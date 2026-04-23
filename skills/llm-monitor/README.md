# LLM Monitor Skill

**Autonomous cross-LLM conversation monitoring, Knowledge Map enrichment, and source-traceable notifications for OpenClaw.**

---

## What It Does

The LLM Monitor skill turns OpenClaw into a continuous intelligence aggregator across all your AI interfaces. Every 30 minutes (configurable), it:

1. **Scans** all configured LLM interfaces (ChatGPT, Claude, Gemini, custom) for new conversations.
2. **Extracts** high-quality insights using a structured gold-scoring prompt.
3. **Filters** out low-quality data — only insights scoring above the configurable `goldThreshold` (default: 0.75) are written to the Knowledge Map.
4. **Enriches** the KM with verified entries, each tagged with full source metadata: interface name, model, conversation ID, timestamp, gold score, and sync run ID.
5. **Notifies** you on your preferred channel (Telegram, Discord, Slack, WhatsApp, etc.) with a summary of all changes.

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
# View the example
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
├── MEMORY.md                          ← Top-tier gold facts (score ≥ 0.90)
└── memory/
    ├── llm-monitor-index.md           ← Sync state and running totals
    ├── llm-monitor-errors.md          ← Error log (if any)
    └── llm-insights/
        ├── 2026-04-23-reasoning-chains.md
        ├── 2026-04-23-opus-context.md
        └── ...
```

---

## Notification Example

```
🔭 LLM Monitor — Scan Complete [Thu, 23 Apr 2026 19:00:00 GMT]

✅ 3 new gold insights added to KM
⏭️  2 conversations skipped (below gold threshold 0.75)
🔄 2 interfaces updated (ChatGPT, Claude)

New Insights:
  • [ChatGPT] "Reasoning chains improve with chain-of-thought prompting" (score: 0.91)
  • [Claude]  "Opus 4.5 handles 200K context reliably" (score: 0.88)
  • [Gemini]  "Flash 2.5 excels at structured extraction tasks" (score: 0.82)

Sources: memory/llm-insights/
Run ID: run_2026-04-23T19:00:00.000Z
```

---

## Security

- API keys should always be stored in environment variables or the 1Password skill — never hardcoded in config.
- All ingested conversation content is treated as untrusted external data. The extraction prompt wraps transcripts in a safe boundary to prevent prompt injection.
- The gold scoring step acts as a secondary quality and safety filter.

---

## Traceability

Every KM entry includes:
- Source interface ID and model
- Original conversation ID
- Sync run ID (ISO timestamp)
- Gold score
- Skill version (`llm-monitor v1.0.0`)

This ensures full auditability: any KM fact can be traced back to its original source.
