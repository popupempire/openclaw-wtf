import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { categoriesForDepartment, DEFAULT_TAXONOMY } from "./taxonomy";
import { itemsToCsv } from "./csv";
import { analyzePhoto } from "./photo-analysis";
import { clearAll as clearAllItems, listItems, putItem, removeItem } from "./db";
import { parseComps, suggestPrice } from "./pricing";
import type {
  Condition,
  DownsizeItem,
  DownsizeItemStatus,
  DownsizePhoto,
  PriceStrategy,
} from "./types";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return `$${value}`;
}

function nowMs(): number {
  return Date.now();
}

function createDefaultItem(): DownsizeItem {
  const t = nowMs();
  return {
    id: newId(),
    createdAtMs: t,
    updatedAtMs: t,
    status: "pending",
    title: "",
    department: "Unsorted",
    category: "Unsorted",
    condition: "unknown",
    strategy: "balanced",
    comps: [],
    suggestedPrice: null,
    price: null,
    notes: "",
    photos: [],
  };
}

function normalizeCondition(raw: string): Condition {
  switch (raw) {
    case "new":
    case "like_new":
    case "good":
    case "fair":
    case "for_parts":
    case "unknown":
      return raw;
    default:
      return "unknown";
  }
}

function normalizeStrategy(raw: string): PriceStrategy {
  switch (raw) {
    case "sell_fast":
    case "balanced":
    case "maximize":
      return raw;
    default:
      return "balanced";
  }
}

