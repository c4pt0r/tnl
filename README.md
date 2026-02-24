# tnl - Tunnel File Sharing

A simple, ephemeral file sharing tool using WebSocket tunnels through Cloudflare Workers.

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
Copied to ./local.txt
```

## Features

- 🚀 **Instant sharing** - One command to share, no account needed
- 🔒 **Ephemeral** - Share dies when you disconnect
- 🌐 **NAT traversal** - Works through firewalls via Cloudflare
- 📁 **Directory support** - Share entire folders
- 🔐 **Permission control** - Read-only (default) or read-write mode

## Installation

### CLI (Go)

```bash
go install github.com/c4pt0r/tnl/cmd/tnl@latest
```

Or build from source:
```bash
git clone https://github.com/c4pt0r/tnl.git
cd tnl
go build -o tnl ./cmd/tnl
```

### Worker (Cloudflare)

```bash
cd worker
npm install
# Edit wrangler.toml with your account
npx wrangler deploy
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

### View file content
```bash
tnl cat <code>:/file.txt
```

### Download file
```bash
tnl cp <code>:/remote/file.txt ./local.txt
```

### Delete file (requires rw mode)
```bash
tnl rm <code>:/file.txt
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

## Configuration

Set custom worker URL:
```bash
tnl share ./dir --worker wss://your-worker.workers.dev/ws
```

## License

MIT
