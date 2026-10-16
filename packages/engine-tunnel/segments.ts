// segments.ts — whether one segment of a server path may become a file name on the engine's
// machine. The twin of `safeSegment` in engine/k7-supervisor/src/PathMap.cpp, case for case: a
// server path is joined under a local root, and a segment either side refuses must not open here.

/** Windows opens a DEVICE for these whatever follows the first dot, and a copy made on Linux reaches Windows. */
export function reservedDeviceName(seg: string): boolean {
  const dot = seg.indexOf(".");
  const base = (dot < 0 ? seg : seg.slice(0, dot))
    .replace(/ +$/, "")
    .replace(/[a-z]/g, (c) => c.toUpperCase());
  if (["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].includes(base))
    return true;
  if (!base.startsWith("COM") && !base.startsWith("LPT")) return false;
  const n = base.slice(3);
  return /^[0-9]$/.test(n) || n === "¹" || n === "²" || n === "³";
}

/** One segment that names a file under its root and nothing else; `windows` adds the trailing dot and space Windows trims. */
export function safeSegment(
  seg: string,
  windows: boolean = process.platform === "win32",
): boolean {
  if (reservedDeviceName(seg)) return false;
  // Dots and spaces alone are refused whole: Windows trims `.. ` to `..`, and `...` names nothing anywhere.
  if (/^[. ]*$/.test(seg)) return false;
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c === 0x2f || c === 0x5c || c === 0x3a)
      return false;
  }
  if (windows && /[. ]$/.test(seg)) return false;
  return true;
}
