/**
 * Scenarios for tests/integration/crash-safety.test.ts. Each one runs in its own
 * process, so a native crash fails only that test and shows up as a signal
 * instead of taking down the test runner.
 *
 * A scenario that survives prints "survived" and exits 0. Scenarios that exit
 * mid-request do so themselves and never print it.
 *
 *   node --expose-gc --import tsx tests/integration/helpers/crash-scenarios.ts <scenario>
 */
import {
  SystemLanguageModel,
  PrivateCloudComputeLanguageModel,
  LanguageModelSession,
  FailRequestError,
  CancelledError,
  ToolCallLimitExceededError,
  GenerationSchema,
  GenerationGuide,
  GeneratedContent,
  Transcript,
  Tool,
  type GenerationOptions,
  type JsonSchema,
  type ToolCallContext,
} from "../../../src/index.js";
import { getFunctions, type NativePointer } from "../../../src/bindings.js";
import { Worker } from "node:worker_threads";
import path from "node:path";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

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

// Cancel while JavaScript still owns a pending tool invocation, then start
// another request before that invocation returns or the tool is disposed.
// Previously the late continuation resumed the cancelled native generation
// against the reused session and trapped inside FoundationModels.
async function cancelWithPendingTool(
  kind: "stream" | "text" | "schema" | "json",
  disposeTool = false,
  timing?: { cancel: number; late: number },
): Promise<void> {
  let called!: () => void;
  const didCall = new Promise<void>((resolve) => (called = resolve));
  let finishTool!: (output: string) => void;
  let aborted!: () => void;
  const didAbort = new Promise<void>((resolve) => (aborted = resolve));
  class DeferredTool extends NeverReturnsTool {
    override async call(_args?: GeneratedContent, context?: ToolCallContext): Promise<string> {
      assert.ok(context);
      context.signal.addEventListener("abort", aborted, { once: true });
      const result = new Promise<string>((resolve) => (finishTool = resolve));
      called();
      return result;
    }
  }
  using tool = new DeferredTool(() => {});
  using session = new LanguageModelSession({ tools: [tool] });
  const prompt = "Use lookup to find a fact.";
  const options = { toolCallingMode: "required" } as const;
  const schema = new GenerationSchema("Fact").property("fact", "string");
  const pending =
    kind === "stream"
      ? session.streamResponse(prompt, { options }).collect()
      : kind === "text"
        ? session.respond(prompt, { options })
        : kind === "schema"
          ? session.respondWithSchema(prompt, schema, { options })
          : session.respondWithJsonSchema(prompt, schema.toDict(), { options });
  await Promise.race([
    didCall,
    pending.then(() => {
      throw new Error("The request finished without invoking the tool");
    }),
  ]);
  const cancelDelay = Number(timing?.cancel ?? process.env.TSFM_STRESS_CANCEL_MS ?? 0);
  const lateDelay = Number(timing?.late ?? process.env.TSFM_STRESS_LATE_MS ?? 100);
  assert.ok(Number.isInteger(cancelDelay) && cancelDelay >= 0 && cancelDelay <= 1000);
  assert.ok(Number.isInteger(lateDelay) && lateDelay >= 0 && lateDelay <= 1000);
  if (cancelDelay) await tick(cancelDelay);
  session.cancel();
  if (kind === "stream") await pending;
  else await assert.rejects(pending, CancelledError);
  await didAbort;
  const next = session.respond("Say hello in one word.", {
    options: { toolCallingMode: "disallowed" },
  });
  // Handle a rejection immediately, even while waiting to answer the old tool.
  const result = next.then(
    (response) => ({ response }),
    (error: unknown) => ({ error }),
  );
  await tick(lateDelay);
  if (disposeTool) tool.dispose();
  else finishTool("A day has 24 hours.");
  const outcome = await result;
  if ("error" in outcome) throw outcome.error;
  assert.ok(outcome.response.content.length > 0);
  // Let any late callback run before the scenario exits.
  await tick(100);
}

