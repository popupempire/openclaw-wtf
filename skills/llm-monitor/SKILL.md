---
name: llm-monitor
description: >
  Continuously monitor and scan for new conversations across all configured LLM interfaces
  (ChatGPT, Claude, Gemini, etc.). Automatically integrates and synchronizes new data points
  and relevant insights into the local Knowledge Map (KM). Enriches the KM with verified
  "gold" information and sends traceable notifications for all changes. Use when you want
  to keep your KM current with the latest AI conversations and insights.
metadata:
  {
    "openclaw":
      {
        "emoji": "🔭",
        "skillKey": "llm-monitor",
        "requires":
          {
            "bins": ["node"],
            "env": [],
          },
      },
  }
---

# LLM Monitor Skill

Autonomously scans configured LLM interfaces for new conversations, extracts verified insights,
enriches your Knowledge Map (KM), and delivers source-traceable notifications.

---

## Overview

The LLM Monitor skill operates as a continuous background intelligence layer. It:

1. **Polls** configured LLM API endpoints or conversation exports at a scheduled interval.
2. **Extracts** new data points and insights from detected conversations.
3. **Verifies** quality using a "gold" scoring prompt before writing to the KM.
4. **Enriches** `MEMORY.md` and `memory/llm-insights/` with verified entries, each tagged with
   source metadata (interface name, conversation ID, timestamp, confidence score).
5. **Notifies** you via your preferred channel (Telegram, Discord, Slack, etc.) with a summary
   of all changes and full source traceability.

---

## Quick Start

### 1. Configure Monitored Interfaces

Add a `llmMonitor` block to your `~/.openclaw/config.json`:

```json
{
  "llmMonitor": {
    "enabled": true,
    "pollIntervalMinutes": 30,
    "notifyChannel": "telegram",
    "goldThreshold": 0.75,
    "interfaces": [
      {
        "id": "chatgpt",
        "label": "ChatGPT",
        "kind": "openai",
        "apiKey": "sk-...",
        "model": "gpt-4o"
      },
      {
        "id": "claude",
        "label": "Claude",
        "kind": "anthropic",
        "apiKey": "sk-ant-...",
        "model": "claude-opus-4-5"
      },
      {
        "id": "gemini",
        "label": "Gemini",
        "kind": "gemini",
        "apiKey": "AIza...",
        "model": "gemini-2.5-flash"
      }
    ]
  }
}
```

### 2. Register the Cron Job

Ask the agent to schedule the monitor:

```
Schedule the LLM monitor to run every 30 minutes and notify me on Telegram.
```

Or use the cron tool directly:

```
/cron add --every 30m --message "Run LLM monitor scan: check all interfaces for new conversations, extract gold insights, update KM, notify me of changes."
```

### 3. Manual Scan

Trigger a one-off scan at any time:

```
Run a full LLM monitor scan now and report what's new.
```

---

## Knowledge Map Structure

The skill writes to the following locations within your workspace:

| Path | Purpose |
|------|---------|
| `memory/llm-insights/YYYY-MM-DD-<slug>.md` | Individual insight entries with full source metadata |
| `memory/llm-monitor-index.md` | Running index of all monitored conversations and their sync status |
| `MEMORY.md` | Top-level gold facts appended as a `## LLM Monitor` section |

### Insight Entry Format

Each verified insight file follows this schema:

```markdown
# Insight: <title>

- **Source Interface**: ChatGPT (gpt-4o)
- **Conversation ID**: conv_abc123
- **Detected At**: 2026-04-23T19:00:00Z
- **Gold Score**: 0.88
- **Topics**: [AI reasoning, prompt engineering]

## Summary

<LLM-generated summary of the key insight>

## Raw Excerpt

> <verbatim excerpt from the source conversation>

## Traceability

- Interface: chatgpt
- Model: gpt-4o
- Sync Run ID: run_2026-04-23T19:00:00Z
- Verified By: llm-monitor v1.0.0
```

---

## Notification Format

Each scan cycle sends a notification to your configured channel:

