# Knowledge Map Monitor (`km-monitor`)

> **Autonomous multi-LLM conversation monitor, Knowledge Map enrichment pipeline, and notification system for [OpenClaw](https://openclaw.ai).**

**Version:** 1.1.0

---

## Overview

The `km-monitor` extension continuously scans all configured LLM interfaces for new conversations, extracts high-quality "gold" insights using an LLM-powered pipeline, enriches the internal **Knowledge Map (KM)**, and dispatches traceable notifications for every change.

Every entry in the KM carries a full provenance chain — linking it back to the exact conversation, source LLM interface, extraction model, and timestamp that produced it. An append-only **audit log** records every add and skip-duplicate event for complete change-log traceability.

**v1.1.0 adds:**
- Named adapters for **ChatGPT, Claude, Gemini, Mistral, and Meta Llama** with source-specific buffer routing.
- `createAllAdapters()` factory and `--all-adapters` CLI flag for full multi-LLM coverage.
- Enriched gold-extraction prompt with stricter selection criteria and lower temperature.
- `extractionModel` and `rawConfidence` fields in every `Provenance` object.
- Append-only **audit log** (`audit.ndjson`) for full change-log traceability.
- Per-source statistics in notifications (conversations detected, gold extracted per source).
- `km_list` agent tool for listing all KM entries with optional source filter.
- `stats` CLI command for KM statistics (entry counts, top tags, per-source breakdown).
- `GET /status` endpoint on the webhook server for buffer observability.
- Claude, Gemini, and Mistral payload normalisation in the webhook server.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Monitor Loop (cron / daemon)                     │
│                                                                      │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────────────┐  │
│  │ Scanner  │───▶│Extractor │───▶│KM Writer │───▶│   Notifier     │  │
│  └──────────┘    └──────────┘    └──────────┘    └────────────────┘  │
│       │               │               │                │             │
│  ┌────┴────────────┐  │          ┌────┴────────┐  ┌────┴──────────┐  │
│  │ Adapters        │  │          │ Outputs     │  │ Channels      │  │
│  │ • OpenClaw      │  │          │ • MD log    │  │ • Console     │  │
│  │ • ChatGPT       │  │          │ • JSON idx  │  │ • File NDJSON │  │
│  │ • Claude        │  │          │ • Audit log │  │ • Discord     │  │
│  │ • Gemini        │  │          └─────────────┘  │ • Slack       │  │
│  │ • Mistral       │  │                           │ • Custom POST │  │
│  │ • Meta Llama    │  │                           └───────────────┘  │
│  │ • Webhook (any) │  │                                              │
│  └─────────────────┘  │                                              │
│                       ▼                                              │
│               gpt-4.1-mini (or override)                             │
└──────────────────────────────────────────────────────────────────────┘
                              ▲
                 ┌────────────┴────────────┐
                 │  Webhook Server :7842   │
                 │  POST /ingest           │
                 │  GET  /health           │
                 │  GET  /status           │
                 └─────────────────────────┘
                 ▲         ▲         ▲
           ChatGPT    Claude.ai   Gemini
           extension  extension   extension
```

| Component | File | Responsibility |
|-----------|------|----------------|
| **Types** | `src/types.ts` | Shared TypeScript interfaces for all data structures |
| **State** | `src/state.ts` | JSON-file-backed persistence of scan progress, cycleCount, sourceStats |
| **Scanner** | `src/scanner.ts` | Polls adapters; returns only unseen conversations; named LLM adapters |
| **Extractor** | `src/extractor.ts` | LLM-powered gold insight extraction with confidence scoring and traceability |
| **KM Writer** | `src/km-writer.ts` | Writes entries to Markdown log + JSON index + audit log; deduplicates |
| **Notifier** | `src/notifier.ts` | Dispatches notifications with per-source summaries and scan errors |
| **Monitor Loop** | `src/monitor-loop.ts` | Orchestrates the full pipeline; continuous or one-shot; cycleCount tracking |
| **Webhook Server** | `src/webhook-server.ts` | HTTP receiver with source-specific buffer routing and /status endpoint |
| **CLI Runner** | `src/cli-runner.ts` | Standalone CLI without the full OpenClaw stack |
| **Plugin Entry** | `index.ts` | OpenClaw plugin registration (CLI + agent tools: scan, search, list) |

---

## Quick Start

### As an OpenClaw Extension

```bash
# Install the extension
openclaw extensions install ./extensions/km-monitor

# Run a one-shot scan (default adapters: OpenClaw + generic webhook)
openclaw km-monitor scan

# Run a one-shot scan with ALL named LLM adapters
openclaw km-monitor scan --all-adapters

# Start the continuous monitor with all adapters
openclaw km-monitor start --all-adapters --interval 30000

# Search the Knowledge Map
openclaw km-monitor search "neurodivergent productivity"

# Search filtered to a specific LLM source
openclaw km-monitor search --source openai-chatgpt "productivity"

# List all entries from Claude
openclaw km-monitor list anthropic-claude

# Print KM statistics
openclaw km-monitor stats

# Check status
openclaw km-monitor status
```

### Standalone (without OpenClaw CLI)

```bash
# One-shot scan with all adapters
bun extensions/km-monitor/src/cli-runner.ts scan --all-adapters

# Continuous monitor
bun extensions/km-monitor/src/cli-runner.ts start --all-adapters

# Dry-run (analyse without writing)
bun extensions/km-monitor/src/cli-runner.ts scan --dry-run

# Search
bun extensions/km-monitor/src/cli-runner.ts search "knowledge management"

# Search filtered by source
bun extensions/km-monitor/src/cli-runner.ts search --source anthropic-claude "reasoning"

# List all entries
bun extensions/km-monitor/src/cli-runner.ts list

# List entries from a specific source
bun extensions/km-monitor/src/cli-runner.ts list google-gemini

# Print KM statistics
bun extensions/km-monitor/src/cli-runner.ts stats
```

### Webhook Receiver (for external LLM interfaces)

```bash
# Start the webhook receiver
bun extensions/km-monitor/src/webhook-server.ts

# Check health
curl http://localhost:7842/health

# Check buffer statistics
curl http://localhost:7842/status

# POST a ChatGPT conversation (routes to buffer-openai-chatgpt.ndjson)
curl -X POST http://localhost:7842/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "id": "chatgpt-session-001",
    "source": "openai-chatgpt",
    "content": "[user]: How do I build a knowledge management system?\n[assistant]: A KMS should...",
    "originUrl": "https://chat.openai.com/c/abc123"
  }'

