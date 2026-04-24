---
name: llm-monitor
description: >
  Triggered by cron or the /llm-monitor command. Continuously scans ALL configured LLM
  interfaces for new conversations, extracts and verifies gold insights via a multi-criteria
  rubric, enriches the Knowledge Map with full source traceability, appends to the changelog,
  and sends rich, channel-agnostic notifications for every change.
version: "2.0.0"
events:
  - command:llm-monitor
  - gateway:cron
---

# LLM Monitor Hook — v2.0.0

This hook fires when:
- The user sends `/llm-monitor` (or the agent is prompted to run a scan).
- A scheduled cron job triggers with a payload containing `"llm-monitor"` in the message.

## Behavior

1. Loads `llmMonitor` config from `~/.openclaw/config.json`.
2. Polls each configured LLM interface for conversations newer than the last sync.
3. Extracts insights via the **multi-criteria gold scoring rubric** (factual reliability,
   novelty, actionability, specificity — weighted composite score).
4. Writes verified insights (score ≥ `goldThreshold`) to `memory/llm-insights/` with full
   source metadata and rubric breakdown.
5. Promotes top-tier insights (score ≥ 0.9) to `MEMORY.md` for immediate agent awareness.
6. Updates `memory/llm-monitor-index.md` with sync state and embedded audit trail.
7. Appends a row to `memory/llm-monitor-changelog.md` for every processed conversation.
8. Sends a rich notification summary to the configured channel with full traceability links.

## KM Layout

```
<workspace>/memory/
  llm-insights/            — one .md file per gold insight (score ≥ goldThreshold)
  llm-monitor-index.md     — sync state + embedded JSON audit trail
  llm-monitor-changelog.md — append-only Markdown table of every scan run
  llm-monitor-errors.md    — error log (best-effort)
MEMORY.md                  — top-tier (score ≥ 0.9) entries promoted here
```

## Gold Scoring Rubric

Each insight is scored on four dimensions (each 0.0–1.0):

| Dimension | Weight | Description |
|-----------|--------|-------------|
| Factual Reliability | 35% | Is the claim verifiable and well-supported? |
| Novelty | 25% | Does this add meaningfully new information? |
| Actionability | 20% | Can this insight be directly applied? |
| Specificity | 20% | Is the claim precise and concrete? |

**Composite goldScore** = 0.35×factualReliability + 0.25×novelty + 0.20×actionability + 0.20×specificity

## Traceability Guarantee

Every KM entry includes:
- Source interface ID and label
- Model used for extraction
- Original conversation ID
- Sync run ID (ISO timestamp)
- Per-dimension rubric scores
- Skill version (`llm-monitor v2.0.0`)

## Configuration

See `skills/llm-monitor/SKILL.md` for the full configuration reference.
