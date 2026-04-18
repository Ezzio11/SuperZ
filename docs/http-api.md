# HTTP API

When you run `superz serve --http` (or the Docker image), SuperZ exposes three
surfaces on one port:

- `POST /v1/compress` — plain REST compression endpoint.
- `GET /v1/stats` — cumulative metrics.
- `GET /healthz` — liveness probe.
- `ALL /mcp` — MCP streamable HTTP/SSE transport.

## Authentication

Pass a bearer token via the `Authorization` header if you launched the
server with `--token` (or `SUPERZ_HTTP_TOKEN` in the environment).

```
Authorization: Bearer <token>
```

`/healthz` is always public.

## POST /v1/compress

**Request**

```json
{
  "prompt": "Please could you refactor this function...",
  "force": false
}
```

**Response**

```json
{
  "compressed": "Task: refactor fn ...",
  "provider": "Cerebras",
  "bypassed": false,
  "cacheHit": false,
  "originalTokens": 42,
  "compressedTokens": 11,
  "savedTokens": 31,
  "percentSaved": 74,
  "errors": [],
  "constraintReport": {
    "preserved": true,
    "missing": []
  }
}
```

## GET /v1/stats

Returns a JSON snapshot of the metrics store. See
[`src/util/metrics.ts`](../src/util/metrics.ts) for the schema.

## MCP /mcp

Compliant with the MCP streamable HTTP transport spec. Session IDs are
echoed back in the `Mcp-Session-Id` header. Works with any MCP client that
supports HTTP transport (Claude Code's `--transport http`, Cursor, Continue,
etc.).

## CORS

CORS is disabled by default. Pass `--cors` or set `"cors": true` in your
config to enable permissive cross-origin access (required for browser-based
consumers).