// Both sessions share one JavaScript tool. Cancelling A must stop its JS timer
// without touching B's signal or its work.
async function cancelSharedTool(): Promise<void> {
  const calls: Array<{ signal: AbortSignal; stopped: Promise<void> }> = [];
  let called!: () => void;
  let didCall = new Promise<void>((resolve) => (called = resolve));
  class SharedTool extends Tool {
    name = "lookup";
    description = "Look up a fact. Always use this tool.";
    argumentsSchema = new GenerationSchema("Args").property("query", "string");
    async call(_args: GeneratedContent, { signal }: ToolCallContext): Promise<string> {
      let stopped!: () => void;
      calls.push({ signal, stopped: new Promise<void>((resolve) => (stopped = resolve)) });
      called();
      try {
        return await delay(60_000, "answer", { signal });
      } finally {
        stopped();
      }
    }
  }
  using tool = new SharedTool();
  using a = new LanguageModelSession({ tools: [tool] });
  using b = new LanguageModelSession({ tools: [tool] });
  const start = (session: LanguageModelSession) =>
    session
      .respond("Use lookup to find a fact.", {
        options: { toolCallingMode: "required" },
      })
      .then(
        () => {
          throw new Error("Expected cancellation");
        },
        (error: unknown) => error,
      );
  const first = start(a);
  await Promise.race([
    didCall,
    first.then((error) => {
      throw error;
    }),
  ]);
  didCall = new Promise<void>((resolve) => (called = resolve));
  const second = start(b);
  await Promise.race([
    didCall,
    second.then((error) => {
      throw error;
    }),
  ]);
  a.cancel();
  assert.ok((await first) instanceof CancelledError);
  await calls[0].stopped;
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, false);
  b.cancel();
  assert.ok((await second) instanceof CancelledError);
  await calls[1].stopped;
  assert.equal(calls[1].signal.aborted, true);
}

async function sharedToolBudgets(): Promise<void> {
  const started = Promise.withResolvers<void>();
  let count = 0;
  let firstSignal: AbortSignal | undefined;
  class SharedTool extends NeverReturnsTool {
    override async call(_args?: GeneratedContent, context?: ToolCallContext): Promise<string> {
      assert.ok(context);
      count++;
      if (count === 1) {
        firstSignal = context.signal;
        started.resolve();
        return delay(60_000, "fact", { signal: context.signal });
      }
      return "The capital of Peru is Lima.";
    }
  }
  using tool = new SharedTool(() => {});
  using a = new LanguageModelSession({ tools: [tool] });
  using b = new LanguageModelSession({ tools: [tool] });
  const first = a
    .respond("Use lookup to find a fact.", {
      options: { toolCallingMode: "required", maximumToolCalls: 1 },
    })
    .catch((error: unknown) => error);
  await Promise.race([
    started.promise,
    first.then(() => {
      throw new Error("First request ended before its tool call");
    }),
  ]);
  const second = await b
    .respond("Use lookup to find a fact.", {
      options: { toolCallingMode: "required", maximumToolCalls: 2 },
    })
    .catch((error: unknown) => error);
  assert.ok(second instanceof ToolCallLimitExceededError);
  assert.equal(count, 3, "B must get both calls while A's budget is exhausted");
  b.dispose();
  assert.equal(firstSignal?.aborted, false);
  a.cancel();
  assert.ok((await first) instanceof CancelledError);
}

