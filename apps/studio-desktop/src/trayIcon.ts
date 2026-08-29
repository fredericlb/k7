// trayIcon.ts — iconRaster's bytes as cached NativeImages. Two traps, both seductive:
// nativeImage CANNOT rasterise SVG (createFromPath on an .svg returns an empty image), and
// setTemplateImage(true) uses the image as a MASK — it would tint the mark correctly in both
// appearances and collapse every status colour to one grey silhouette, so running and stopped
// would look identical. The manual dark flip stays. See docs/trayIcon.md.

import { type NativeImage, nativeImage } from "electron";
import { type IconState, renderIcon } from "./iconRaster.ts";

/**
 * Menu-bar sizes. macOS wants 22pt, which is 44 at @2x; Windows' notification area is a 16pt
 * slot the compositor scales, and handing it 44 closes the badge's cleared ring so the badge
 * merges into the note head.
 */
const SIZE: Record<string, { n: number; scale: number }> = {
  darwin: { n: 44, scale: 2 },
  win32: { n: 32, scale: 2 },
  linux: { n: 44, scale: 2 },
};

const { n, scale } = SIZE[process.platform] ?? SIZE.darwin;

// 13 states × 2 appearances × 2 attention = 52 entries, built lazily. After one spinner cycle
// nothing is computed at all, which is what makes an 8fps animation free.
const cache = new Map<string, NativeImage>();

const key = (s: IconState, dark: boolean, attention: boolean): string =>
  `${s.kind}:${s.kind === "loading" ? s.frame : 0}:${dark}:${attention}`;

/** The icon for one state, cached. */
export function trayImage(
  state: IconState,
  dark: boolean,
  attention: boolean,
): NativeImage {
  const k = key(state, dark, attention);
  const hit = cache.get(k);
  if (hit) return hit;
  const img = nativeImage.createFromBuffer(
    renderIcon(state, dark, attention, n),
    {
      width: n,
      height: n,
      scaleFactor: scale,
    },
  );
  cache.set(k, img);
  return img;
}
