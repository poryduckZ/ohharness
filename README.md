# OhHarness

A terminal-based AI harness for learning how agents work. This repository currently
contains only the TypeScript project setup; no harness features are implemented.

## Tooling

- **Node.js 24 LTS** — runtime, pinned via `.nvmrc`.
- **pnpm** — package management, pinned in `package.json`.
- **TypeScript** — strict type checking and native Node.js ESM output.
- **tsx** — run TypeScript during development with automatic restarts.
- **Biome** — linting and formatting.
- **Vitest** — test runner.

## Getting started

Install Node.js 24 (or run `nvm install` and `nvm use` if you use nvm), then:

```sh
npm install --global pnpm@12.0.0
pnpm install
pnpm check
```

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Watch and run the empty TypeScript entry point |
| `pnpm build` | Compile `src/` to `dist/` |
| `pnpm start` | Run the compiled entry point after building |
| `pnpm typecheck` | Check source types without emitting files |
| `pnpm lint` | Check lint rules and formatting |
| `pnpm format` | Apply formatting |
| `pnpm test` | Run tests once; allow an empty suite during initialization |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm check` | Run type checking, lint/format checks, and tests |

The entry point intentionally does nothing. Add tests as `*.test.ts` files alongside
source files; tests are excluded from the production build. Remove
`--passWithNoTests` from the test script once the first tests are added.

Use `.js` extensions for relative imports in TypeScript so compiled imports work
directly in Node.js. Keep API keys in local `.env` files, which Git ignores; no
environment loader or model provider is configured yet.
