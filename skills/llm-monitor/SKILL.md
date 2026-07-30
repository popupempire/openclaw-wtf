---
name: llm-monitor
version: "3.0.0"
description: >
  Continuously monitors all configured LLM interfaces (ChatGPT, Claude, Gemini, custom) for
  new conversations, extracts and verifies "gold" insights via a multi-criteria rubric,
  enriches the Knowledge Map with full source traceability, and sends rich notifications for
  every change. v3.0.0 adds content-hash deduplication, adaptive polling, interface health
  tracking, KM delta diffing, and SHA-256 transcript fingerprinting.
---

# LLM Monitor Skill — v3.0.0

## Overview

The LLM Monitor skill turns OpenClaw into a continuous intelligence aggregator across all
your AI interfaces. Every 30 minutes (configurable), it:

1. **Scans** all configured LLM interfaces (ChatGPT, Claude, Gemini, custom) for new
   conversations, passing `since` timestamps to minimize data transfer.
2. **Deduplicates** by conversation ID *and* SHA-256 content hash, preventing re-processing
   of identical transcripts even if the conversation ID changes.
3. **Extracts** high-quality insights using a structured gold-scoring prompt with a
   four-dimension rubric (factual reliability, novelty, actionability, specificity).
4. **Filters** out low-quality data — only insights scoring above `goldThreshold` (default:
   0.75) are written to the Knowledge Map.
5. **Delta-diffs** the KM: if an insight file for the same date+slug already exists with a
   higher score, the new entry is skipped to preserve the best version.
6. **Enriches** the KM with verified entries, each tagged with full source metadata:
   interface name, model, conversation ID, SHA-256 transcript fingerprint, timestamp, gold
   score, rubric breakdown, and sync run ID.
7. **Tracks** per-interface health (last success, last error, consecutive failures) in the
   sync index for operational visibility.
8. **Notifies** you on your preferred channel (Telegram, Discord, Slack, WhatsApp, etc.)
   with a summary of all changes, including a per-interface health table.

---

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Full skill documentation and agent instructions (this file) |
| `README.md` | Quick-start guide |
| `config-example.json` | Example `llmMonitor` config block to merge into `~/.openclaw/config.json` |
| `cron-template.json` | Cron job template for scheduling automatic scans |

The hook handler lives at:
```
src/hooks/bundled/llm-monitor/handler.ts
src/hooks/bundled/llm-monitor/HOOK.md
```

---

## Quick Setup

### 1. Add config

Merge `config-example.json` into your `~/.openclaw/config.json`:

```bash
cat skills/llm-monitor/config-example.json
```

Set your API keys as environment variables (recommended):

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=AIza...
```

### 2. Schedule the scan

```bash
openclaw cron add --every 30m \
  --message "Run LLM monitor scan: check all configured LLM interfaces for new conversations, extract gold insights, update the Knowledge Map, and notify me of all changes with full source traceability." \
  --deliver --channel telegram
```

Or ask the agent:
```
Schedule the LLM monitor to run every 30 minutes and notify me on Telegram.
```

### 3. Run a manual scan

```
Run a full LLM monitor scan now and report what's new.
```

---

## Knowledge Map Output

After each scan, the KM is enriched at:

```
~/.openclaw/workspace/
├── MEMORY.md                          <- Top-tier gold facts (score >= 0.90)
└── memory/
    ├── llm-monitor-index.md           <- Sync state, interface health, and running totals
    ├── llm-monitor-changelog.md       <- Append-only scan log
    ├── llm-monitor-errors.md          <- Error log (if any)
    └── llm-insights/
        ├── 2026-04-27-reasoning-chains-abc12345.md
        ├── 2026-04-27-opus-context-def67890.md
        └── ...
```

Each insight file includes:
- Source interface ID and label
- Model used for extraction
- Original conversation ID
- **SHA-256 transcript fingerprint** (v3)
- Detected timestamp
- Composite gold score
- Per-dimension rubric scores
- Sync run ID
- Skill version

---

## Gold Scoring Rubric

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Factual Reliability | 35% | Is the claim verifiable and well-supported? |
| Novelty | 25% | Does this add meaningfully new information? |
| Actionability | 20% | Can this insight be directly applied? |
| Specificity | 20% | Is the claim precise and concrete? |

**Composite goldScore** = 0.35 x factualReliability + 0.25 x novelty + 0.20 x actionability + 0.20 x specificity

---

## Notification Example

```
LLM Monitor Scan Complete [Mon, 27 Apr 2026 19:00:00 GMT]
Run: run_2026-04-27T19:00:00.000Z

