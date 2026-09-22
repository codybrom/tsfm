# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-beta.1] - 2026-09-19

The first 1.0 beta. It publishes under npm's `beta` tag (`npm install tsfm-sdk@beta`); `latest` stays on 0.5 until 1.0.0.

tsfm 1.0 adds token usage, tool-calling modes, opt-in Private Cloud Compute, and typed errors for the macOS 27 framework, and still runs on macOS 26. On macOS 26, features that need macOS 27 report a clear reason instead of working. It replaces koffi with tsfm's own Node-API addon, so tsfm has no runtime dependencies, and makes the native layer much harder to crash. See the [migration guide](https://tsfm.dev/guide/migrating-to-1) for the changes that affect existing code.

### Changed

- Building from source needs Xcode 27 (the macOS 27 SDK). The native library still targets macOS 26.0 and weak-links the macOS 27 APIs, so it loads on macOS 26.
- **Breaking:** `respond()`, `respondWithSchema()` and `respondWithJsonSchema()` return a `Response` whose `.content` is the old return value and whose `.usage` is the request's token usage (`null` on macOS 26).
- **Breaking:** `streamResponse()` returns a `ResponseStream`. It iterates text deltas as before, can be iterated once, and adds `.usage` once finished and a `collect()` method.
- **Breaking:** a request may make at most 32 tool calls by default. Past `maximumToolCalls` it fails with `ToolCallLimitExceededError` instead of calling another tool.
- A tool's `args` are released once its `call()` settles, instead of waiting for garbage collection. Read what you need from them before `call()` returns or rejects.
- **Breaking:** `GenerationErrorCode` is a regular `enum` instead of a `const enum`. Comparisons still work; it now exists at runtime.
- **Breaking:** on macOS 27, regex guides are checked against what the on-device model supports before a request is sent. Unsupported syntax, such as character classes like `[a-z]`, throws `UnsupportedGuideError` naming the construct and, where there is one, a replacement. Private Cloud Compute requests aren't checked, because PCC supports more.
- Errors from the macOS 27 framework map to typed errors instead of `GenerationError` with code 255.
- A schema the framework can't build, such as one with an undefined reference, throws `InvalidGenerationSchemaError` instead of `GenerationError` with code 255.
- `generable()` names nested reference schemas by their property path, such as `shipping_address`, so objects under the same key in different places stay separate.
- The Swift-to-C bridge is now tsfm's own code in `native/bridge`, forked from Apple's `foundation-models-c` (see `native/bridge/UPSTREAM.md`).
- tsfm no longer installs SIGINT or SIGTERM handlers. A library shouldn't change how its host handles signals: a server draining on SIGTERM was killed by tsfm's re-raise, or ran its own handler twice. Sessions are still released on `exit`, and a process that dies from a signal is safe: the addon never lets a native callback reach JavaScript that's gone.
- Chat and Responses APIs: `response.created` and `response.in_progress` events carry `status: "in_progress"`, as OpenAI's do.
- A session rejects a tool listed twice, or two tools with one name, with `FoundationModelsError`.
- `SamplingMode` objects built by hand are validated like `SamplingMode.random()` output when a request is sent: `top` must be a positive integer and `seed` a non-negative integer up to `Number.MAX_SAFE_INTEGER`; the bridge silently dropped values it couldn't read.
- The stream idle timeout rejects with `GenerationError` instead of a plain `Error`.
- Emitted JavaScript `target` configured to `ES2022` (with `ES2024` and `ESNext.Disposable` library types) for broad compatibility across runtimes, bundlers, and IDE language servers.
- JavaScript reaches the bridge through tsfm's own Node-API addon, `native/tsfm.node`, instead of koffi. tsfm has no runtime dependencies, so npm no longer warns about koffi's install script. Native objects are type-tagged handles: passing the wrong kind, a released one, or a non-string where a string belongs throws instead of reaching native code, and native callbacks can't reach JavaScript after a stream is dropped, a tool is disposed or the process exits. Node-API is ABI-stable, so the one bundled build works on every supported Node version.

