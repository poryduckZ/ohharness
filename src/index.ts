import OpenAI from "openai";
import { summarize } from "./summarize.js";
import { runTerminal } from "./terminal.js";

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.error("Set OPENAI_API_KEY in your environment or .env file first.");
    process.exitCode = 1;
    return;
  }

  const client = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });
  await runTerminal(process.stdin, process.stdout, (paragraph, signal) =>
    summarize(client, paragraph, signal),
  );
}

main().catch(() => {
  console.error("The terminal session failed.");
  process.exitCode = 1;
});