Summary
3 new gold insights added to KM
2 conversations skipped (below threshold 0.75)
3 interfaces scanned: ChatGPT, Claude, Gemini
2 interfaces with new data: ChatGPT, Claude

New Gold Insights
  [ChatGPT] "Reasoning chains improve with chain-of-thought prompting"
    Score: 0.91 | Topics: reasoning, prompting, llm
    Conv: thread_abc123
  [Claude]  "Opus 4.5 handles 200K context reliably"
    Score: 0.88 | Topics: context, claude, performance
    Conv: conv_def456

Interface Health
| Interface      | Status | Consecutive Failures | Total Processed |
|----------------|--------|---------------------|-----------------|
| chatgpt        | OK     | 0                   | 47              |
| claude         | OK     | 0                   | 31              |
| gemini         | OK     | 0                   | 18              |

Traceability
KM location: memory/llm-insights/
Changelog: memory/llm-monitor-changelog.md
All-time totals: 96 insights across 48 runs
Skill: llm-monitor v3.0.0
```

---

## Security

- API keys should always be stored in environment variables or the 1Password skill — never
  hardcoded in config.
- All ingested conversation content is treated as untrusted external data. The extraction
  prompt wraps transcripts in a safe boundary to prevent prompt injection.
- The gold scoring step acts as a secondary quality and safety filter.

---

## Traceability Guarantee

Every KM entry includes:
- Source interface ID and label
- Model used for extraction
- Original conversation ID
- **SHA-256 transcript fingerprint** (v3 — enables independent content verification)
- Sync run ID (ISO timestamp)
- Per-dimension rubric scores
- Composite gold score
- Skill version (`llm-monitor v3.0.0`)

This ensures full auditability: any KM fact can be traced back to its original source
transcript using the SHA-256 fingerprint.

---

## Configuration Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `false` | Master switch for the monitor |
| `pollIntervalMinutes` | number | `30` | How often to run a scan (for cron scheduling) |
| `notifyChannel` | string | `"telegram"` | Channel to send notifications to |
| `goldThreshold` | number | `0.75` | Minimum gold score for KM inclusion |
| `interfaces` | array | `[]` | List of LLM interface configurations |
| `interfaces[].id` | string | — | Unique identifier for this interface |
| `interfaces[].label` | string | — | Human-readable name |
| `interfaces[].kind` | string | — | `"openai"`, `"anthropic"`, `"gemini"`, or `"custom"` |
| `interfaces[].apiKey` | string | — | API key (store in env var for security) |
| `interfaces[].model` | string | — | Model identifier to use for extraction |
| `interfaces[].endpoint` | string | — | Custom endpoint URL (for `kind: "custom"`, and required for `anthropic`/`gemini`) |

---

## v3.0.0 Changelog

| Feature | Details |
|---------|---------|
| Content-hash deduplication | SHA-256 fingerprint of transcript stored in sync index; duplicate content skipped even under a new conversation ID |
| Adaptive polling | `since` and `limit` passed as query parameters to all interface kinds that support them |
| Interface health ledger | `interfaceHealth` map in sync index tracks `lastSuccessAt`, `lastErrorAt`, `lastErrorMessage`, `consecutiveFailures`, `totalConversationsProcessed` per interface |
| KM delta diffing | Before writing, checks for existing insight file with same date+slug; skips if existing score is higher |
| SHA-256 fingerprint in KM entries | `Transcript SHA-256` field in every insight file metadata table |
| No-new-data fast path | Sends a concise one-liner notification when no new conversations were found |
| Bounded state growth | `processedConversationIds` and `processedContentHashes` capped at 2000 entries per interface |
| v2 index back-fill | Gracefully upgrades v2 sync index by back-filling missing v3 fields on first load |
