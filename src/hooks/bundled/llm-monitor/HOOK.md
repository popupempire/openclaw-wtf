---
name: llm-monitor
description: >
  Triggered by cron or the /llm-monitor command. Scans all configured LLM interfaces for
  new conversations, extracts and verifies gold insights, enriches the Knowledge Map, and
  sends source-traceable notifications.
events:
  - command:llm-monitor
  - gateway:cron
---

# LLM Monitor Hook

This hook fires when:
- The user sends `/llm-monitor` (or the agent is prompted to run a scan).
- A scheduled cron job triggers with a payload containing `"llm-monitor"` in the message.

## Behavior

1. Loads `llmMonitor` config from `~/.openclaw/config.json`.
2. Polls each configured LLM interface for conversations newer than the last sync.
3. Extracts insights via the gold-scoring extraction prompt.
4. Writes verified insights to `memory/llm-insights/` with full source metadata.
5. Updates `memory/llm-monitor-index.md` with sync state.
6. Sends a notification summary to the configured channel.

## Configuration

See `skills/llm-monitor/SKILL.md` for the full configuration reference.