# POST a Claude conversation (routes to buffer-anthropic-claude.ndjson)
curl -X POST http://localhost:7842/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "uuid": "claude-conv-xyz",
    "chat_messages": [
      {"sender": "human", "text": "Explain constitutional AI"},
      {"sender": "assistant", "text": "Constitutional AI is a technique..."}
    ]
  }'

# POST an OpenAI-style chat export (source inferred from model name)
curl -X POST http://localhost:7842/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [
      {"role": "user", "content": "What is retrieval-augmented generation?"},
      {"role": "assistant", "content": "RAG combines a retrieval system..."}
    ]
  }'
```

---

## Multi-LLM Adapter Coverage

When `KM_MONITOR_ALL_ADAPTERS=1` (or `--all-adapters` flag), the following adapters are active:

| Adapter | Source ID | Buffer File | Activation |
|---------|-----------|-------------|------------|
| OpenClaw Session | `openclaw-session` | OpenClaw session store | Always available |
| ChatGPT | `openai-chatgpt` | `buffer-openai-chatgpt.ndjson` | `--all-adapters` |
| Claude | `anthropic-claude` | `buffer-anthropic-claude.ndjson` | `--all-adapters` |
| Gemini | `google-gemini` | `buffer-google-gemini.ndjson` | `--all-adapters` |
| Mistral | `mistral` | `buffer-mistral.ndjson` | `--all-adapters` |
| Meta Llama | `meta-llama` | `buffer-meta-llama.ndjson` | `--all-adapters` |
| Webhook (generic) | `custom-webhook` | `webhook-buffer.ndjson` | Always available |

Each named adapter reads from its own source-specific buffer file, enabling per-source deduplication and traceability. The webhook server routes incoming payloads to the correct buffer based on the `source` field.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KM_MONITOR_INTERVAL_MS` | `60000` | Polling interval in milliseconds |
| `KM_MONITOR_CONFIDENCE` | `0.6` | Minimum LLM confidence score to accept a gold entry |
| `KM_MONITOR_DRY_RUN` | — | Set to `1` to analyse without writing or notifying |
| `KM_MONITOR_ALL_ADAPTERS` | — | Set to `1` to use all named LLM adapters |
| `KM_MONITOR_EXTRACTION_MODEL` | `gpt-4.1-mini` | LLM model used for gold extraction |
| `KM_MONITOR_STATE_PATH` | `~/.openclaw/km-monitor/state.json` | Override state file path |
| `KM_MONITOR_KM_DIR` | `~/.openclaw/km-monitor/` | Override KM output directory |
| `KM_MONITOR_NOTIFY_FILE` | — | Path to NDJSON notification log |
| `KM_MONITOR_NOTIFY_WEBHOOK_URL` | — | Webhook URL (Discord/Slack/custom) |
| `KM_MONITOR_WEBHOOK_BUFFER` | `~/.openclaw/km-monitor/webhook-buffer.ndjson` | Generic incoming webhook buffer |
| `KM_MONITOR_WEBHOOK_PORT` | `7842` | Webhook receiver port |
| `KM_MONITOR_WEBHOOK_SECRET` | — | Shared secret for webhook validation (`x-km-monitor-secret` header) |

