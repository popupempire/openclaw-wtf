/**
 * km-monitor/src/webhook-server.ts  — v1.2.0
 *
 * Lightweight HTTP webhook receiver that accepts POST payloads from external
 * LLM interfaces and writes them to the local webhook buffer consumed by
 * the scanner adapters.
 *
 * Changes in v1.2.0:
 *   - Added routing for "xai-grok", "perplexity", "deepseek", "cohere".
 *   - Added GET /adapters endpoint listing all known source identifiers.
 *   - Improved payload normalisation for Grok and Perplexity message formats.
 *   - Added `X-Batch-ID` response header for traceability.
 *
 * Endpoints:
 *   GET  /health    — liveness check
 *   GET  /status    — buffer statistics (counts per source)
 *   GET  /adapters  — list all known LLM source identifiers
 *   POST /ingest    — accept a conversation payload
 *
 * Environment variables:
 *   KM_MONITOR_WEBHOOK_PORT    — Port to listen on (default: 7842)
 *   KM_MONITOR_WEBHOOK_SECRET  — Optional shared secret for request validation
 *   KM_MONITOR_WEBHOOK_BUFFER  — Path to the generic buffer file
 *   KM_MONITOR_KM_DIR          — KM directory (used for source-specific buffers)
 */
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { appendFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { ConversationRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.KM_MONITOR_WEBHOOK_PORT ?? "7842", 10);
const SECRET = process.env.KM_MONITOR_WEBHOOK_SECRET ?? "";

/** Well-known source identifiers that get their own sub-buffer files. */
const NAMED_SOURCES = new Set([
  "openai-chatgpt",
  "anthropic-claude",
  "google-gemini",
  "mistral",
  "meta-llama",
  "cohere",
  "xai-grok",
  "perplexity",
  "deepseek",
]);

function resolveKmDir(): string {
  const home = process.env.HOME ?? "/tmp";
  return (
    process.env.KM_MONITOR_KM_DIR ??
    join(home, ".openclaw", "km-monitor")
  );
}

function resolveBufferPath(source?: string): string {
  if (source && NAMED_SOURCES.has(source)) {
    return join(resolveKmDir(), `buffer-${source}.ndjson`);
  }
  if (process.env.KM_MONITOR_WEBHOOK_BUFFER) {
    return process.env.KM_MONITOR_WEBHOOK_BUFFER;
  }
  return join(resolveKmDir(), "webhook-buffer.ndjson");
}

// ---------------------------------------------------------------------------
// Request body reader
// ---------------------------------------------------------------------------

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Payload normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a raw inbound payload into a ConversationRecord.
 * Handles OpenAI, Anthropic, Google, Mistral, Grok, Perplexity, and DeepSeek formats.
 */
function normalisePayload(raw: unknown): ConversationRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  // Already a ConversationRecord shape.
  if (typeof obj.id === "string" && typeof obj.content === "string") {
    return {
      id: obj.id,
      source: (obj.source as string) ?? "custom-webhook",
      detectedAt: (obj.detectedAt as string) ?? new Date().toISOString(),
      content: obj.content,
      originUrl: obj.originUrl as string | undefined,
      metadata: obj.metadata as Record<string, unknown> | undefined,
    };
  }

  // OpenAI ChatGPT export format.
  if (Array.isArray(obj.mapping)) {
    const messages = (obj.mapping as Array<{ message?: { author?: { role: string }; content?: { parts?: string[] } } }>)
      .filter((n) => n.message?.content?.parts)
      .map((n) => `[${n.message!.author?.role ?? "unknown"}]: ${n.message!.content!.parts!.join(" ")}`)
      .join("\n");
    return {
      id: (obj.id as string) ?? randomUUID(),
      source: "openai-chatgpt",
      detectedAt: new Date().toISOString(),
      content: messages,
      originUrl: undefined,
    };
  }

  // Anthropic Claude format (messages array).
  if (Array.isArray(obj.messages) && typeof obj.model === "string" && (obj.model as string).includes("claude")) {
    const messages = (obj.messages as Array<{ role: string; content: string | Array<{ text: string }> }>)
      .map((m) => {
        const text = Array.isArray(m.content)
          ? m.content.map((c) => c.text).join(" ")
          : m.content;
        return `[${m.role}]: ${text}`;
      })
      .join("\n");
    return {
      id: (obj.id as string) ?? randomUUID(),
      source: "anthropic-claude",
      detectedAt: new Date().toISOString(),
      content: messages,
      originUrl: undefined,
    };
  }

  // Google Gemini format.
  if (Array.isArray(obj.contents)) {
    const messages = (obj.contents as Array<{ role: string; parts: Array<{ text: string }> }>)
      .map((c) => `[${c.role}]: ${c.parts.map((p) => p.text).join(" ")}`)
      .join("\n");
    return {
      id: (obj.id as string) ?? randomUUID(),
      source: "google-gemini",
      detectedAt: new Date().toISOString(),
      content: messages,
      originUrl: undefined,
    };
  }

  // Mistral / OpenAI-compatible messages array (generic).
  if (Array.isArray(obj.messages)) {
    const messages = (obj.messages as Array<{ role: string; content: string }>)
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n");
    const source = (obj.source as string) ?? "custom-webhook";
    return {
      id: (obj.id as string) ?? randomUUID(),
      source,
      detectedAt: new Date().toISOString(),
      content: messages,
      originUrl: undefined,
    };
  }

  // Perplexity format (answer + search_results).
  if (typeof obj.answer === "string") {
    const content = [
      `[user]: ${obj.query ?? ""}`,
      `[assistant]: ${obj.answer}`,
    ].join("\n");
    return {
      id: (obj.id as string) ?? randomUUID(),
      source: "perplexity",
      detectedAt: new Date().toISOString(),
      content,
      originUrl: undefined,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    ...headers,
  });
  res.end(json);
}

