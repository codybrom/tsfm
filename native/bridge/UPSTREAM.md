# Upstream: Apple's foundation-models-c

`native/bridge/` is tsfm's Swift-to-C bridge for the Foundation Models framework. It's a fork of
Apple's `foundation-models-c` from
[apple/python-apple-fm-sdk](https://github.com/apple/python-apple-fm-sdk), and tsfm maintains and
changes it as its own code.

| | |
| --- | --- |
| Forked from | `foundation-models-c/` at `e868e60811aa0706feb2ccb33cfe7e27626287b7` (2026-07-07) |
| License | Apache License 2.0, see `LICENSE.md` (Apple's, kept verbatim) and tsfm's `NOTICE` at the repository root |

The commit that first added this code has it exactly as upstream had it at that commit. Every
later change is tsfm's, and changes to upstream code are marked `tsfm:` in comments. To see
everything tsfm changed:

```sh
git -C <python-apple-fm-sdk checkout> archive e868e60 foundation-models-c | tar -x -C /tmp/upstream
diff -ru /tmp/upstream/foundation-models-c native/bridge
```

`LICENSE.md`, `UPSTREAM.md` and `.build` always show as only in `native/bridge`: the first two are
tsfm's additions, and `.build` is SwiftPM's cache.

It's forked, not cloned at build time, because tsfm 1.0 changes the bridge itself: macOS 27
APIs, structured errors, `Usage`, tool-call limits, and Private Cloud Compute.

tsfm's standalone additions stay in `../extensions/`. `scripts/build-native.sh` copies this
package to `.build/bridge`, adds the extensions there, and builds, so this directory never holds
build output.
