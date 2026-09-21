# The model manager refusing work

Captured 2026-09-19 on macOS 27.0, Apple silicon, while the machine was under
memory pressure (swap nearly full). Every request failed with
`ModelManagerServices.ModelManagerError` **1013**, "Not executed due to current
system state [\"CriticalMemoryPressure\"], try again later". `pressure.json` has
one entry per call.

This is not a crash, and it is not tsfm: Apple's own `fm respond` failed the
same way throughout. It happened twice in one day on a machine running builds,
Xcode and test suites.

An opaque variant was captured again on 2026-09-21: every tsfm request and
Apple's own `fm respond` failed immediately with `ModelManagerError` **1008**.
It exposed no system-state text, but had the same health signature below:
`isAvailable()` and `fm available` both claimed the model was available,
`contextSize` was 0, and the variant had degraded to "AFM 3 Core". See
`model-manager-1008.json`. The zero-sized context and consistent request
failures indicate that the runtime was not actually ready, so tsfm maps the
error to `AssetsUnavailableError`. Apple doesn't publish definitions for the
code's meaning, so the original detail is retained and provisioning remains an
inference rather than a guaranteed interpretation.

The undocumented `fm respond --show-assets` flag printed no asset bindings
before returning `1008` on this host. That is consistent with a failure before
model assets bind, but it does not prove the provisioning interpretation.

## What tsfm reports

- **Requests fail**: `respond`, `streamResponse`, `respondWithSchema`,
  `respondWithJsonSchema` and `tokenCount` all reject. A tool-calling request
  fails before the tool runs.
- **The error arrives two ways**, which is why `statusToError()` matches the
  code rather than one spelling:
  - `ModelManagerError Code=1013`, nested under
    `com.apple.SensitiveContentAnalysisML` error 15 (the safety classifier
    couldn't load), for ordinary requests.
  - `ModelManagerError:1013` with the system state in brackets, from a tool
    call. This one is where the cause is legible.
- **Metadata keeps working**: `variant`, `capabilities`, `supportedLanguages`,
  `usage` and `transcript` all answer, and `prewarm()` returns without error.

## What lies

- **`isAvailable()` reports `{ available: true }`** while every request fails.
  Availability describes whether the model is installed and the device is
  eligible, not whether the system will run it. Don't use it as a health check.
- **`contextSize` reads 0** instead of 8192.
- **`variant` degrades**: "AFM 3 Core" here, "AFM 3 Core Advanced" when healthy.

Either of the last two is a usable signal that the system won't serve requests.
`fm available` can produce the same false positive. An actual `fm respond`
request is the useful CLI comparison.

## Recovery

It clears on its own, in minutes, once memory frees up. `launchctl kickstart` is
refused while System Integrity Protection is on, so there is nothing to restart
by hand; freeing memory is the actionable step.

## The model manager's other refusals

Read out of `ModelManagerServices` in the dyld shared cache, since the framework
binary isn't on disk:

```sh
cd /System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld
grep -abom1 "Not executed due to current system state" dyld_shared_cache_arm64e.52
dd if=dyld_shared_cache_arm64e.52 bs=4096 skip=$((OFFSET/4096 - 40)) count=110 | strings -n 12
```

Transient, and now recognised by `statusToError()` rather than surfacing as
"unknown error":

| Message | tsfm error |
| --- | --- |
| `Not executed due to current system state ["…"], try again later` | `SystemPressureError` |
| `Client rate limit exceeded, try again later` | `RateLimitedError` |
| `Canceled due to preemption, try again` | `SystemPressureError` (`state: "Preempted"`) |
| `… is not available in Model Catalog` / `… not found in Model Catalog` | `AssetsUnavailableError` |

Seen in the same table and **not** mapped, because they describe a machine or
policy state a caller can't retry past, and none has been observed from tsfm:
`Device not eligible`, `Assertion denied, process not eligible to hold
assertion`, `Denied to hold Assertion by System`, `Policy Not Available`,
`Builtin InferenceProviderService extension not found`. They still arrive as
`GenerationError` with the original text. Add a mapping when one shows up in
practice, with a fixture entry next to this one.

`CriticalMemoryPressure` is the only system state named in `modelmanagerd`'s
strings; the message formats the state as an array, so more than one can appear.
