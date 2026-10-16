// project.ts — the bare-named project verbs the shell answers itself, because each writes
// through a ROUTE or from state only this browser holds: the undo journal, the master meter's
// fix, the mixdown and the cut, the k7 publish and the share link, an import.

import { sceneOf as videoSceneOf } from "@studio/k7-plugins/video";
import { runRedo, runUndo } from "@studio/project-shell/undo";
import { EXPORT_USAGE, parseExportAsk } from "../../exportArgs";
import { resolveEntry } from "../../localTargets";
import { m } from "../../paraglide/messages.js";
import type { LocalCommand } from "./context";

export const PROJECT_COMMANDS: LocalCommand[] = [
  // Ctrl+Z / Ctrl+Y as commands: the project-wide journal, the editor's own buffer history staying with the keys.
  {
    name: "project undo",
    readable: {
      en: "Undo the last change",
      fr: "Annuler la dernière modification",
    },
    run: (ctx) => {
      void runUndo(ctx.historyDeps);
      return true;
    },
  },
  {
    name: "project redo",
    readable: {
      en: "Redo the change you took back",
      fr: "Rétablir la modification annulée",
    },
    run: (ctx) => {
      void runRedo(ctx.historyDeps);
      return true;
    },
  },
  {
    // The Fix button as a verb; local, because the trim comes from a peak only this browser saw (docs/masterMeter.md).
    name: "project master fix",
    readable: {
      en: "Lower the output until the last pass fits",
      fr: "Baisser la sortie pour rentrer le dernier passage",
    },
    // Optional, and the blank is the ordinary answer: a number is for another tab, or a CLI.
    args: [
      {
        name: "peak",
        kind: "number",
        optional: true,
        hint: "the pass's peak in dB — the header meter's own when left blank",
      },
    ],
    match: "names",
    run: (ctx, rest) => {
      const arg = rest.trim();
      const given = arg ? Number(arg) : null;
      if (given !== null && !Number.isFinite(given)) {
        ctx.setStatus(m["master.notADb"]({ arg }));
        return true;
      }
      const pass = ctx.masterMeterRef.current?.pass();
      if (given === null && !pass?.offered) {
        ctx.setStatus(
          pass ? m["master.nothingToFix"]() : m["master.noMeter"](),
        );
        return true;
      }
      ctx.masterMeterRef.current?.take();
      void ctx.fixClipping(given ?? (pass?.peak as number));
      return true;
    },
  },
  {
    // Which HALF of the project leaves is the first word — see exportArgs.ts.
    name: "project export",
    readable: {
      en: "Download the mixdown, the picture, or the cut",
      fr: "Télécharger le mixage, l'image ou le montage",
    },
    args: [
      { name: "what", kind: "choice", hint: "audio · video · timeline" },
      {
        name: "format",
        kind: "choice",
        hint: "wav · mp3 · webm · mp4 · otio · edl",
      },
      {
        name: "sound",
        kind: "choice",
        hint: "the video's audio — wav · mp3 · none",
      },
    ],
    match: "names",
    run: (ctx, rest) => {
      const ask = parseExportAsk(rest);
      const name = ctx.projectDoc?.name;
      if (!ask) ctx.setStatus(EXPORT_USAGE);
      else if (ask.kind === "audio") void ctx.share.exportMix(ask.format);
      else if (ask.kind === "timeline")
        void ctx.share.exportTimeline(
          ctx.ws?.activeProject ?? ".",
          ask.format,
          ask.lane,
          name ?? "cut",
          ctx.runCommand,
        );
      else
        void ctx.share.exportVideo(
          ctx.videoDoc ? videoSceneOf(ctx.videoDoc, null, "export") : null,
          ask.format,
          ask.audio,
          name ?? "video",
          ask.settings,
        );
      return true;
    },
  },
  {
    name: "project share k7",
    readable: {
      en: "Publish this song to k7",
      fr: "Publier ce morceau sur k7",
    },
    run: (ctx) => {
      void ctx.share.shareK7();
      return true;
    },
  },
  {
    name: "project share link",
    readable: {
      en: "Share a frozen copy by link",
      fr: "Partager une copie gelée par lien",
    },
    run: (ctx) => {
      void ctx.share.shareLink();
      return true;
    },
  },
  {
    // The dialog reports what the translation did and then offers to open the result.
    name: "project import",
    readable: {
      en: "Import a .dawproject, an .als or an Ableton .zip",
      fr: "Importer un .dawproject, un .als ou un .zip Ableton",
    },
    args: [
      {
        name: "path",
        kind: "file",
        hint: "a .dawproject, .als or Ableton .zip of this workspace",
      },
    ],
    match: "names",
    run: (ctx, rest) => {
      const arg = rest.trim();
      const path = arg
        ? resolveEntry(arg, ctx.editorRef.current?.entries() ?? [])
        : null;
      if (!path)
        ctx.setStatus(
          "usage: project import <a .dawproject, .als or Ableton .zip of this workspace>",
        );
      else ctx.imp.askImport(path);
      return true;
    },
  },
];