// Four live sessions share one stateful tool across all response APIs. Hold
// every invocation open, then independently cancel, dispose, finish, and close
// the owner. This catches cross-session routing errors hidden by serial tests.
async function sharedToolFourSessions(): Promise<void> {
  const calls: Array<{
    signal: AbortSignal;
    resolve: (value: string) => void;
    aborted: Promise<void>;
  }> = [];
  let entered = Promise.withResolvers<void>();
  class SharedTool extends NeverReturnsTool {
    override async call(_args?: GeneratedContent, context?: ToolCallContext): Promise<string> {
      assert.ok(context);
      const result = Promise.withResolvers<string>();
      const aborted = Promise.withResolvers<void>();
      calls.push({ signal: context.signal, resolve: result.resolve, aborted: aborted.promise });
      context.signal.addEventListener(
        "abort",
        () => {
          result.reject(context.signal.reason);
          aborted.resolve();
        },
        {
          once: true,
        },
      );
      entered.resolve();
      return result.promise;
    }
  }
  using tool = new SharedTool(() => {});
  using a = new LanguageModelSession({ tools: [tool] });
  using b = new LanguageModelSession({ tools: [tool] });
  using c = new LanguageModelSession({ tools: [tool] });
  using source = new LanguageModelSession();
  using d = LanguageModelSession.fromTranscript(Transcript.fromJson(source.transcript.toJson()), {
    tools: [tool],
  });
  const schema = new GenerationSchema("Fact").property("fact", "string");
  const prompt = "Use lookup to find a fact.";
  const opts = { options: { toolCallingMode: "required", maximumToolCalls: 1 } } as const;
  const starts = [
    () => a.respond(prompt, opts),
    () => b.streamResponse(prompt, opts).collect(),
    () => c.respondWithSchema(prompt, schema, opts),
    () => d.respondWithJsonSchema(prompt, schema.toDict(), opts),
  ];
  const pending: Promise<unknown>[] = [];
  for (const start of starts) {
    entered = Promise.withResolvers<void>();
    const result = start().then(
      () => {
        throw new Error("Expected the required loop to fail");
      },
      (error: unknown) => error,
    );
    pending.push(result);
    await Promise.race([
      entered.promise,
      result.then((error) => {
        throw error;
      }),
    ]);
  }
  assert.equal(calls.length, 4);
  a.cancel();
  assert.ok((await pending[0]) instanceof CancelledError);
  await calls[0].aborted;
  assert.equal(calls[0].signal.aborted, true);
  assert.ok(calls.slice(1).every(({ signal }) => !signal.aborted));
  b.dispose();
  assert.ok((await pending[1]) instanceof Error);
  assert.equal(calls[1].signal.aborted, true);
  assert.ok(calls.slice(2).every(({ signal }) => !signal.aborted));
  calls[2].resolve("A day has 24 hours.");
  assert.ok((await pending[2]) instanceof ToolCallLimitExceededError);
  assert.equal(calls[3].signal.aborted, false);
  tool.dispose();
  assert.ok((await pending[3]) instanceof Error);
  assert.equal(calls[3].signal.aborted, true);
  assert.equal(calls.length, 4);
  console.log("four simultaneous tool invocations isolated across text, stream, schema and JSON");
}

// A long-lived user Tool must not keep every session's private registration
// alive. Half are disposed explicitly and half are abandoned to the GC.
async function sharedToolLifetime(): Promise<void> {
  const registrations: WeakRef<Tool>[] = [];
  class TrackedTool extends NeverReturnsTool {
    override _bindToSession(): Tool {
      const bound = super._bindToSession();
      registrations.push(new WeakRef(bound));
      return bound;
    }
  }
  using tool = new TrackedTool(() => {});
  const create = () => {
    for (let i = 0; i < 200; i++) {
      const session = new LanguageModelSession({ tools: [tool] });
      if (i % 2 === 0) session.dispose();
    }
  };
  create();
  let alive = registrations.length;
  for (let attempt = 0; attempt < 20 && alive; attempt++) {
    // WeakRef targets remain alive until the current job ends.
    await tick(10);
    globalThis.gc?.();
    await tick(10);
    alive = registrations.filter((ref) => ref.deref()).length;
  }
  assert.equal(alive, 0, "the shared Tool retained abandoned session registrations");
  // It must remain reusable after all the old registrations are gone.
  using session = new LanguageModelSession({ tools: [tool] });
  assert.ok(session._nativeSession);
  console.log("collected 200 session registrations; shared tool remains usable");
}

