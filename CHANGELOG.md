# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

- TypeScript/Node.js bindings for Apple's Foundation Models framework via koffi FFI
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

[Unreleased]: https://github.com/codybrom/tsfm/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/codybrom/tsfm/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/codybrom/tsfm/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/codybrom/tsfm/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/codybrom/tsfm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/codybrom/tsfm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/codybrom/tsfm/releases/tag/v0.1.0
