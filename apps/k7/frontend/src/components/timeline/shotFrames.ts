// shotFrames.ts — the still frames an expanded picture lane draws along each shot, grabbed by
// seeking one hidden <video> per source, one seek at a time, and kept as small bitmaps.
// What a reader gets wrong: the grabs are SERIAL per source on purpose — a seek interrupts the
// one before it, so parallel requests on one element would all land on the last time asked.
// Caps and timing: docs/picture.md, "Frames on an expanded lane".

/** Frame height in pixels of every cached bitmap, whatever the lane draws it at. */
const GRAB_H = 72;
/** Source times are rounded to this, so a zoom or a small drag reuses the frames already held. */
const STEP_SEC = 0.1;
const MAX_BITMAPS = 600;
const MAX_ELEMENTS = 4;

interface Source {
  el: HTMLVideoElement;
  ready: Promise<boolean>;
  queue: Promise<unknown>;
}

const bitmaps = new Map<string, Promise<ImageBitmap | null>>();
const sources = new Map<string, Source>();
const aspects = new Map<string, number>();

const remember = <T>(
  m: Map<string, T>,
  key: string,
  v: T,
  cap: number,
  drop: (v: T) => void,
) => {
  m.set(key, v);
  while (m.size > cap) {
    const [k, old] = m.entries().next().value as [string, T];
    m.delete(k);
    drop(old);
  }
};

const dropBitmap = (p: Promise<ImageBitmap | null>) =>
  void p.then((b) => b?.close());

const dropSource = (s: Source) => {
  s.el.removeAttribute("src");
  s.el.load();
};

function sourceOf(url: string): Source {
  const held = sources.get(url);
  if (held) {
    // Most recently used goes last, so the cap drops the coldest one.
    sources.delete(url);
    sources.set(url, held);
    return held;
  }
  const el = document.createElement("video");
  el.muted = true;
  el.playsInline = true;
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  const ready = new Promise<boolean>((done) => {
    el.addEventListener("loadeddata", () => done(true), { once: true });
    el.addEventListener("error", () => done(false), { once: true });
  });
  el.src = url;
  const s: Source = { el, ready, queue: Promise.resolve() };
  remember(sources, url, s, MAX_ELEMENTS, dropSource);
  void ready.then((ok) => {
    if (ok && el.videoHeight) aspects.set(url, el.videoWidth / el.videoHeight);
  });
  return s;
}

async function seekAndGrab(
  s: Source,
  sec: number,
): Promise<ImageBitmap | null> {
  if (!(await s.ready)) return null;
  const { el } = s;
  const end = Number.isFinite(el.duration) ? el.duration : sec;
  const at = Math.max(0, Math.min(sec, end - 0.05));
  if (Math.abs(el.currentTime - at) > 0.01) {
    // A seek that never lands (a released element, a broken file) must not stall the queue behind it.
    const landed = await new Promise<boolean>((done) => {
      const t = setTimeout(() => done(false), 3000);
      el.addEventListener(
        "seeked",
        () => {
          clearTimeout(t);
          done(true);
        },
        { once: true },
      );
      el.currentTime = at;
    });
    if (!landed) return null;
  }
  if (!el.videoHeight) return null;
  const h = GRAB_H;
  const w = Math.round((h * el.videoWidth) / el.videoHeight);
  return createImageBitmap(el, { resizeWidth: w, resizeHeight: h }).catch(
    () => null,
  );
}

async function grabStill(url: string): Promise<ImageBitmap | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  aspects.set(url, img.naturalWidth / img.naturalHeight);
  return createImageBitmap(img, {
    resizeHeight: GRAB_H,
    resizeWidth: Math.round((GRAB_H * img.naturalWidth) / img.naturalHeight),
  }).catch(() => null);
}

/** The source time a request lands on, rounded so neighbouring asks share one frame. */
export const frameTime = (sec: number) =>
  Math.max(0, Math.round(sec / STEP_SEC) * STEP_SEC);

/** One frame of `url` at `sec` (a still ignores `sec`), or null when it cannot be decoded. */
export function frameAt(
  url: string,
  sec: number,
  still: boolean,
): Promise<ImageBitmap | null> {
  const key = still ? url : `${url}@${frameTime(sec).toFixed(1)}`;
  const held = bitmaps.get(key);
  if (held) return held;
  let p: Promise<ImageBitmap | null>;
  if (still) p = grabStill(url);
  else {
    const s = sourceOf(url);
    p = s.queue.then(() => seekAndGrab(s, frameTime(sec)));
    s.queue = p.catch(() => null);
  }
  remember(bitmaps, key, p, MAX_BITMAPS, dropBitmap);
  return p;
}

/** Width over height of a source already opened, 16:9 until it is known. */
export const aspectOf = (url: string) => aspects.get(url) ?? 16 / 9;
