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

function toolCall(callId: string, args: string, name = "count_words") {
  return {
    type: "function_call",
    id: `fc_${callId}`,
    call_id: callId,
    name,
    arguments: args,
    status: "completed",
  };
}

function toolResponse(calls: ReturnType<typeof toolCall>[]) {
  return { ...modelResponse("completed", ""), output: calls };
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
    "Answer:\nLibrary hours expanded on weekdays only.\n\nParagraph:\n",
  );
  expect(harness.child.exitCode).toBeNull();
  harness.child.stdin.write("Fog canceled today's ferry service.\n\n");
  await harness.waitFor(
    "Answer:\nFog canceled the ferry service.\n\nParagraph:\n",
  );
  expect(harness.child.exitCode).toBeNull();
  harness.child.stdin.write("/exit\n");
  expect(await harness.finished).toEqual([0, null]);
  expect(harness.transcript()).toContain("Goodbye.");
  expect(harness.requests.map(({ body }) => body.input)).toEqual([
    [
      {
        role: "user",
        content:
          "The library now closes at 9 pm.\nWeekend hours are unchanged.",
      },
    ],
    [{ role: "user", content: "Fog canceled today's ferry service." }],
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

test("CLI runs tools across three model calls, matches results to calls, and resets history", async (context) => {
  const firstCalls = [
    toolCall("first", JSON.stringify({ text: "  The\tferry\nis late.  " })),
    toolCall("empty", JSON.stringify({ text: " \t\n " })),
  ];
  const lastCall = toolCall("last", JSON.stringify({ text: "你好 café" }));
  const firstResponse = modelResponse(
    "completed",
    "Counting the supplied text.",
  );
  const harness = await startHarness(context, [
    {
      status: 200,
      body: {
        ...firstResponse,
        output: [...firstResponse.output, ...firstCalls],
      },
    },
    { status: 200, body: toolResponse([lastCall]) },
    {
      status: 200,
      body: modelResponse("completed", "The counts are 4, 0, and 2."),
    },
    { status: 200, body: modelResponse("completed", "A separate summary.") },
  ]);
  const task = "Count the words in three passages.";
  await harness.waitFor("Paragraph:\n");
  harness.child.stdin.write(`${task}\n\n`);
  await harness.waitFor("Answer:\nThe counts are 4, 0, and 2.\n\nParagraph:\n");
  expect(harness.transcript()).not.toContain("Counting the supplied text.");

  const firstInput = [{ role: "user", content: task }];
  const secondInput = [
    ...firstInput,
    ...firstResponse.output,
    ...firstCalls,
    { type: "function_call_output", call_id: "first", output: '{"count":4}' },
    { type: "function_call_output", call_id: "empty", output: '{"count":0}' },
  ];
  expect(harness.requests[1]?.body.input).toEqual(secondInput);
  expect(harness.requests[2]?.body.input).toEqual([
    ...secondInput,
    lastCall,
    { type: "function_call_output", call_id: "last", output: '{"count":2}' },
  ]);
  for (const request of harness.requests) {
    expect(request.body).toMatchObject({
      store: false,
      parallel_tool_calls: false,
      tools: [
        {
          type: "function",
          name: "count_words",
          strict: true,
          parameters: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      ],
    });
    expect(request.body).not.toHaveProperty("previous_response_id");
  }

  harness.child.stdin.write("New paragraph.\n\n");
  await harness.waitFor("Answer:\nA separate summary.\n\nParagraph:\n");
  expect(harness.requests[3]?.body.input).toEqual([
    { role: "user", content: "New paragraph." },
  ]);
  harness.child.stdin.write("/exit\n");
  expect(await harness.finished).toEqual([0, null]);
  expect(harness.requests).toHaveLength(4);
});

test.for([
  { name: "unapproved_tool", args: "{}", error: "Unknown tool" },
  { name: "count_words", args: "sensitive-invalid-json", error: "valid JSON" },
  { name: "count_words", args: "null", error: "one string argument" },
  { name: "count_words", args: "[]", error: "one string argument" },
  { name: "count_words", args: '{"text":42}', error: "one string argument" },
  {
    name: "count_words",
    args: '{"text":"hello","extra":true}',
    error: "one string argument",
  },
])(
  "CLI returns a safe tool error for $name with $args",
  async (failure, context) => {
    const harness = await startHarness(context, [
      {
        status: 200,
        body: toolResponse([toolCall("invalid", failure.args, failure.name)]),
      },
      {
        status: 200,
        body: toolResponse([toolCall("corrected", '{"text":"one two three"}')]),
      },
      { status: 200, body: modelResponse("completed", "There are 3 words.") },
    ]);
    await harness.waitFor("Paragraph:\n");
    harness.child.stdin.write("Count some words.\n\n");
    await harness.waitFor("Answer:\nThere are 3 words.\n\nParagraph:\n");
    const input = harness.requests[1]?.body.input as {
      type?: string;
      call_id?: string;
      output?: string;
    }[];
    const result = input.find((item) => item.type === "function_call_output");
    expect(result?.call_id).toBe("invalid");
    expect(JSON.parse(result?.output ?? "").error).toContain(failure.error);
    expect(result?.output).not.toContain("sensitive-invalid-json");
    const lastInput = harness.requests[2]?.body.input as typeof input;
    expect(lastInput.at(-1)).toEqual({
      type: "function_call_output",
      call_id: "corrected",
      output: '{"count":3}',
    });
    harness.child.stdin.write("/exit\n");
    expect(await harness.finished).toEqual([0, null]);
  },
);

test.for([
  {
    limit: "Model-call",
    batches: [["one"], ["two"], ["three"]],
  },
  {
    limit: "Tool-call",
    batches: [
      ["one", "two"],
      ["three", "four"],
    ],
  },
])(
  "CLI stops at the $limit limit and accepts the next submission",
  async (scenario, context) => {
    const harness = await startHarness(context, [
      ...scenario.batches.map((batch) => ({
        status: 200,
        body: toolResponse(batch.map((id) => toolCall(id, '{"text":"a b"}'))),
      })),
      {
        status: 200,
        body: modelResponse("completed", "The next task succeeded."),
      },
    ]);
    await harness.waitFor("Paragraph:\n");
    harness.child.stdin.write("Keep counting.\n\n");
    await harness.waitFor(`${scenario.limit} limit reached (3)`);
    expect(harness.requests).toHaveLength(scenario.batches.length);
    harness.child.stdin.write("A new task.\n\n");
    await harness.waitFor("Answer:\nThe next task succeeded.\n\nParagraph:\n");
    expect(harness.requests.at(-1)?.body.input).toEqual([
      { role: "user", content: "A new task." },
    ]);
    harness.child.stdin.write("/exit\n");
    expect(await harness.finished).toEqual([0, null]);
    expect(harness.requests).toHaveLength(scenario.batches.length + 1);
  },
);

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
    message: "no answer",
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
    expect(harness.transcript()).not.toContain("Answer:\n");
    expect(harness.transcript()).not.toContain("sensitive-provider-detail");
    harness.child.stdin.write("Second paragraph.\n\n");
    await harness.waitFor(
      "Answer:\nThe second submission succeeded.\n\nParagraph:\n",
    );
    harness.child.stdin.write("/exit\n");
    expect(await harness.finished).toEqual([0, null]);
    expect(harness.requests.map(({ body }) => body.input)).toEqual([
      [{ role: "user", content: "First paragraph." }],
      [{ role: "user", content: "Second paragraph." }],
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
