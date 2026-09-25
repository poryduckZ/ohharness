import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export const inputBytesMax = 16_384;

export async function runTerminal(
  input: Readable,
  output: Writable,
  summarize: (paragraph: string, signal: AbortSignal) => Promise<string>,
): Promise<void> {
  const terminal = createInterface({ input, output, crlfDelay: Infinity });
  const controller = new AbortController();
  const interrupt = () => {
    controller.abort();
    terminal.close();
  };
  terminal.on("SIGINT", interrupt);

  output.write(
    "OhHarness — paragraph summarizer\n" +
      "Paste a paragraph; submit with a blank line. /exit quits.\n" +
      "Each submission is independent and is sent to OpenAI.\n\nParagraph:\n",
  );

  let paragraph = "";
  let oversized = false;
  try {
    for await (const line of terminal) {
      if (controller.signal.aborted || line.trim() === "/exit") break;

      if (line.trim() !== "") {
        if (oversized) continue;
        const next = paragraph ? `${paragraph}\n${line}` : line;
        if (Buffer.byteLength(next, "utf8") > inputBytesMax) {
          paragraph = "";
          oversized = true;
          output.write(
            `Input exceeds ${inputBytesMax} UTF-8 bytes. Discarding until the next blank line.\n`,
          );
        } else {
          paragraph = next;
        }
        continue;
      }

      if (oversized) {
        oversized = false;
        output.write("\nParagraph:\n");
        continue;
      }
      if (!paragraph) continue;

      output.write("Summarizing…\n");
      try {
        const summary = await summarize(paragraph, controller.signal);
        if (controller.signal.aborted) break;
        output.write(`\nSummary:\n${summary}\n`);
      } catch (error) {
        if (controller.signal.aborted) break;
        output.write(
          `Error: ${error instanceof Error ? error.message : "Summarization failed."}\n`,
        );
      }
      paragraph = "";
      output.write("\nParagraph:\n");
    }
  } finally {
    controller.abort();
    terminal.close();
    terminal.off("SIGINT", interrupt);
    output.write("\nGoodbye.\n");
  }
}