### Added

- `tsfm-sdk/system1`, with `tsfm-sdk/jev` as an alias: a local, Jev-shaped decision API with `SystemOneClient` (`TypeSafeClient` alias), `systemOne()`, and typed `choice`, `score`, and `noul` questions. It batches named decisions over shared state into one guided-generation request, validates runtime inputs before creating a session, and exports Jev-shaped aliases for the common SDK types. Probabilities are model-estimated rather than Jev-calibrated, and `confidence` is derived from distribution concentration.
- Tools receive a per-invocation `ToolCallContext` with an `AbortSignal`. Pass it to `fetch()` or other cancellable APIs to stop work when the request is cancelled or the tool is disposed. Existing one-argument tool implementations remain supported. Cancellation cannot forcibly stop code that ignores the signal.
- Token usage (macOS 27): `Response.usage` and `ResponseStream.usage` for a request, and `session.usage` for the whole session, with input, cached, output and reasoning token counts. `null` on macOS 26.
- `toolCallingMode` (`"allowed"`, `"required"` or `"disallowed"`; the last two need macOS 27) and `maximumToolCalls` in `GenerationOptions`.
- `includeSchemaInPrompt` in `GenerationOptions` (default `true`): controls whether structured schema definitions are injected into the prompt text, allowing callers to omit schema text when already known to save tokens.
- `PrivateCloudComputeLanguageModel` for Apple's server model: a 32K context, reasoning, and a daily quota. It's opt-in, needs macOS 27, and needs a host signed with Apple's PCC entitlement. Includes availability (with missing-entitlement and requires-newer-OS reasons), `waitUntilAvailable()`, `quotaUsage`, `contextSize()`, `capabilities`, `supportedLanguages()` and `supportsLocale()`. Sessions and `fromTranscript()` accept it as their `model`. `supportedLanguages()` and `supportsLocale()` are asynchronous on PCC (Apple defined them `async throws` there), unlike the synchronous versions on `SystemLanguageModel`.
- `supportsLocale()` on both `SystemLanguageModel` and `PrivateCloudComputeLanguageModel` defaults to the host machine's current locale when called without arguments.
- `reasoningLevel` in `GenerationOptions` (`"light"`, `"moderate"` or `"deep"`), for Private Cloud Compute. The on-device model throws `UnsupportedCapabilityError`.
- `FailRequestError` and `RequestFailedByToolError`: throwing `FailRequestError` from a tool's `call()` method aborts generation immediately and rejects `respond()` with `RequestFailedByToolError` naming the failing tool, instead of returning an error string to the model.
- `CancelledError` (code 20): a request stopped by `session.cancel()`, or a dropped stream, rejects with it instead of `GenerationError` with code 255.
- Prompts can interleave text and images: `{ content: [image, "What is this?", image] }` composes in that order, and an image alone sends no text. `{ text, attachments }` works as before.
- An attachment path that isn't an existing file throws `PromptAttachmentError` with `reason: "not-found"` before anything reaches the native library.
- Chat and Responses APIs accept `"system"` and `"pcc"`, the model ids Apple's `fm serve` uses, as aliases of `"SystemLanguageModel"` and `"PrivateCloudComputeLanguageModel"`. `"pcc"` used to fall back silently to the on-device model.
- `npx tsfm doctor` reports whether a machine can run tsfm and why not, and notes how to agree to the `fm` CLI's license (`sudo fm license`) if not already agreed. It only reads system configuration, and never agrees on your behalf.
- New errors: `InvalidArgumentError`, `TimeoutError`, `UnsupportedCapabilityError`, `UnsupportedTranscriptContentError`, `ToolCallLimitExceededError`, `SystemPressureError`, `TranscriptMutationWhileRespondingError`, `FailRequestError`, `RequestFailedByToolError`, `PrivateCloudComputeNetworkError`, `PrivateCloudComputeQuotaExceededError`, `PrivateCloudComputeUnavailableError` and `PrivateCloudComputeEntitlementError`.
- `SystemLanguageModel.variant` (e.g. `"AFM 3 Core Advanced"`) and `capabilities` (macOS 27; `null` on macOS 26).
- `UnsupportedCapabilityError.minimumRequiredMacOS`: `27` when a macOS 27 feature is used on macOS 26, so an app can fall back instead of crashing.
- Transcripts support `reasoning` entries, plus the `contextOptions` and `metadata` fields.
- Chat and Responses APIs:
  - They fill in `usage`, and a Chat Completions stream reports it in a final chunk with `stream_options: { include_usage: true }`.
  - `model: "PrivateCloudComputeLanguageModel"` sends a request to Private Cloud Compute, and `reasoning_effort` / `reasoning.effort` map to `reasoningLevel`.
  - Responses report the model that served them.
