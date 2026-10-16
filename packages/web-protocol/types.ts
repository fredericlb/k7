// types.ts — the API contract between k7's backend and frontend, one module per concern and all of
// them re-exported here, which is the path every consumer imports.

export * from "./commandTypes.ts";
export * from "./engineAccess.ts";
export * from "./machineTypes.ts";
export * from "./timelineTypes.ts";
export * from "./workspaceTypes.ts";

// How good a link is — Q1/Q2/Q3, off a measured latency — lives in ./quality; see docs/quality.md.
// How capable the machine behind it is — one integer, 1000 the reference — lives in ./performance.
