# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-09-18

### Added

- Official support for macOS 27. The SDK is tested on macOS 27, and the full unit and integration suites pass there. macOS 26 is still supported, and the native library's minimum deployment target stays at macOS 26.0.

### Changed

- `koffi` upgraded from `^3.1.5` to `^3.3.0`. This is the runtime FFI dependency.
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

[0.5.0]: https://github.com/codybrom/tsfm/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/codybrom/tsfm/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/codybrom/tsfm/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/codybrom/tsfm/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/codybrom/tsfm/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/codybrom/tsfm/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/codybrom/tsfm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/codybrom/tsfm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/codybrom/tsfm/releases/tag/v0.1.0
