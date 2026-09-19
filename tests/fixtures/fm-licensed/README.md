# fm CLI, licensed state

Captured 2026-09-18 on macOS 27.0 (26A428), right after running `sudo fm license`. See `../fm-unlicensed/` for the state before agreeing.
The directories here come from `../fm-harness/probe.sh` (set `OUT` to the output directory).

## License

- The plist `/Library/Preferences/com.apple.fm.plist` is root:wheel with mode 0644, so anyone can read it:
  `FMLicenseAgreementAccepted = { date, licenseID: "FM1", version: "1.0" }`.
- `fm license --status` → exit **0**, `Agreed to license FM1 version 1.0 on <localized date>.`
  The date contains U+202F, so only check the exit code and never parse this text.
- `fm license` (already agreed) → exit 0, prints the terms and `You have already agreed to these terms.`

## CLI

- Exit codes aren't consistent: an unknown command exits 1 (colored message), a bad option exits 64,
  a runtime error such as a bad schema exits 1. `--version` doesn't exist (exit 64).
- Global `-m` has to come after the subcommand. `fm -m bogus respond` is read as the command `bogus`.
- `count-tokens` takes one positional argument. `--quiet` is automatic when output is piped.
- `respond --tool ocr` works. `--schema` errors are colored even when output is piped.

## `fm serve` (tested over `--socket`)

- **Socket paths longer than 104 bytes (`sun_path`) fail silently.** It prints "listening on …", but no socket
  is created. The SDK has to check the length itself and use a short path (e.g. `mkdtemp(os.tmpdir())`).
- The startup banner is block-buffered when output isn't a TTY and only flushes at exit, so it can't be used
  to tell when the server is ready. Wait for the socket file to appear, then poll `GET /health`.
- Endpoints: `GET /health`, `GET /v1/models`, `POST /v1/chat/completions`. Others return a 404 JSON error.
- **If `stream` is omitted, the response streams.** OpenAI's default is non-streaming. Always send `stream` explicitly.
- `model` is optional. Any value other than `system` returns a 400.
- **Cancellation: disconnecting a streaming request stops generation. Disconnecting a non-streaming request
  doesn't**, and later requests queue behind it (one waited 36 s). The SDK should always stream internally.
- Concurrent requests are queued one at a time on the server, and all of them succeed.
- Sampling:
  - `temperature: 0` gives deterministic output.
  - `seed` gives reproducible output.
  - `top_p` is honored.
  - **`top_k` is silently ignored.**
  - `logprobs` and the penalties are silently ignored.
  - Unknown fields are ignored.
- Length:
  - **`max_tokens` is silently ignored.**
  - `max_completion_tokens` works, but `finish_reason` is still `"stop"` instead of `"length"`.
- Returns 400 for: `n>1`, `stop`, `reasoning_effort`, `response_format: json_object`, the `developer` role,
  an empty `messages` array, and non-`data:` image URLs.
- `stream_options.include_usage` works and adds a final chunk with empty `choices`.
- Structured output (`json_schema`) expects Apple's schema dialect:
  - OK: `enum`, `const`, min/max, `exclusiveMinimum`, `maxItems`, `minLength`, nested objects.
  - 500 "unsupported generation guide": `pattern`.
  - 400: `$defs` without `x-order`, `type: [..,"null"]`, `anyOf` of primitives.
  - **Hung >60 s with no bytes sent (non-streaming): `minItems`, `format: "date"`.**
  - When streaming, the error arrives as `event: error` after HTTP 200.
- **Tool calling doesn't work in this build:**
  - `auto` never called the tool (0 of 5 attempts); the model made up answers.
  - `required` or a named function returns 500 "unsupported generation guide".
  - A tool with no `parameters` returns 400.
  - Tool-result round-trips work (even with an empty `tool_call_id`). An unknown `tool_call_id` returns 400.
- Errors: context overflow and guardrails both come back as **HTTP 500 `server_error`**. The only way to tell
  them apart is the message text:
  - "The session's transcript exceeded the model's context size."
  - "The model's safety guardrails were triggered."
- A `system` message in the middle of a conversation is accepted but has no effect.
