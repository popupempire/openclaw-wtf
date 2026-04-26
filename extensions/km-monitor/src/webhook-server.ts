/**
 * km-monitor/src/webhook-server.ts
 *
 * Lightweight HTTP webhook receiver that accepts POST payloads from external
 * LLM interfaces (ChatGPT browser extension, Claude.ai, Gemini, Mistral, etc.)
 * and writes them to the local webhook buffer consumed by the scanner adapters.
 *
 * Start with:
 *   bun extensions/km-monitor/src/webhook-server.ts
 *
 * Endpoints:
 *   GET  /health   — liveness check
 *   GET  /status   — buffer statistics (counts per source)
 *   POST /ingest   — accept a conversation payload
 *
 * Environment variables:
 *   KM_MONITOR_WEBHOOK_PORT    — Port to listen on (default: 7842)
 *   KM_MONITOR_WEBHOOK_SECRET  — Optional shared secret for request validation
 *   KM_MONITOR_WEBHOOK_BUFFER  — Path to the generic buffer file
 *   KM_MONITOR_KM_DIR          — KM directory (used for source-specific buffers)
 *
 * Enhanced in v1.1.0:
 *   - Source-specific routing: payloads with a known `source` field are written
 *     to `buffer-<source>.ndjson` in the KM directory, enabling per-source
 *     deduplication by the named LLM adapters.
 *   - Generic buffer retains payloads from unknown sources.
 *   - Added GET /status endpoint for observability.
 *   - Improved payload normalisation: detects Claude, Gemini, and Mistral
 *     message formats in addition to OpenAI-style exports.
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
]);

function resolveKmDir(): string {
  const home = process.env.HOME ?? "/tmp";
  return (
    process.env.KM_MONITOR_KM_DIR ??
    join(home, ".openclaw", "km-monitor")
  );
}

function resolveBufferPath(source?: string): string {
  // Route named sources to their own sub-buffer for per-source deduplication.
  if (source && NAMED_SOURCES.has(source)) {
    return join(resolveKmDir(), `buffer-${source}.ndjson`);
  }
  // Fall back to the generic buffer (also overrideable via env).
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
// Payload normaliser
// ---------------------------------------------------------------------------

/**
 * Normalise an incoming webhook payload into a ConversationRecord.
 *
 * Accepted payload shapes:
 *   1. Native format:       `{ id, source, content, originUrl?, metadata? }`
 *   2. OpenAI chat export:  `{ conversation_id?, messages: [{role, content}], model }`
 *   3. Claude export:       `{ uuid, name, chat_messages: [{sender, text}] }`
 *   4. Gemini export:       `{ conversationId, turns: [{author, text}] }`
 *   5. Generic messages:    `{ id?, messages: [{role, content}] }`
 *   6. Plain text blob:     `{ text }`
 */
