/**
 * Scenarios for tests/integration/crash-safety.test.ts. Each one runs in its own
 * process, so a native crash fails only that test and shows up as a signal
 * instead of taking down the test runner.
 *
 * A scenario that survives prints "survived" and exits 0. Scenarios that exit
 * mid-request do so themselves and never print it.
 *
 *   tsx tests/integration/helpers/crash-scenarios.ts <scenario>
 */
import {
  SystemLanguageModel,
  LanguageModelSession,
  GenerationSchema,
  GenerationGuide,
  Transcript,
  Tool,
  type GenerationOptions,
  type JsonSchema,
} from "../../../src/index.js";

const LONG_PROMPT = "Write a 400-word story about a lighthouse keeper.";

/** Resolves on the next macrotask, after pending native callbacks can run. */
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** Awaits a promise and ignores whether it resolved or rejected. */
async function settle(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (err) {
    return `rejected: ${err instanceof Error ? err.constructor.name : typeof err}`;
  }
}

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of iterable) {
    // Consume.
  }
}

class NeverReturnsTool extends Tool {
  readonly name = "lookup";
  readonly description = "Looks up a fact. Always call this tool.";
  readonly argumentsSchema = new GenerationSchema("Args", "Lookup arguments").property(
    "query",
    "string",
  );
  constructor(private readonly onToolCall: () => void) {
    super();
  }
  async call(): Promise<string> {
    this.onToolCall();
    return new Promise(() => {});
  }
}

