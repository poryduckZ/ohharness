import { PassThrough } from "node:stream";
import { expect, test, vi } from "vitest";
import { inputBytesMax, runTerminal } from "./terminal.js";

test("Ctrl+C aborts an in-flight model request and closes the terminal", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  Object.defineProperty(output, "isTTY", { value: true });
  let requestSignal: AbortSignal | undefined;
  const summarize = vi.fn((_paragraph: string, signal: AbortSignal) => {
    requestSignal = signal;
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Canceled")), {
        once: true,
      });
    });
  });
  const session = runTerminal(input, output, summarize);
  input.write("Cancel this paragraph.\n\n");
  await vi.waitFor(() => expect(summarize).toHaveBeenCalledTimes(1));
  input.write("\x03");
  await session;
  expect(requestSignal?.aborted).toBe(true);
  const transcript = output.read().toString();
  expect(transcript).toContain("Goodbye.");
  expect(transcript).not.toContain("Error:");
  // Node retains its key decoder's data listener until the next input event.
  expect(input.listenerCount("keypress")).toBe(0);
  expect(input.isPaused()).toBe(true);
});

test("accepts exactly the byte limit, discards oversized UTF-8 input completely, then recovers", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const summarize = vi.fn().mockResolvedValue("Summary.");
  const session = runTerminal(input, output, summarize);
  const atLimit = "é".repeat(inputBytesMax / 2);
  input.end(
    `${atLimit}\n\n${atLimit}x\nDiscard this tail too.\n\nValid paragraph.\n\n/exit\n`,
  );
  await session;
  expect(summarize.mock.calls.map(([text]) => text)).toEqual([
    atLimit,
    "Valid paragraph.",
  ]);
  expect(output.read().toString()).toContain(
    "Discarding until the next blank line.",
  );
});