function downloadTextFile(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

@customElement("openclaw-downsize")
export class OpenClawDownsize extends LitElement {
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private items: DownsizeItem[] = [];
  @state() private selectedId: string | null = null;

  @state() private exportPending = false;
  @state() private exportInProgress = true;
  @state() private exportExported = true;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    this.loading = true;
    this.error = null;
    try {
      this.items = await listItems();
      if (!this.selectedId && this.items.length) {
        this.selectedId = this.items[0]?.id ?? null;
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  private selected(): DownsizeItem | null {
    if (!this.selectedId) return null;
    return this.items.find((item) => item.id === this.selectedId) ?? null;
  }

  private async persist(item: DownsizeItem) {
    const updated: DownsizeItem = { ...item, updatedAtMs: nowMs() };
    await putItem(updated);
    this.items = this.items.map((entry) => (entry.id === updated.id ? updated : entry));
  }

  private async createItem() {
    const item = createDefaultItem();
    await putItem(item);
    this.items = [item, ...this.items];
    this.selectedId = item.id;
  }

  private async deleteItem(item: DownsizeItem) {
    const ok = window.confirm("Delete this item? This cannot be undone.");
    if (!ok) return;
    await removeItem(item.id);
    const nextItems = this.items.filter((entry) => entry.id !== item.id);
    this.items = nextItems;
    if (this.selectedId === item.id) {
      this.selectedId = nextItems[0]?.id ?? null;
    }
  }

  private async updateStatus(item: DownsizeItem, status: DownsizeItemStatus) {
    await this.persist({ ...item, status });
  }

  private async setTitle(item: DownsizeItem, title: string) {
    await this.persist({ ...item, title });
  }

  private async setNotes(item: DownsizeItem, notes: string) {
    await this.persist({ ...item, notes });
  }

  private async setDepartment(item: DownsizeItem, department: string) {
    const categories = categoriesForDepartment(DEFAULT_TAXONOMY, department);
    const category = categories.includes(item.category) ? item.category : (categories[0] ?? "Unsorted");
    await this.persist({ ...item, department, category });
  }

  private async setCategory(item: DownsizeItem, category: string) {
    await this.persist({ ...item, category });
  }

  private async setCondition(item: DownsizeItem, raw: string) {
    await this.persist({ ...item, condition: normalizeCondition(raw) });
  }

  private async setStrategy(item: DownsizeItem, raw: string) {
    const strategy = normalizeStrategy(raw);
    const next = { ...item, strategy };
    const suggestion = suggestPrice(next.comps, next.strategy);
    next.suggestedPrice = suggestion?.suggested ?? null;
    await this.persist(next);
  }

  private async setComps(item: DownsizeItem, raw: string) {
    const comps = parseComps(raw);
    const suggestion = suggestPrice(comps, item.strategy);
    await this.persist({
      ...item,
      comps,
      suggestedPrice: suggestion?.suggested ?? null,
    });
  }

  private async setPrice(item: DownsizeItem, raw: string) {
    const cleaned = raw.trim().replace(/^\$/, "");
    if (!cleaned) {
      await this.persist({ ...item, price: null });
      return;
    }
    const num = Number(cleaned);
    if (!Number.isFinite(num) || num <= 0) return;
    await this.persist({ ...item, price: Math.round(num) });
  }

  private async addPhotos(item: DownsizeItem, files: FileList | null) {
    if (!files || files.length === 0) return;
    const nextPhotos: DownsizePhoto[] = [];
    for (const file of Array.from(files)) {
      try {
        const analysis = await analyzePhoto(file);
        nextPhotos.push({
          id: newId(),
          createdAtMs: nowMs(),
          mime: file.type || "image/jpeg",
          blob: file,
          analysis,
        });
      } catch {
        // ignore individual photo failures
      }
    }
    if (nextPhotos.length === 0) return;
    await this.persist({ ...item, photos: [...item.photos, ...nextPhotos] });
  }

  private async removePhoto(item: DownsizeItem, photoId: string) {
    const next = item.photos.filter((p) => p.id !== photoId);
    await this.persist({ ...item, photos: next });
  }

  private exportCsv() {
    const allow: Record<DownsizeItemStatus, boolean> = {
      pending: this.exportPending,
      in_progress: this.exportInProgress,
      exported: this.exportExported,
    };
    const filtered = this.items.filter((item) => allow[item.status]);
    const csv = itemsToCsv(filtered);
    downloadTextFile(`openclaw-downsize-${todayIsoDate()}.csv`, csv, "text/csv");
  }

  private async clearAll() {
    const ok = window.confirm("Clear all downsize items? This cannot be undone.");
    if (!ok) return;
    await clearAllItems();
    this.items = [];
    this.selectedId = null;
  }

  private renderItemList() {
    if (this.items.length === 0) {
      return html`<div class="card">
        <div class="card-title">No items yet</div>
        <div class="card-sub">Tap “New item”, take a few photos, and export when ready.</div>
      </div>`;
    }

    return html`
      <div class="downsize-list">
        ${this.items.map((item) => {
          const active = item.id === this.selectedId;
          const title = item.title.trim() || "Untitled item";
          const price = item.price ?? item.suggestedPrice;
          return html`
            <button class="downsize-item ${active ? "active" : ""}" @click=${() => (this.selectedId = item.id)}>
              <div class="downsize-item__title">${title}</div>
              <div class="downsize-item__meta">
                <span class="pill">${item.status.replaceAll("_", " ")}</span>
                <span class="pill">${item.department}</span>
                <span class="pill">${item.category}</span>
                ${price != null ? html`<span class="pill ok">${formatMoney(price)}</span>` : nothing}
              </div>
            </button>
          `;
        })}
      </div>
    `;
  }

  private renderSelected(item: DownsizeItem) {
    const title = item.title.trim();
    const categories = categoriesForDepartment(DEFAULT_TAXONOMY, item.department);
    const compsRaw = item.comps.length ? item.comps.join(" ") : "";
    const suggestion = item.suggestedPrice;
    const priceUsed = item.price ?? suggestion;

    const photoFlags = Array.from(new Set(item.photos.flatMap((p) => p.analysis.flags)));

    const searchQuery = encodeURIComponent(
      (title || `${item.department} ${item.category}`).trim(),
    );
    const soldCompsUrl = `https://www.ebay.com/sch/i.html?_nkw=${searchQuery}&LH_Sold=1&LH_Complete=1`;

    return html`
      <div class="card">
        <div class="downsize-header">
          <div>
            <div class="card-title">${title || "Untitled item"}</div>
            <div class="card-sub">
              ${item.status.replaceAll("_", " ")} · ${item.photos.length} photos
              ${priceUsed != null ? html` · ${formatMoney(priceUsed)}` : nothing}
            </div>
          </div>
          <div class="downsize-actions">
            ${item.status === "pending"
              ? html`<button class="btn primary" @click=${() => this.updateStatus(item, "in_progress")}>
                  Approve
                </button>`
              : nothing}
            ${item.status !== "exported"
              ? html`<button class="btn" @click=${() => this.updateStatus(item, "exported")}>
                  Mark exported
                </button>`
              : nothing}
            <button class="btn danger" @click=${() => this.deleteItem(item)}>Delete</button>
          </div>
        </div>

        <div class="downsize-grid">
          <label class="field full">
            <span>Title</span>
            <input
              .value=${item.title}
              placeholder="What is it?"
              @input=${(e: InputEvent) => this.setTitle(item, (e.target as HTMLInputElement).value)}
            />
          </label>

          <label class="field">
            <span>Department</span>
            <select
              .value=${item.department}
              @change=${(e: Event) => this.setDepartment(item, (e.target as HTMLSelectElement).value)}
            >
              ${DEFAULT_TAXONOMY.map(
                (entry) =>
                  html`<option value=${entry.department}>${entry.department}</option>`,
              )}
            </select>
          </label>

          <label class="field">
            <span>Category</span>
            <select
              .value=${item.category}
              @change=${(e: Event) => this.setCategory(item, (e.target as HTMLSelectElement).value)}
            >
              ${categories.map((cat) => html`<option value=${cat}>${cat}</option>`)}
            </select>
          </label>

          <label class="field">
            <span>Condition</span>
            <select
              .value=${item.condition}
              @change=${(e: Event) => this.setCondition(item, (e.target as HTMLSelectElement).value)}
            >
              <option value="unknown">Unknown</option>
              <option value="new">New</option>
              <option value="like_new">Like new</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="for_parts">For parts</option>
            </select>
          </label>

          <div class="field">
            <span>Strategy</span>
            <select
              .value=${item.strategy}
              @change=${(e: Event) => this.setStrategy(item, (e.target as HTMLSelectElement).value)}
            >
              <option value="sell_fast">Sell fast</option>
              <option value="balanced">Balanced</option>
              <option value="maximize">Maximize</option>
            </select>
          </div>

          <label class="field">
            <span>Comps (paste sold prices)</span>
            <input
              .value=${compsRaw}
              placeholder="e.g. 25 30 22 28"
              @input=${(e: InputEvent) => this.setComps(item, (e.target as HTMLInputElement).value)}
            />
          </label>

          <div class="field">
            <span>Suggested</span>
            <input value=${suggestion == null ? "" : String(suggestion)} disabled />
          </div>

          <label class="field">
            <span>Price (override)</span>
            <input
              .value=${item.price == null ? "" : String(item.price)}
              placeholder="$"
              inputmode="decimal"
              @input=${(e: InputEvent) => this.setPrice(item, (e.target as HTMLInputElement).value)}
            />
          </label>

          <div class="field full">
            <span>Quick links</span>
            <div class="downsize-links">
              <a class="btn" href=${soldCompsUrl} target="_blank" rel="noreferrer">Search sold comps (eBay)</a>
            </div>
          </div>

          <label class="field full">
            <span>Notes (be honest)</span>
            <textarea
              .value=${item.notes}
              rows="4"
              placeholder="Defects, wear, missing parts, what it’s not great for…"
              @input=${(e: InputEvent) => this.setNotes(item, (e.target as HTMLTextAreaElement).value)}
            ></textarea>
          </label>
        </div>

        <div class="downsize-photos">
          <div class="downsize-photos__header">
            <div class="card-title">Photos</div>
            <label class="btn primary">
              Add photos
              <input
                class="downsize-file"
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                @change=${(e: Event) => {
                  const el = e.target as HTMLInputElement;
                  void this.addPhotos(item, el.files);
                  el.value = "";
                }}
              />
            </label>
          </div>
          ${photoFlags.length
            ? html`<div class="downsize-flags">
                ${photoFlags.map((flag) => html`<span class="pill warn">${flag.replaceAll("_", " ")}</span>`)}
              </div>`
            : nothing}
          <div class="downsize-photo-grid">
            ${item.photos.map((photo) => {
              const url = URL.createObjectURL(photo.blob);
              const flags = photo.analysis.flags;
              return html`
                <div class="downsize-photo">
                  <img
                    src=${url}
                    alt="Item photo"
                    @load=${() => URL.revokeObjectURL(url)}
                    @error=${() => URL.revokeObjectURL(url)}
                  />
                  <div class="downsize-photo__meta">
                    ${flags.length
                      ? html`<div class="downsize-photo__flags">
                          ${flags.map(
                            (flag) =>
                              html`<span class="pill warn">${flag.replaceAll("_", " ")}</span>`,
                          )}
                        </div>`
                      : html`<span class="pill ok">ok</span>`}
                    <button class="btn btn--sm danger" @click=${() => this.removePhoto(item, photo.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              `;
            })}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    const selected = this.selected();

    return html`
      <div class="downsize-shell">
        <div class="downsize-top">
          <div class="downsize-top__left">
            <button class="btn primary" @click=${() => this.createItem()}>New item</button>
            <button class="btn" @click=${() => this.exportCsv()} ?disabled=${this.items.length === 0}>
              Download CSV
            </button>
          </div>
          <div class="downsize-top__right">
            <label class="pill">
              <input
                type="checkbox"
                .checked=${this.exportPending}
                @change=${(e: Event) => (this.exportPending = (e.target as HTMLInputElement).checked)}
              />
              pending
            </label>
            <label class="pill">
              <input
                type="checkbox"
                .checked=${this.exportInProgress}
                @change=${(e: Event) => (this.exportInProgress = (e.target as HTMLInputElement).checked)}
              />
              in progress
            </label>
            <label class="pill">
              <input
                type="checkbox"
                .checked=${this.exportExported}
                @change=${(e: Event) => (this.exportExported = (e.target as HTMLInputElement).checked)}
              />
              exported
            </label>
            <button class="btn danger" @click=${() => this.clearAll()} ?disabled=${this.items.length === 0}>
              Clear all
            </button>
          </div>
        </div>

        ${this.error ? html`<div class="pill danger">${this.error}</div>` : nothing}

        ${this.loading
          ? html`<div class="card"><div class="card-title">Loading…</div></div>`
          : html`
              <div class="downsize-layout">
                <aside class="downsize-sidebar">${this.renderItemList()}</aside>
                <section class="downsize-main">
                  ${selected ? this.renderSelected(selected) : nothing}
                </section>
              </div>
            `}
      </div>
    `;
  }
}
