# Testing

Run commands from the repository root. Native tests need Apple silicon, macOS 26+
and Apple Intelligence. Build with Xcode 27 first (`npm run build`).

```sh
npm run test:unit
npm run test:coverage -- --project unit
npm run test:integration
npm run test:integration:sdk27
npm run test:stress
```

The SDK 27 command uses a locally copied and re-stamped Node host to exercise
Foundation Models' newer framework behavior. It does not emulate macOS 26.
Unit tests mock the macOS 26 API boundary; verifying the older OS itself needs
an actual macOS 26 machine.

## Native tool stress

`test:stress` runs 10 rounds of nine native lifecycle scenarios in child
processes. It tests independent budgets, four simultaneous tool invocations
across all response APIs, garbage collection of 200 session registrations,
cancellation of shared tools, and late tool results after session reuse.
Cancellation and late-result delays vary, with a seeded order for reproduction.
Every child has a hard timeout; failed assertions, crashes and hangs stop the
run. Failed cases are not retried.

```sh
TSFM_STRESS_ROUNDS=20 TSFM_STRESS_SEED=123 npm run test:stress
```

The log identifies the seed, round, scenario and delays on failure. Run the same
command to repeat that workload; native thread scheduling is still variable.
Unlike the normal integration suite, stress tests fail if the model cannot run
requests rather than skipping on unavailable hardware.

## Private Cloud Compute

The default integration run tests the missing-entitlement errors and skips real
PCC requests. For actual cloud coverage, use a locally provisioned host:

```sh
TSFM_PCC_PROFILE=/path/to/profile npm run test:integration:pcc
```

This requires PCC availability instead of silently skipping. Requests use
synthetic test prompts and count toward the signed-in user's daily quota.
The missing-entitlement tests are intentionally skipped on this host.

## Interpreting results

Check skipped tests, not just the exit code. On macOS 27, the native macOS 26
usage test is intentionally skipped. Some model-output integration tests retry
when generation does not follow the requested shape; they log every attempt.
The tool stress cases assert lifecycle behavior without that retry helper.
TypeScript coverage excludes the native Swift and C bridge and does not measure
native race coverage. Run the integration and stress commands as well.
