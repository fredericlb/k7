#!/usr/bin/env bash
# Report package `exports` subpaths that no tracked source imports.
set -uo pipefail
cd "$(dirname "$0")"

for pj in packages/*/package.json; do
  name=$(node -e "process.stdout.write(require('./$pj').name||'')")
  [ -z "$name" ] && continue
  subs=$(node -e "
    const e = require('./$pj').exports || {};
    for (const k of Object.keys(e)) process.stdout.write(k + '\n');
  ")
  while IFS= read -r sub; do
    [ -z "$sub" ] && continue
    if [ "$sub" = "." ]; then spec="$name"; else spec="$name${sub#.}"; fi
    hits=$(git grep -l -F "\"$spec\"" -- '*.ts' '*.tsx' ':!commons' ':!'"$(dirname "$pj")" | wc -l)
    hits2=$(git grep -l -F "'$spec'" -- '*.ts' '*.tsx' ':!commons' ':!'"$(dirname "$pj")" | wc -l)
    total=$((hits + hits2))
    if [ "$total" -eq 0 ]; then
      echo "UNCONSUMED  $spec"
    fi
  done <<< "$subs"
done
