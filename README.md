# OhHarness

A terminal-based AI harness for learning how agents work. Paste a paragraph and
get a concise summary from OpenAI's `gpt-4.1-mini`; keep submitting paragraphs in
the same session. Each submission is independent, with no conversation history.

## Tooling

- **Node.js 24 LTS** — runtime, pinned via `.nvmrc`.
- **pnpm** — package management, pinned in `package.json`.
- **TypeScript** — strict type checking and native Node.js ESM output.
- **tsx** — run TypeScript directly during development.
- **Biome** — linting and formatting.
- **Vitest** — test runner.

## Getting started

Install Node.js 24 (or run `nvm install` and `nvm use` if you use nvm), then:

```sh
npm install --global pnpm@12.0.0
pnpm install
pnpm check
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env` (or export it in your shell), then run `pnpm dev`.
Use an OpenAI API key with available API credit and access to `gpt-4.1-mini`;
a ChatGPT subscription does not supply API credit. Never commit your key.

Paste one or more lines of text, then enter a **blank line** to submit. After the
summary, the program waits for another paragraph. Enter `/exit` on its own line
or press Ctrl+C to quit. EOF also quits; unsubmitted text is discarded.

Text is sent to OpenAI, so avoid sensitive input. Requests use `store: false`,
which disables response storage but does not override the provider's data policies.
Input is limited to 16,384 UTF-8 bytes per paragraph, output to 256 tokens, and
each request to 30 seconds with no automatic retries. Oversized paragraphs are
discarded through the next blank line. Request failures are reported without
ending the session. Requests run sequentially; wait for the next prompt to type.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the interactive summarizer from TypeScript |
| `pnpm build` | Compile `src/` to `dist/` |
| `pnpm start` | Run the compiled entry point after building |
| `pnpm typecheck` | Check source types without emitting files |
| `pnpm lint` | Check lint rules and formatting |
| `pnpm format` | Apply formatting |
| `pnpm test` | Build and test the compiled CLI without live API requests |
| `pnpm check` | Run type checking, lint/format checks, and tests |

Prefer integration and end-to-end tests; reserve unit tests for special cases.
Integration tests launch the compiled CLI as a subprocess and exercise real HTTP
requests through the OpenAI SDK against a local fake provider. They cover repeat
submissions, failure recovery, request content, and exit behavior. Only UTF-8 byte
boundaries and terminal cancellation use focused function-level tests.

Run `pnpm test` after changes so the compiled CLI is rebuilt before testing.
Tests do not load `.env` or use real provider credentials. They verify application
behavior, not live summary quality. For a live end-to-end check, run `pnpm dev`
with a valid API key, submit two different paragraphs, check both summaries against
their source text, and confirm the program prompts again before entering `/exit`.
Test files live alongside source files and are excluded from the production build.

Use `.js` extensions for relative imports in TypeScript so compiled imports work
directly in Node.js. Node loads the optional `.env` file for `pnpm dev` and
`pnpm start`; Git ignores it.
