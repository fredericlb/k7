// host-pid.mjs — where a host task leaves its PID, named once so the runner and the stopper
// cannot come to disagree. Under `.cache`, which the mirror skips: this is host-local state,
// meaningless on the other side of the share. See ../docs/wsl.md.

/** Relative to the mirror root, which is the cwd of everything the bridge runs on the host. */
export const pidFileFor = (tag) => `.cache/dev-${tag}.pid`;
