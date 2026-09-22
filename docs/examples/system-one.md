# System One Decisions

Making several narrow, typed judgments about shared state in one on-device request.

<<< @/../examples/system-one/system-one.ts

## What This Shows

1. `choice()`, `noul()`, and `score()` questions in one call
2. Answer types inferred from question names and criteria
3. Probability-aware routing with a human-review fallback
4. An explicit `other` choice when the listed routes may not cover every ticket

The example threshold is illustrative. Evaluate thresholds on representative labeled data before
using them for automation. Apple Foundation Models estimates these probabilities; they do not carry
Jev's calibration guarantee.
