# fm CLI fixtures

Recorded runs of macOS 27's `/usr/bin/fm`, the groundwork for tsfm 1.0.

| File | Contents |
| --- | --- |
| `unlicensed.json`, `unlicensed.md` | Runs from before anyone on the machine agreed to the fm license, and the findings |
| `licensed.json`, `licensed.md` | Runs from after agreeing, and the findings (including `fm serve`) |
| `probe.ts` | The harness that records runs |

## Format

Each JSON file is an `FmCapture` (see `probe.ts`): metadata plus a `runs` array sorted by `name`.
Each run has these fields:

| Field | Meaning |
| --- | --- |
| `argv` | Arguments passed to `fm` |
| `stdin` | `null` (`</dev/null`), `pipe` (`echo no \|`), or `tty` (a pty via `script(1)`) |
| `exitCode` | Exit status (`124` = killed by the 10 s timeout) |
| `seconds` | Wall-clock time |
| `stdout`, `stderr` | Output exactly as captured, ANSI escape codes included |
| `tty` | Pty transcript, only included when it differs from `stdout` |

Machine-specific details are redacted: temp paths, home directories, and the local date and time
of the license agreement.

## Recording

```sh
npx tsx tests/fixtures/fm/probe.ts tests/fixtures/fm/licensed.json respond-null null -- respond "Say hi."
```

A run with the same `name` replaces the old one. Never run the harness as root or with `sudo`:
agreeing to the fm license applies to the whole machine.
