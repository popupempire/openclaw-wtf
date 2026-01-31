---
summary: "Solo Godmode: Single-agent configuration with unrestricted host access"
title: Solo Godmode
read_when: "You want to run OpenClaw as a single personal assistant with full system access"
status: active
---

# Solo Godmode Configuration

**Solo Godmode** is a configuration pattern for running OpenClaw as a single personal AI assistant with unrestricted access to your host system. This mode disables sandboxing and elevated exec prompts, giving the agent full filesystem and process control.

## ⚠️ Security Warning

Solo Godmode gives your AI assistant **unrestricted access** to your system:

- Can read/write any file the user can access
- Can execute any command
- Can modify system configuration
- Can install/remove software
- No Docker isolation

**Only use this mode if:**
- You're the only user
- You trust the AI model provider
- You understand the risks of prompt injection
- You run on a dedicated/isolated machine

## When to Use Solo Godmode

✅ **Good use cases:**
- Personal development machine
- Home lab/experimental setup
- Trusted single-user environment
- Maximum AI assistant capabilities needed

❌ **Avoid for:**
- Shared systems
- Production servers
- Systems with sensitive data
- Multi-user environments

## Configuration

Add this to your `~/.openclaw/openclaw.json`:

```json5
{
  "agents": {
    "defaults": {
      "workspace": "~/.openclaw/workspace",
      "sandbox": {
        "mode": "off"  // Disable all sandboxing
      },
      "elevatedDefault": "full"  // Skip elevated exec prompts
    }
  },
  "tools": {
    "exec": {
      "enabled": true,
      "elevated": true  // Enable elevated commands
    }
  }
}
```

## Quick Setup

```bash
# Set sandbox mode to off (no Docker isolation)
openclaw config set agents.defaults.sandbox.mode off

# Set elevated default to full (no prompts for sudo/admin commands)
openclaw config set agents.defaults.elevatedDefault full

# Enable elevated exec
openclaw config set tools.exec.elevated true

# Verify configuration
openclaw config get agents.defaults.sandbox
openclaw config get agents.defaults.elevatedDefault
```

## What This Enables

With Solo Godmode active:

1. **No Docker sandboxing**: Tools run directly on host
2. **Full filesystem access**: Read/write anywhere the user can access
3. **Unrestricted commands**: Execute any shell command
4. **No elevated prompts**: Sudo/admin commands run without confirmation
5. **Direct process control**: Start/stop services, modify system state

## Comparison: Sandboxed vs Solo Godmode

| Feature | Sandboxed (`mode: "non-main"`) | Solo Godmode (`mode: "off"`) |
|---------|-------------------------------|----------------------------|
| Docker isolation | ✅ Yes (non-main sessions) | ❌ No |
| Filesystem access | Limited to sandbox workspace | Full host access |
| Command execution | Restricted in container | Unrestricted on host |
| Elevated commands | Prompted | Auto-approved (with `elevatedDefault: "full"`) |
| Tool allowlist | Applied | Bypassed |
| Security boundary | Moderate | None |
| Performance | Slight overhead | Native |

## Related Configuration

### Workspace Location

The agent workspace is where bootstrap files (`AGENTS.md`, `SOUL.md`, etc.) live:

```bash
openclaw config set agents.defaults.workspace ~/.openclaw/workspace
```

### Tool Policy

Even in Solo Godmode, you can restrict specific tools if desired:

```json5
{
  "tools": {
    "policy": {
      "allow": ["exec", "read", "write", "edit", "browser"],
      "deny": ["nodes", "gateway"]
    }
  }
}
```

See [Tool Policy](/tools/policy) for details.

### Elevated Exec Modes

Control elevated command behavior:

- `"off"`: Elevated exec disabled (fail with error)
- `"on"`: Prompt for each elevated command (default when sandboxing is off)
- `"ask"`: Prompt first time per session
- `"full"`: Auto-approve all elevated commands (godmode)

```bash
openclaw config set agents.defaults.elevatedDefault full
```

## Verification

Check your effective configuration:

```bash
# Show sandbox config
openclaw sandbox explain

# Show tool policy
openclaw config get tools

# Show elevated settings
openclaw config get agents.defaults.elevatedDefault
```

## Safety Tips

Even in Solo Godmode:

1. **Review agent instructions**: Keep `AGENTS.md` and `SOUL.md` up to date with boundaries
2. **Monitor logs**: Enable verbose logging to see what the agent does
3. **Use backups**: Regular backups of your workspace and system
4. **Isolated environment**: Consider running on a VM or dedicated machine
5. **Rate limits**: Configure API rate limits to prevent runaway execution

## Reverting to Sandboxed Mode

To disable Solo Godmode and re-enable sandboxing:

```bash
# Enable sandboxing for non-main sessions
openclaw config set agents.defaults.sandbox.mode non-main

# Require prompts for elevated commands
openclaw config set agents.defaults.elevatedDefault on

# Restart gateway
openclaw gateway restart
```

## See Also

- [Sandboxing](/gateway/sandboxing) - Full sandboxing documentation
- [Sandbox vs Tool Policy vs Elevated](/gateway/sandbox-vs-tool-policy-vs-elevated) - Security model comparison
- [Elevated Mode](/tools/elevated) - Elevated exec details
- [Gateway Configuration](/gateway/configuration) - Complete config reference
- [Agent Workspace](/concepts/agent-workspace) - Workspace structure and bootstrap files
