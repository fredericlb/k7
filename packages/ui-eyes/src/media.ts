// media.ts — the pictures realtime draws WITHOUT a <video>: a still's image, decoded once per
// src, and a subtitle clip's cue, set once per cue. Neither has a clock to chase, so neither
// claims an element or a decoder. Kept apart from realtime.ts, which is about the elements that
// do. See docs/realtime.md and song-video/docs/titles.md.

import { CaptionFrames } from "./captionFrames";
import type { SceneClip } from "./scene";

export class StaticMedia {
  private images = new Map<string, HTMLImageElement>();
  private captions: CaptionFrames;

  constructor(vw: number, vh: number) {
    this.captions = new CaptionFrames(vw, vh);
  }

  /** A new scene: captions are drawn again, since their cues may have changed under the same src; stills stay decoded. */
  reset(vw: number, vh: number): void {
    this.captions = new CaptionFrames(vw, vh);
  }

  /** Is this a clip drawn here, rather than decoded by an element? */
  static owns(clip: SceneClip): boolean {
    return !!clip.still || !!clip.captions;
  }

  /** What `clip` shows at `sourceTime`, or null — a still not decoded yet, or a caption between cues. */
  picture(clip: SceneClip, sourceTime: number): TexImageSource | null {
    if (clip.captions)
      return this.captions.frame(clip.src, clip.captions, sourceTime);
    return this.image(clip.src);
  }

  // A still's image, loaded once per src; null until it has decoded, so the lane shows nothing rather than a blank.
  private image(src: string): HTMLImageElement | null {
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.src = src;
      this.images.set(src, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
}
