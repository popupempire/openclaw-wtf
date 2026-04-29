# Knowledge Map Monitor — Heartbeat Checklist

Run this checklist on every heartbeat cycle to keep the Knowledge Map current.

## 1. Scan for new conversations
Use `km_monitor_scan` with `extended_adapters=true` to check all LLM interfaces
(ChatGPT, Claude, Gemini, Mistral, Meta Llama, Cohere, Grok, Perplexity, DeepSeek,
OpenClaw sessions, and the generic webhook buffer) for new conversations.

If new gold entries are found, report a summary including:
- Number of new entries added
- Per-source breakdown (which LLM interface contributed)
- Top tags from the new entries
- Batch ID for traceability

## 2. Health check
Use `km_health` to verify the monitor is operating correctly.
Report if:
- `cycleCount` has not increased since the last heartbeat (monitor may be stalled)
- `lastScanAt` is more than 2x the configured interval ago

## 3. Notify on changes
If new entries were added, include a brief summary in the heartbeat response.
Format: "KM Update: +N gold entries from [sources]. Top tags: [tags]."

If nothing changed, reply HEARTBEAT_OK.
