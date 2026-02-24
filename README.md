# tnl - Tunnel File (Directory) Sharing

A simple, ephemeral file sharing tool using WebSocket tunnels through Cloudflare Workers.

### Install tnl CLI

```bash
curl -fsSL https://raw.githubusercontent.com/c4pt0r/tnl/master/install.sh | sh
```

**User A shares:**
```bash
$ tnl share ./mydir
Sharing: /home/user/mydir
Mode: ro

Share code:  Xyiojdu53d
Public URL:  https://tnl.example.workers.dev/?code=Xyiojdu53d

Others can access with:
  tnl ls Xyiojdu53d:/
  tnl cp Xyiojdu53d:<file> ./local
  tnl cp -r Xyiojdu53d:/ ./localdir

Press Ctrl+C to stop sharing
```

**User B accesses:**
```bash
$ tnl ls Xyiojdu53d:/
-rw-r--r--  1.2 KB  Feb 23 18:12  hello.txt
drwxr-xr-x  4.0 KB  Feb 23 18:12  subdir/

$ tnl cat Xyiojdu53d:/hello.txt
Hello from tnl!

$ tnl cp Xyiojdu53d:/hello.txt ./local.txt
hello.txt 100% |████████████████████| 1.2KB/1.2KB
Copied to ./local.txt

$ tnl cp -r Xyiojdu53d:/ ./backup
Copying 15 files 100% |████████████████████| 2.5MB/2.5MB
Copied to ./backup/
```

## Features

- 🚀 **Instant sharing** - One command to share, no account needed
- 🔒 **Ephemeral** - Share dies when you disconnect
- 🌐 **NAT traversal** - Works through firewalls via Cloudflare
- 📁 **Directory support** - Share entire folders, copy recursively
- 🔐 **Permission control** - Read-only (default) or read-write mode
- 📊 **Progress bar** - Real-time download progress with speed
- 🗜️ **Compression** - Automatic gzip compression for transfers

## Installation

### 1. Deploy Worker (Server)

First, deploy the Cloudflare Worker that relays connections.

#### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Node.js](https://nodejs.org/) 18+ installed
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

#### Step-by-step

```bash
# Clone the repo
git clone https://github.com/c4pt0r/tnl.git
cd tnl/worker

# Install dependencies
npm install

# Login to Cloudflare (opens browser)
npx wrangler login

# Deploy
npx wrangler deploy
```

After deployment, you'll see:
```
Deployed tnl triggers
  https://tnl.YOUR_ACCOUNT.workers.dev
```

Save this URL - you'll need it for the CLI.

#### Configuration (Optional)

Edit `wrangler.toml` to customize:

```toml
name = "tnl"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# Custom public URL (for custom domains)
[vars]
PUBLIC_URL = "https://tnl.your-domain.com"

[durable_objects]
bindings = [
  { name = "SHARES", class_name = "ShareDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ShareDO"]
```

#### Custom Domain (Optional)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → tnl
2. Settings → Triggers → Custom Domains
3. Add your domain (must be on Cloudflare DNS)
4. Update `PUBLIC_URL` in wrangler.toml and redeploy

#### Using API Token (CI/CD)

Instead of `wrangler login`, use an API token:

```bash
# Create token at https://dash.cloudflare.com/profile/api-tokens
# Use template: "Edit Cloudflare Workers"

export CLOUDFLARE_API_TOKEN=your_token_here
npx wrangler deploy
```

### 2. Install CLI (Client)

#### Option A: Quick Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/c4pt0r/tnl/master/install.sh | sh
```

This auto-detects your OS/architecture and installs the latest release.

#### Option B: Go Install

```bash
go install github.com/c4pt0r/tnl/cmd/tnl@latest
```

#### Option C: Build from Source

```bash
git clone https://github.com/c4pt0r/tnl.git
cd tnl
go build -o tnl ./cmd/tnl
sudo mv tnl /usr/local/bin/
```

#### Option D: Download Binary

Check [Releases](https://github.com/c4pt0r/tnl/releases) for pre-built binaries.

### 3. Configure CLI

Configure your worker URL (choose one method):

```bash
# Method 1: Quick init (recommended)
tnl init wss://tnl.YOUR_ACCOUNT.workers.dev/ws

