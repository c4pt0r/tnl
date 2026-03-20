---
name: tnl
description: Help a coding agent use tnl to get temporary access to a user's local files or directories, inspect a shared codebase through a share code, guide the user through tnl install/init/share, or deploy/configure a dedicated Cloudflare Worker backend for tnl. Use when the user wants to share files with the agent without pushing to git, paste a tnl share code or public URL, or ask for tnl setup/troubleshooting.
---

# tnl

`tnl` is a tunnel-based file and directory sharing tool for short-lived remote access.

Use it to let a coding agent inspect a local folder without requiring git push, zip upload, SSH, or a persistent server.

The normal model is:

1. The user runs `tnl share <path>` on their machine.
2. The user sends the share code or public URL.
3. The agent uses `tnl` commands against `<code>:/...` to inspect or copy what it needs.

## Trigger patterns

Reach for this skill when the user says things like:

- "use tnl"
- "share my local repo"
- "I can give you a share code"
- "inspect files from my machine"
- "set up tnl"
- "deploy a tnl worker"
- "tnl is not working"

## Working rules

- Prefer a share code such as `ABC123defg:/` over the browser URL when you need CLI access.
- Prefer `--mode ro` by default. Ask for `--mode rw` only when the task truly requires remote writes or deletes.
- Keep file access minimal. Use `tnl ls`, `tnl tree`, `tnl cat`, `tnl grep`, and `tnl glob` before copying large directories.
- If you need local processing, copy only the necessary files with `tnl cp` or `tnl cp -r`.
- Treat a tnl share as ephemeral. If commands fail with availability errors, assume the sharer disconnected and ask the user to re-run `tnl share`.
- If the user only needs setup help, do not force a deployment path. Offer public-worker setup first unless they explicitly want their own backend.
- Prefer the nightly install path for public onboarding unless the user explicitly asks for a stable release.
- When checking what binary a user has, ask for `tnl version` rather than inferring from install time.

## Default workflow

### 1. Identify the task shape

Pick one path first:

- `consume-share`: the user already has a share code or can start sharing now
- `setup-cli`: the user needs `tnl` installed and configured
- `release-management`: the user needs versioning, release, or nightly-build changes
- `deploy-backend`: the user wants their own Cloudflare Worker
- `troubleshoot`: an existing setup or share is failing

### 2. If the user wants to share files with the agent

Run this flow:

1. Confirm whether the user already has `tnl` installed.
2. If not, use the install flow in [cli-setup.md](references/cli-setup.md).
3. Confirm the CLI has a worker URL configured.
4. Ask the user to start a read-only share unless writes are required:

```bash
tnl share /path/to/project
```

5. Ask the user to send either:
   - the `Share code`
   - or the `Public URL`
6. If they send the public URL, extract the `code=` value and use that as the remote prefix.
7. Start with:

```bash
tnl ls <code>:/
tnl tree <code>:/
```

8. Inspect targeted files with:

```bash
tnl cat <code>:/path/to/file
tnl grep "pattern" <code>:/
tnl glob <code>:/**/*.ts
```

9. Copy only what you need:

```bash
tnl cp <code>:/path/to/file ./local-file
tnl cp -r <code>:/subdir ./local-dir
```

### 3. If remote writes are required

Only ask for `rw` when the task requires creating, replacing, appending, or deleting files in the shared directory.

Use:

```bash
tnl share /path/to/project --mode rw
```

Then operate carefully with:

```bash
echo "content" | tnl tee <code>:/path/to/file
cat patch.txt | tnl tee -a <code>:/path/to/file
tnl rm <code>:/path/to/file
tnl rm -r <code>:/path/to/dir
```

State explicitly that anyone with the share code can perform those writes while the share is live.

## Definition of done

For setup tasks, do not stop at installation. The task is complete only when:

1. `tnl` is installed or built successfully
2. a worker URL is configured
3. a real share can be started
4. at least one access command succeeds against the share

For share-consumption tasks, do not claim success until:

1. you have the live share code
2. you can read the target path with `tnl ls`, `tnl tree`, or `tnl cat`
3. any required file copy or remote write has been verified

## Failure handling

Use these quick interpretations:

- `worker URL not configured`: initialize config or set `TNL_WORKER_URL`
- `share not available`: the sharer stopped or the code is wrong
- `read-only share`: the user started `ro` mode but the task needs `rw`
- `path outside share root`: access escaped the shared root or hit a blocked symlink

If setup is the issue, read [cli-setup.md](references/cli-setup.md).

If deployment is the issue, read [worker-deploy.md](references/worker-deploy.md).

If the task is about release channels, installer behavior, or version output, read [release-and-nightly.md](references/release-and-nightly.md).

## References

- Read [cli-setup.md](references/cli-setup.md) for installation, config, and command patterns.
- Read [worker-deploy.md](references/worker-deploy.md) when the user wants a dedicated Cloudflare Worker backend.
- Read [release-and-nightly.md](references/release-and-nightly.md) for versioning, GitHub Releases, and nightly channel behavior.