- `tsfm-sdk/openai`, an alias of `tsfm-sdk/chat`.
- Arrays of booleans in `generable()` and `GenerationSchema`.

### Fixed

- Stream cancellation and early iterator exit now wait for the terminal native callback before starting the next queued request. Reusing a session while its cancelled generation was still unwinding could crash the host.
- Concurrent sessions sharing a tool now enforce independent `maximumToolCalls` budgets. Disposing one session releases only its own tool registrations.
- Cancelling a stream while a tool was pending, reusing the session, and then completing or disposing the old tool could crash Node. Cancellation now removes the tool's native continuation, so late results are ignored. One-shot requests cancelled during a tool call reject with `CancelledError` without waiting for JavaScript's tool to finish.
- Sessions now copy the supplied tools array. Mutating that array can no longer bypass `maximumToolCalls` or leave a spent budget attached to a tool.
- Several ways to crash the host process:
  - A number where a string was expected (a prompt, instructions, an attachment path, a schema or property name, a guide value) was passed to native code as a pointer. It now throws `TypeError`.
  - A stream queued behind another request, when the session was disposed in between, passed a released session to native code.
  - Breaking out of a stream early let the cancelled native stream call a callback that had already been released.
  - A JSON schema nested about 200 levels deep overflowed the framework's stack. Schemas deeper than 128 levels now throw `InvalidGenerationSchemaError`.
  - Reading a session's transcript after `dispose()` read freed memory. It now throws `FoundationModelsError`.
  - A guide whose bounds the framework can't represent, such as `range(5, 1)`, a `NaN` or infinite bound, or `maximum(1e20)` on an integer, trapped in Swift. `GenerationGuide` now throws `RangeError` for a bound that isn't a finite number, a range whose minimum is above its maximum, or a count that isn't a non-negative integer, and the bridge rejects any that get past it with `UnsupportedGuideError`.