const scenarios: Record<string, () => Promise<void>> = {
  // --- Exiting with work in flight -----------------------------------------

  async "exit-during-respond"() {
    const session = new LanguageModelSession();
    void session.respond(LONG_PROMPT).catch(() => {});
    await tick(200);
    process.exit(0);
  },

  async "exit-during-stream"() {
    const session = new LanguageModelSession();
    for await (const _ of session.streamResponse(LONG_PROMPT)) {
      process.exit(0);
    }
  },

  async "exit-during-tool-call"() {
    const tool = new NeverReturnsTool(() => setImmediate(() => process.exit(0)));
    const session = new LanguageModelSession({ tools: [tool] });
    await session.respond("Look up the capital of Peru.", {
      options: { toolCallingMode: "required" },
    });
    // Unreachable unless the tool was never called; exit either way.
    process.exit(0);
  },

  async "exit-with-queued-requests"() {
    const session = new LanguageModelSession();
    for (let i = 0; i < 5; i++) void session.respond(LONG_PROMPT).catch(() => {});
    void drain(session.streamResponse(LONG_PROMPT)).catch(() => {});
    await tick(200);
    process.exit(0);
  },

  // --- Disposing with work in flight -----------------------------------------

  async "dispose-during-respond"() {
    const session = new LanguageModelSession();
    const pending = session.respond(LONG_PROMPT);
    await tick(200);
    session.dispose();
    console.log(await settle(pending));
  },

  async "dispose-during-stream"() {
    const session = new LanguageModelSession();
    const stream = session.streamResponse(LONG_PROMPT);
    let disposed = false;
    const result = settle(
      (async () => {
        for await (const _ of stream) {
          if (!disposed) {
            disposed = true;
            session.dispose();
          }
        }
      })(),
    );
    console.log(await result);
  },

  async "dispose-with-queued-requests"() {
    const session = new LanguageModelSession();
    const running = session.respond(LONG_PROMPT);
    // Queued behind the running request, so they start after dispose().
    const queued = [
      session.respond("Say hi."),
      session.respondWithJsonSchema("Make one up.", {
        type: "object",
        properties: { n: { type: "integer" } },
      }),
      drain(session.streamResponse("Say hi.")),
    ];
    await tick(200);
    session.dispose();
    console.log((await Promise.all([running, ...queued].map(settle))).join(", "));
  },

  async "dispose-model-during-respond"() {
    const model = new SystemLanguageModel();
    const session = new LanguageModelSession({ model });
    const pending = session.respond(LONG_PROMPT);
    await tick(200);
    model.dispose();
    console.log(await settle(pending));
    session.dispose();
  },

  async "dispose-during-tool-call"() {
    const holder: { session?: LanguageModelSession } = {};
    const tool = new NeverReturnsTool(() => setImmediate(() => holder.session?.dispose()));
    const session = new LanguageModelSession({ tools: [tool] });
    holder.session = session;
    const pending = session.respond("Look up the capital of Peru.", {
      options: { toolCallingMode: "required" },
    });
    // The tool never returns, so the request can't finish; give dispose() time to run.
    await Promise.race([settle(pending), tick(3_000)]);
    tool.dispose();
  },

  async "abandoned-stream-collected"() {
    const session = new LanguageModelSession();
    (async () => {
      for await (const _ of session.streamResponse(LONG_PROMPT)) break;
    })();
    await tick(500);
    globalThis.gc?.();
    await tick(200);
    session.dispose();
  },

  async "gc-with-sessions-in-flight"() {
    for (let i = 0; i < 3; i++) {
      const session = new LanguageModelSession();
      void session.respond(LONG_PROMPT).catch(() => {});
    }
    await tick(200);
    globalThis.gc?.();
    await tick(500);
    globalThis.gc?.();
  },

  // --- Adversarial inputs ------------------------------------------------------

  async fuzz() {
    const session = new LanguageModelSession();
    const cases: Array<[string, () => Promise<unknown> | unknown]> = [];
    const add = (name: string, run: () => Promise<unknown> | unknown) => cases.push([name, run]);

    // Prompts: empty, NUL bytes, lone surrogates, huge.
    const quick: GenerationOptions = { maximumResponseTokens: 4 };
    for (const prompt of ["", "\0", "a\0b", "\uD800", "\uDFFF\uD800", "🧪".repeat(50)]) {
      add(`prompt ${JSON.stringify(prompt).slice(0, 20)}`, () =>
        session.respond(prompt, { options: quick }),
      );
    }
    add("prompt over the context window", () =>
      session.respond("word ".repeat(20_000), { options: quick }),
    );

    // Options: wrong types and out-of-range values.
    const badOptions: unknown[] = [
      { temperature: Number.NaN },
      { temperature: -1 },
      { temperature: Number.POSITIVE_INFINITY },
      { maximumResponseTokens: -5 },
      { maximumResponseTokens: 0 },
      { maximumResponseTokens: 1.5 },
      { maximumResponseTokens: Number.MAX_SAFE_INTEGER },
      { maximumToolCalls: -1 },
      { maximumToolCalls: Number.NaN },
      { toolCallingMode: "sometimes" },
      { reasoningLevel: "deep" },
      { reasoningLevel: "extreme" },
      { sampling: { mode: "random", top: -3 } },
      { sampling: { mode: "bogus" } },
      { sampling: null },
      "not an object",
      null,
    ];
    for (const options of badOptions) {
      add(`options ${JSON.stringify(options)}`, () =>
        session.respond("Say hi.", { options: options as GenerationOptions }),
      );
    }

    // JSON schemas: malformed, cyclic references, deep nesting, wrong types.
    const deep: JsonSchema = { type: "object", properties: {} };
    let cursor = deep;
    for (let i = 0; i < 200; i++) {
      const next: JsonSchema = { type: "object", properties: {} };
      (cursor.properties as Record<string, JsonSchema>).child = next;
      cursor = next;
    }
    const badSchemas: unknown[] = [
      {},
      { type: "nonsense" },
      { type: "object", properties: "no" },
      { type: "object", properties: { a: { $ref: "#/$defs/missing" } } },
      { type: "object", properties: { a: { $ref: "#" } } },
      { type: "array" },
      { type: "string", enum: [] },
      { type: "object", properties: { a: { type: "string", pattern: "(" } } },
      { type: "object", properties: { a: { type: "integer", minimum: 10, maximum: 1 } } },
      deep,
      [],
      null,
      "string",
    ];
    for (const schema of badSchemas) {
      add(`json schema ${JSON.stringify(schema)?.slice(0, 40)}`, () =>
        session.respondWithJsonSchema("Make one up.", schema as JsonSchema, { options: quick }),
      );
    }

    // Schema builder: odd names and guides.
    add("schema with an empty name", () =>
      session.respondWithSchema(
        "Make one up.",
        new GenerationSchema("", "").property("", "string"),
      ),
    );
    add("schema with a NUL in a guide", () =>
      session.respondWithSchema(
        "Make one up.",
        new GenerationSchema("S", "s").property("v", "string", {
          guides: [GenerationGuide.constant("a\0b")],
        }),
        { options: quick },
      ),
    );
    add("schema with an empty anyOf", () =>
      session.respondWithSchema(
        "Make one up.",
        new GenerationSchema("S", "s").property("v", "string", {
          guides: [GenerationGuide.anyOf([])],
        }),
        { options: quick },
      ),
    );

    // Transcripts: malformed JSON and wrong shapes.
    const badTranscripts = [
      "",
      "{",
      "null",
      "[]",
      '{"type":"FoundationModels.Transcript","version":1}',
      '{"type":"FoundationModels.Transcript","version":99,"transcript":{"entries":[]}}',
      '{"type":"FoundationModels.Transcript","version":1,"transcript":{"entries":[{"role":"alien"}]}}',
      '{"type":"FoundationModels.Transcript","version":1,"transcript":{"entries":"nope"}}',
    ];
    for (const json of badTranscripts) {
      add(`transcript ${json.slice(0, 40)}`, () => {
        const restored = LanguageModelSession.fromTranscript(Transcript.fromJson(json));
        restored.dispose();
      });
    }

    // Wrong types where the C API takes a string. koffi passed a number as a
    // raw pointer, so each of these crashed before strings were checked.
    const bad = 42 as never;
    add("prompt that isn't a string", () => session.respond(bad));
    add("prompt object without text", () => session.respond({} as never));
    add("attachment path that isn't a string", () =>
      session.respond({ text: "hi", attachments: [{ path: bad }] }),
    );
    add("instructions that aren't a string", () => new LanguageModelSession({ instructions: bad }));
    add("transcript JSON that isn't a string", () => Transcript.fromJson(bad));
    add("schema name that isn't a string", () => new GenerationSchema(bad, "d"));
    add("anyOf with a number", () =>
      new GenerationSchema("S", "d").property("p", "string", {
        guides: [GenerationGuide.anyOf([bad])],
      }),
    );
    add("regex that isn't a string", () =>
      new GenerationSchema("S", "d").property("p", "string", {
        guides: [GenerationGuide.regex(bad)],
      }),
    );
    add("prewarm prefix that isn't a string", () => session.prewarm(bad));

    // Use after dispose, and double dispose.
    add("respond after dispose", () => {
      const s = new LanguageModelSession();
      s.dispose();
      s.dispose();
      return s.respond("Say hi.");
    });
    add("stream after dispose", () => {
      const s = new LanguageModelSession();
      s.dispose();
      return drain(s.streamResponse("Say hi."));
    });
    add("transcript after dispose", () => {
      const s = new LanguageModelSession();
      s.dispose();
      return s.transcript.toJson();
    });
    add("stream iterated twice", async () => {
      const stream = session.streamResponse("Say hi.", { options: quick });
      await drain(stream);
      await drain(stream);
    });
    add("session on a disposed model", () => {
      const model = new SystemLanguageModel();
      model.dispose();
      return new LanguageModelSession({ model }).respond("Say hi.");
    });

    for (const [name, run] of cases) {
      const outcome = await settle(Promise.resolve().then(run));
      console.log(`${name}: ${outcome}`);
    }
    session.dispose();
  },
};

const name = process.argv[2] ?? "";
const scenario = scenarios[name];
if (!scenario) {
  console.error(`Unknown scenario "${name}". Known: ${Object.keys(scenarios).join(", ")}`);
  process.exit(64);
}
await scenario();
console.log("survived");
process.exit(0);