export function startWebhookServer(): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    // --- GET /health ---
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, ts: new Date().toISOString() });
    }

    // --- GET /adapters ---
    if (req.method === "GET" && url.pathname === "/adapters") {
      return sendJson(res, 200, {
        ok: true,
        namedSources: Array.from(NAMED_SOURCES),
        genericBuffer: "custom-webhook",
      });
    }

    // --- GET /status ---
    if (req.method === "GET" && url.pathname === "/status") {
      const kmDir = resolveKmDir();
      const counts: Record<string, number> = {};
      if (existsSync(kmDir)) {
        for (const file of readdirSync(kmDir)) {
          if (!file.startsWith("buffer-") && file !== "webhook-buffer.ndjson") continue;
          const filePath = join(kmDir, file);
          try {
            const stat = statSync(filePath);
            counts[file] = stat.size;
          } catch {
            counts[file] = -1;
          }
        }
      }
      return sendJson(res, 200, { ok: true, buffers: counts });
    }

    // --- POST /ingest ---
    if (req.method === "POST" && url.pathname === "/ingest") {
      // Optional shared secret validation.
      if (SECRET) {
        const authHeader = req.headers["authorization"] ?? "";
        const tokenHeader = req.headers["x-openclaw-token"] ?? "";
        const tokenQuery = url.searchParams.get("token") ?? "";
        const provided =
          authHeader.replace(/^Bearer\s+/i, "") || tokenHeader || tokenQuery;
        if (provided !== SECRET) {
          return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        }
      }

      let bodyText: string;
      try {
        bodyText = await readBody(req);
      } catch {
        return sendJson(res, 400, { ok: false, error: "Failed to read request body" });
      }

      let rawPayload: unknown;
      try {
        rawPayload = JSON.parse(bodyText);
      } catch {
        return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
      }

      const record = normalisePayload(rawPayload);
      if (!record) {
        return sendJson(res, 422, { ok: false, error: "Unrecognised payload format" });
      }

      const bufferPath = resolveBufferPath(record.source);
      const bufferDir = dirname(bufferPath);
      if (!existsSync(bufferDir)) mkdirSync(bufferDir, { recursive: true });

      try {
        appendFileSync(bufferPath, JSON.stringify(record) + "\n", "utf-8");
      } catch (err) {
        console.error("[km-monitor/webhook-server] Failed to write buffer:", err);
        return sendJson(res, 500, { ok: false, error: "Failed to write buffer" });
      }

      const batchId = randomUUID();
      console.log(
        `[km-monitor/webhook-server] Ingested conv=${record.id} source=${record.source} buffer=${bufferPath}`,
      );
      return sendJson(res, 200, { ok: true, id: record.id, source: record.source, batchId }, {
        "X-Batch-ID": batchId,
      });
    }

    return sendJson(res, 404, { ok: false, error: "Not found" });
  });

  server.listen(PORT, () => {
    console.log(`[km-monitor/webhook-server] Listening on http://localhost:${PORT}`);
    console.log(`[km-monitor/webhook-server] Known sources: ${Array.from(NAMED_SOURCES).join(", ")}`);
  });
}

// Allow direct execution: `node webhook-server.js`
startWebhookServer();
