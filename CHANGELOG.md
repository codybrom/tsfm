# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/codybrom/tsfm/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/codybrom/tsfm/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/codybrom/tsfm/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/codybrom/tsfm/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/codybrom/tsfm/releases/tag/v0.1.0
