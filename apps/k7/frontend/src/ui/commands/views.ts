// views.ts — the shell's PAGE commands: which pane is up, the bottom panel, the popins over
// them, and the footer's toggles. All `ui`: none of them touches the project or the transport.

import { externalUrl, parseLaunch } from "@studio/project-shell/launch";
import { m } from "../../paraglide/messages.js";
import { closeTopPopin } from "../../popins";
import type { Pane, Panel } from "../../routes";
import { PANEL_META, PANES } from "../../shellMeta";
import type { LocalCommand } from "./context";

const PANE_READABLE: Record<Pane, { en: string; fr: string }> = {
  editor: {
    en: "Fullscreen the editor",
    fr: "Passer l'éditeur en plein écran",
  },
  timeline: {
    en: "Fullscreen the timeline",
    fr: "Passer la timeline en plein écran",
  },
  turntables: {
    en: "Fullscreen the DJ desk",
    fr: "Passer le pupitre DJ en plein écran",
  },
  mastering: {
    en: "Fullscreen the master strip",
    fr: "Passer le pupitre de mastering en plein écran",
  },
  chains: {
    en: "Fullscreen the chains graph",
    fr: "Passer le graphe des chaînes en plein écran",
  },
};

export const VIEW_COMMANDS: LocalCommand[] = [
  {
    name: "ui global",
    readable: {
      en: "Back to the project's home page",
      fr: "Revenir à la page d'accueil du projet",
    },
    run: (ctx) => {
      // There is no split to return to; the panel closes as on any page change.
      if (ctx.full !== ctx.homePane) ctx.setPanel(null);
      ctx.setFull(null);
      return true;
    },
  },
  // `fullscreen` decides whether this layout has the pane, as it does for the buttons and the number keys.
  ...PANES.map(
    (p): LocalCommand => ({
      name: `ui ${p}`,
      readable: PANE_READABLE[p],
      run: (ctx) => {
        ctx.fullscreen(p);
        return true;
      },
    }),
  ),
  {
    // The frame is a WINDOW over the layout, so its command shows or hides it rather than fullscreening anything.
    name: "ui viewport",
    readable: {
      en: "Show or hide the picture window",
      fr: "Afficher ou masquer la fenêtre de l'image",
    },
    run: (ctx) => {
      if (!ctx.hasViewport) ctx.setStatus(m["status.noViewport"]());
      else ctx.setViewportWindow((cur) => ({ open: !cur.open }));
      return true;
    },
  },
  {
    // One page on screen, so walking the keys' owner IS walking the pages.
    name: "ui focus next",
    readable: {
      en: "Move the keyboard to the next pane",
      fr: "Donner le clavier au panneau suivant",
    },
    run: (ctx) => {
      const i = ctx.ringPanes.indexOf(ctx.full);
      ctx.fullscreen(ctx.ringPanes[(i + 1) % ctx.ringPanes.length]);
      return true;
    },
  },
  {
    name: "ui close",
    readable: { en: "Close the bottom panel", fr: "Fermer le panneau du bas" },
    run: (ctx) => {
      ctx.setPanel(null);
      return true;
    },
  },
  {
    // Whoever registered the topmost overlay; with nothing open the line asks for what is already true.
    name: "ui popin close",
    readable: {
      en: "Close the overlay in front",
      fr: "Fermer la fenêtre au premier plan",
    },
    run: () => {
      closeTopPopin();
      return true;
    },
  },
  {
    // Escape and the footer's panel button do exactly this.
    name: "ui slot close",
    readable: {
      en: "Show the chains graph again",
      fr: "Réafficher le graphe des chaînes",
    },
    run: (ctx) => {
      ctx.closeEvent();
      return true;
    },
  },
  {
    name: "ui help",
    readable: {
      en: "Show the help: commands, keys and file syntax",
      fr: "Afficher l'aide : commandes, touches et syntaxe des fichiers",
    },
    run: (ctx) => {
      if (window.location.hash === "#help") ctx.closeHelp();
      else ctx.openHelp();
      return true;
    },
  },
  {
    // `""` is the LIST — the state `/chains-builder` parses to; typing it again closes.
    name: "ui chains builder",
    readable: {
      en: "Show or hide the library chains builder",
      fr: "Afficher ou masquer le constructeur de chaînes",
    },
    run: (ctx) => {
      ctx.setOpenBuilder((cur) => (cur === null ? "" : null));
      return true;
    },
  },
  {
    name: "ui mixer",
    readable: { en: "Show the mix panel", fr: "Afficher le panneau de mixage" },
    run: (ctx) => {
      ctx.toggleMixer();
      return true;
    },
  },
  {
    name: "ui stack",
    readable: {
      en: "Stack the graph, one column per track",
      fr: "Empiler le graphe, une colonne par piste",
    },
    run: (ctx) => {
      ctx.toggleStack();
      return true;
    },
  },
  {
    name: "ui notes",
    readable: {
      en: "Show or hide the notes on the graph",
      fr: "Afficher ou masquer les notes du graphe",
    },
    run: (ctx) => {
      ctx.toggleDocs();
      return true;
    },
  },
  {
    name: "ui logs clear",
    readable: { en: "Empty the log panel", fr: "Vider le journal" },
    run: (ctx) => {
      ctx.clearLogs();
      return true;
    },
  },
  {
    // The per-track view's toggle: its curve cards shown, beside the cards they drive.
    name: "ui curves",
    readable: {
      en: "Show or hide the curve cards in the per-track graph view",
      fr: "Afficher ou masquer les courbes dans la vue graphe par piste",
    },
    run: (ctx) => {
      ctx.setTrackCurves((v) => !v);
      return true;
    },
  },
  {
    // The footer buttons' own toggle — naming the panel already up closes it.
    name: "ui panel",
    readable: {
      en: "Open a panel at the bottom",
      fr: "Ouvrir un panneau en bas",
    },
    args: [{ name: "panel", kind: "choice", hint: "event · graph · logs" }],
    run: (ctx, _rest, lower) => {
      const want = lower.trim();
      const names = Object.keys(PANEL_META) as Panel[];
      if (!names.includes(want as Panel))
        ctx.setStatus(
          m["status.usage"]({ syntax: `ui panel <${names.join("|")}>` }),
        );
      else ctx.togglePanel(want as Panel);
      return true;
    },
  },
  {
    // Names nothing — every surface is a PANE — and exists only to say so to anyone who read the verb in the docs.
    name: "ui surface",
    readable: {
      en: "Open a surface this project declares",
      fr: "Ouvrir une surface déclarée par le projet",
    },
    args: [
      { name: "surface", kind: "choice", hint: "a surface of this project" },
    ],
    run: (ctx) => {
      ctx.setStatus(m["status.surfaceIsPane"]());
      return true;
    },
  },
  {
    // The link that opens ONE surface on another device; it COPIES rather than navigating (docs/external.md).
    name: "ui external",
    readable: {
      en: "Copy a surface's link, to drive it from another device",
      fr: "Copier le lien d'une surface, pour un autre appareil",
    },
    args: [
      {
        name: "surface",
        kind: "text",
        hint: "a surface this project declares",
      },
    ],
    run: (ctx, rest) => {
      const want = rest.trim();
      const hit = ctx.surfaces.find((x) => x.id === want);
      if (!hit) {
        ctx.setStatus(
          ctx.surfaces.length
            ? m["status.noSurfaceNamed"]({
                surface: want,
                surfaces: ctx.surfaces.map((x) => x.id).join(", "),
              })
            : m["status.noSurfaces"](),
        );
        return true;
      }
      const at = parseLaunch(
        window.location.pathname,
        "k7",
        import.meta.env.BASE_URL,
      );
      // No project in the address: nothing to hang a surface off.
      if (!at) return false;
      const url = externalUrl(window.location.href, at, hit.id, "k7");
      void navigator.clipboard?.writeText(url).catch(() => {});
      ctx.setStatus(url);
      return true;
    },
  },
];
