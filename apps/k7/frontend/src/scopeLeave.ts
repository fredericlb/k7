// scopeLeave.ts — what a module kept for ONE project, forgotten when the page leaves it without a
// load (appNav.ts). Apart from appNav so a module registers without importing the navigator,
// which listens on the window the moment it is imported. See ../docs/shell.md.

const hooks = new Set<() => void>();

/** Forget something kept for one project at module level, when that project is left. */
export function onLeave(forget: () => void): void {
  hooks.add(forget);
}

/** Run every registered forget — Root, between unmounting one scope and mounting the next. */
export function forgetLeftScope(): void {
  for (const forget of hooks) forget();
}
