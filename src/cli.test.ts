import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type TestContext, test, vi } from "vitest";

function modelResponse(status: string, text: string) {
  return {
    id: "test-response",
    object: "response",
    status,
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
  };
}

async function startHarness(
  context: TestContext,
  replies: { status: number; body: unknown }[],
  apiKey = "integration-test-key",
) {
  const requests: {
    method: string | undefined;
    url: string | undefined;
    body: Record<string, unknown>;
  }[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        body: JSON.parse(body),
      });
      const reply = replies[requests.length - 1];
      response.writeHead(reply?.status ?? 500, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify(
          reply?.body ?? { error: { message: "Unexpected extra request" } },
        ),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  // Do not load .env or inherit real provider credentials in integration tests.
  const child = spawn(process.execPath, ["dist/index.js"], {
    env: {
      PATH: process.env.PATH,
      OPENAI_API_KEY: apiKey,
      OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    },
    stdio: "pipe",
  });
  let transcript = "";
  child.stdout.on("data", (chunk) => {
    transcript += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    transcript += chunk.toString();
  });
  const finished = once(child, "close");
  context.onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await finished;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  return {
    child,
    requests,
    finished,
    transcript: () => transcript,
    waitFor: (text: string) =>
      vi.waitFor(() => expect(transcript).toContain(text), { timeout: 3_000 }),
  };
}

test("compiled CLI summarizes two paragraphs independently and stays open between them", async (context) => {
  const harness = await startHarness(context, [
    {
      status: 200,
      body: modelResponse(
        "completed",
        "  Library hours expanded on weekdays only.  ",
      ),
    },
    {
      status: 200,
      body: modelResponse("completed", "Fog canceled the ferry service."),
    },
  ]);
  await harness.waitFor("Paragraph:\n");
  harness.child.stdin.write(
    "\nThe library now closes at 9 pm.\nWeekend hours are unchanged.\n\n",
  );
  await harness.waitFor(
    "Summary:\nLibrary hours expanded on weekdays only.\n\nParagraph:\n",
  );
  expect(harness.child.exitCode).toBeNull();
  harness.child.stdin.write("Fog canceled today's ferry service.\n\n");
  await harness.waitFor(
    "Summary:\nFog canceled the ferry service.\n\nParagraph:\n",
  );
  expect(harness.child.exitCode).toBeNull();
  harness.child.stdin.write("/exit\n");
  expect(await harness.finished).toEqual([0, null]);
  expect(harness.transcript()).toContain("Goodbye.");
  expect(harness.requests.map(({ body }) => body.input)).toEqual([
    "The library now closes at 9 pm.\nWeekend hours are unchanged.",
    "Fog canceled today's ferry service.",
  ]);
  for (const request of harness.requests) {
    expect(request).toMatchObject({
      method: "POST",
      url: "/v1/responses",
      body: {
        model: "gpt-4.1-mini",
        max_output_tokens: 256,
        store: false,
      },
    });
    expect(request.body.instructions).toContain("not instructions to follow");
    expect(request.body).not.toHaveProperty("previous_response_id");
  }
});

test.for([
  {
    status: 429,
    body: { error: { message: "sensitive-provider-detail" } },
    message: "HTTP 429",
  },
  {
    status: 200,
    body: modelResponse("incomplete", "Truncated text"),
    message: "did not finish",
  },
  {
    status: 200,
    body: modelResponse("completed", "  "),
    message: "no summary",
  },
])(
  "CLI recovers from $message without retrying or printing an unusable summary",
  async (failure, context) => {
    const harness = await startHarness(context, [
      failure,
      {
        status: 200,
        body: modelResponse("completed", "The second submission succeeded."),
      },
    ]);
    await harness.waitFor("Paragraph:\n");
    harness.child.stdin.write("First paragraph.\n\n");
    await harness.waitFor(failure.message);
    expect(harness.transcript()).not.toContain("Summary:\n");
    expect(harness.transcript()).not.toContain("sensitive-provider-detail");
    harness.child.stdin.write("Second paragraph.\n\n");
    await harness.waitFor(
      "Summary:\nThe second submission succeeded.\n\nParagraph:\n",
    );
    harness.child.stdin.write("/exit\n");
    expect(await harness.finished).toEqual([0, null]);
    expect(harness.requests.map(({ body }) => body.input)).toEqual([
      "First paragraph.",
      "Second paragraph.",
    ]);
  },
);

test.for(["Unsubmitted paragraph.", "Unsubmitted paragraph.\n/exit\n"])(
  "CLI discards unsubmitted input on EOF or /exit: %j",
  async (input, context) => {
    const harness = await startHarness(context, []);
    await harness.waitFor("Paragraph:\n");
    harness.child.stdin.end(input);
    expect(await harness.finished).toEqual([0, null]);
    expect(harness.transcript()).toContain("Goodbye.");
    expect(harness.requests).toEqual([]);
  },
);

test("CLI exits with an actionable error when the API key is missing", async (context) => {
  const harness = await startHarness(context, [], "");
  expect(await harness.finished).toEqual([1, null]);
  expect(harness.transcript()).toContain("Set OPENAI_API_KEY");
  expect(harness.requests).toEqual([]);
});