---

## Knowledge Map Output

All outputs are stored under `~/.openclaw/km-monitor/` (override with `KM_MONITOR_KM_DIR`):

### `knowledge-map.md` (human-readable)

```markdown
## How to structure a knowledge management system

A knowledge management system should separate storage from retrieval,
use vector embeddings for semantic search, and maintain full provenance
for every entry.

| Field | Value |
|-------|-------|
| **ID** | `3f2a1b4c-...` |
| **Confidence** | 87% _(raw: 87.3%)_ |
| **Tags** | `knowledge-management`, `vector-search`, `provenance` |
| **Added** | 2026-04-26T10:00:00.000Z |
| **Source** | `openai-chatgpt` |
| **Conversation ID** | `chatgpt-session-001` |
| **Origin URL** | [https://chat.openai.com/c/abc123](https://chat.openai.com/c/abc123) |
| **Extracted by** | `km-monitor/extractor@1.1.0` |
| **Extraction model** | `gpt-4.1-mini` |
| **Extracted at** | 2026-04-26T10:00:00.000Z |
```

### `knowledge-map.json` (machine-readable)

A JSON array of `GoldEntry` objects, each with full `provenance` metadata including `extractionModel` and `rawConfidence`.

### `audit.ndjson` (change log)

An append-only NDJSON log of every `KmAuditEvent`. Each line records an `add` or `skip-duplicate` action with the entry ID, title, source, and conversation ID.

```json
{"kind":"km-audit","timestamp":"2026-04-26T10:00:00.000Z","action":"add","entryId":"3f2a1b4c-...","entryTitle":"How to structure a KMS","source":"openai-chatgpt","conversationId":"chatgpt-session-001"}
```

---

## Traceability

Every `GoldEntry` in the Knowledge Map carries a `provenance` object:

```typescript
{
  conversationId: "chatgpt-session-001",
  source: "openai-chatgpt",
  originUrl: "https://chat.openai.com/c/abc123",
  extractedBy: "km-monitor/extractor@1.1.0",
  extractedAt: "2026-04-26T10:00:00.000Z",
  extractionModel: "gpt-4.1-mini",
  rawConfidence: 0.873
}
```

This ensures that every piece of knowledge in the KM can be traced back to its exact origin, enabling auditing, correction, and removal of outdated information.

---

## Notification Channels

| Channel | Activation | Format |
|---------|-----------|--------|
| **Console** | Always active | Structured JSON to stdout (includes per-source stats, model info) |
| **File** | Set `KM_MONITOR_NOTIFY_FILE` | Append-only NDJSON log |
| **Discord** | Set `KM_MONITOR_NOTIFY_WEBHOOK_URL` to a Discord webhook | Rich embed with per-source breakdown and entry list |
| **Slack** | Set `KM_MONITOR_NOTIFY_WEBHOOK_URL` to a Slack webhook | Block Kit message with per-source stats |
| **Custom** | Set `KM_MONITOR_NOTIFY_WEBHOOK_URL` to any URL | Raw `KmChangeNotification` JSON payload |

All notifications include:
- Cycle number (monotonic, for ordering and deduplication)
- Per-source summary (conversations detected, gold extracted per LLM interface)
- Full entry list with provenance metadata
- Adapter errors encountered during the scan cycle

---

## Agent Tools

When installed as an OpenClaw extension, three agent tools are available:

| Tool | Description |
|------|-------------|
| `km_monitor_scan` | Trigger a scan cycle; returns state summary, sourceStats, and KM stats |
| `km_search` | Search the KM by query string; optionally filter by `source` |
| `km_list` | List all KM entries; optionally filter by `source` and `limit` |

---

## Adding a New Adapter

To monitor a new LLM interface, implement the `ConversationAdapter` interface in `src/scanner.ts` and register it in `createAdapters()` or `createAllAdapters()`:

```typescript
export function createMyLlmAdapter(): ConversationAdapter {
  return {
    name: "My LLM Adapter",
    source: "my-llm",
    async fetchLatest(sinceId?: string): Promise<ConversationRecord[]> {
      const { join } = await import("node:path");
      const home = process.env.HOME ?? "/tmp";
      const kmDir = process.env.KM_MONITOR_KM_DIR ?? join(home, ".openclaw", "km-monitor");
      const bufferPath = join(kmDir, "buffer-my-llm.ndjson");
      return readAndClearBuffer(bufferPath, sinceId);
    },
  };
}
```

Then configure your browser extension or API hook to POST to `http://localhost:7842/ingest` with `"source": "my-llm"`.

---

## License

Same as the parent `openclaw-wtf` repository.
