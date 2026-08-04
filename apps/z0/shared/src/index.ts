// z0-shared — the pieces more than one of the six frontends renders.
//
// These are presentational only: every component takes its data and callbacks
// as props rather than reaching for an app's ../lib/auth, so each frontend
// keeps owning its own auth wiring. Styling is deliberately left to the
// consumer's extracted-styles.css — the .auth-*/.login-*/.panel class names
// below resolve to each app's own theme (the presenter's synthwave surfaces
// and the editor's blue/grey chrome are the same markup, different CSS).
//
// Apps import via subpaths ("z0-shared/auth-badge"); this barrel is
// here for tooling that wants the whole surface at once.

export * from "./auth-badge";
export * from "./login-gate";
export * from "./session-picker";
export * from "./types";
