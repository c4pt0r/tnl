# Deploy a Dedicated tnl Worker

Use this path only when the user wants their own backend. Otherwise prefer an existing public worker.

## Prerequisites

- Cloudflare account
- Node.js 18+
- Wrangler CLI or `npx wrangler`

## Deploy from source

```bash
git clone https://github.com/c4pt0r/tnl.git
cd tnl/worker
npm install
npx wrangler login
npx wrangler deploy
```

The deploy output should print a URL like:

```text
https://tnl.<account>.workers.dev
```

Then configure the CLI with:

```bash
tnl init wss://tnl.<account>.workers.dev/ws
```

## Deploy with API token

If browser login is not desired:

```bash
export CLOUDFLARE_API_TOKEN=<token>
cd tnl/worker
npx wrangler deploy
```

The token should have Cloudflare Workers edit permissions.

## Optional custom public URL

In `worker/wrangler.toml`, set:

```toml
[vars]
PUBLIC_URL = "https://share.example.com"
```

Then redeploy.

If the user also wants a custom domain route, configure it in Cloudflare Workers and point the CLI to:

```bash
tnl init wss://share.example.com/ws
```

## Verification

After deployment:

1. Run `tnl init wss://<host>/ws`
2. Run `tnl share ./some-dir`
3. Verify another `tnl ls <code>:/` works

Do not mark deployment complete until a real share works end to end.
