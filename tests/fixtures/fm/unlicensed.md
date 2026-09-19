# fm CLI, unlicensed state

Captured 2026-09-18 on macOS 27.0 (26A428), Apple Silicon, running as a non-root user.
Nobody on this machine had agreed to the Apple Foundation Models CLI terms yet.
This state is hard to reproduce: after someone runs `sudo fm license`, it applies to every user on the machine.

`unlicensed.json` has one entry per `fm` run (see `README.md` for the format). `probe.ts` recorded them
with `EXPECT_UNLICENSED=1`. The socket path in the `serve-socket` run is redacted as `<scratch-dir>`.

## Findings

- The license check runs before argument parsing. Every command exits **69** with empty stdout and prints
  the notice to stderr. This includes `--help`, `--version`, unknown commands and bad flags.
- The only exception is `fm license`, which parses its own arguments normally:
  - `fm license --status` → exit 69, stdout `Not agreed. Run 'sudo fm license' to review and agree.`
  - `fm license --show` → exit 0 with the terms. If `--show` and `--status` are both given, `--show` wins.
  - `fm license --nope` → exit 64 (usage error).
  - `fm license` (not root) → the same 69 notice as other commands.
- **A non-root user never sees a prompt, even on a real TTY.** Runs finish in about 15 ms, so they can't hang.
- The notice always has ANSI truecolor codes, even when piped. `NO_COLOR` doesn't turn them off.
- No side effects: no `/Library/Preferences/com.apple.fm.plist`, no `~/.fm/`, and `serve` doesn't
  bind its socket or port.
- The license is stored in `/Library/Preferences/com.apple.fm.plist` (keys `FMLicenseAgreementAccepted`
  and `licenseID`). The binary re-prompts "if the terms change", so a later OS update can make
  an agreed machine unlicensed again.

## Paths not tested (they need root, or an existing plist)

These strings are in the binary, but a non-root user can't trigger them:
- "No terminal is attached, so the agreement cannot be presented…"
- "Standard input is redirected, so there is nothing to read your answer from…"
- Corrupt, unreadable or immutable plist messages
- Asking again after the terms change (`licenseID` mismatch)

Anything that runs `fm` as root (e.g. a Node app under sudo) could reach the prompt paths.
