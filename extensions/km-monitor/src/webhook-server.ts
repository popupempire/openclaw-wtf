/**
 * km-monitor/src/webhook-server.ts
 *
 * Lightweight HTTP webhook receiver that accepts POST payloads from external
 * LLM interfaces (ChatGPT browser extension, Claude.ai, Gemini, etc.) and
 * writes them to the local webhook buffer consumed by the WebhookBufferAdapter.
 *
 * Start with:
 *   bun extensions/km-monitor/src/webhook-server.ts
 *
 * Environment variables:
 *   KM_MONITOR_WEBHOOK_PORT    — Port to listen on (default: 7842)
 *   KM_MONITOR_WEBHOOK_SECRET  — Optional shared secret for request validation
 *   KM_MONITOR_WEBHOOK_BUFFER  — Path to the buffer file (default: ~/.openclaw/km-monitor/webhook-buffer.ndjson)
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { ConversationRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.KM_MONITOR_WEBHOOK_PORT ?? "7842", 10);
const SECRET = process.env.KM_MONITOR_WEBHOOK_SECRET ?? "";

function resolveBufferPath(): string {
  if (process.env.KM_MONITOR_WEBHOOK_BUFFER) {
    return process.env.KM_MONITOR_WEBHOOK_BUFFER;
  }
  const home = process.env.HOME ?? "/tmp";
  return join(home, ".openclaw", "km-monitor", "webhook-buffer.ndjson");
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
 * Accepts several common shapes:
 *   - `{ id, source, content, originUrl?, metadata? }` — native format
 *   - `{ conversation_id, messages: [{role, content}], model }` — OpenAI-style
 *   - `{ id, messages: [{role, content}], model }` — generic chat export
 *   - `{ text }` — plain text blob
 */
function normalisePayload(
  raw: Record<string, unknown>,
): ConversationRecord | null {
  const now = new Date().toISOString();

  // Native format.
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

  // OpenAI / generic chat export with messages array.
  if (Array.isArray(raw.messages)) {
    const content = (
      raw.messages as Array<{ role?: string; content?: string }>
    )
      .map((m) => `[${m.role ?? "unknown"}]: ${m.content ?? ""}`)
      .join("\n");

    const source = raw.model
      ? `openai-${String(raw.model).split("-")[0]}`
      : "custom-webhook";

    return {
      id: String(raw.conversation_id ?? raw.id ?? randomUUID()),
      source,
      detectedAt: now,
      content,
      originUrl: raw.url ? String(raw.url) : undefined,
      metadata: { model: raw.model },
    };
  }

  // Plain text blob.
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

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Health check.
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true, service: "km-monitor-webhook" });
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

  // Append to buffer file.
  const bufferPath = resolveBufferPath();
  const bufferDir = dirname(bufferPath);
  if (!existsSync(bufferDir)) mkdirSync(bufferDir, { recursive: true });

  appendFileSync(bufferPath, JSON.stringify(record) + "\n", "utf-8");

  console.log(
    `[km-monitor/webhook] Received conversation ${record.id} from ${record.source}`,
  );

  return sendJson(res, 200, { ok: true, id: record.id });
});

server.listen(PORT, () => {
  console.log(
    `[km-monitor/webhook] Webhook receiver listening on http://0.0.0.0:${PORT}/ingest`,
  );
  console.log(
    `[km-monitor/webhook] Buffer file: ${resolveBufferPath()}`,
  );
  if (SECRET) {
    console.log(
      `[km-monitor/webhook] Secret validation: ENABLED (header: x-km-monitor-secret)`,
    );
  }
});

export { server };
