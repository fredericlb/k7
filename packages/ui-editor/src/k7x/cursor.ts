// cursor.ts (k7x) — where the cursor sits in key terms, read from the text BEFORE it by a tolerant scan, not a parse.
// Completion runs on half-written text, which the k7x parser refuses; the scan only needs the open brackets (docs/completion.md).

/** The yaml mode's CursorContext, the same four answers so one vocabulary serves both formats. */
export interface K7xCursor {
  /** The keys of the mapping the cursor is in (or whose value it fills), outermost first; list items add no key. */
  path: string[];
  /** Is the cursor where a key goes: a statement's start, after `.` in a chain, or an object's key? */
  inKey: boolean;
  /** The key whose value the cursor is filling, when it is filling one. */
  valueOf: string | null;
  /** Is the cursor at an item of a list, which may be a value or a chain of keys? */
  inSeqItem: boolean;
  /** Is the cursor inside a string it is typing? A value completion then supplies no quotes of its own. */
  inString: boolean;
}

type Frame =
  /** A mapping written as a chain, the file's root included: keys come first, after `.` or at a statement's start. */
  | { kind: "chain"; path: string[]; root: boolean; expectKey: boolean }
  /** A call's arguments: the value of `key` in the mapping at `path`. */
  | { kind: "call"; path: string[]; key: string }
  /** `{ … }`: keys until `:`, then the value of that key. */
  | { kind: "object"; path: string[]; key: string | null; afterColon: boolean }
  /** `[ … ]`, the value of `key` in the mapping at `path`. */
  | { kind: "list"; path: string[]; key: string };

const IDENT = /[A-Za-z_$][\w$-]*/y;
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** The path and key a value at the top of the stack belongs to, or null when the top is no value position. */
function valueSlot(top: Frame): { path: string[]; key: string } | null {
  if (top.kind === "call") return { path: top.path, key: top.key };
  if (top.kind === "list") return { path: top.path, key: top.key };
  if (top.kind === "object" && top.afterColon && top.key !== null)
    return { path: top.path, key: top.key };
  return null;
}

/** Scan `text` (everything before the cursor) and say what the cursor is filling. */
export function k7xCursor(text: string): K7xCursor {
  const stack: Frame[] = [
    { kind: "chain", path: [], root: true, expectKey: true },
  ];
  const top = () => stack[stack.length - 1];
  let pendingKey: string | null = null;
  let i = 0;
  let inString = false;

  /** A key just read, before `(` or `:` says what it is. */
  const keyRead = (key: string) => {
    pendingKey = key;
  };

  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (text.startsWith("//", i)) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? text.length : close + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      if (j >= text.length) {
        inString = true;
        // An open string at a key position is a quoted key being typed.
        const t = top();
        if (t.kind === "object" && !t.afterColon) pendingKey = null;
        break;
      }
      const t = top();
      const key = text.slice(i + 1, j);
      if (
        (t.kind === "chain" && t.expectKey) ||
        (t.kind === "object" && !t.afterColon)
      )
        keyRead(key);
      else pendingKey = null;
      i = j + 1;
      continue;
    }
    NUMBER.lastIndex = i;
    const num = NUMBER.exec(text);
    if (num) {
      i += num[0].length;
      pendingKey = null;
      continue;
    }
    IDENT.lastIndex = i;
    const m = IDENT.exec(text);
    if (m) {
      const word = m[0];
      i += word.length;
      const t = top();
      // At a value position, a word is the head of a chain: the value is a mapping, its keys under the slot's path.
      const slot = valueSlot(t);
      if (slot && (t.kind !== "object" || t.afterColon)) {
        stack.push({
          kind: "chain",
          path: [...slot.path, slot.key],
          root: false,
          expectKey: false,
        });
      } else if (t.kind === "chain") t.expectKey = false;
      keyRead(word);
      continue;
    }
    i++;
    const t = top();
    if (c === "(") {
      const key = pendingKey;
      pendingKey = null;
      const owner = top();
      if (key !== null && owner.kind === "chain")
        stack.push({ kind: "call", path: owner.path, key });
      else if (key !== null && owner.kind === "object")
        stack.push({ kind: "call", path: owner.path, key });
      else stack.push({ kind: "call", path: [], key: "" });
    } else if (c === ")") {
      if (t.kind === "chain" && !t.root) stack.pop();
      if (top().kind === "call") stack.pop();
      const owner = top();
      if (owner.kind === "chain") owner.expectKey = owner.root;
    } else if (c === ".") {
      const owner = top();
      if (owner.kind === "chain") owner.expectKey = true;
    } else if (c === ";") {
      const owner = top();
      if (owner.kind === "chain" && owner.root) owner.expectKey = true;
    } else if (c === "[" || c === "{") {
      const slot = valueSlot(t);
      const path = slot ? slot.path : t.path;
      const key = slot ? slot.key : "";
      if (c === "[") stack.push({ kind: "list", path, key });
      else
        stack.push({
          kind: "object",
          path: [...path, key].filter(Boolean),
          key: null,
          afterColon: false,
        });
      pendingKey = null;
    } else if (c === "]" || c === "}") {
      if (t.kind === "chain" && !t.root) stack.pop();
      if (stack.length > 1) stack.pop();
      const owner = top();
      if (owner.kind === "chain") owner.expectKey = owner.root;
    } else if (c === ":") {
      if (t.kind === "object") {
        t.key = pendingKey;
        t.afterColon = true;
      }
      pendingKey = null;
    } else if (c === ",") {
      if (t.kind === "chain" && !t.root) stack.pop();
      const owner = top();
      if (owner.kind === "object") {
        owner.afterColon = false;
        owner.key = null;
      }
      pendingKey = null;
    }
  }

  // A word being typed sits on the stack as a pending key: the position is the one before it.
  const t = top();
  const typing = !inString && /[\w$-]$/.test(text);
  if (t.kind === "chain") {
    const atKey = t.expectKey || (typing && pendingKey !== null);
    return {
      path: t.path,
      inKey: atKey,
      valueOf: null,
      inSeqItem: false,
      inString,
    };
  }
  if (t.kind === "object")
    return t.afterColon
      ? {
          path: t.path,
          inKey: false,
          valueOf: t.key,
          inSeqItem: false,
          inString,
        }
      : {
          path: t.path,
          inKey: true,
          valueOf: null,
          inSeqItem: false,
          inString,
        };
  if (t.kind === "list")
    return {
      path: [...t.path, t.key],
      inKey: true,
      valueOf: null,
      inSeqItem: true,
      inString,
    };
  return {
    path: t.path,
    inKey: false,
    valueOf: t.key || null,
    inSeqItem: false,
    inString,
  };
}