```
🔭 LLM Monitor — Scan Complete [2026-04-23 19:00 UTC]

✅ 3 new gold insights added to KM
⏭️  2 conversations skipped (below gold threshold)
🔄 1 interface updated (ChatGPT)

New Insights:
  • [ChatGPT] "Reasoning chains improve with chain-of-thought prompting" (score: 0.91)
  • [Claude]  "Opus 4.5 handles 200K context reliably" (score: 0.88)
  • [Gemini]  "Flash 2.5 excels at structured extraction tasks" (score: 0.82)

Sources: memory/llm-insights/2026-04-23-*.md
Run ID: run_2026-04-23T19:00:00Z
```

---

## Agent Instructions

When the user asks to run a monitor scan, perform the following steps:

### Step 1 — Load Configuration

Read `~/.openclaw/config.json` and extract the `llmMonitor` block. If absent, prompt the user
to configure it. Validate that at least one interface is defined and `enabled: true`.

### Step 2 — Load Existing Index

Read `memory/llm-monitor-index.md` (create if absent) to determine which conversation IDs have
already been processed. This prevents duplicate ingestion.

### Step 3 — Poll Each Interface

For each configured interface, use the appropriate API or CLI to fetch recent conversations:

- **OpenAI / ChatGPT**: Use `web_fetch` to call `https://api.openai.com/v1/chat/completions`
  or parse exported conversation JSON if available.
- **Anthropic / Claude**: Use the Messages API at `https://api.anthropic.com/v1/messages`.
- **Gemini**: Use `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`.
- **Generic / Custom**: Use `web_fetch` with the configured endpoint URL.

For each interface, collect all conversations newer than the last sync timestamp recorded in
the index.

### Step 4 — Extract Insights

For each new conversation, send the transcript to the configured LLM with the following
extraction prompt:

```
You are a knowledge extraction agent. Analyze the following conversation and extract
all high-quality, verifiable insights. For each insight, provide:
1. A concise title (max 80 chars)
2. A summary (2-4 sentences)
3. A verbatim excerpt (max 300 chars) that best supports the insight
4. A list of relevant topics/tags
5. A gold score (0.0–1.0) reflecting factual reliability and novelty

Return JSON: { "insights": [ { "title", "summary", "excerpt", "topics", "goldScore" } ] }

Conversation:
{transcript}
```

### Step 5 — Filter by Gold Threshold

Discard any insight with `goldScore < llmMonitor.goldThreshold` (default: 0.75).

### Step 6 — Write to Knowledge Map

For each passing insight:

1. Generate a filename slug using the insight title.
2. Write the insight file to `memory/llm-insights/YYYY-MM-DD-<slug>.md` using the schema above.
3. Append a one-line summary to `memory/llm-monitor-index.md`.
4. If `goldScore >= 0.90`, also append a brief fact to the `## LLM Monitor` section of `MEMORY.md`.

### Step 7 — Update Sync Index

Update `memory/llm-monitor-index.md` with:
- The conversation IDs processed in this run.
- The timestamp of this sync run.
- A count of insights added vs. skipped.

### Step 8 — Send Notification

Format and send the notification message (see **Notification Format** above) to the channel
specified in `llmMonitor.notifyChannel`. Use the `message_send` tool or the appropriate
channel action tool.

---

## Error Handling

- If an interface API call fails, log the error to `memory/llm-monitor-errors.md` and continue
  with the remaining interfaces. Do not abort the entire scan.
- If the LLM extraction step fails, skip that conversation and log the failure.
- Always complete the notification step, even if some interfaces failed, noting which ones
  encountered errors.

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
| `interfaces[].endpoint` | string | — | Custom endpoint URL (for `kind: "custom"`) |

---

## Security Notes

- Never log or expose raw API keys. Reference them via environment variables (e.g.,
  `$OPENAI_API_KEY`) or the 1Password skill.
- All fetched conversation content is treated as **untrusted external data**. The extraction
  prompt wraps the transcript in a safe boundary to prevent prompt injection.
- The gold scoring step acts as a secondary filter against low-quality or adversarial content.

---

## Traceability Guarantee

Every KM entry written by this skill includes:
- The source interface ID and model.
- The original conversation ID (if available from the API).
- The sync run ID (ISO timestamp of the scan cycle).
- The gold score assigned during verification.
- The version of the llm-monitor skill that wrote the entry.

This ensures full auditability: you can always trace any KM fact back to its original source.
