# Streaming

Token-by-token streaming using `streamResponse()`.

<<< @/../examples/streaming/streaming.ts

## What This Shows

1. Create a session (model availability check can be skipped for brevity)
2. Use `for await...of` to iterate over response chunks
3. Each chunk contains only new tokens: write directly to stdout