# Method 2: Environment variable
export TNL_WORKER_URL=wss://tnl.YOUR_ACCOUNT.workers.dev/ws

# Method 3: Config file
mkdir -p ~/.tnl
echo '{"worker_url": "wss://tnl.YOUR_ACCOUNT.workers.dev/ws"}' > ~/.tnl/config.json

# Method 4: Command line flag (per-command)
tnl share ./dir --worker wss://tnl.YOUR_ACCOUNT.workers.dev/ws
```

## Usage

### Share a directory (read-only)
```bash
tnl share ./mydir
```

### Share with write access
```bash
tnl share ./mydir --mode=rw
```

### List remote directory
```bash
tnl ls <code>:/path
```

### View directory tree
```bash
tnl tree <code>:/
```

### View file content
```bash
tnl cat <code>:/file.txt
```

### Download file
```bash
tnl cp <code>:/remote/file.txt ./local.txt
```

### Download directory recursively
```bash
tnl cp -r <code>:/ ./local-backup
```

### Delete file (requires rw mode)
```bash
tnl rm <code>:/file.txt
```

### Disable progress bar
```bash
tnl cp -p=false <code>:/file.txt ./local.txt
```

## Architecture

```
User A (sharer)                    Cloudflare Worker                    User B (accessor)
     │                                    │                                    │
     │──── WebSocket (persistent) ────────│                                    │
     │                                    │                                    │
     │                                    │◄─── WebSocket (request) ───────────│
     │◄─── Forward request ───────────────│                                    │
     │                                    │                                    │
     │──── Response ──────────────────────│                                    │
     │                                    │──── Forward response ──────────────►│
```

- **Sharer** maintains a persistent WebSocket connection to the Worker
- **Worker** (Durable Object) manages the share session and routes requests
- **Accessor** connects via WebSocket, sends requests, receives responses
- When sharer disconnects, share becomes unavailable immediately
- All data streams through the Worker - no direct P2P connection

## How It Works

1. **Share**: User A runs `tnl share ./dir`, which:
   - Connects to Worker via WebSocket
   - Receives a unique share code
   - Waits for file operation requests

2. **Access**: User B runs `tnl ls CODE:/`, which:
   - Connects to Worker with the share code
   - Worker routes request to User A's connection
   - User A reads local files and sends response
   - Response is relayed back to User B

3. **Transfer**: Files are streamed in 64KB chunks with:
   - Optional gzip compression (auto-disabled if larger)
   - Progress tracking with file size
   - Base64 encoding for WebSocket transport

## Security Considerations

- Share codes are randomly generated (10 chars, ~60 bits entropy)
- No authentication - anyone with the code can access
- Read-only by default, explicit `--mode=rw` required for writes
- No encryption beyond HTTPS/WSS (Cloudflare handles TLS)
- Sharer controls what's exposed via the root path

## Limitations

- Cloudflare Workers free tier:
  - 100,000 requests/day
  - 10ms CPU time per request (may affect large directories)
  - Durable Objects: 1GB storage (not used for file storage)
- WebSocket payload size limits may affect very large files
- No resume support for interrupted transfers (yet)

## Troubleshooting

### "worker URL not configured"
Run `tnl init wss://your-worker.workers.dev/ws` or set `TNL_WORKER_URL`.

### "Share not available"
The sharer has disconnected. Share codes are ephemeral.

### "read-only share"
The share was created with default `--mode=ro`. Ask sharer to use `--mode=rw`.

### Slow transfers
- Check your network connection
- Large files transfer in chunks; this is normal
- Consider using `--progress=false` to reduce overhead

## Contributing

PRs welcome! Areas of interest:
- Resume support for interrupted transfers
- End-to-end encryption
- Web UI for browser access
- Upload support (B → A)

## License

MIT
