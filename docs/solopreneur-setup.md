---
title: Solopreneur Setup — OpenClaw + Brutal Truths + Solopreneur Godmode
summary: "How to wire openclaw-wtf, ecosystem-BT, and solopreneur-godmode into a single system"
read_when: "You want your Brutal Truths store, AI assistant, and automation workflows to talk to each other"
status: active
---

# Solopreneur Setup

This guide explains how the three repos form one integrated system:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ecosystem-BT                                                        │
│  brutalmyths.com (Wix + Astro)                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  AIChatWidget  ──wss://──▶  OpenClaw Gateway  ◀──  your phone │   │
│  │  Store pages   ──webhook──▶  solopreneur-godmode plugin        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────┬────────────────────────────┘
                                         │ OpenClaw Plugin API
                              ┌──────────▼────────────────┐
                              │  openclaw-wtf              │
                              │  Solo Godmode config        │
                              │  Claude / GPT model         │
                              │  WhatsApp / Telegram        │
                              │  brutal_truths_* tools      │
                              └───────────────────────────┘
```

## Components

| Repo | Role |
|---|---|
| **openclaw-wtf** | AI brain — runs the gateway, talks to Claude/GPT, routes messages |
| **ecosystem-BT** | Storefront — Wix Astro site at brutalmyths.com; includes the chat widget |
| **solopreneur-godmode** | Plugin hub — handles Wix webhooks, registers store agent tools |

## Quick Setup

### Step 1 — Configure OpenClaw (Solo Godmode)

```bash
# Enable Solo Godmode — no sandbox, no elevated prompts
openclaw config set agents.defaults.sandbox.mode off
openclaw config set agents.defaults.elevatedDefault full
openclaw config set tools.exec.elevated true

# Verify
openclaw sandbox explain
```

### Step 2 — Install the Solopreneur Godmode plugin

```bash
cd solopreneur-godmode
npm install && npm run build
openclaw plugins install ./
```

Add plugin config to `~/.openclaw/openclaw.json`:

```json5
{
  "plugins": {
    "solopreneur-godmode": {
      "enabled": true,
      "config": {
        "notifyChannel": "whatsapp",          // your preferred channel
        "notifyTarget": "+1234567890",
        "wixWebhookSecret": "YOUR_SECRET",
        "wixApiKey": "YOUR_WIX_API_KEY",
        "wixSiteId": "8ab953ba-c612-4642-b9a9-29ee6543c8ce"
      }
    }
  }
}
```

### Step 3 — Start the gateway

```bash
openclaw gateway --port 18789 --verbose
```

You should see:
```
[solopreneur-godmode] Wix webhook registered at /plugins/solopreneur-godmode/wix/webhook
[solopreneur-godmode] Running on gateway port 18789
```

### Step 4 — Expose the gateway publicly

Use a tunnel so Wix can reach your local gateway (or run on a VPS):

```bash
# Cloudflare Tunnel (recommended — free, stable URL)
cloudflared tunnel --url http://localhost:18789

# or ngrok
ngrok http 18789
```

Note the public URL (e.g. `https://abc123.trycloudflare.com`).

### Step 5 — Configure Wix webhooks

1. Wix Dashboard → **Automations** → **Webhooks**
2. New webhook → trigger: **ecom/v1/orders** → Event: **Order Approved**
3. URL: `https://YOUR_PUBLIC_URL/plugins/solopreneur-godmode/wix/webhook`
4. Copy the HMAC secret → paste into `wixWebhookSecret` in your OpenClaw config
5. Reload config: `openclaw config reload`

### Step 6 — Deploy the chat widget (ecosystem-BT)

Add `PUBLIC_OPENCLAW_GATEWAY_URL` to your Wix/Astro environment:

```bash
# .env (local dev)
PUBLIC_OPENCLAW_GATEWAY_URL=wss://abc123.trycloudflare.com

# Wix / Cloudflare Pages — set via dashboard environment variables
```

The `AIChatWidget` is already wired into `Router.tsx` and will appear as a floating
button in the bottom-right corner of every page on brutalmyths.com.

## What you get

After setup is complete:

- **Instant order alerts** — Wix fires a webhook the moment a sale lands; you get a WhatsApp/Telegram message with buyer info, items, and total
- **AI chat on your store** — visitors can ask questions; responses are powered by OpenClaw (Claude/GPT)
- **Agent tools** — in any OpenClaw session, say:
  - *"Show me today's revenue"* → calls `brutal_truths_revenue_today`
  - *"List recent orders"* → calls `brutal_truths_recent_orders`
  - *"Remind me to follow up at 5pm"* → calls `solopreneur_notify`
- **Full system access** — Solo Godmode means the agent can read/write files, run scripts, manage your machine

## Troubleshooting

**Webhook 401 — invalid signature**
Verify `wixWebhookSecret` matches exactly what Wix shows in the dashboard.

**Chat widget shows "Connecting…" indefinitely**
- Check `PUBLIC_OPENCLAW_GATEWAY_URL` is set and the tunnel is running
- Run `openclaw gateway --verbose` and watch for connection attempts

**Plugin not loading**
Run `openclaw plugins list` and confirm `solopreneur-godmode` is `enabled`.
Check `openclaw gateway --verbose` for `[solopreneur-godmode]` log lines.

## See Also

- [Solo Godmode](/gateway/solo-godmode) — full sandboxing / elevated config docs
- [Hooks](/hooks) — add custom automation scripts
- [Plugins](/plugins) — OpenClaw plugin development guide
