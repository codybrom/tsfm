# fm CLI probe harness

Records how `/usr/bin/fm` behaves, one run per fixture directory. The captures in
`../fm-unlicensed/` and `../fm-licensed/` were made with it.

```sh
OUT=tests/fixtures/fm-licensed tests/fixtures/fm-harness/probe.sh respond-null null -- respond "Say hi."
```

- `to` wraps a command with a timeout (`to <secs> cmd…`, exit 124 on timeout). macOS has no `timeout(1)`.
- Every run gets a 10 s limit and a controlled stdin (`null`, `pipe`, or `tty`), so a prompt can never hang it.
- Never run it as root or with `sudo`. Agreeing to the fm license applies to the whole machine.
