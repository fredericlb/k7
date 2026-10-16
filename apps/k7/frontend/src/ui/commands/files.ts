// files.ts — the file tree's right-click menu, as commands. Each calls the SAME callback the
// menu item runs (see EditorHandle), including the confirm a delete asks for; the `fs` verbs
// take TREE ENTRIES, folders included, where `ui file` takes only what the editor can open.

import type { PaletteArg } from "../../components/CommandBar";
import { headTokens, resolveEntry } from "../../localTargets";
import type { LocalCommand, LocalCtx } from "./context";

const ENTRY: PaletteArg = {
  name: "path",
  kind: "file",
  hint: "a file or folder of this workspace",
};

const entryOf = (ctx: LocalCtx, arg: string | undefined) =>
  arg ? resolveEntry(arg, ctx.editorRef.current?.entries() ?? []) : null;

/** `fs file new` and `fs folder new`: the folder it goes in, then its name. */
const create = (folder: boolean): LocalCommand => {
  const head = folder ? "fs folder new" : "fs file new";
  return {
    name: head,
    readable: folder
      ? { en: "Create a folder", fr: "Créer un dossier" }
      : { en: "Create an empty file", fr: "Créer un fichier vide" },
    args: [
      { name: "folder", kind: "file", hint: "the folder it goes in" },
      {
        name: "name",
        kind: "text",
        hint: folder ? "the new folder's name" : "the new file's name",
      },
    ],
    match: "names",
    run: (ctx, rest) => {
      const [dirArg, name] = headTokens(rest, 2);
      const dir = entryOf(ctx, dirArg);
      const ed = ctx.editorRef.current;
      if (!dirArg || !name) ctx.setStatus(`usage: ${head} <folder> <name>`);
      else if (!dir || !ed?.isDir(dir))
        ctx.setStatus(`no folder "${dirArg}" in this workspace`);
      else if (folder) ed.createFolder(dir, name);
      else ed.createFile(dir, name);
      return true;
    },
  };
};

export const FILE_COMMANDS: LocalCommand[] = [
  {
    // To the top of the tree, or off it when it is already there.
    name: "ui pin",
    readable: {
      en: "Pin a file to the top of the tree",
      fr: "Épingler un fichier en haut de l'arbre",
    },
    args: [{ name: "path", kind: "file", hint: "a file of this project" }],
    run: (ctx, rest) => {
      const arg = rest.trim();
      const path = entryOf(ctx, arg);
      const pinned = path ? ctx.editorRef.current?.togglePin(path) : null;
      if (!path) ctx.setStatus(`no file "${arg}" in this workspace`);
      else if (pinned == null)
        ctx.setStatus("the file tree is not on screen — the pins live in it");
      else ctx.setStatus(`${pinned ? "pinned" : "unpinned"} ${path}`);
      return true;
    },
  },
  {
    // What it copies is the workspace-relative path every route takes.
    name: "ui copy path",
    readable: {
      en: "Copy a file's path to the clipboard",
      fr: "Copier le chemin d'un fichier dans le presse-papiers",
    },
    args: [ENTRY],
    run: (ctx, rest) => {
      const arg = rest.trim();
      const path = entryOf(ctx, arg);
      if (!path) ctx.setStatus(`no entry "${arg}" in this workspace`);
      else {
        void navigator.clipboard?.writeText(path);
        ctx.setStatus(`copied ${path}`);
      }
      return true;
    },
  },
  create(false),
  create(true),
  {
    // The NAME, not a path: a rename leaves the entry where it is.
    name: "fs file rename",
    readable: {
      en: "Rename a file or a folder",
      fr: "Renommer un fichier ou un dossier",
    },
    args: [
      ENTRY,
      { name: "name", kind: "text", hint: "its new name — it does not move" },
    ],
    match: "names",
    run: (ctx, rest) => {
      const [pathArg, name] = headTokens(rest, 2);
      const path = entryOf(ctx, pathArg);
      if (!pathArg || !name)
        ctx.setStatus("usage: fs file rename <path> <new name>");
      else if (!path) ctx.setStatus(`no entry "${pathArg}" in this workspace`);
      else ctx.editorRef.current?.rename(path, name);
      return true;
    },
  },
  {
    // What dragging a row onto a folder does.
    name: "fs file move",
    readable: {
      en: "Move a file into another folder",
      fr: "Déplacer un fichier dans un autre dossier",
    },
    args: [ENTRY, { name: "folder", kind: "file", hint: "where it goes" }],
    match: "names",
    run: (ctx, rest) => {
      const [pathArg, dirArg] = headTokens(rest, 2);
      const path = entryOf(ctx, pathArg);
      const dir = entryOf(ctx, dirArg);
      if (!pathArg || !dirArg)
        ctx.setStatus("usage: fs file move <path> <folder>");
      else if (!path) ctx.setStatus(`no entry "${pathArg}" in this workspace`);
      else if (!dir || !ctx.editorRef.current?.isDir(dir))
        ctx.setStatus(`no folder "${dirArg}" in this workspace`);
      else ctx.editorRef.current?.move(path, dir);
      return true;
    },
  },
  {
    // Recycled, not erased — and confirmed, because the menu's is.
    name: "fs file delete",
    readable: {
      en: "Send a file to the recycle bin",
      fr: "Envoyer un fichier à la corbeille",
    },
    args: [ENTRY],
    match: "names",
    run: (ctx, rest) => {
      const arg = rest.trim();
      const path = entryOf(ctx, arg);
      const ed = ctx.editorRef.current;
      if (!arg) ctx.setStatus("usage: fs file delete <path>");
      else if (!path) ctx.setStatus(`no entry "${arg}" in this workspace`);
      else ed?.remove(path, ed.isDir(path));
      return true;
    },
  },
  {
    // Opens the OS picker; `folder` asks for a whole directory, which a browser draws differently — see FileTree.
    name: "fs file upload",
    readable: {
      en: "Upload files into a folder",
      fr: "Envoyer des fichiers dans un dossier",
    },
    args: [
      { name: "folder", kind: "file", hint: "where the files land" },
      { name: "what", kind: "choice", hint: "files · folder" },
    ],
    match: "names",
    run: (ctx, rest) => {
      const [dirArg, what] = headTokens(rest, 2);
      const dir = entryOf(ctx, dirArg);
      const ed = ctx.editorRef.current;
      if (!dir || !ed?.isDir(dir))
        ctx.setStatus("usage: fs file upload <folder> [files|folder]");
      else if (!ed.pickUpload(dir, (what ?? "").toLowerCase() === "folder"))
        ctx.setStatus(
          "the file tree is not on screen — the picker lives in it",
        );
      return true;
    },
  },
];
