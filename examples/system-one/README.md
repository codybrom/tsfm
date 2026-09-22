# System One Decisions

Makes several narrow, typed judgments about shared state in one on-device request.

## What It Shows

- `choice()`, `noul()`, and `score()` questions in one call
- Answer types inferred from question names and criteria
- Probability-aware routing with a human-review fallback
- An explicit `other` choice when the listed routes may not cover every ticket

The example threshold is illustrative. Evaluate thresholds on representative labeled data before
using them for automation. Apple Foundation Models estimates these probabilities; they do not carry
Jev's calibration guarantee.

## Run

```bash
npx tsx examples/system-one/system-one.ts
```
