# tnl Release and Nightly Builds

## Current release model

- Tagged releases publish stable binaries to GitHub Releases
- The `nightly` release tag is updated by automation
- The install script defaults to `nightly`
- Users can opt into stable with `TNL_CHANNEL=stable`

## User-facing guidance

Default install:

```bash
curl -fsSL tnl.db9.workers.dev/install.sh | sh
```

Stable install:

```bash
curl -fsSL tnl.db9.workers.dev/install.sh | TNL_CHANNEL=stable sh
```

Check binary version:

```bash
tnl version
```

Expected output includes:

- version string
- commit
- build timestamp

## Agent guidance

- If the user wants the newest public binary, prefer nightly
- If the user cares about reproducibility or release tags, prefer stable
- If a bug report may be nightly-only, ask the user for `tnl version`
- If changing GitHub Actions, keep stable release and nightly release workflows separate