function normalisePayload(
  raw: Record<string, unknown>,
): ConversationRecord | null {
  const now = new Date().toISOString();

  // 1. Native format — most specific, check first.
  if (typeof raw.content === "string" && typeof raw.source === "string") {
    return {
      id: String(raw.id ?? randomUUID()),
      source: String(raw.source),
      detectedAt: now,
      content: raw.content,
      originUrl: raw.originUrl ? String(raw.originUrl) : undefined,
      metadata: raw.metadata as Record<string, unknown> | undefined,
    };
  }

  // 2. OpenAI / generic chat export with `messages` array.
  if (Array.isArray(raw.messages)) {
    const content = (raw.messages as Array<{ role?: string; content?: string }>)
      .map((m) => `[${m.role ?? "unknown"}]: ${m.content ?? ""}`)
      .join("\n");

    // Infer source from model name if available.
    let source = "custom-webhook";
    if (typeof raw.model === "string") {
      const m = raw.model.toLowerCase();
      if (m.includes("gpt") || m.includes("openai")) source = "openai-chatgpt";
      else if (m.includes("claude")) source = "anthropic-claude";
      else if (m.includes("gemini")) source = "google-gemini";
      else if (m.includes("mistral")) source = "mistral";
      else if (m.includes("llama")) source = "meta-llama";
    }

    return {
      id: String(raw.conversation_id ?? raw.id ?? randomUUID()),
      source,
      detectedAt: now,
      content,
      originUrl: raw.url ? String(raw.url) : undefined,
      metadata: { model: raw.model },
    };
  }

  // 3. Claude export format (`chat_messages` with `sender`/`text` fields).
  if (Array.isArray(raw.chat_messages)) {
    const content = (
      raw.chat_messages as Array<{ sender?: string; text?: string }>
    )
      .map((m) => `[${m.sender ?? "unknown"}]: ${m.text ?? ""}`)
      .join("\n");
    return {
      id: String(raw.uuid ?? raw.id ?? randomUUID()),
      source: "anthropic-claude",
      detectedAt: now,
      content,
      originUrl: raw.url ? String(raw.url) : undefined,
      metadata: { name: raw.name },
    };
  }

  // 4. Gemini export format (`turns` with `author`/`text` fields).
  if (Array.isArray(raw.turns)) {
    const content = (raw.turns as Array<{ author?: string; text?: string }>)
      .map((t) => `[${t.author ?? "unknown"}]: ${t.text ?? ""}`)
      .join("\n");
    return {
      id: String(raw.conversationId ?? raw.id ?? randomUUID()),
      source: "google-gemini",
      detectedAt: now,
      content,
      originUrl: raw.url ? String(raw.url) : undefined,
    };
  }

  // 5. Plain text blob.
  if (typeof raw.text === "string") {
    return {
      id: randomUUID(),
      source: "custom-webhook",
      detectedAt: now,
      content: raw.text,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Return buffer file statistics for the /status endpoint. */
function getBufferStats(): Record<string, { path: string; sizeBytes: number }> {
  const kmDir = resolveKmDir();
  const stats: Record<string, { path: string; sizeBytes: number }> = {};
  if (!existsSync(kmDir)) return stats;
  try {
    for (const file of readdirSync(kmDir)) {
      if (file.endsWith(".ndjson")) {
        const filePath = join(kmDir, file);
        try {
          const s = statSync(filePath);
          stats[file] = { path: filePath, sizeBytes: s.size };
        } catch {
          // Skip unreadable files.
        }
      }
    }
  } catch {
    // Directory not readable.
  }
  return stats;
}

const server = createServer(
  async (req: IncomingMessage, res: ServerResponse) => {
    // Health check.
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "km-monitor-webhook",
        version: "1.1.0",
      });
    }

    // Status endpoint — buffer file statistics.
    if (req.method === "GET" && req.url === "/status") {
      return sendJson(res, 200, {
        ok: true,
        buffers: getBufferStats(),
        namedSources: Array.from(NAMED_SOURCES),
        port: PORT,
      });
    }

    // Only accept POST /ingest.
    if (req.method !== "POST" || req.url !== "/ingest") {
      return sendJson(res, 404, { ok: false, error: "Not found" });
    }

    // Optional secret validation.
    if (SECRET) {
      const provided = req.headers["x-km-monitor-secret"];
      if (provided !== SECRET) {
        return sendJson(res, 401, { ok: false, error: "Unauthorized" });
      }
    }

    let body: string;
    try {
      body = await readBody(req);
    } catch {
      return sendJson(res, 400, { ok: false, error: "Failed to read body" });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { ok: false, error: "Invalid JSON" });
    }

    const record = normalisePayload(parsed);
    if (!record) {
      return sendJson(res, 422, {
        ok: false,
        error: "Could not normalise payload into a ConversationRecord",
      });
    }

    // Route to source-specific or generic buffer.
    const bufferPath = resolveBufferPath(record.source);
    const bufferDir = dirname(bufferPath);
    if (!existsSync(bufferDir)) mkdirSync(bufferDir, { recursive: true });

    appendFileSync(bufferPath, JSON.stringify(record) + "\n", "utf-8");

    console.log(
      `[km-monitor/webhook] Received conversation ${record.id} from ${record.source} → ${bufferPath}`,
    );

    return sendJson(res, 200, {
      ok: true,
      id: record.id,
      source: record.source,
      buffer: bufferPath,
    });
  },
);

server.listen(PORT, () => {
  console.log(
    `[km-monitor/webhook] Webhook receiver v1.1.0 listening on http://0.0.0.0:${PORT}/ingest`,
  );
  console.log(`[km-monitor/webhook] KM directory: ${resolveKmDir()}`);
  console.log(
    `[km-monitor/webhook] Named source routing: ${Array.from(NAMED_SOURCES).join(", ")}`,
  );
  if (SECRET) {
    console.log(
      `[km-monitor/webhook] Secret validation: ENABLED (header: x-km-monitor-secret)`,
    );
  }
});

export { server };