const scenarios: Record<string, () => Promise<void>> = {
  "shared-tool-budgets": sharedToolBudgets,
  "shared-tool-lifetime": sharedToolLifetime,
  "shared-tool-four-sessions": sharedToolFourSessions,
  "cancel-shared-tool": cancelSharedTool,
  "cancel-stream-reuse-late-tool": () => cancelWithPendingTool("stream"),
  "cancel-stream-reuse-delayed-tool": () =>
    cancelWithPendingTool("stream", false, { cancel: 1, late: 500 }),
  "cancel-stream-reuse-disposed-tool": () => cancelWithPendingTool("stream", true),
  "cancel-text-reuse-late-tool": () => cancelWithPendingTool("text"),
  "cancel-schema-reuse-late-tool": () => cancelWithPendingTool("schema"),
  "cancel-json-reuse-late-tool": () => cancelWithPendingTool("json"),
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

  // FMShutdown() with work in flight, called directly rather than at exit so
  // the outcome is observable: every in-flight one-shot promise settles as
  // CancelledError, and a tool call JavaScript never answered is failed, so
  // the response waiting on it settles too instead of pinning its session.
  async "shutdown-settles-work-in-flight"() {
    let toolCalled!: () => void;
    const called = new Promise<void>((resolve) => (toolCalled = resolve));
    const tool = new NeverReturnsTool(() => toolCalled());
    const toolSession = new LanguageModelSession({ tools: [tool] });
    const viaTool = settle(
      toolSession.respond("Look up the capital of Peru.", {
        options: { toolCallingMode: "required" },
      }),
    );
    const plain = new LanguageModelSession();
    const text = settle(plain.respond(LONG_PROMPT));
    const count = settle(new SystemLanguageModel().tokenCount({ instructions: "Be brief." }));
    // Wait until the tool call is pending in JavaScript and the others are in flight.
    await Promise.race([called, tick(10_000)]);
    await tick(100);

    getFunctions().FMShutdown();

    const outcomes = await Promise.all(
      [viaTool, text, count].map((p) => Promise.race([p, tick(15_000).then(() => "timed out")])),
    );
    console.log(`after FMShutdown: tool=${outcomes[0]}, text=${outcomes[1]}, count=${outcomes[2]}`);
    toolSession.dispose();
    plain.dispose();
    tool.dispose();
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

  // A worker using tsfm exits (by process.exit, which runs its shutdown, and by
  // terminate(), which tears its env down) while the main thread has a request
  // in flight. The main thread's request must still settle.
  async "worker-exits-mid-request"() {
    const addon = path.join(import.meta.dirname, "../../../native/tsfm.node");
    const workerCode = (exit: string) => `
      const { createRequire } = require("node:module");
      const { parentPort } = require("node:worker_threads");
      const fn = createRequire(${JSON.stringify(addon)})(${JSON.stringify(addon)});
      process.on("exit", () => fn.FMShutdown());
      const model = fn.FMSystemLanguageModelCreate(0, 0);
      const session = fn.FMLanguageModelSessionCreateFromSystemLanguageModel(model, null, null);
      const prompt = fn.FMComposedPromptInitialize();
      fn.FMComposedPromptAddText(prompt, ${JSON.stringify(LONG_PROMPT)});
      const [promise] = fn.FMLanguageModelSessionRespond(session, prompt, null);
      promise.then(() => {}, () => {});
      parentPort.postMessage("started");
      setTimeout(() => { ${exit} }, 100);
    `;
    for (const [how, exit] of [
      ["process.exit", "process.exit(0)"],
      ["terminate", "parentPort.postMessage('terminate')"],
    ]) {
      const session = new LanguageModelSession();
      const main = settle(session.respond("Say hi.", { options: { maximumResponseTokens: 8 } }));
      const worker = new Worker(workerCode(exit), { eval: true });
      worker.on("message", (m) => {
        if (m === "terminate") void worker.terminate();
      });
      await new Promise((resolve) => worker.once("exit", resolve));
      const outcome = await Promise.race([main, tick(60_000).then(() => "timed out")]);
      console.log(`main request after the worker's ${how}: ${outcome}`);
      session.dispose();
    }
  },

  // Private Cloud Compute's model info: reads that need no entitlement, on a
  // disposed model, and with odd locale strings. On macOS 26 none reach native code.
  async "pcc-model-info"() {
    const pcc = new PrivateCloudComputeLanguageModel();
    console.log(`languages: ${(await pcc.supportedLanguages()).length}`);
    for (const locale of [undefined, "en-US", "en_US", "", "\0", "xx-XX", "🧪".repeat(50)]) {
      console.log(
        `supportsLocale(${JSON.stringify(locale)}): ${await settle(pcc.supportsLocale(locale))}`,
      );
    }
    pcc.dispose();
    console.log(`languages after dispose: ${await settle(pcc.supportedLanguages())}`);
    console.log(`supportsLocale after dispose: ${await settle(pcc.supportsLocale())}`);
  },

  // A tool that fails the request (FailRequestError) ends the response with
  // RequestFailedByToolError, including under toolCallingMode "required".
  async "tool-fails-request"() {
    class FailingTool extends Tool {
      readonly name = "lookup";
      readonly description = "Looks up a fact. Always call this tool.";
      readonly argumentsSchema = new GenerationSchema("Args", "Lookup arguments").property(
        "query",
        "string",
      );
      async call(): Promise<string> {
        throw new FailRequestError("The database is unreachable");
      }
    }
    const tool = new FailingTool();
    const session = new LanguageModelSession({ tools: [tool] });
    const outcome = await settle(
      session.respond("Look up the capital of Peru.", {
        options: { toolCallingMode: "required" },
      }),
    );
    console.log(`respond: ${outcome}`);
    session.dispose();
    tool.dispose();
  },

  // An undisposed Tool nobody references is collected (its native callback
  // doesn't pin it), which releases the native tool.
  async "undisposed-tool-collected"() {
    let collected = false;
    const registry = new FinalizationRegistry(() => {
      collected = true;
    });
    (() => {
      const tool = new NeverReturnsTool(() => {});
      registry.register(tool, "tool");
      new LanguageModelSession({ tools: [tool] });
    })();
    for (let i = 0; i < 40 && !collected; i++) {
      globalThis.gc?.();
      await tick(50);
    }
    console.log(`tool collected: ${collected}`);
  },

  // JavaScript that runs while the addon reads an argument (an array element
  // accessor) disposes handles the call already read. The addon must see that.
  async "accessor-disposes-handles"() {
    const fn = getFunctions();
    const tryCall = (name: string, run: () => unknown) => {
      try {
        const result = run();
        console.log(`${name}: returned ${result === null ? "null" : typeof result}`);
      } catch (err) {
        console.log(`${name}: threw ${(err as Error).constructor.name}: ${(err as Error).message}`);
      }
    };
    const disposingArray = <T>(items: T[], onRead: () => void): T[] => {
      const array = [...items];
      Object.defineProperty(array, items.length - 1, {
        get() {
          onRead();
          return items[items.length - 1];
        },
      });
      return array;
    };

    const tools = [new NeverReturnsTool(() => {}), new NeverReturnsTool(() => {})];
    for (const tool of tools) tool._register();
    const handles = tools.map((t) => t._nativeTool as NativePointer);
    tryCall("session create, a tool disposed by a later element", () =>
      fn.FMLanguageModelSessionCreateFromSystemLanguageModel(
        null,
        null,
        disposingArray(handles, () => tools[0].dispose()),
      ),
    );

    const model = new SystemLanguageModel();
    const tool = new NeverReturnsTool(() => {});
    tool._register();
    tryCall("session create, the model disposed while reading tools", () =>
      fn.FMLanguageModelSessionCreateFromSystemLanguageModel(
        model._nativeModel,
        null,
        disposingArray([tool._nativeTool as NativePointer], () => model.dispose()),
      ),
    );
    const countModel = new SystemLanguageModel();
    tryCall("token count, the model disposed while reading tools", () => {
      const [promise] = fn.FMSystemLanguageModelTokenCountForTools(
        countModel._nativeModel as NativePointer,
        disposingArray([tool._nativeTool as NativePointer], () => countModel.dispose()),
      );
      void promise.catch(() => {});
      return promise;
    });

    const property = fn.FMGenerationSchemaPropertyCreate("v", null, "string", false);
    tryCall("anyOf, the property released while reading choices", () =>
      fn.FMGenerationSchemaPropertyAddAnyOfGuide(
        property,
        disposingArray(["a", "b"], () => fn.FMRelease(property)),
        false,
      ),
    );
    tool.dispose();
    for (const t of tools) t.dispose();
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

    // Guide bounds that crashed the host before the bridge checked them. The
    // public constructors reject these, so build the guides directly to reach
    // the native checks too.
    const rawGuide = (type: string, value: unknown) =>
      new (GenerationGuide as unknown as new (data: unknown) => GenerationGuide)({ type, value });
    const badGuides: Array<[string, string, () => GenerationGuide]> = [
      ["integer", "range 5..1", () => rawGuide("range", [5, 1])],
      ["number", "range 5..1", () => rawGuide("range", [5, 1])],
      ["integer", "range NaN", () => rawGuide("range", [Number.NaN, 3])],
      ["number", "range Infinity", () => rawGuide("range", [0, Infinity])],
      ["integer", "maximum 1e20", () => rawGuide("maximum", 1e20)],
      ["integer", "minimum -Infinity", () => rawGuide("minimum", -Infinity)],
      ["number", "minimum NaN", () => rawGuide("minimum", Number.NaN)],
      ["array<string>", "count -1", () => rawGuide("count", -1)],
      ["array<string>", "count 1e20", () => rawGuide("count", 1e20)],
      ["array<string>", "minItems -2", () => rawGuide("minItems", -2)],
      ["array<string>", "maxItems NaN", () => rawGuide("maxItems", Number.NaN)],
      ["integer", "public range 5..1", () => GenerationGuide.range(5, 1)],
      ["integer", "public maximum 1e20", () => GenerationGuide.maximum(1e20)],
    ];
    for (const [type, name, guide] of badGuides) {
      add(`guide ${name} on ${type}`, () =>
        session.respondWithSchema(
          "Make one up.",
          new GenerationSchema("S", "s").property("v", type as "string", { guides: [guide()] }),
          { options: quick },
        ),
      );
    }
    for (const schema of [
      { type: "integer", maximum: 1e20 },
      { type: "integer", minimum: -1e300 },
      { type: "array", items: { type: "string" }, minItems: -1 },
      { type: "array", items: { type: "string" }, maxItems: 1e20 },
    ]) {
      add(`json schema bound ${JSON.stringify(schema)}`, () =>
        session.respondWithJsonSchema(
          "Make one up.",
          { type: "object", properties: { v: schema } } as JsonSchema,
          { options: quick },
        ),
      );
    }

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

if (!globalThis.gc) {
  console.error("Run with --expose-gc: the GC scenarios need a real gc().");
  process.exit(64);
}

const name = process.argv[2] ?? "";
const scenario = scenarios[name];
if (!scenario) {
  console.error(`Unknown scenario "${name}". Known: ${Object.keys(scenarios).join(", ")}`);
  process.exit(64);
}
await scenario();
console.log("survived");
process.exit(0);
