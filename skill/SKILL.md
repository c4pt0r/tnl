---
name: tnl
description: Install and deploy tnl (tunnel-based ephemeral file sharing). Use when user wants to share files temporarily, set up tnl CLI, or deploy their own tnl Cloudflare Worker server.
---

# tnl - Tunnel File Sharing

Ephemeral file sharing via WebSocket tunnels. Share files from CLI, access via web or CLI.

## Setup Flow

**Before installing, ask user:**
> Do you want to deploy your own tnl server, or use the public server?
> - **Public server**: Quick setup, no Cloudflare account needed
> - **Own server**: Full control, requires Cloudflare account + API token

### Option A: Use Public Server (Quick)

```bash
# Install CLI
curl -fsSL https://raw.githubusercontent.com/c4pt0r/tnl/master/install.sh | sh

# Configure to use public server
tnl init wss://tnl.dongxuhuang.workers.dev/ws
```

### Option B: Deploy Own Server

See [Deploy Own Server](#deploy-own-server-cloudflare-worker) section below, then install CLI.

## Usage

### Sharing (host side)
```bash
tnl share ./mydir              # Read-only (default)
tnl share ./mydir --mode rw    # Read-write (dangerous!)
```

### Browsing (client side)
```bash
tnl ls <code>:/                # List root directory
tnl ls <code>:/subdir          # List subdirectory
tnl tree <code>:/              # Recursive tree view
```

### Reading files
```bash
tnl cat <code>:/file.txt       # Print file to stdout
tnl cat <code>:/file.txt > out # Save to file
```

### Copying files
```bash
tnl cp <code>:/file.txt ./local      # Copy single file
tnl cp -r <code>:/ ./backup          # Copy entire share recursively
tnl cp -r <code>:/subdir ./local     # Copy subdirectory
```

### Writing/Deleting (requires --mode rw)
```bash
tnl rm <code>:/file.txt        # Delete file
tnl rm <code>:/subdir          # Delete directory recursively
# Note: Write via CLI not yet implemented, use web UI
```

### Web Access
Share URL is printed when running `tnl share`. Open in browser for:
- File browsing with syntax highlighting
- Direct download
- Raw file view

## Deploy Own Server (Cloudflare Worker)

Requires: Cloudflare account + API token with Workers permissions.

### Interactive Setup

Ask user for:
1. **Cloudflare API Token** - From https://dash.cloudflare.com/profile/api-tokens
   - Create token with "Edit Cloudflare Workers" permission
2. **Worker name** (optional, default: `tnl`)

### Deployment Steps

```bash
# Clone repo
git clone https://github.com/c4pt0r/tnl.git
cd tnl/worker

# Install wrangler if needed
npm install -g wrangler

# Store token securely
echo "CLOUDFLARE_API_TOKEN=<user-token>" > .dev.vars
chmod 600 .dev.vars

# Deploy
source .dev.vars && export CLOUDFLARE_API_TOKEN && npx wrangler deploy

# Configure CLI to use new server
tnl init wss://<worker-name>.<account>.workers.dev/ws
```

### Custom Domain (Optional)

In `wrangler.toml`, add:
```toml
[vars]
PUBLIC_URL = "https://share.example.com"

[[routes]]
pattern = "share.example.com/*"
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `share not available` | Sharer disconnected or wrong code |
| `read-only share` | Use `--mode rw` when sharing |
| `path outside share root` | Symlink escape blocked (security) |

## Security Notes

- Share codes are cryptographically random (52^10 entropy)
- Symlinks are validated to prevent escape
- XSS/header injection protected
- **rw mode is dangerous** - anyone with code can delete files
