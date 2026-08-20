// fuzzy.ts — the one subsequence matcher the shell searches with.
//
// Shared by the `file` command's path completion (App.tsx) and the graph's module search
// (ModulePicker), so "type a few letters of what you want" behaves the same wherever it
// is offered rather than being re-invented per feature.

// Fuzzy subsequence match, higher score is better and -1 is no match: contiguous runs and post-separator hits
// score higher, so "syn" surfaces sequences/synth.yaml; shorter strings win ties.
export function fuzzyScore(q: string, s: string): number {
  const t = s.toLowerCase();
  let score = 0;
  let si = 0;
  let run = 0;
  for (const ch of q.toLowerCase()) {
    const start = si;
    while (si < t.length && t[si] !== ch) si++;
    if (si >= t.length) return -1;
    const atBoundary = si === 0 || "/-_. ".includes(t[si - 1]);
    const contiguous = si === start; // no chars skipped since the last match
    score += 1 + (contiguous ? run * 2 : 0) + (atBoundary ? 3 : 0);
    run = contiguous ? run + 1 : 1;
    si++;
  }
  return score - t.length * 0.01;
}