- Nested object properties in `generable()` failed with an undefined reference. Arrays of objects were unaffected. Keys shared by objects in different places, keys named like a scalar type such as `string`, and keys with characters like `-` also produced wrong or failing schemas.
- `$ref` to `$defs` in JSON schemas never resolved, because the framework looks up a definition by its title. Each definition's `title` is now set to its key.
- A session created with a disposed `SystemLanguageModel` silently used the default model. It now throws.
- A tool call could hang when the tool answered before the bridge was ready to receive the answer.
- A stream always releases the session's request lock, even if native cleanup or reading its usage fails. Cancelling a stream no longer releases its handle before cleanup, which threw "The request has been released" and left later requests waiting forever.
- A synchronous `FailRequestError` from a tool stops the request just like a rejected Promise. Concurrent sessions sharing a tool each receive their own invocation's original error as the request's cause, even when the error messages match.
- The native library's load-failure hint reads the macOS version from `SystemVersion.plist` instead of guessing from the Darwin version.
- Chat Completions: a streamed tool request that ended in a mapped error reported zero usage.
- Disposing a tool while the model was waiting on one of its calls left the response waiting forever. Its pending calls now fail.
- `ServiceCrashedError` told you to restart the service with `launchctl kickstart`, which System Integrity Protection blocks on macOS 27. It now says to wait for macOS to restart it, or to log out or restart the Mac.
- `LanguageModelSession.fromTranscript()` refuses a transcript that belongs to a live session. It used to repoint that session's transcript at the new one, so disposing the new session broke the original. Export and restore to branch a conversation: `fromTranscript(Transcript.fromJson(session.transcript.toJson()))`.
- Private Cloud Compute failures reach the Chat Completions and Responses layers with an HTTP status: quota 429, unavailable and network 503, a missing entitlement 403. They used to rethrow with no status, so a proxy answered 500 for a quota a client could have backed off from.
- `Client.close()` sticks: a later request for Private Cloud Compute used to build a native model nothing would dispose.
- A Responses stream reports the usage it produced before an error, as the Chat layer already did.
- `temperature` and `probabilityThreshold` require numbers between 0 and 1 inclusive. `"0.5"` and boolean values passed initial range checks, then the bridge dropped them or serialized the wrong type.
- Model manager memory pressure (`CriticalMemoryPressure`) and preemption (`Preempted`) map to `SystemPressureError` with actionable recovery advice rather than appearing as an unknown error or service crash.
- Modifying a session's transcript while generation is actively in progress throws `TranscriptMutationWhileRespondingError` instead of failing with an unknown error.
- Two objects in one schema sharing a title are reported, rather than one silently taking the other's shape.
- A `Tool` that was used by a session and never disposed was never garbage-collected, so it and its native tool leaked. Once nothing references it, it's collected and its native tool released.
- A stream the native side couldn't start (for example with invalid options) passed a null stream on to native code. It now throws `FoundationModelsError`.
- `UnsupportedCapabilityError.minimumRequiredMacOS` was `26` for token counting on macOS 26.0–26.3, which needs 26.4. It's now `26.4`.
- Passing a disposed transcript, or one whose session was disposed, to `fromTranscript()` or `tokenCount()` throws `FoundationModelsError` instead of a bare `Error` from the addon.
- A tool whose `call()` resolved with something other than a string reported the addon's `Expected a string for "output"`. The message now names the tool and the type, and the call is still answered.
- Chat and Responses APIs: `reasoning_effort: "constructor"` (or another `Object.prototype` name) threw instead of being warned about and ignored.
- The published `tsfm` command is built with executable permissions (+x) so it can be run directly via `npx` or global npm install without permission errors.
- `quotaUsage` throws `FoundationModelsError` if the bridge returns quota JSON it can't parse, instead of a raw `SyntaxError`.
- Chat and Responses APIs release the transcript they built when the session can't be created, instead of leaving it to the garbage collector.
- Prototype pollution in prompt inputs: properties on prompt objects (e.g. `{ text: "..." }`) could inherit `attachments` or `text` from `Object.prototype`. Explicit `Object.hasOwn()` checks now guard against prototype pollution.
- Stream cancellation tracks the active native request handle. `session.cancel()` signals the native request immediately; stream cleanup releases the handle and the session's queue lock.

## [0.5.1] - 2026-09-18

### Fixed

- Chat and Responses APIs: after a tool result was sent back, the model often ignored it and answered something unrelated, such as "I am a foundation model created by Apple." Past tool calls went into the transcript as raw OpenAI JSON, which the model sometimes echoed back, and the tool result reached the model as a bare user turn with no question. Tool calls are now described in plain text, and the prompt restates the request that led to the call. In 15 runs of the tool-calling integration test, the first attempt succeeded 15/15 times, up from 6/15.
- Chat and Responses APIs: when one tool was called more than once, the model could not tell which result belonged to which call. Asked for the weather in Tokyo and Paris, it swapped the cities every time. Results from a repeated tool are now labeled with the call's arguments, for example `[Tool result for get_weather {"city":"Paris"}]`.

