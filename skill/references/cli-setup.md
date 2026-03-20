# tnl CLI Setup and Use

## Install

Preferred install:

```bash
curl -fsSL https://raw.githubusercontent.com/c4pt0r/tnl/master/install.sh | sh
```

Alternative install:

```bash
go install github.com/c4pt0r/tnl/cmd/tnl@latest
```

Build from source:

```bash
git clone https://github.com/c4pt0r/tnl.git
cd tnl
go build -o tnl ./cmd/tnl
```

## Configure worker URL

`tnl` resolves its worker URL in this order:

1. `--worker`
2. `TNL_WORKER_URL`
3. `~/.tnl/config.json`
4. `~/.config/tnl/config.json`

Recommended initialization:

```bash
tnl init wss://<worker-host>/ws
```

Environment-based configuration:

```bash
export TNL_WORKER_URL=wss://<worker-host>/ws
```

Config file shape:

```json
{
  "worker_url": "wss://<worker-host>/ws"
}
```

## Start a share

Read-only:

```bash
tnl share ./mydir
```

Read-write:

```bash
tnl share ./mydir --mode rw
```

Expected output includes:

- absolute shared path
- mode
- share code
- public URL

## Inspect a share

List:

```bash
tnl ls <code>:/
tnl ls <code>:/subdir
```

Tree:

```bash
tnl tree <code>:/
```

Read file:

```bash
tnl cat <code>:/file.txt
```

Search:

```bash
tnl grep "TODO" <code>:/
tnl grep -i "error" <code>:/
tnl grep -l "import" <code>:/
tnl glob <code>:/**/*.go
```

Copy:

```bash
tnl cp <code>:/file.txt ./local.txt
tnl cp -r <code>:/subdir ./local-dir
tnl cp -r <code>:/ ./snapshot
```

## Remote writes

These require the share to be started with `--mode rw`.

Overwrite:

```bash
echo "hello" | tnl tee <code>:/file.txt
```

Append:

```bash
cat output.log | tnl tee -a <code>:/log.txt
```

Remove:

```bash
tnl rm <code>:/file.txt
tnl rm -r <code>:/dir
```

## Troubleshooting

- `worker URL not configured`
  Fix by running `tnl init ...` or exporting `TNL_WORKER_URL`.
- `share not available`
  Confirm the sharer process is still running and the share code is correct.
- `read-only share`
  Re-share with `--mode rw` if remote writes are intentionally required.
- `path outside share root`
  Stay inside the shared root; blocked symlink traversal is expected behavior.
