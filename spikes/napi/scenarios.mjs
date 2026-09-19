// Crash scenarios for the Node-API spike, runnable against the addon or against
// tsfm's current koffi binding for comparison. Each run is one process.
//
//   node spikes/napi/scenarios.mjs napi <scenario>
//   node node_modules/tsx/dist/cli.mjs spikes/napi/scenarios.mjs koffi <scenario>
//
// A scenario that survives prints "survived" and exits 0.

const [impl, name] = process.argv.slice(2);

async function load() {
  if (impl === "napi") {
    const { Session } = await import("./tsfm-napi.mjs");
    return Session;
  }
  const { LanguageModelSession } = await import("../../src/index.js");
  // The same surface as the spike's Session.
  return class {
    #s = new LanguageModelSession();
    respond = (p) => this.#s.respond(p).then((r) => r.content);
    stream = (p) => this.#s.streamResponse(p);
    dispose = () => this.#s.dispose();
  };
}

const Session = await load();
const LONG = "Write a 400-word story about a lighthouse keeper.";
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = (p) =>
  Promise.resolve(p).then(
    () => "resolved",
    (e) => `rejected: ${e?.constructor?.name}`,
  );

const scenarios = {
  async "exit-during-respond"() {
    void new Session().respond(LONG).catch(() => {});
    await tick(200);
    process.exit(0);
  },

  async "exit-during-stream"() {
    for await (const _ of new Session().stream(LONG)) process.exit(0);
  },

  // Many streams mid-response when the process exits.
  async "exit-with-many-streams"() {
    for (let i = 0; i < 8; i++) {
      const s = new Session();
      void (async () => {
        for await (const _ of s.stream(LONG)) {
          // keep reading
        }
      })().catch(() => {});
    }
    await tick(1500);
    process.exit(0);
  },

  async "dispose-during-respond"() {
    const s = new Session();
    const pending = s.respond(LONG);
    await tick(200);
    s.dispose();
    console.log(await settle(pending));
  },

  async "dispose-during-stream"() {
    const s = new Session();
    let disposed = false;
    console.log(
      await settle(
        (async () => {
          for await (const _ of s.stream(LONG)) {
            if (!disposed) {
              disposed = true;
              s.dispose();
            }
          }
        })(),
      ),
    );
  },

  // Break out of many streams right after their first delta, then keep the
  // process alive while their cancelled native tasks wind down.
  async "abandon-streams-repeatedly"() {
    for (let i = 0; i < 25; i++) {
      const s = new Session();
      for await (const _ of s.stream(LONG)) break;
      s.dispose();
    }
    await tick(2000);
    globalThis.gc?.();
    await tick(500);
  },

  // Drop streams without breaking or disposing, and let GC collect them.
  async "gc-abandoned-streams"() {
    for (let i = 0; i < 10; i++) {
      const it = new Session().stream(LONG)[Symbol.asyncIterator]();
      await it.next();
    }
    for (let i = 0; i < 5; i++) {
      globalThis.gc?.();
      await tick(300);
    }
  },

  // Use after dispose and wrong argument types must throw, never crash.
  async fuzz() {
    const s = new Session();
    s.dispose();
    const results = [
      await settle(s.respond("hi")),
      await settle(
        (async () => {
          for await (const _ of s.stream("hi")) {
            // unreachable
          }
        })(),
      ),
    ];
    const live = new Session();
    for (const bad of [undefined, null, 42, {}, "a\0b", "\uD800"]) {
      results.push(await settle(live.respond(bad)));
    }
    live.dispose();
    console.log(results.join(", "));
  },
};

const scenario = scenarios[name];
if (!scenario) {
  console.error(`Unknown scenario "${name}". Known: ${Object.keys(scenarios).join(", ")}`);
  process.exit(64);
}
await scenario();
console.log("survived");
process.exit(0);
