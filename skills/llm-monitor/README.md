# LLM Monitor Skill — v3.0.0

**Autonomous cross-LLM conversation monitoring, Knowledge Map enrichment, and source-traceable notifications for OpenClaw.**

---

## What It Does

The LLM Monitor skill turns OpenClaw into a continuous intelligence aggregator across all
your AI interfaces. Every 30 minutes (configurable), it:

1. **Scans** all configured LLM interfaces (ChatGPT, Claude, Gemini, custom) for new
   conversations, using adaptive polling with `since` timestamps.
2. **Deduplicates** by conversation ID *and* SHA-256 content hash — no double-processing
   even if a conversation is re-exported under a new ID.
3. **Extracts** high-quality insights using a structured gold-scoring prompt.
4. **Filters** out low-quality data — only insights scoring above the configurable
   `goldThreshold` (default: 0.75) are written to the Knowledge Map.
5. **Delta-diffs** the KM — if a better version of the same insight already exists, the
   new entry is skipped.
6. **Enriches** the KM with verified entries, each tagged with full source metadata:
   interface name, model, conversation ID, SHA-256 transcript fingerprint, timestamp, gold
   score, and sync run ID.
7. **Tracks** per-interface health (consecutive failures, last success/error) in the sync
   index.
8. **Notifies** you on your preferred channel (Telegram, Discord, Slack, WhatsApp, etc.)
   with a summary of all changes, including a per-interface health table.

---

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Full skill documentation and agent instructions |
| `README.md` | This file |
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
  --message "Run LLM monitor scan: check all configured LLM interfaces for new conversations, extract gold insights via the multi-criteria rubric, update the Knowledge Map with full traceability, append to the changelog, and notify me of all changes with source attribution." \
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
    ├── llm-monitor-errors.md          <- Error log (if any)
    ├── llm-monitor-changelog.md       <- Append-only scan log
    └── llm-insights/
        ├── 2026-04-27-reasoning-chains-abc12345.md
        ├── 2026-04-27-opus-context-def67890.md
        └── ...
```

---

## Security

- API keys should always be stored in environment variables or the 1Password skill — never
  hardcoded in config.
- All ingested conversation content is treated as untrusted external data. The extraction
  prompt wraps transcripts in a safe boundary to prevent prompt injection.
- The gold scoring step acts as a secondary quality and safety filter.

---

## Traceability

Every KM entry includes:
- Source interface ID and model
- Original conversation ID
- **SHA-256 transcript fingerprint** (v3)
- Sync run ID (ISO timestamp)
- Gold score and per-dimension rubric breakdown
- Skill version (`llm-monitor v3.0.0`)

This ensures full auditability: any KM fact can be traced back to its original source
transcript using the SHA-256 fingerprint.
