// editors.ts — the commands that OPEN something to edit: a file in the editor, a sequence's
// grid, a take's review, a module or an assembly in its builder, a curve, a tap's chain. Those
// under `ui` only open; the bare ones open an editor that writes to what they name.

import { api } from "../../api";
import { newCurveName, type ParamKind } from "../../curveDraft";
import { resolveModuleFile } from "../../localTargets";
import { describeDownload, followDownload } from "../../modelDownload";
import { m } from "../../paraglide/messages.js";
import { trackPlacing } from "../../rows";
import { resolveSequence, type SeqView } from "../../sequenceEdit";
import type { LocalCommand } from "./context";

/** `<node> <param>`, the param quoted when it holds a space. */
const NODE_PARAM = /^(\S+)\s+(?:"([^"]*)"|(.+))$/;

/** `sequence edit roll|tracker <sequence>` — the sequence's notes where the graph is. */
const seqEdit = (
  view: SeqView,
  readable: { en: string; fr: string },
): LocalCommand => ({
  name: `sequence edit ${view}`,
  readable,
  args: [
    { name: "sequence", kind: "file", hint: "a sequence of this project" },
  ],
  match: "names",
  run: (ctx, rest) => {
    const name = rest.trim();
    const path = resolveSequence(name, ctx.editorRef.current?.files() ?? []);
    if (!name)
      ctx.setStatus(
        m["status.usage"]({ syntax: `sequence edit ${view} <sequence>` }),
      );
    else if (!path) ctx.setStatus(m["status.noSequence"]({ name }));
    else ctx.openEvent({ kind: "grid", path, view });
    return true;
  },
});

/** A command that opens its argument in the editor, by path or fuzzy name. */
const opensFile = (
  name: string,
  readable: { en: string; fr: string },
  arg: { name: string; hint: string },
): LocalCommand => ({
  name,
  readable,
  args: [{ name: arg.name, kind: "file", hint: arg.hint }],
  run: (ctx, rest) => {
    ctx.openInEditor(rest.trim());
    return true;
  },
});