### Changed

- TypeScript `target` and `lib` raised from ES2022 to ES2025, matching the Node 24 minimum. Emitted JavaScript is unchanged.

## [0.5.0] - 2026-09-18

### Added

- Official support for macOS 27. The SDK is tested on macOS 27, and the full unit and integration suites pass there. macOS 26 is still supported, and the native library's minimum deployment target stays at macOS 26.0.
- Prompt attachments now work on macOS 27 with the bundled library. It is built against the macOS 27 SDK and still loads on macOS 26, where each attachment is rejected with `PromptAttachmentError` (`reason: "unsupported-os"`).

### Fixed

- Building from source with the macOS 27 SDK did not enable prompt attachments. `scripts/build-native.sh` never defined `FM_HAS_MACOS_27_SDK`, so the bridge compiled attachments out and every attachment was rejected with `unsupported-sdk`. The script now defines it when the active SDK is macOS 27 or later, as upstream's build does, and rebuilds an existing dylib that lacks attachment support instead of skipping it.

### Changed

- `koffi` upgraded from `^3.1.5` to `^3.3.0`. This is the runtime FFI dependency.
- The published package is now built on the `xcode-27` runner instead of `macos-26`. A new `scripts/verify-native.sh` check fails the publish if the library's deployment target is not macOS 26.0, or if any macOS 27 attachment symbol is strongly linked.
- Development toolchain moved to Vitest 5 (`vitest` and `@vitest/coverage-v8` 5.0.1). `openai`, `eslint`, `typescript-eslint`, `@types/node`, `prettier`, and `tsx` also moved to their latest versions.

### Security

- Development dependencies no longer include vulnerable versions of `vitest` (GHSA-82fw-gwwq-j7x9) or `@humanfs/node` (GHSA-p498-v437-472g). None of these packages ship in the published package.

## [0.4.0] - 2026-08-14

### Added

- `generable()` — declarative typed schema builder for structured output with full TypeScript type inference, the equivalent of the Python SDK's `@generable` decorator
- `SystemLanguageModel.contextSize` — read the model's context window size (back-deployed from macOS 26.4 SDK)
- `SystemLanguageModel.tokenCount()` — count the tokens a prompt, instruction set, tool list, schema, or transcript consumes against the context window. Asynchronous, requires a macOS 26.4+ runtime.
- Prompt attachments — every method taking a prompt now accepts `{ text, attachments }` as well as a string. Requires macOS 27 and a native library built against the macOS 27 SDK; until then each attachment is refused with a `PromptAttachmentError` naming the reason.
- `SystemLanguageModel.supportedLanguages` — list supported language codes
- `SystemLanguageModel.supportsLocale()` — check if a specific locale is supported
- `LanguageModelSession.prewarm()` — preload model resources and optionally cache a prompt prefix to reduce first-response latency
- `GeneratedContent.dispose()` / `Symbol.dispose` — explicit resource cleanup for structured output results, with `FinalizationRegistry` auto-cleanup as a safety net
- `Transcript.dispose()` / `Symbol.dispose` — release the C object behind a standalone transcript from `fromJson()` / `fromDict()`, with `FinalizationRegistry` auto-cleanup as a safety net. No-op for the transcript reached through `session.transcript`, which the session frees.
- `GeneratedContent.toObject<T>()` — pass the shape the schema guarantees instead of asserting at the call site. Defaults to `JsonObject`, so existing calls are unaffected.
- `NativeTypeName` type export — compound array type names (`"array<string>"`, `"array<integer>"`, etc.) for use with `GenerationSchema.property()`
- `decodeString()` — decode a C string pointer without freeing it, for use in callbacks where the C side owns the memory
- `Tool.onCall` now receives parsed arguments as a second parameter: `(toolName, args)` instead of `(toolName)`
- Input validation: `temperature` must be ≥ 0, `maximumResponseTokens` must be a positive integer — both throw immediately on invalid values
- Explicit FFI type casts (`as NativePointer`, `as boolean`, etc.) at all C call sites
- 3 new examples: `contact-card` (nested generable schemas), `email-triage` (JSON Schema + streaming + tools), `journal` (tools + transcript persistence)
- ESLint: `no-floating-promises` and `no-console` for `src/`, `no-eval` and `no-debugger` globally
- Unit tests for `generable()`, streaming edge cases, compat `reorderJson` with array items, disposed session guards, stream queue-stall recovery, and all 3 new examples

