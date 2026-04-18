# Contributing

Thanks for your interest in making prompt compression better.

## Development setup

```bash
git clone https://github.com/Ezzio11/prompt-compressor.git
cd prompt-compressor
npm install
cp .env.example .env    # add at least one API key
```

## Useful commands

```bash
npm run typecheck          # tsc --noEmit
npm run lint               # eslint (flat config)
npm run format             # prettier --write
npm test                   # vitest run
npm run test:watch         # watch mode
npm run test:coverage      # coverage report
npm run build              # tsup, emits dist/
```

## Code layout

See [`docs/architecture.md`](./docs/architecture.md). In short:

- Business logic lives in [`src/engine/`](./src/engine/) and should stay
  pure (no filesystem, no network) so it's trivially testable.
- Side-effecting code (HTTP, disk, config writing) lives in
  [`src/providers/`](./src/providers/), [`src/mcp/`](./src/mcp/),
  [`src/cli/`](./src/cli/).
- Every new client integration adds one file under
  [`src/cli/clients/`](./src/cli/clients/) and registers itself in
  [`src/cli/clients/registry.ts`](./src/cli/clients/registry.ts).

## Adding a new provider

1. Append a new entry to `defaultProviders()` in
   [`src/config/load.ts`](./src/config/load.ts).
2. If it's NOT OpenAI-compatible, write a custom caller alongside
   [`src/providers/base.ts`](./src/providers/base.ts). Otherwise the shared
   `callOpenAICompatible` will work out of the box.
3. Bump `PROVIDER_SET_VERSION` in
   [`src/config/schema.ts`](./src/config/schema.ts) — this invalidates
   every cached entry, which is correct because the race dynamics changed.
4. Add a test mocking `fetch`.

## Adding a new MCP client integration

1. Create `src/cli/clients/<client>.ts` implementing `ClientWriter`.
2. Register it in [`src/cli/clients/registry.ts`](./src/cli/clients/registry.ts).
3. Add docs to the README table.
4. Test via `superz init --dry-run --only <client-id>`.

## Pull request checklist

- `npm run typecheck`, `npm run lint`, `npm test` all pass.
- New behavior has unit tests (engine pieces) or manual-test notes
  (installer/client integrations).
- No new non-null assertions; no new `any`.
- No secrets in commits — `.env` is gitignored.

## Releasing

1. Bump `version` in [`package.json`](./package.json) and
   [`extension/package.json`](./extension/package.json).
2. Update [`CHANGELOG.md`](./CHANGELOG.md).
3. Create a git tag `vX.Y.Z`; the CI pipeline publishes to npm with
   provenance automatically.
