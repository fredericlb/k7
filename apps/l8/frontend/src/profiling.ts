// profiling.ts — is somebody LOOKING at this app's performance? `?profile=1`, or
// `studio.profile` in localStorage so it survives the reloads an investigation takes.
//
// One rule rather than two, because the two things it gates cost the same way: the React
// Profiler bills every commit in a tree that commits on every meter frame, and the viewport's
// per-lane drift readout re-renders its pane five times a second. Both are instruments, and an
// instrument left running is a measurement of itself. See docs/shell.md.

export const PROFILING: boolean =
  typeof window !== "undefined" &&
  (new URLSearchParams(window.location.search).get("profile") === "1" ||
    localStorage.getItem("studio.profile") === "1");
