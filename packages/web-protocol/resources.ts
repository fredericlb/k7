// resources.ts — one EXTERNAL RESOURCE of a project as the browser lists it: a clip the user
// imported, audio or video, ready to preview and to place again. What a reader gets wrong: the
// unit is the CLIP (`clips/<id>.k7x`), not the file — a lane places a clip by id, never a path.

export interface ProjectResource {
  /** The clip's id, its filename: what `event add` and `picture add` place. */
  id: string;
  kind: "audio" | "video";
  /** The media file, workspace-relative — what `mediaUrl` serves. */
  source: string;
  /** For a video, the lighter copy a browser plays when there is one, workspace-relative. */
  preview?: string;
  /** The media file's size in bytes; 0 when it cannot be read. */
  bytes: number;
  /** The file is not there: the clip names something gone, and previews nothing. */
  missing?: boolean;
}
