# Nx cache worker

A Cloudflare Worker that stores Nx task results in R2. It serves the Nx
self-hosted remote cache API:

| Route                  | Access                        | Answer                                                                  |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `GET /health`          | Public                        | `{"ok": true, "commit": "<deployed commit>"}`                           |
| `GET /v1/cache/<hash>` | The write token or read token | `200` with the result, or `404`                                         |
| `PUT /v1/cache/<hash>` | The write token               | `200` when stored, `409` when the hash exists, `403` for the read token |

The tokens, the CI wiring and the one-time setup are in
[Nx: remote cache](../../docs/contributing/setup/nx.md#remote-cache).
[`.github/workflows/nx-cache.yml`](../../.github/workflows/nx-cache.yml)
deploys the worker when a change to this folder reaches `main`.

## Test it

```sh
mise exec -- bun nx run-many -t test typecheck lint -p nx-cache
```

The test starts the worker with `wrangler dev`, which runs workerd and a local
R2 bucket. It needs no Cloudflare login.

To run the worker by hand:

```sh
mise exec -- bun x wrangler dev --config apps/nx-cache/wrangler.jsonc --local --port 8799 \
  --var CACHE_WRITE_TOKEN:local-write --var CACHE_READ_TOKEN:local-read
curl -X PUT -H 'Authorization: Bearer local-write' --data-binary 'result' \
  http://127.0.0.1:8799/v1/cache/0123456789abcdef
curl -H 'Authorization: Bearer local-read' http://127.0.0.1:8799/v1/cache/0123456789abcdef
```
