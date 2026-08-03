// freezeWatchdog.ts — turn "the tab froze randomly" into evidence, console only.
//
// A heartbeat catches the stall and says HOW LONG. That is where this stopped, and a duration alone names no
// suspect: "it blocked 3.7 s" is the same sentence whether React committed a huge tree, a message handler chewed
// through a payload, or the browser paused us. So the stall report now also says WHAT — the long tasks that fell
// inside the window, the React commits that landed in it, and whatever the app had told us it was doing.
//
// Imported for its side effects from main.tsx; safe to keep on. The probes cost microseconds, the breadcrumb ring
// is fixed-size, and nothing prints until a real stall happens.

const STALL_MS = 250; // heartbeat overshoot above this == a stall worth reporting
const LONGTASK_MS = 200; // report long tasks at least this long
const COMMIT_MS = 50; // React commits worth remembering
const RING = 64; // breadcrumbs kept, per kind

let installed = false;

interface Span {
  name: string;
  start: number;
  end: number; // still open == Number.POSITIVE_INFINITY
}

const longTasks: Span[] = [];
const commits: Span[] = [];
const activities: Span[] = [];
// Stretches where the page was HIDDEN. A backgrounded tab has its timers throttled — Chrome clamps them hard, and
// a sleeping machine stops them altogether — so the heartbeat comes back to a huge gap that was never a freeze.
// Reporting those as stalls is worse than not reporting: it is a false lead with a number on it.
const hidden: Span[] = [];
let longTaskObs: PerformanceObserver | null = null;

function push(ring: Span[], s: Span): void {
  ring.push(s);
  if (ring.length > RING) ring.shift();
}

/** Spans overlapping [from, to], longest first. An OPEN span counts: it was in flight across the stall. */
function overlapping(ring: Span[], from: number, to: number): Span[] {
  return ring
    .filter((s) => s.start <= to && s.end >= from)
    .sort(
      (a, b) => Math.min(b.end, to) - b.start - (Math.min(a.end, to) - a.start),
    );
}

const ms = (s: Span, to: number) => Math.round(Math.min(s.end, to) - s.start);

/**
 * Mark what the app is doing, so a stall can name it. Returns the closer; call it in a `finally`.
 *
 * Deliberately coarse — the message type, the endpoint — because the point is to halve the search space, not to
 * profile. A span left open (the code threw, or never finished) is the most useful shape of all: it is exactly
 * the thing that was still running when everything stopped.
 */
export function beginActivity(name: string): () => void {
  const span: Span = {
    name,
    start: performance.now(),
    end: Number.POSITIVE_INFINITY,
  };
  push(activities, span);
  return () => {
    span.end = performance.now();
  };
}

/** Wrap a synchronous call in a breadcrumb. */
export function activity<T>(name: string, fn: () => T): T {
  const done = beginActivity(name);
  try {
    return fn();
  } finally {
    done();
  }
}

/** React's Profiler callback, for main.tsx. Only slow commits are kept. */
export function reportCommit(
  id: string,
  phase: string,
  actualDuration: number,
  _baseDuration: number,
  startTime: number,
  commitTime: number,
): void {
  if (actualDuration < COMMIT_MS) return;
  push(commits, { name: `${id} ${phase}`, start: startTime, end: commitTime });
}

export function installFreezeWatchdog(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // Heartbeat: setInterval doesn't fire while the thread is busy, so a 4s freeze shows as a ~4s gap on the next tick.
  const PERIOD = 1000;
  let last = performance.now();
  window.setInterval(() => {
    const now = performance.now();
    const overshoot = now - last - PERIOD;
    const from = last + PERIOD;
    last = now;
    if (overshoot <= STALL_MS) return;

    // A hidden page is not a frozen one. Throttled timers produce exactly the same gap, and the gap is the only
    // thing the heartbeat can see — so the visibility record is what tells the two apart.
    if (overlapping(hidden, from, now).length) return;

    // Drain the observer BEFORE reading the ring. Its callback and this interval are both tasks queued after the
    // long task ended, in no guaranteed order — so the ring could still be empty for a stall the browser has
    // already measured, and the report would say "nothing on the main thread" about our own 5s of JS. That is not
    // a missing detail, it is the wrong conclusion, which is the one thing an instrument must not produce.
    for (const e of longTaskObs?.takeRecords() ?? [])
      push(longTasks, {
        name: taskName(e),
        start: e.startTime,
        end: e.startTime + e.duration,
      });

    const lines: string[] = [];
    const add = (label: string, ring: Span[]) => {
      for (const s of overlapping(ring, from, now).slice(0, 4))
        lines.push(
          `    ${label} ${ms(s, now)}ms  ${s.name}` +
            (s.end === Number.POSITIVE_INFINITY ? "  (still running)" : ""),
        );
    };
    add("longtask", longTasks);
    add("commit  ", commits);
    add("activity", activities);
    // Heap size when the browser offers it (Chromium only). A stall with no task behind it is often a major GC,
    // and a heap climbing towards the limit is the difference between "the browser paused us" and "we made it".
    const mem = (
      performance as Performance & {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
      }
    ).memory;
    if (mem)
      lines.push(
        `    heap      ${(mem.usedJSHeapSize / 1048576).toFixed(0)}MB of ` +
          `${(mem.jsHeapSizeLimit / 1048576).toFixed(0)}MB`,
      );
    console.warn(
      `⏱️ [freeze] main thread blocked ~${Math.round(overshoot)}ms ` +
        `(at ${new Date().toLocaleTimeString()})` +
        // No breadcrumb at all is itself a finding: the thread was taken from us rather than spent by us — GC, a
        // browser-level pause, an extension, or a blocking dialog. Do not go looking in the app for that one.
        (lines.length
          ? `\n${lines.join("\n")}`
          : "\n    (nothing on the main thread — not ours to fix in JS)"),
    );
  }, PERIOD);

  // Visibility, so a throttled background tab is never reported as a stall.
  let hiddenSince =
    document.visibilityState === "hidden" ? performance.now() : 0;
  if (hiddenSince)
    push(hidden, { name: "hidden", start: 0, end: Number.POSITIVE_INFINITY });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenSince = performance.now();
      push(hidden, {
        name: "hidden",
        start: hiddenSince,
        end: Number.POSITIVE_INFINITY,
      });
    } else if (hiddenSince) {
      const open = hidden[hidden.length - 1];
      if (open) open.end = performance.now();
      hiddenSince = 0;
    }
  });

  // Long tasks: the browser's own measure of a blocking chunk. Attribution is thin, but the timing pins the stall.
  try {
    longTaskObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        push(longTasks, {
          name: taskName(e),
          start: e.startTime,
          end: e.startTime + e.duration,
        });
        if (e.duration >= LONGTASK_MS)
          console.warn(
            `🧱 [longtask] ${Math.round(e.duration)}ms ${taskName(e)}`,
          );
      }
    });
    longTaskObs.observe({ entryTypes: ["longtask"] });
  } catch {
    /* longtask timing not supported in this browser — the heartbeat still works */
  }
}

function taskName(e: PerformanceEntry): string {
  const attr = (
    e as PerformanceEntry & {
      attribution?: {
        name?: string;
        containerType?: string;
        containerSrc?: string;
      }[];
    }
  ).attribution?.[0];
  return (
    [attr?.name, attr?.containerType, attr?.containerSrc]
      .filter(Boolean)
      .join(" ") ||
    e.name ||
    "unattributed"
  );
}
