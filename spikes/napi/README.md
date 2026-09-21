# Spike: Node-API instead of koffi

**Status:** adopted. tsfm 1.0 replaced koffi with a Node-API addon built on
this design (`native/addon/tsfm_addon.c`). This directory is the original
spike, kept for reference; it isn't wired into the package.

The 1.0 plan kept koffi (Option B) and set a bar for replacing it with a
Node-API addon (Option C): no crash under a fuzz suite, clean shutdown with
requests in flight, and no crash on process exit. This spike builds a minimal
addon over tsfm's C bridge and tests it against that bar, side by side with
the koffi binding.

## What's here

| File | What it is |
| --- | --- |
| `addon.c` | About 450 lines of C (456): sessions, `respond`, streaming, stream cancellation, shutdown |
| `tsfm-napi.mjs` | A thin JS wrapper with the same shape as tsfm's session API |
| `scenarios.mjs` | Crash scenarios that run against either binding, one process per run |
| `build.sh` | Builds `build/tsfm_napi.node` with `clang` and Node's own headers, with no node-gyp and no new dependencies |

```bash
npm run build && bash spikes/napi/build.sh
node --expose-gc spikes/napi/scenarios.mjs napi exit-with-many-streams
node --expose-gc node_modules/tsx/dist/cli.mjs spikes/napi/scenarios.mjs koffi fuzz
```

## The design being tested

Every request is a heap `Request` that owns a `napi_threadsafe_function`.
Native callbacks go only through that function, under one lock, and the
`Request` decides when native code may still reach JavaScript:

- **Exit:** a `process.on("exit")` hook calls `shutdown()`, which cuts every
  live request off from JS. `process.exit()` skips Node-API's env cleanup hooks,
  so this can't be left to them. A per-request env cleanup hook covers worker
  and embedder teardown.
- **Dispose:** requests retain the session themselves, so `dispose()` never
  frees a session in use, and a disposed session is checked in C, not at each
  JS call site.
- **Abandoned streams:** JS drops a stream by releasing the stream box, which
  cancels the Swift task. The `Request` absorbs the native side's final call,
  so JS keeps no callback registered and has nothing to unregister.
- **Arguments:** strings are read with `napi_get_value_string_utf8`, which
  throws a `TypeError` for a non-string. A value can't reach Swift as a raw
  pointer.

With koffi, each of these depends on the JS code at every call site getting it
right. The 1.0 crash suite found four places that didn't, and this spike found
a fifth (below). With the addon, they hold by construction.

## Results

Each scenario ran 5 times per binding, one process per run.

| Scenario | Node-API | koffi |
| --- | --- | --- |
| exit during `respond` | 5/5 | 5/5 |
| exit during a stream | 5/5 | 5/5 |
| exit with 8 streams in flight | 5/5 | 5/5 |
| dispose during `respond` | 4/5, 1 timeout | 4/5, 1 timeout |
| dispose during a stream | 5/5 | 5/5 |
| break out of 25 streams, one after another | 5/5 | 5/5 |
| streams abandoned to GC | 5/5 | 5/5 |
| fuzz (use after dispose, wrong argument types) | **5/5** | **0/5, SIGSEGV** (5/5 since #35) |

- **The timeouts aren't bugs.** Both came in the run right after "exit with 8
  streams in flight". Apple's model service keeps generating for the exited
  process, which delays the next request past the scenario's 170-second limit.
- **The koffi segfault is real, and on `feat/v1` today.** koffi passes a number
  given for a string parameter as a raw pointer, so
  `session.respond(42 as never)`, `new GenerationSchema(42 as never)` and a
  dozen similar calls crashed the process. Fixed separately in #35, which checks every string argument against the C
  header's nullability. The addon never had the bug.

### Cost

| | Node-API | koffi |
| --- | --- | --- |
| Per call (create a model, check availability, release it) | 248 µs | 246 µs |
| Installed size | 56 KB | 1.8 MB |
| Code to maintain | about 450 lines of C, plus a JS wrapper | declarations in `bindings.ts` |
| Build | `clang` against Node's headers | none (prebuilt) |

Call overhead is a wash: the Swift work dominates. Node-API is ABI-stable, so
one arm64 build covers every Node version from 18 on, and it ships next to
`libFoundationModels.dylib` the way the dylib already does.

## What the spike doesn't cover

- Structured output, tools (persistent callbacks that JS answers
  asynchronously), transcripts, PCC and usage. Tools are the hardest part to
  port: a tool call has to stay answerable after JS awaits, and fail cleanly if
  JS never answers.
- Worker threads and Electron (one env per thread). The per-request env
  cleanup hook is there for them, but the spike only tested the main thread.
- A migration plan for `bindings.ts`'s ~50 functions.

## Recommendation

Adopt Node-API in **1.1**, not 1.0:

1. It meets the plan's bar, and it makes crash safety structural instead of a
   rule every call site has to follow. That's the property tsfm cares about most.
2. 1.0 is already safe with koffi after the crash-suite fixes and string
   argument checks, so there's no need to hold 1.0 for it.
3. Port in order of risk: streaming and `respond` (done here), then tools,
   then the rest. Keep the public API unchanged; `getFunctions()` is the seam.
   Run `tests/integration/crash-safety.test.ts` against both bindings until
   koffi is removed.
