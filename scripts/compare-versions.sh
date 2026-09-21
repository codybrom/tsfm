#!/usr/bin/env bash
# Prints "older", "same" or "newer": how release version $1 compares to $2.
# Both are plain x.y.z versions (no prerelease), compared numerically per part,
# which is how npm orders releases. publish.yml uses it to keep the latest
# dist-tag from moving backwards.
#
#   bash scripts/compare-versions.sh 1.0.1 1.2.0   # older

set -euo pipefail

if [[ $# -ne 2 || ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || ! "$2" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 x.y.z x.y.z" >&2
  exit 64
fi

IFS=. read -r a1 a2 a3 <<<"$1"
IFS=. read -r b1 b2 b3 <<<"$2"
for pair in "$a1 $b1" "$a2 $b2" "$a3 $b3"; do
  read -r a b <<<"$pair"
  if ((10#$a < 10#$b)); then echo older; exit 0; fi
  if ((10#$a > 10#$b)); then echo newer; exit 0; fi
done
echo same