export const EDITOR_COMMANDS: LocalCommand[] = [
  opensFile(
    "ui file",
    {
      en: "Open a file of this project in the editor",
      fr: "Ouvrir un fichier de ce projet dans l'éditeur",
    },
    { name: "path", hint: "a file of this project" },
  ),
  // The name fuzzy-resolves to sequences/<id>.yaml or clips/<id>.yaml — `e` on a clip.
  opensFile(
    "ui edit sequence",
    {
      en: "Open a MIDI sequence in the editor",
      fr: "Ouvrir une séquence MIDI dans l'éditeur",
    },
    { name: "name", hint: "a sequence of this project" },
  ),
  opensFile(
    "ui edit clip",
    {
      en: "Open an audio clip's file in the editor",
      fr: "Ouvrir le fichier d'un clip audio dans l'éditeur",
    },
    { name: "name", hint: "a clip of this project" },
  ),
  // Bare-named: they open an editor that WRITES to the sequence they name.
  seqEdit("roll", {
    en: "Show a sequence's notes as a piano roll",
    fr: "Afficher les notes d'une séquence en piano roll",
  }),
  seqEdit("tracker", {
    en: "Show a sequence's notes as a tracker",
    fr: "Afficher les notes d'une séquence en tracker",
  }),
  {
    // Reopens the take review on a clip; the lane is looked up rather than asked for (docs/clipEditors.md).
    name: "ui review",
    readable: {
      en: "Reopen the take review on a clip",
      fr: "Rouvrir la relecture d'une prise",
    },
    args: [
      { name: "clip", kind: "file", hint: "a clip of this project — a take" },
    ],
    run: (ctx, rest) => {
      const clip = rest.trim();
      if (!clip) {
        ctx.setStatus(m["status.usage"]({ syntax: "ui review <clip>" }));
        return true;
      }
      ctx.setReviewOn({ clip, track: trackPlacing(ctx.projectDoc, clip) });
      // …and the clip panel on screen: it is the ONE place a clip is drawn.
      ctx.openEvent({ kind: "recording" });
      return true;
    },
  },
  {
    // The shared builder over the shell, on the MODULE file of the trio.
    name: "ui builder",
    readable: {
      en: "Edit a module in the builder",
      fr: "Modifier un module dans le constructeur",
    },
    args: [
      { name: "module", kind: "module", hint: "a module of this project" },
    ],
    run: (ctx, rest) => {
      const arg = rest.trim();
      const path = resolveModuleFile(arg, ctx.editorRef.current?.files() ?? []);
      if (!path) ctx.setStatus(m["status.noModule"]({ name: arg }));
      else void ctx.openModuleBuilder(path, "module");
      return true;
    },
  },
  {
    // An assembly TEMPLATE, by its ref; the PATH is the file service's to give, never one built here.
    name: "ui assembly",
    readable: {
      en: "Open an assembly template in the builder",
      fr: "Ouvrir un modèle d'assemblage dans le constructeur",
    },
    args: [
      {
        name: "ref",
        kind: "module",
        hint: "an assembly template the library holds (@k7-core/<path>)",
      },
    ],
    run: (ctx, rest) => {
      const ref = rest.trim();
      void api
        .libraryAssemblies()
        .then(({ assemblies }) => {
          const hit = assemblies.find((a) => a.ref === ref);
          if (!hit) {
            ctx.setStatus(m["status.noAssemblyTemplate"]({ ref }));
            return;
          }
          ctx.setAssemblyBuilder({ file: hit.file, folder: hit.path });
        })
        .catch((e: Error) => ctx.setStatus(e.message, "error"));
      return true;
    },
  },
  {
    // The right-click's "Download model", followed on the status line; the graph re-read at the end drops the menu entry.
    name: "ui model",
    readable: {
      en: "Download the model a node's module needs",
      fr: "Télécharger le modèle dont le module d'un nœud a besoin",
    },
    args: [
      {
        name: "node",
        kind: "module",
        hint: "a node whose module names a model",
      },
    ],
    run: (ctx, rest) => {
      const node = rest.trim();
      void api
        .downloadModel(node)
        .then(async ({ job }) => {
          if (!job) {
            ctx.setStatus(m["status.modelAlreadyHere"]({ node }));
            return;
          }
          const end = await followDownload(job, api.modelDownload, (j) =>
            ctx.setStatus(describeDownload(j)),
          );
          if (!end.error) ctx.bumpReload();
        })
        .catch((e: Error) => ctx.setStatus(e.message, "error"));
      return true;
    },
  },
  {
    // Bare, the editor on a NEW curve; with a name, on that one, read off the graph's own curves (docs/curveEditor.md).
    name: "ui curve",
    readable: {
      en: "Create or edit an automation curve",
      fr: "Créer ou modifier une courbe d'automation",
    },
    args: [
      {
        name: "curve",
        kind: "file",
        optional: true,
        hint: "a curve of this project — none for a new one",
      },
    ],
    match: "names",
    run: (ctx, rest) => {
      const name = rest.trim();
      if (!name) {
        ctx.setCurveEdit({ name: newCurveName(), isNew: true });
        return true;
      }
      void api
        .graph()
        .then((g) => {
          const spec = g.curves?.[name]?.spec;
          if (spec) ctx.setCurveEdit({ name, isNew: false, spec });
          else ctx.setStatus(m["status.noCurve"]({ name }));
        })
        .catch((e) =>
          ctx.setStatus(
            m["status.curveFailed"]({ message: (e as Error).message }),
            "error",
          ),
        );
      return true;
    },
  },
  {
    // The editor on the curve that control is bound to, or on a new one to bind — a widget's right-click.
    name: "ui automate",
    readable: {
      en: "Automate a parameter with a curve",
      fr: "Automatiser un paramètre avec une courbe",
    },
    args: [
      { name: "node", kind: "module", hint: "a node of this project" },
      { name: "param", kind: "text", hint: "the name its widget binds" },
    ],
    run: (ctx, rest) => {
      const hit = NODE_PARAM.exec(rest.trim());
      if (!hit) {
        ctx.setStatus(
          m["status.usageExample"]({
            syntax: "ui automate <node> <param>",
            example: 'ui automate synth "Filter Freq"',
          }),
        );
        return true;
      }
      const node = hit[1];
      const param = (hit[2] ?? hit[3] ?? "").trim();
      void api
        .graph()
        .then((g) => {
          const step = Object.values(g.chains)
            .flatMap((c) => c.use)
            .find((u) => u.module === node);
          const events = step?.events ?? [];
          const bound = step?.automations?.find((a) => a.param === param);
          const spec = bound ? g.curves?.[bound.curve]?.spec : undefined;
          // A toggle or a button drives a BOOLEAN, which follows an on/off curve; any other control a number.
          const widget = Object.values(step?.ui?.widgets ?? {}).find(
            (w) => w.bind === param,
          );
          const kind: ParamKind =
            widget?.type === "toggle" ||
            widget?.type === "button" ||
            spec?.type === "onoff"
              ? "boolean"
              : "number";
          ctx.setCurveEdit(
            bound && spec
              ? { name: bound.curve, isNew: false, spec, events, kind }
              : {
                  name: newCurveName(),
                  isNew: true,
                  events,
                  kind,
                  bind: { node, param },
                },
          );
        })
        .catch((e) =>
          ctx.setStatus(
            m["status.automateFailed"]({ message: (e as Error).message }),
            "error",
          ),
        );
      return true;
    },
  },
  {
    // The popin on that tap's own chain — a pad's right-click; names with a space arrive quoted.
    name: "ui tap chain",
    readable: {
      en: "Edit a tap's own chain of effects",
      fr: "Modifier la chaîne d'effets d'un pad",
    },
    args: [
      { name: "node", kind: "module", hint: "a rack node of this project" },
      { name: "tap", kind: "text", hint: "one of its taps — BD, Snare…" },
    ],
    run: (ctx, _rest, lower) => {
      const [node, tap] = [...lower.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map(
        (w) => (w[1] !== undefined ? JSON.parse(`"${w[1]}"`) : w[2]),
      );
      if (!node || !tap)
        ctx.setStatus(
          m["status.usage"]({ syntax: "ui tap chain <node> <tap>" }),
        );
      else ctx.setTapChain({ node, tap });
      return true;
    },
  },
  {
    // Web-local because the building is the browser's; the create writes through the file routes.
    name: "module create rack",
    readable: {
      en: "Build a samples rack on a pad grid",
      fr: "Construire un rack de samples sur une grille",
    },
    run: (ctx) => {
      ctx.setRackBuilder(true);
      return true;
    },
  },
];
