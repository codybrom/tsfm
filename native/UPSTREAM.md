# Vendored upstream: foundation-models-c

`foundation-models-c/` is Apple's Swift-to-C bridge for the Foundation Models framework, from
[apple/python-apple-fm-sdk](https://github.com/apple/python-apple-fm-sdk).

| | |
| --- | --- |
| Upstream path | `foundation-models-c/` |
| Upstream commit | `e868e60811aa0706feb2ccb33cfe7e27626287b7` (2026-07-07) |
| License | Apache License 2.0, see `foundation-models-c/LICENSE.md` and the repository's `NOTICE` |

The first commit that adds this directory has the upstream files exactly as they were at that
commit. Check it with:

```sh
git -C <python-apple-fm-sdk checkout> diff e868e60 -- foundation-models-c
```

It's vendored, not cloned at build time, because tsfm 1.0 changes the bridge itself: macOS 27
APIs, structured errors, `Usage`, tool-call limits, and Private Cloud Compute. Every change
after that first commit is tsfm's own and shows up in `git log -- native/foundation-models-c`.

tsfm's own additions stay separate in `extensions/`. `scripts/build-native.sh` copies the
vendored package to `.build/`, adds the extensions there, and builds, so this directory
never holds build output.
