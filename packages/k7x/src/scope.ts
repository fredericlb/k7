// scope.ts — a view of a document under one base path, so a writer that owns a subtree addresses it from its own root.
// A reader would get wrong that it holds a node: it holds a path, resolved again on every call, so it survives every edit.

import type { K7Node, K7Path } from "./ast.ts";
import type { K7Document, WriteOptions } from "./edit.ts";

export class K7Scope {
  constructor(
    readonly doc: K7Document,
    readonly base: K7Path,
  ) {}

  private at(path: K7Path): K7Path {
    return [...this.base, ...path];
  }

  getIn(path: K7Path): unknown {
    return this.doc.getIn(this.at(path));
  }

  hasIn(path: K7Path): boolean {
    return this.doc.hasIn(this.at(path));
  }

  getNode(path: K7Path): K7Node | undefined {
    return this.doc.getNode(this.at(path));
  }

  getSource(path: K7Path): string | undefined {
    return this.doc.getSource(this.at(path));
  }

  toJS(): unknown {
    return this.doc.getIn(this.base);
  }

  setIn(path: K7Path, value: unknown, opts?: WriteOptions): void {
    this.doc.setIn(this.at(path), value, opts);
  }

  addIn(path: K7Path, value: unknown, opts?: WriteOptions): void {
    this.doc.addIn(this.at(path), value, opts);
  }

  insertIn(
    path: K7Path,
    index: number,
    value: unknown,
    opts?: WriteOptions,
  ): void {
    this.doc.insertIn(this.at(path), index, value, opts);
  }

  deleteIn(path: K7Path, opts?: { prune?: boolean }): boolean {
    return this.doc.deleteIn(this.at(path), opts);
  }

  applyIn(path: K7Path, value: unknown): void {
    this.doc.applyIn(this.at(path), value);
  }

  renameKey(path: K7Path, newKey: string): void {
    this.doc.renameKey(this.at(path), newKey);
  }

  setSourceIn(path: K7Path, source: string): void {
    this.doc.setSourceIn(this.at(path), source);
  }

  insertSourceIn(path: K7Path, index: number, source: string): void {
    this.doc.insertSourceIn(this.at(path), index, source);
  }

  moveIn(path: K7Path, from: number, to: number): void {
    this.doc.moveIn(this.at(path), from, to);
  }

  positionOf(path: K7Path): { line: number; col: number } | undefined {
    return this.doc.positionOf(this.at(path));
  }

  /** A narrower view, its base relative to this one. */
  scope(path: K7Path): K7Scope {
    return new K7Scope(this.doc, this.at(path));
  }
}