### Fixed

- `Transcript.fromJson()` and `fromDict()` leaked their native object. Each allocated a C object with no way to release it, since the class had no `dispose()`, no `Symbol.dispose`, and no `FinalizationRegistry`.
- Building from source validated the wrong toolchain: the Xcode version check ran before `DEVELOPER_DIR` was repointed at an installed `Xcode-beta.app`, so the build could use an SDK that was never checked.
- Streaming no longer discards a response whose text is exactly `null`. The callback treated that string as a koffi coercion artifact, so such a response streamed as nothing at all. koffi marshals the end-of-stream signal to JS `null`, never to the string, so there was no artifact to filter.
- Upstream C bridge moved to apple/python-apple-fm-sdk@e868e608, which changed the prompt parameter of all four response entry points from `const char *` to an opaque composed-prompt object. The build now pins that revision, since koffi binds by symbol name and cannot see a changed parameter type.

- Stream setup failures no longer stall the request queue permanently (native init moved inside try/finally)
- Stream idle timeout (30s) prevents permanent hangs when native callbacks stop firing. Armed between snapshots rather than after a tool-call snapshot, since the artifact it originally keyed on does not occur.
- Disposed session methods (`respond`, `respondWithSchema`, `respondWithJsonSchema`, `streamResponse`) now throw `FoundationModelsError` immediately instead of calling into freed native memory
- `FinalizationRegistry` callbacks across all classes now log warnings via `console.warn` instead of silently swallowing errors
- Better error message when `libFoundationModels.dylib` is not found — lists all searched paths and suggests `npm run build`
- Streaming iterator now resets the session (`FMLanguageModelSessionReset`) on early `break` to prevent stalled subsequent calls

### Changed

- Declare `generable()` property maps with `satisfies Record<string, PropertyDef>` (or inline them at the call). Assigning them to a plain `const` first widens `optional: true` to `boolean`, and `InferSchema` then marks every property required. The bundled examples show the pattern.
- **Breaking:** `engines.node` raised from `>=20` to `>=24`. Installing on Node 20 or 22 no longer works.
- `koffi` upgraded from `^2.15.1` to `^3.1.5`. This is the runtime FFI dependency, and its marshalling of null C strings differs from 2.x — see the streaming fix above.
- Development toolchain moved to TypeScript 7 (`@typescript/native`, with 6.0.2 available as `tsc6`), `openai` 7, `@types/node` 26, and ESLint 10.
- Building the dylib from source now requires **Xcode 26.4+**, the first SDK that declares `SystemLanguageModel.contextSize`. The bundled prebuilt library is unaffected.
- `generable()` array properties now use compound type names (`"array<string>"`, `"array<Name>"`) matching the Python SDK's C bridge convention
- `GenerationSchema.property()` rejects bare `"array"` type — use compound form like `"array<string>"` or use `generable()` for automatic type resolution
- Prettier scope widened from `src/` to entire repo (excluding `*.md`); added `.prettierignore`
- Standardized "Apple Foundation Models" terminology (dropped possessive "'s") across docs and config
- README license section rewritten with copyright notice and Apple trademark disclaimer
- `docs/tsconfig.json` added for VitePress theme type checking
- CSS: added `.VPHero .tagline` max-width constraints for responsive layout

## [0.3.1] - 2026-03-12

### Added

