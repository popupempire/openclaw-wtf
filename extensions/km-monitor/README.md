# Knowledge Map Monitor (`km-monitor`)

> **Autonomous LLM conversation monitor, Knowledge Map enrichment pipeline, and notification system for [OpenClaw](https://openclaw.ai).**

---

## Overview

The `km-monitor` extension continuously scans all configured LLM interfaces for new conversations, extracts high-quality "gold" insights using an LLM-powered pipeline, enriches the internal **Knowledge Map (KM)**, and dispatches traceable notifications for every change. Every entry in the KM carries a full provenance chain linking it back to the exact conversation and source that produced it.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Monitor Loop (cron / daemon)            │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐ │
│  │ Scanner  │───▶│Extractor │───▶│KM Writer │───▶│Notify │ │
│  └──────────┘    └──────────┘    └──────────┘    └───────┘ │
│       │                                                     │
│  ┌────┴──────────────────────────────────┐                  │
│  │ Adapters                              │                  │
│  │  • OpenClaw Session Adapter           │                  │
│  │  • Webhook Buffer Adapter             │                  │
│  │  • (add more adapters as needed)      │                  │
│  └───────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

| Component | File | Responsibility |
|-----------|------|----------------|
| **Types** | `src/types.ts` | Shared TypeScript interfaces for all data structures |
| **State** | `src/state.ts` | JSON-file-backed persistence of scan progress |
| **Scanner** | `src/scanner.ts` | Polls adapters; returns only unseen conversations |
| **Extractor** | `src/extractor.ts` | LLM-powered gold insight extraction with confidence scoring |
| **KM Writer** | `src/km-writer.ts` | Writes entries to Markdown log + JSON index; deduplicates |
| **Notifier** | `src/notifier.ts` | Dispatches notifications (console, file, webhook) |
| **Monitor Loop** | `src/monitor-loop.ts` | Orchestrates the full pipeline; continuous or one-shot |
| **Webhook Server** | `src/webhook-server.ts` | HTTP receiver for external LLM interface payloads |
| **CLI Runner** | `src/cli-runner.ts` | Standalone CLI without the full OpenClaw stack |
| **Plugin Entry** | `index.ts` | OpenClaw plugin registration (CLI + agent tools) |

---

## Quick Start

### As an OpenClaw Extension

```bash
# Install the extension
openclaw extensions install ./extensions/km-monitor

# Run a one-shot scan
openclaw km-monitor scan

# Start the continuous monitor
openclaw km-monitor start

# Search the Knowledge Map
openclaw km-monitor search "neurodivergent productivity"

# Check status
openclaw km-monitor status
```

### Standalone (without OpenClaw CLI)

```bash
# One-shot scan
bun extensions/km-monitor/src/cli-runner.ts scan

# Continuous monitor
bun extensions/km-monitor/src/cli-runner.ts start

# Dry-run (analyse without writing)
bun extensions/km-monitor/src/cli-runner.ts scan --dry-run

# Search
bun extensions/km-monitor/src/cli-runner.ts search "knowledge management"
```

### Webhook Receiver (for external LLM interfaces)

```bash
# Start the webhook receiver
bun extensions/km-monitor/src/webhook-server.ts

# POST a conversation from any LLM interface
curl -X POST http://localhost:7842/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "id": "chatgpt-session-001",
    "source": "openai-chatgpt",
    "content": "[user]: How do I build a knowledge management system?\n[assistant]: A KMS should...",
    "originUrl": "https://chat.openai.com/c/abc123"
  }'
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KM_MONITOR_INTERVAL_MS` | `60000` | Polling interval in milliseconds |
| `KM_MONITOR_CONFIDENCE` | `0.6` | Minimum LLM confidence score to accept a gold entry |
| `KM_MONITOR_DRY_RUN` | — | Set to `1` to analyse without writing or notifying |
| `KM_MONITOR_STATE_PATH` | `~/.openclaw/km-monitor/state.json` | Override state file path |
| `KM_MONITOR_KM_DIR` | `~/.openclaw/km-monitor/` | Override KM output directory |
| `KM_MONITOR_NOTIFY_FILE` | — | Path to NDJSON notification log |
| `KM_MONITOR_NOTIFY_WEBHOOK_URL` | — | Webhook URL (Discord/Slack/custom) |
| `KM_MONITOR_WEBHOOK_BUFFER` | `~/.openclaw/km-monitor/webhook-buffer.ndjson` | Incoming webhook buffer |
| `KM_MONITOR_WEBHOOK_PORT` | `7842` | Webhook receiver port |
| `KM_MONITOR_WEBHOOK_SECRET` | — | Shared secret for webhook validation |

---

## Knowledge Map Output

The KM is stored in two formats under `~/.openclaw/km-monitor/`:

### `knowledge-map.md` (human-readable)

```markdown
## How to structure a knowledge management system

A knowledge management system should separate storage from retrieval,
use vector embeddings for semantic search, and maintain full provenance
for every entry.

| Field | Value |
|-------|-------|
| **ID** | `3f2a1b4c-...` |
| **Confidence** | 87% |
| **Tags** | `knowledge-management`, `vector-search`, `provenance` |
| **Source** | `openai-chatgpt` |
| **Conversation ID** | `chatgpt-session-001` |
| **Origin URL** | https://chat.openai.com/c/abc123 |
```

### `knowledge-map.json` (machine-readable)

A JSON array of `GoldEntry` objects, each with full `provenance` metadata.

---

## Adding a New Adapter

To monitor a new LLM interface, implement the `ConversationAdapter` interface in `src/scanner.ts` and register it in `createAdapters()`:

```typescript
export function createMyLlmAdapter(): ConversationAdapter {
  return {
    name: "My LLM Adapter",
    source: "my-llm",
    async fetchLatest(sinceId?: string): Promise<ConversationRecord[]> {
      // Fetch conversations from your LLM interface API.
      // Return only those with id > sinceId (if provided).
      return [];
    },
  };
}
```

---

## Notification Channels

| Channel | Activation | Format |
|---------|-----------|--------|
| **Console** | Always active | Structured JSON to stdout |
| **File** | Set `KM_MONITOR_NOTIFY_FILE` | Append-only NDJSON log |
| **Discord** | Set `KM_MONITOR_NOTIFY_WEBHOOK_URL` to a Discord webhook | Rich embed with entry list |
| **Slack** | Set `KM_MONITOR_NOTIFY_WEBHOOK_URL` to a Slack webhook | Formatted message |
| **Custom** | Set `KM_MONITOR_NOTIFY_WEBHOOK_URL` to any URL | Raw JSON payload |

---

## Agent Tools

When installed as an OpenClaw extension, two agent tools are available:

| Tool | Description |
|------|-------------|
| `km_monitor_scan` | Trigger a scan cycle from within an agent conversation |
| `km_search` | Search the Knowledge Map for entries matching a query |

---

## Traceability

Every `GoldEntry` in the Knowledge Map carries a `provenance` object:

```typescript
{
  conversationId: "chatgpt-session-001",
  source: "openai-chatgpt",
  originUrl: "https://chat.openai.com/c/abc123",
  extractedBy: "km-monitor/extractor@1.0.0",
  extractedAt: "2026-04-25T19:30:00.000Z"
}
```

This ensures that every piece of knowledge in the KM can be traced back to its exact origin, enabling auditing, correction, and removal of outdated information.

---

## License

Same as the parent `openclaw-wtf` repository.
