// panels.ts — the RIGHT-HAND column and the account: each bare line toggles its panel, as its
// button does, while naming a settings TAB always opens and never closes. All `ui`.

import { api } from "../../api";
import type { SettingsTab } from "../../components/SettingsPanel";
import { m } from "../../paraglide/messages.js";
import type { LocalCommand, RightPanelId } from "./context";

const toggle = (
  id: RightPanelId,
  readable: { en: string; fr: string },
): LocalCommand => ({
  name: `ui ${id}`,
  readable,
  run: (ctx) => {
    ctx.toggleRight(id);
    return true;
  },
});

const tab = (
  id: SettingsTab,
  readable: { en: string; fr: string },
): LocalCommand => ({
  name: `ui settings ${id}`,
  readable,
  run: (ctx) => {
    ctx.setSettingsTab(id);
    ctx.setRightPanel("settings");
    return true;
  },
});

export const PANEL_COMMANDS: LocalCommand[] = [
  toggle("settings", {
    en: "Open or close the settings panel",
    fr: "Ouvrir ou fermer le panneau de réglages",
  }),
  tab("editor", {
    en: "Open the editor's settings",
    fr: "Ouvrir les réglages de l'éditeur",
  }),
  tab("io", {
    en: "Open the audio inputs and outputs",
    fr: "Ouvrir les entrées et sorties audio",
  }),
  // What the open song says about its whole mix — its console (packages/song/docs/console.md).
  tab("project", {
    en: "Open the project's settings — its mix console",
    fr: "Ouvrir les réglages du projet — sa console de mix",
  }),
  tab("account", {
    en: "Open the account, engine and language settings",
    fr: "Ouvrir le compte, le moteur et la langue",
  }),
  {
    // A full PAGE, a catalogue not being orderable in a 24rem column — see components/SettingsPanel.tsx.
    name: "ui settings commands",
    readable: {
      en: "Rename, reorder and rebind the commands",
      fr: "Renommer, réordonner et relier les commandes",
    },
    run: (ctx) => {
      ctx.setCommandsPage(true);
      return true;
    },
  },
  // The workspace's set lists — what they open belongs to the WORKSPACE (docs/playlists.md).
  toggle("playlists", {
    en: "Open or close this workspace's playlists",
    fr: "Ouvrir ou fermer les playlists de cet espace",
  }),
  // What you listen AGAINST, which belongs to the workspace the same way (docs/references.md).
  toggle("references", {
    en: "Open or close this workspace's reference tracks",
    fr: "Ouvrir ou fermer les morceaux de référence de cet espace",
  }),
  // The workspace's task list, TODOS.md at its root (docs/tasks.md).
  toggle("tasks", {
    en: "Open or close this workspace's task list",
    fr: "Ouvrir ou fermer la liste de tâches de ce dépôt",
  }),
  // The open song's undo journal (docs/shell.md).
  toggle("history", {
    en: "Open or close this song's undo steps and commits",
    fr: "Ouvrir ou fermer l'historique de ce morceau",
  }),
  // `ui` because the PANEL is a view; every verb inside it is a `project` one and writes.
  toggle("share", {
    en: "Open or close the share and export panel",
    fr: "Ouvrir ou fermer le panneau de partage",
  }),
  {
    // The one control ON the editor settings screen — a global preference, which is why it is `ui`.
    name: "ui vim",
    readable: {
      en: "Turn the editor's vim mode on or off",
      fr: "Activer ou désactiver le mode vim de l'éditeur",
    },
    run: (ctx) => {
      void ctx.toggleVim();
      return true;
    },
  },
  {
    name: "ui engine",
    readable: { en: "Choose another engine", fr: "Choisir un autre moteur" },
    run: (ctx) => {
      ctx.onChangeEngine();
      return true;
    },
  },
  {
    name: "ui workspace quit",
    readable: {
      en: "Leave this workspace",
      fr: "Quitter cet espace de travail",
    },
    run: (ctx) => {
      ctx.onQuitWorkspace();
      return true;
    },
  },
  {
    // Reload after logout: AuthGate is outermost, so a fresh load lands on sign-in.
    name: "ui logout",
    readable: { en: "Sign out", fr: "Se déconnecter" },
    run: () => {
      void api.logout().then(() => window.location.reload());
      return true;
    },
  },
  {
    name: "ui language",
    readable: {
      en: "Change the interface language",
      fr: "Changer la langue de l'interface",
    },
    args: [{ name: "language", kind: "choice", hint: "en · fr" }],
    run: (ctx, _rest, lower) => {
      const want = lower.trim();
      if (!ctx.locales.includes(want))
        ctx.setStatus(
          m["status.usage"]({
            syntax: `ui language <${ctx.locales.join("|")}>`,
          }),
        );
      else ctx.setLocale(want);
      return true;
    },
  },
];
