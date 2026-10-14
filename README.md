# OhHarness

A terminal-based AI harness for learning how agents work. Paste a paragraph and
get a concise summary from OpenAI's `gpt-4.1-mini`, or ask it to count words with
the local `count_words` tool. Keep submitting text in the same session. Each
submission is independent, with no conversation history between submissions.

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
answer, the program waits for another paragraph. Enter `/exit` on its own line
or press Ctrl+C to quit. EOF also quits; unsubmitted text is discarded.

For example, enter `Count the words in "The ferry is late."`, then a blank line.
The model requests `count_words`, the harness returns `{"count":4}`, and the
model writes the final answer. Ordinary paragraphs still get summaries.

Text is sent to OpenAI, so avoid sensitive input. Requests use `store: false`,
which disables response storage but does not override the provider's data policies.
Input is limited to 16,384 UTF-8 bytes per submission, output to 256 tokens per
model call, and each request to 30 seconds with no automatic retries. Each
submission allows at most three model calls and three tool calls. A submission
can therefore take up to about 90 seconds. Oversized paragraphs are
discarded through the next blank line. Request failures are reported without
ending the session. Requests run sequentially; wait for the next prompt to type.

## The tool loop

The model requests a tool; your TypeScript code checks and runs it. The model
does not execute code directly. The only allowed tool is `count_words(text)`.
It counts non-empty chunks separated by whitespace. Punctuation stays attached,
and empty or whitespace-only text has zero words. This is not a language-aware
word counter or a model token counter.

`src/summarize.ts` owns this loop:

1. Send the task, instructions, and tool definition to the model.
2. If there are no tool requests, return the final answer.
3. Check the model-call and tool-call limits before running any tools.
4. Preserve the model's response and add each tool result with its tool-call ID.
5. Send the updated history to the model and repeat.

Unknown tools and invalid arguments produce safe tool errors. The model can
correct a request within the remaining limits. The harness does not run tools
after the last model call, since no model call remains to use their results.
History and limits reset for the next submission. Ctrl+C cancels the active
request. Tool calls stay internal; the terminal prints only the final answer.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the summary and word-count assistant from TypeScript |
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
submissions, tool results and IDs, argument checks, call limits, failure recovery,
request content, and exit behavior. Only UTF-8 byte boundaries and terminal
cancellation use focused function-level tests.

Run `pnpm test` after changes so the compiled CLI is rebuilt before testing.
Tests do not load `.env` or use real provider credentials. They verify application
behavior, not live model quality or tool selection. For a live end-to-end check,
run `pnpm dev` with a valid API key, submit a paragraph and a word-count task,
check both answers against their source text, and confirm the program prompts
again before entering `/exit`.
Test files live alongside source files and are excluded from the production build.

Use `.js` extensions for relative imports in TypeScript so compiled imports work
directly in Node.js. Node loads the optional `.env` file for `pnpm dev` and
`pnpm start`; Git ignores it.