- `Tool.onCall` — optional callback that fires at the start of each tool invocation, before `call()` runs. Useful for showing UI indicators while the model waits for tool results.

## [0.3.0] - 2026-03-11

### Added

- **Chat & Responses API layer** (`tsfm-sdk/chat`) — industry-standard Chat-style and Responses-style APIs
  - **Chat Completions API** (`client.chat.completions.create()`) with full message history, streaming, structured output (`json_schema`), and tool calling
  - **Responses API** (`client.responses.create()`) — string or structured input, function tools, and streaming via `ResponseStream`
  - Parameter mapping: `temperature`, `max_tokens`/`max_completion_tokens`, `top_p`, `seed` → native `GenerationOptions`; unsupported params warned at runtime
  - Error mapping: `ExceededContextWindowSizeError` → `finish_reason: "length"`, `GuardrailViolationError` → `finish_reason: "content_filter"`, `RefusalError` → `message.refusal`, `RateLimitedError` → HTTP 429
  - `Stream` and `ResponseStream` async iterables with `toReadableStream()`, `close()`, `Symbol.dispose`, and `FinalizationRegistry` cleanup
  - Tool calling via structured output with `$defs`/`$ref` schemas to prevent parameter name collisions
  - JSON key reordering utility to match schema-defined property order
- `ServiceCrashedError` — detects crashed `generativeexperiencesd` service and provides recovery instructions
- `Symbol.dispose` support on `SystemLanguageModel`, `LanguageModelSession`, `Tool`, and `Client` for TC39 Explicit Resource Management
- Typed transcript entries: `TranscriptEntry`, `TranscriptContent`, `TranscriptTextContent`, `TranscriptStructuredContent`, `TranscriptToolCall`, `TranscriptEntryRole` types and `transcript.entries()` method
- `JsonSchema` and `JsonObject` exported types
- Automatic session cleanup on `process.exit`, `SIGINT`, and `SIGTERM` via global session tracking
- Enhanced `afmSchemaFormat()` with recursive normalization for nested objects, `$defs`/`$ref` support, and `x-order` fields
- `respondWithJsonSchema()` now accepts typed `JsonSchema` instead of `Record<string, unknown>`
- Tool callback error handling: synchronous errors in `call()` now invoke `FMBridgedToolFinishCall()` with error message to prevent session hang
- Enhanced `statusToError()`: maps `ModelManagerError Code=1041` to `InvalidGenerationSchemaError` with descriptive message
- Integration tests for Chat & Responses API layer (chat completions and Responses API)
- Unit tests for all compat modules (~4,300 lines of new test coverage)
- 6 new examples in `examples/compat/` demonstrating Chat Completions and Responses API
- Retry helper for integration tests (`retryAttempts()`) for flaky on-device model responses

### Changed

- Renamed model class from internal name to `SystemLanguageModel` across all public APIs and documentation
- `Transcript.toDict()` and `fromDict()` now use `JsonObject` type instead of `Record<string, unknown>`
- `GeneratedContent.toObject()` now returns `JsonObject` instead of `Record<string, unknown>`
- `serializeOptions()` uses typed `SerializedSampling` and `SerializedOptions` interfaces internally
- Integration tests now use `waitUntilAvailable()` instead of synchronous `isAvailable()`

### Documentation

- Complete Chat & Responses API guide (505 lines), API reference (568 lines), and examples page (321 lines)
- Docs site visual overhaul: brand colors shifted to teal, Apple-style typography and font rendering, WCAG AA contrast fixes
- Landing page redesigned with code examples and Chat API showcase
- Swift-equivalent references extracted into caption-style info boxes across all guide pages
- Code blocks now word-wrap; inline code uses inherited text color with subtle background
- All guide pages updated with Apple conventions terminology alignment

## [0.2.3] - 2026-03-10

### Fixed

- `NOTICE` file now included in published npm package

## [0.2.2] - 2026-03-10

### Changed

