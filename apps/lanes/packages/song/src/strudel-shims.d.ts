// Minimal ambient types for the untyped @strudel/* packages (the 1.1.x line ships
// no declarations). We only need a few functions; patterns/haps stay `any`.

declare module "@strudel/core" {
  export function evalScope(...modules: Promise<unknown>[]): Promise<unknown>;
  export function noteToMidi(note: string): number;
}

declare module "@strudel/mini";

declare module "@strudel/transpiler" {
  export function evaluate(code: string): Promise<{ pattern: any }>;
}
