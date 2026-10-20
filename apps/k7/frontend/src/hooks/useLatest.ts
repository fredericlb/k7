// useLatest.ts — a ref that always holds this render's value, for a listener or a timer that must
// read the current props without being rebuilt every time they change.

import { type RefObject, useRef } from "react";

export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