- Renamed package from `afm-ts-sdk` to `tsfm-sdk`
- Renamed GitHub repository from `codybrom/afm-ts-sdk` to `codybrom/tsfm`

## [0.2.1] - 2026-03-09

### Added

- Branded `NativePointer` type for compile-time C pointer type safety
- `unregisterCallback()` utility to centralize callback cleanup logic
- Discriminated union for `GenerationGuide` data, enabling exhaustive type checking
- Comprehensive JSDoc comments on public APIs (`SystemLanguageModel`, `LanguageModelSession`, `Tool`, `Transcript`, `SamplingMode`)
- `stripInternal` in tsconfig to exclude `@internal` symbols from `.d.ts` output
- Unit tests for error hierarchy and `statusToError()` mapping
- Integration test suite covering basic responses, streaming, structured output, tools, and transcripts
- GitHub Actions CI workflow (macOS, Node.js 20/22, lint + format + unit tests)
- Organized examples directory with individual READMEs for each example

### Changed

- Renamed all internal pointer variables from abbreviations (`ptr`, `cbPtr`) to full names (`pointer`, `callbackPointer`, `_nativeSession`, `_nativeTool`, `_nativeSchema`, etc.)
- `InvalidGenerationSchemaError` now extends `GenerationError` instead of `FoundationModelsError`
- All error-throwing paths now use `FoundationModelsError` or `GenerationError` subclasses instead of generic `Error`
- Replaced `GenerationGuide` separate `guideType`/`value` fields with a single `data` discriminated union

### Removed

- Monolithic `example.ts` file (replaced by organized `examples/` directory)

## [0.2.0] - 2026-03-08

### Added

- `decodeAndFreeString()` utility in bindings to safely decode C string pointers and free memory via `FMFreeString`
- ESLint (flat config) and Prettier for code linting and formatting
- `tsx` dev dependency for TypeScript execution

### Changed

- C function signatures for string-returning functions now declare return type as `void *` instead of `str` to retain the pointer for proper memory management
- Tool callback error handling now wraps errors in `ToolCallError` with proper context
- Updated README import paths

### Fixed

- Critical memory leak in all string-returning C functions — `koffi`'s `str` return type was copying strings but discarding the original pointer before it could be freed

### Removed

- Unused `FMLanguageModelSessionCreateDefault` binding (sessions always route through `CreateFromSystemLanguageModel`)
- Unused `FMRetain` binding (all Swift-to-JS transfers use `passRetained`, only `FMRelease` is needed)

## [0.1.0] - 2026-03-08

### Added

- TypeScript/Node.js bindings for Apple Foundation Models framework via koffi FFI
- `SystemLanguageModel` class with availability checks and `waitUntilAvailable()`
- `LanguageModelSession` with `respond()`, `streamResponse()`, and `respondWithJsonSchema()` for text, streaming, and structured generation
- `GenerationSchema` and `GenerationSchemaProperty` for typed structured output with generation guides
- `GenerationOptions` and `SamplingMode` for controlling temperature, token limits, and sampling strategies
- Abstract `Tool` base class for function calling with schema-driven arguments
- `Transcript` class for session history export and import
- Error hierarchy matching Python SDK status codes (11 specific error types)
- Prebuilt `libFoundationModels.dylib` bundled for npm distribution (no Xcode required)
- `build-native.sh` script for building the dylib from vendored Swift source
- `verify-native.js` postinstall script for SHA256 verification with automatic rebuild

[1.0.0-beta.1]: https://github.com/codybrom/tsfm/compare/v0.5.1...v1.0.0-beta.1
[0.5.1]: https://github.com/codybrom/tsfm/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/codybrom/tsfm/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/codybrom/tsfm/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/codybrom/tsfm/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/codybrom/tsfm/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/codybrom/tsfm/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/codybrom/tsfm/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/codybrom/tsfm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/codybrom/tsfm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/codybrom/tsfm/releases/tag/v0.1.0
