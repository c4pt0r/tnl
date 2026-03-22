# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is TNL

TNL (Tunnel) is a peer-to-peer file sharing tool. A sharer runs `tnl share <path>` which opens a persistent WebSocket to a Cloudflare Worker relay. An accessor connects with a share code to list, read, copy, write, or search files. The Worker (Durable Objects + SQLite) routes messages between paired WebSocket connections — no files are stored server-side.

## Build & Development Commands

```bash
make build              # Build CLI: go build -o tnl ./cmd/tnl
make test               # Run all tests: go test ./...
make fmt                # Format Go sources: gofmt -w
make check              # fmt + test
make clean              # Remove binary
make worker-install     # npm install in worker/
make worker-dev         # Run worker locally via wrangler dev
make worker-deploy      # Deploy worker to Cloudflare
```

Version metadata is injected via ldflags (`-X main.version=... -X main.commit=... -X main.buildDate=...`). CI does this automatically; local `make build` does not.

## Architecture

```
Sharer ──WebSocket──► Cloudflare Worker (ShareDO) ◄──WebSocket── Accessor
```

Four packages, one Go module (`github.com/c4pt0r/tnl`):

- **`cmd/tnl/main.go`** — Cobra CLI. All commands (share, ls, tree, cat, cp, rm, tee, glob, grep, init, version) defined in one file.
- **`client/share.go`** — `ShareClient`: persistent WebSocket connection, serves file operation requests from accessors. 30s ping keepalive to survive Cloudflare's ~100s idle timeout.
- **`client/remote.go`** — `RemoteClient`: connects as accessor, implements all remote file operations. Uses 64KB chunked streaming with base64 encoding over JSON WebSocket.
- **`protocol/protocol.go`** — Message types and operation codes shared between client and worker.
- **`worker/src/index.ts`** — Cloudflare Worker with Durable Objects. Routes WebSocket messages between sharer/accessor pairs. Also serves an HTML UI for browser-based file access.

## Key Patterns

- **Chunked transfer**: Files stream in 64KB chunks, base64-encoded in JSON messages, with optional gzip compression.
- **Request correlation**: UUID-based reqId matches async responses to requests.
- **Worker URL resolution** (priority order): `--worker` flag > `TNL_WORKER_URL` env > config file (`~/.tnl/config.json` or `~/.config/tnl/config.json`) > default public worker.
- **Share codes**: 10 random chars (~60 bits entropy), sole access control mechanism.
- **Mode enforcement**: `ro` (default) or `rw` set at share time; write operations rejected in ro mode.
- **Path safety**: symlink traversal is blocked to prevent directory escape.

## CI/CD

Three GitHub Actions workflows:
- **ci.yml** — Build, test, golangci-lint on push/PR
- **release.yml** — Cross-platform binaries on `v*` tags (linux/darwin amd64+arm64, windows amd64)
- **nightly.yml** — Daily builds published to `nightly` release tag
