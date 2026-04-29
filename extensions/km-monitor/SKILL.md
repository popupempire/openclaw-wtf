---
name: km-monitor
version: 1.2.0
description: >
  Continuously monitors LLM interfaces for new conversations, synchronises data
  points, enriches the Knowledge Map with verified "gold" information, and
  dispatches fully traceable notifications for all changes.
author: PopUpEmpire / OpenClaw
requires:
  config:
    - OPENAI_API_KEY
tags:
  - knowledge-management
  - monitoring
  - llm
  - automation
  - notifications
---

# Knowledge Map Monitor Skill

This skill teaches the agent how to use the `km-monitor` extension tools to
continuously scan LLM interfaces, extract high-quality insights, and manage
the local Knowledge Map (KM).

## When to use this skill

- The user asks to monitor or scan LLM conversations for new insights.
- The user wants to enrich the Knowledge Map with "gold" information.
- The user wants to search or query the Knowledge Map.
- The user wants to check the monitor's health or status.
- The user wants to retrieve a specific KM entry by ID.

## Available tools

| Tool | Description |
|------|-------------|
| `km_monitor_scan` | Trigger a one-shot scan cycle. Accepts `dry_run`, `all_adapters`, `extended_adapters`. |
| `km_search` | Search the KM by query string. Accepts `query` and optional `source`. |
| `km_list` | List recent KM entries. Accepts optional `source` and `limit`. |
| `km_get` | Retrieve a single KM entry by UUID. |
| `km_health` | Return a live health report (cycle count, gold entries, per-source stats). |

## Supported LLM sources

`openai-chatgpt`, `anthropic-claude`, `google-gemini`, `mistral`, `meta-llama`,
`cohere`, `xai-grok`, `perplexity`, `deepseek`, `openclaw-session`, `custom-webhook`

## Usage examples

**Trigger a scan across all LLM interfaces:**
```
Use km_monitor_scan with extended_adapters=true
```

**Search for entries about vector databases:**
```
Use km_search with query="vector database"
```

**Check monitor health:**
```
Use km_health
```

**Retrieve a specific entry:**
```
Use km_get with id="<uuid>"
```

## Traceability

Every gold entry includes a `provenance` object with:
- `conversationId` — the source conversation
- `source` — the LLM interface
- `originUrl` — link to the original conversation (if available)
- `extractedBy` — the extractor version
- `extractionModel` — the LLM used for extraction
- `batchId` — the scan cycle batch ID

## Notification channels

Configure via environment variables:
- `KM_MONITOR_NOTIFY_FILE` — NDJSON log file
- `KM_MONITOR_NOTIFY_WEBHOOK_URL` — Discord, Slack, or custom webhook URL

## Starting the continuous monitor

Via CLI:
```bash
openclaw km-monitor start --extended-adapters --interval 60000
```

Via cron (OpenClaw):
```bash
openclaw cron add --name "KM Scan" --every "1h" --session isolated \
  --message "Run km_monitor_scan with extended_adapters=true" --deliver
```
