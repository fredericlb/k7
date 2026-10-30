// verovio.d.ts — the part of Verovio's toolkit the score view calls: the package ships no types.

declare module "verovio/wasm" {
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module "verovio/esm" {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    redoLayout(options?: Record<string, unknown>): void;
    getPageCount(): number;
    renderToSVG(page?: number): string;
    renderToMIDI(): string;
    renderToTimemap(options?: Record<string, unknown>): unknown[];
    getElementsAtTime(millisec: number): { notes: string[]; page: number };
    getTimeForElement(xmlId: string): number;
    destroy(): void;
  }
}
