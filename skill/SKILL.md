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
# Press Ctrl+C to stop sharing
```

### Browsing
```bash
tnl ls <code>:/                # List with permissions, size, date
tnl ls <code>:/subdir          # List subdirectory
tnl tree <code>:/              # Recursive tree with sizes
```

### Reading
```bash
tnl cat <code>:/file.txt       # Print to stdout
tnl cat <code>:/file.txt > out # Redirect to file
```

### Copying
```bash
tnl cp <code>:/file.txt ./         # Copy to current dir
tnl cp <code>:/file.txt ./new.txt  # Copy with rename
tnl cp -r <code>:/ ./backup        # Recursive copy
tnl cp -r <code>:/src ./           # Copy subdir
# Supports scp-like path behavior
```

### Searching
```bash
# grep - regex search
tnl grep "pattern" <code>:/        # Search all files
tnl grep -i "error" <code>:/       # Case insensitive
tnl grep -w "main" <code>:/        # Whole word only
tnl grep -l "import" <code>:/      # List filenames only
tnl grep -c "func" <code>:/        # Count matches per file
tnl grep -A 3 "TODO" <code>:/      # 3 lines after match
tnl grep -B 2 "TODO" <code>:/      # 2 lines before match
tnl grep -C 2 "TODO" <code>:/      # 2 lines context (before+after)

# glob - pattern matching
tnl glob <code>:/*.txt             # .txt in root
tnl glob <code>:/**/*.go           # .go files recursively
tnl glob <code>:/src/*.{js,ts}     # Multiple extensions
```

### Writing (requires --mode rw)
```bash
# tee - write stdin to remote (and stdout)
echo "hello" | tnl tee <code>:/file.txt      # Write/overwrite
cat log.txt | tnl tee -a <code>:/log.txt     # Append mode

# rm - delete
tnl rm <code>:/file.txt            # Delete file
tnl rm -r <code>:/subdir           # Delete directory recursively
```

### Web Access
Share URL printed on `tnl share`. Features:
- Directory browsing
- Syntax highlighting (JS/TS/Go/Python/Rust/JSON/YAML...)
- Line numbers
- Raw view / Download buttons

### Global Flags
```bash
--worker <url>   # Override server URL
-p, --progress   # Show progress bar (default: true)
```

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
