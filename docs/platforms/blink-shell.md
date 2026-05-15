---
summary: "Install and use OpenClaw with Blink Shell on iOS"
read_when:
  - Installing OpenClaw on a remote server for iOS Blink Shell access
  - Setting up OpenClaw to work with mobile SSH clients
  - Connecting to your OpenClaw gateway from Blink Shell
---

# Blink Shell (iOS SSH Client)

[Blink Shell](https://blink.sh/) is a professional terminal app for iOS/iPadOS that provides full SSH access to remote servers. This guide shows how to install OpenClaw on a remote server and access it from Blink Shell on your iOS device.

## What you can do

With OpenClaw running on a remote server and Blink Shell on your iOS device, you can:

**Core operations:**
- **Chat with your AI assistant** using the CLI (`openclaw agent --message "..."`)
- **Send messages to any channel** you've configured (WhatsApp, Telegram, Discord, Slack, etc.)
- **Check gateway and channel health** to ensure everything is running
- **View and manage logs** for troubleshooting
- **Configure channels** (add/remove WhatsApp, Telegram, Discord, etc.)
- **Update settings** and model preferences
- **Monitor system status** and usage

**Advanced capabilities:**
- Run persistent sessions with tmux/screen (survive disconnections)
- Forward the Gateway WebSocket to connect the OpenClaw iOS app
- Execute cron jobs and automation tasks
- Manage workspace and skills
- Access browser tools and canvas features (when iOS app is connected)
- Debug and troubleshoot with real-time logs

**Real-world workflows:**
- Ask the assistant questions from your iPhone: `openclaw agent --message "Summarize my email inbox" --thinking medium`
- Send WhatsApp messages: `openclaw message send --to +1234567890 --message "Running late"`
- Check if channels are online: `openclaw channels status --probe`
- Monitor gateway health: `openclaw health && openclaw status --deep`
- Review recent logs: `openclaw logs gateway --tail 100`

## Architecture overview

When using Blink Shell with OpenClaw:

1. **Gateway runs on a remote server** (VPS, home desktop, or cloud instance)
2. **SSH connection** from Blink Shell to the server
3. **OpenClaw CLI** commands run through the SSH session
4. **Optional: iOS app** connects to the same Gateway for canvas/voice features

This setup gives you full CLI access from your iOS device while keeping the Gateway always-on.

## Requirements

- iOS device with Blink Shell installed (version 3.0+ recommended)
- Remote server with:
  - SSH access
  - Node ≥22
  - Network access (for model APIs)
- Basic SSH knowledge (connecting, tunneling)

## Installation steps

### 1) Choose a server

Pick where to run the Gateway. Common options:

- **VPS providers:** [Oracle Cloud](https://docs.openclaw.ai/platforms/oracle) (free tier), [Hetzner](https://docs.openclaw.ai/platforms/hetzner), [DigitalOcean](https://docs.openclaw.ai/platforms/digitalocean), [GCP](https://docs.openclaw.ai/platforms/gcp)
- **VM services:** [exe.dev](https://docs.openclaw.ai/platforms/exe-dev) (easy Linux VM)
- **Home server:** Raspberry Pi, desktop, or NAS with SSH enabled
- **Cloud platforms:** Fly.io, Railway, Northflank

Platform guides: [VPS hub](https://docs.openclaw.ai/vps) · [Platforms index](https://docs.openclaw.ai/platforms)

### 2) Connect from Blink Shell

In Blink Shell on your iOS device:

```bash
# Connect to your server
ssh user@your-server-host

# Or if you have a Blink Shell host configured:
ssh myserver
```

Tip: Set up SSH keys in Blink Shell for passwordless login (Settings → Keys → Import or Generate).

### 3) Install Node (if needed)

Check Node version on the server:

```bash
node -v
```

If Node is not installed or version is below 22, install it:

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
nvm alias default 22

# Or using your OS package manager
# Ubuntu/Debian:
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 4) Install OpenClaw

Run the installer script:

```bash
curl -fsSL https://openclaw.bot/install.sh | bash
```

The installer will:
- Install the `openclaw` CLI globally via npm
- Run the onboarding wizard (unless you use `--no-onboard`)
- Optionally install a background service (systemd/launchd)

Alternative (manual install):

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

Installation details: [Install docs](https://docs.openclaw.ai/install)

### 5) Run onboarding

The onboarding wizard will guide you through:

```bash
openclaw onboard --install-daemon
```

Key choices for remote/Blink Shell use:

- **Gateway mode:** Choose "Local" (the server is the gateway host)
- **Auth:** Set up model providers (Anthropic API key or OpenAI OAuth)
- **Channels:** Configure messaging channels (WhatsApp, Telegram, Discord, etc.)
- **Daemon:** Install as background service (recommended for always-on)
- **Runtime:** Choose Node (recommended; required for WhatsApp/Telegram)

Onboarding guide: [Wizard docs](https://docs.openclaw.ai/start/wizard)

### 6) Start the Gateway

If you installed the daemon:

```bash
# Check status
openclaw status

# The daemon should already be running
# If not, start it:
openclaw gateway start
```

Manual start (testing/development):

```bash
openclaw gateway run --bind loopback --port 18789
```

### 7) Verify installation

Check gateway health from Blink Shell:

```bash
openclaw health
openclaw status --deep
openclaw channels status
```

Send a test message:

```bash
openclaw agent --message "Hello from Blink Shell!" --thinking low
```

**You're all set!** The gateway is running on your server, and you can now use OpenClaw from Blink Shell.

## Quick Start: First steps

After installation, here's what to do first from Blink Shell:

**1. Verify everything works:**
```bash
ssh user@your-server-host
openclaw status
openclaw health
```

**2. Try your first AI interaction:**
```bash
# Simple question
openclaw agent --message "What can you help me with?" --thinking low

# More complex task
openclaw agent --message "Explain how OpenClaw works in simple terms" --thinking medium
```

**3. Set up a messaging channel (optional but recommended):**
```bash
# WhatsApp (easiest - shows QR code in terminal)
openclaw channels configure whatsapp

# After scanning QR code, verify it's connected:
openclaw channels status
```

**4. Open the web dashboard (optional):**
```bash
openclaw dashboard
# Opens http://127.0.0.1:18789 (you'll need to access via SSH tunnel or set bind to 'lan')
```

**5. Keep your session alive with tmux:**
```bash
# Install tmux if not present
sudo apt install tmux

# Start a named session
tmux new -s openclaw

# Now if you disconnect, your session stays alive
# Reconnect later with: tmux attach -t openclaw
```

**Next steps:**
- Configure more channels: [Channels guide](https://docs.openclaw.ai/channels)
- Customize your assistant: [Agent configuration](https://docs.openclaw.ai/gateway/configuration)
- Set up automation: [Cron jobs](https://docs.openclaw.ai/automation/cron-jobs)

## How to operate OpenClaw from Blink Shell

Once installed, OpenClaw runs as a background service on your server. Here's how to operate it from Blink Shell:

### Daily workflow

**1. Connect to your server:**
```bash
# From Blink Shell on your iPhone/iPad
ssh user@your-server-host
```

**2. Check everything is running:**
```bash
openclaw status              # Quick status check
openclaw health             # Detailed health report
openclaw channels status    # See which channels are online
```

**3. Chat with your assistant:**
```bash
# Ask questions
openclaw agent --message "What's on my calendar today?" --thinking medium

# Get help with tasks
openclaw agent --message "Write an email apologizing for missing the meeting" --thinking high

# Quick queries
openclaw agent --message "What's the weather in San Francisco?" --thinking low
```

**4. Send messages to channels:**
```bash
# WhatsApp
openclaw message send --to +1234567890 --message "I'll be there in 10 minutes"

# Use the dashboard for a web UI
openclaw dashboard
# Then open http://your-server-ip:18789 in iOS Safari
```

**5. View logs when troubleshooting:**
```bash
openclaw logs gateway --tail 100    # Last 100 lines
openclaw logs gateway --follow      # Live tail
```

### Common operations

**Restart the gateway:**
```bash
openclaw gateway stop
openclaw gateway start
# Or: openclaw gateway restart
```

**Update OpenClaw:**
```bash
npm update -g openclaw@latest
openclaw doctor   # Check for issues after update
```

**Add a new channel:**
```bash
# WhatsApp (scan QR code in terminal)
openclaw channels configure whatsapp

# Telegram (you need a bot token)
openclaw channels configure telegram --token "your-bot-token"

# Discord (you need a bot token)
openclaw channels configure discord --token "your-bot-token"
```

**Check channel status:**
```bash
openclaw channels status             # Quick status
openclaw channels status --probe     # Detailed health check
```

**Manage configuration:**
```bash
openclaw config list                 # View all settings
openclaw config get gateway          # View gateway settings
openclaw config edit                 # Edit in terminal editor
openclaw config set key.path value   # Set a specific value
```

**View help for any command:**
```bash
openclaw --help
openclaw agent --help
openclaw channels --help
```

## Usage from Blink Shell

### Basic CLI commands

All OpenClaw CLI commands work in Blink Shell:

```bash
# Check gateway status
openclaw status

# View configuration
openclaw config list

# Send a message to a channel
openclaw message send --to +1234567890 --message "Test from iOS"

# Talk to the assistant
openclaw agent --message "What's the weather?" --thinking medium

# View logs
openclaw logs gateway --tail 50

# Check node status (if you have iOS/Android app connected)
openclaw nodes status
```

CLI reference: [CLI docs](https://docs.openclaw.ai/cli)

### Working with channels

Configure channels from Blink Shell:

```bash
# WhatsApp (QR code will be shown in terminal)
openclaw channels configure whatsapp

# Telegram
openclaw channels configure telegram --token "your-bot-token"

# Discord
openclaw channels configure discord --token "your-bot-token"

# Check all channels
openclaw channels status --probe
```

Channel guides: [Channels index](https://docs.openclaw.ai/channels)

### Configuration management

```bash
# Edit configuration
openclaw config edit

# View specific sections
openclaw config get gateway
openclaw config get agents

# Set values
openclaw config set gateway.bind loopback
openclaw config set gateway.port 18789
```

Configuration reference: [Config docs](https://docs.openclaw.ai/gateway/configuration)

## Common use cases and examples

Here are practical examples of what you can do with OpenClaw from Blink Shell on your iPhone:

### Example 1: Get help with emails

```bash
openclaw agent --message "Draft a professional email declining a meeting request politely" --thinking high
```

### Example 2: Quick information lookup

```bash
openclaw agent --message "What's the capital of Japan and its population?" --thinking low
```

### Example 3: Send urgent WhatsApp message

```bash
# First, ensure WhatsApp is configured
openclaw channels configure whatsapp

# Send a message
openclaw message send --to +1234567890 --message "Emergency - please call me ASAP"
```

### Example 4: Check system health before important tasks

```bash
openclaw health && openclaw channels status --probe
```

### Example 5: Research and summarization

```bash
openclaw agent --message "Research the latest developments in quantum computing and give me a summary" --thinking high
```

### Example 6: Automate daily standup

```bash
openclaw agent --message "Generate a standup update based on my recent activity" --thinking medium
```

### Example 7: Monitor gateway logs in real-time

```bash
# In a tmux session
openclaw logs gateway --follow
```

### Example 8: Quick translation

```bash
openclaw agent --message "Translate 'How are you?' to Spanish, French, and German" --thinking low
```

### Example 9: Code assistance

```bash
openclaw agent --message "Write a Python function to calculate fibonacci numbers recursively" --thinking medium
```

### Example 10: Schedule a reminder

```bash
openclaw agent --message "Remind me via WhatsApp in 2 hours to check the server logs" --thinking medium
```

**Thinking levels explained:**
- `--thinking low` (fast, simple queries)
- `--thinking medium` (balanced speed and depth)
- `--thinking high` (thorough, research-intensive tasks)

## Advanced: SSH tunneling

If you want to access the Gateway from other devices (iOS app, macOS app, another computer), use SSH tunneling.

### Forward Gateway WebSocket

From Blink Shell or another machine:

```bash
ssh -N -L 18789:127.0.0.1:18789 user@your-server-host
```

Keep this running in a Blink Shell session (or use tmux/screen). Now:

- The Gateway WebSocket is available at `ws://127.0.0.1:18789` on your iOS device
- OpenClaw iOS app can connect via "Manual Host" (Settings → enter `127.0.0.1:18789`)
- CLI commands from your laptop work through the tunnel

### Using tmux/screen in Blink Shell

Keep sessions persistent when you disconnect:

```bash
# Start tmux
tmux new -s openclaw

# Run commands in tmux
openclaw gateway run --bind loopback --port 18789

# Detach: Ctrl+B, then D
# Reattach later:
tmux attach -t openclaw
```

SSH tunneling docs: [Remote access](https://docs.openclaw.ai/gateway/remote)

## Connecting the OpenClaw iOS app

If you have the OpenClaw iOS app (internal preview), connect it to your Gateway:

1. **Option A: SSH tunnel** (from above)
   - Keep SSH tunnel running in Blink Shell
   - In iOS app Settings → Manual Host → enter `127.0.0.1:18789`

2. **Option B: Tailscale/VPN**
   - Set up a Tailscale network ([Tailscale docs](https://tailscale.com/kb/installation))
   - iOS app auto-discovers Gateway on the tailnet
   - Or use Manual Host with the server's Tailscale IP

3. **Option C: Same LAN**
   - If iOS device and server are on the same WiFi, the app auto-discovers via Bonjour
   - Gateway must bind to `lan` or `auto` (not `loopback`)

iOS app guide: [iOS docs](https://docs.openclaw.ai/platforms/ios)

## Troubleshooting

### Command not found: openclaw

The npm global bin directory is not in PATH. Fix:

```bash
# Check where npm installs globals
npm prefix -g

# Add to PATH (zsh)
echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Or bash
echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Gateway not starting

Check logs:

```bash
openclaw logs gateway --tail 100
```

Run doctor:

```bash
openclaw doctor
```

Common fixes:

- Port already in use: change port with `openclaw config set gateway.port 18790`
- Node version too old: upgrade to Node ≥22
- Missing dependencies: run `npm install -g openclaw@latest` again

Troubleshooting guide: [Gateway troubleshooting](https://docs.openclaw.ai/gateway/troubleshooting)

### WhatsApp QR code not showing

Blink Shell should display QR codes in the terminal. If not:

```bash
# Generate QR code and save to file
openclaw channels configure whatsapp --qr-file /tmp/whatsapp-qr.png

# Then transfer the file to your iOS device and scan with WhatsApp
```

### Connection drops when Blink Shell closes

Use a process manager to keep the Gateway running:

```bash
# Install as daemon (recommended)
openclaw onboard --install-daemon

# Or use tmux/screen (see above)
```

### Permissions or sudo issues

Don't install OpenClaw with `sudo` for global npm installs. Use a version manager:

```bash
# Install nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22

# Now install OpenClaw without sudo
npm install -g openclaw@latest
```

## Performance considerations

### Resource usage on mobile SSH

- Gateway runs on the server, not your iOS device
- Blink Shell uses minimal resources (just the terminal session)
- Battery impact is similar to any SSH session

### Network bandwidth

- CLI commands: negligible (text-only)
- Model API calls: Gateway handles this (server's network)
- Channel messages: depends on activity (mostly text)

### Always-on vs on-demand

**Always-on (recommended):**
- Install daemon: `openclaw onboard --install-daemon`
- Gateway runs 24/7 on the server
- Responds to messages even when you're not connected
- Best for WhatsApp/Telegram/Discord bots

**On-demand (development):**
- Start Gateway manually when needed: `openclaw gateway run`
- Stop when done: `openclaw gateway stop`
- Good for testing, but channels won't respond when offline

## Updating OpenClaw

From Blink Shell:

```bash
# Check current version
openclaw --version

# Update to latest
npm update -g openclaw@latest

# Or use the update command
openclaw update --channel stable

# Check for issues after update
openclaw doctor
```

Update guide: [Updating docs](https://docs.openclaw.ai/install/updating)

## Security notes

- **Keep Gateway loopback-only** (`gateway.bind: loopback`) for security
- Use SSH tunneling for remote access (don't expose Gateway ports publicly)
- Store API keys securely (use environment variables or config encryption)
- Set up SSH keys in Blink Shell (more secure than passwords)
- Consider Tailscale for zero-trust networking

Security guide: [Security docs](https://docs.openclaw.ai/gateway/security)

## Related documentation

- [Getting Started](https://docs.openclaw.ai/start/getting-started) - complete beginner guide
- [Remote Access](https://docs.openclaw.ai/gateway/remote) - SSH tunneling and VPN setup
- [iOS App](https://docs.openclaw.ai/platforms/ios) - connecting the OpenClaw iOS app
- [VPS Guide](https://docs.openclaw.ai/vps) - server hosting options
- [CLI Reference](https://docs.openclaw.ai/cli) - all CLI commands
- [Gateway Configuration](https://docs.openclaw.ai/gateway/configuration) - config options

## Community and support

- [Discord](https://discord.gg/clawd) - get help and share tips
- [GitHub Issues](https://github.com/openclaw/openclaw/issues) - report bugs
- [Docs](https://docs.openclaw.ai) - full documentation

## Tips for Blink Shell users

1. **Set up SSH keys** for passwordless login (faster workflow)
2. **Use tmux** to keep sessions alive when disconnecting
3. **Alias common commands** in `~/.zshrc` or `~/.bashrc`:
   ```bash
   alias oc='openclaw'
   alias ocg='openclaw gateway'
   alias ocs='openclaw status --deep'
   alias ocl='openclaw logs gateway --tail 50'
   ```
4. **Enable Mosh** for better mobile connection stability (if server supports it)
5. **Use Blink Shell's snippets** to store common OpenClaw commands
6. **Configure multiple hosts** in Blink Shell for different servers

Enjoy using OpenClaw from your iOS device! 🦞
