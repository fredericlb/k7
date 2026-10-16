// treeActions.ts — the tree's right-click menus: the SONGS family's, and the one every other writable
// family shares. Built from what the screen hands in, so the menu holds no state of its own.
// The one thing a reader would get wrong: a SONG is a folder on disk though a leaf in the tree, so it is removed as a tree (../docs/library.md).

import type { TreeAction, TreeNode } from "@frediverse/ui/file-tree";
import { takesOf } from "@studio/mediatek/takes";
import type { MediatekEntry } from "@studio/mediatek/types";
import { library } from "./api";
import type { LibraryLabels } from "./labels";
import { entryAt, isSongFolder } from "./libraryTree";
import { folderOf } from "./routes";
import { missingUnder } from "./serverSets";

type Actions = TreeAction<TreeNode>[];

/** The right-click menu the SONGS family gets, and the only one it gets (../docs/library.md). */
export function songActions(d: {
  section: string;
  entries: MediatekEntry[] | null;
  file: string | null;
  openFile: (rel: string | null) => void;
  pickVariant: (song: string) => void;
  enqueue: (entries: MediatekEntry[]) => void;
  /** The paired server's songs this machine lacks; empty when unpaired. */
  serverOnly: MediatekEntry[];
  download: (paths: string[]) => Promise<void>;
  refresh: () => void;
  setError: (message: string) => void;
  labels: LibraryLabels;
  /** Whether removals are this account's — apps/k7/backend/docs/media/gate.md. */
  manage: boolean;
}): Actions {
  const { section, entries, file } = d;
  const l = d.labels.tree;
  const missing = (t: TreeNode) =>
    missingUnder(d.serverOnly, `${section}/${t.path}`);
  return [
    {
      key: "download-missing",
      // An album or an artist half here: what the server holds under it, and only that (../../mediatek/docs/serverCopy.md).
      label: (t) => d.labels.contents.downloadMissing(missing(t).length),
      // A folder half here, or one song only the server holds: the same download.
      when: (t) => !t.root && missing(t).length > 0,
      run: (t) => void d.download(missing(t)),
    },
    {
      key: "add-variant",
      // The same gesture as the drop onto this row, said in words — a drag is not discoverable.
      label: l.addVariant,
      when: (t) => isSongFolder(entries, t.path),
      run: (t) => d.pickVariant(t.path),
    },
    {
      key: "queue-song",
      // The bottom bar's queue, not a playlist — see ../docs/miniPlayer.md.
      label: l.queue,
      // Only what actually has a master: an empty folder would make a row playback skips in silence.
      when: (t) => {
        const e = entryAt(entries, t.path);
        return !!e && takesOf(e).some((k) => k.kind === "master");
      },
      run: (t) => {
        const e = entryAt(entries, t.path);
        if (e) d.enqueue([e]);
      },
    },
    {
      key: "delete-song",
      // Named as a folder: what goes is the master and its sidecar, not just the row. No confirmation.
      label: (t) => l.delete(t.name),
      when: (t) => d.manage && isSongFolder(entries, t.path),
      danger: true,
      run: (t) =>
        void library
          .removeTree(`${section}/${t.path}`)
          .then(() => {
            // Close the editor when it shows what just went, or it empties itself on a dead address.
            if (folderOf(file) === t.path) d.openFile(null);
            d.refresh();
          })
          .catch((e: Error) => d.setError(e.message)),
    },
    {
      key: "delete-folder",
      // An ARTIST or ALBUM grouping: a real folder, neither the root nor a song's own.
      label: (t) => l.deleteFolder(t.name),
      when: (t) =>
        d.manage && t.dir && !t.root && !isSongFolder(entries, t.path),
      danger: true,
      // Asked rather than one click: this can take every song underneath — ../docs/library.md.
      confirm: {
        message: (t) => l.deleteFolderConfirm(t.name),
        submit: l.deleteSubmit,
      },
      run: (t) =>
        void library
          .removeTree(`${section}/${t.path}`)
          .then(() => {
            // The open song may sit several levels under an artist or album that just went.
            const open = folderOf(file);
            if (open === t.path || open?.startsWith(`${t.path}/`))
              d.openFile(null);
            d.refresh();
          })
          .catch((e: Error) => d.setError(e.message)),
    },
  ];
}

/** The menu of a writable family: every target needs one action whose `when` passes, or no menu opens (../docs/library.md). */
export function assetActions(d: {
  section: string;
  entries: MediatekEntry[] | null;
  assetsTarget: (dir: string) => string;
  pickFolder: (dir: string) => void;
  refresh: () => void;
  setError: (message: string) => void;
  labels: LibraryLabels;
  /** Whether removals and folder moves are this account's — apps/k7/backend/docs/media/gate.md. */
  manage: boolean;
}): Actions {
  const { section, entries } = d;
  const l = d.labels.tree;
  const fail = (e: Error) => d.setError(e.message);
  return [
    {
      key: "upload-folder",
      label: l.uploadFolder,
      // Through `assetsTarget`, exactly like the drop: the two must land in the same place.
      when: (t) => t.dir || t.root,
      run: (t) => d.pickFolder(t.path),
    },
    {
      key: "new-folder",
      label: l.newFolder,
      // Somewhere to drop into before the first file, and never beside a module's definition.
      when: (t) => t.dir || t.root,
      prompt: { placeholder: l.newFolderPlaceholder, submit: l.create },
      run: (t, value) =>
        void library
          .newFolder(`${d.assetsTarget(t.path)}/${value}`)
          .then(d.refresh)
          .catch(fail),
    },
    {
      key: "new-file",
      label: l.newFile,
      when: (t) => t.dir || t.root,
      prompt: { placeholder: l.newFilePlaceholder, submit: l.create },
      run: (t, value) =>
        void library
          .writeFile(`${section}/${t.path ? `${t.path}/` : ""}${value}`, "")
          .then(d.refresh)
          .catch(fail),
    },
    {
      key: "rename",
      label: l.rename,
      // Renaming a folder moves everything under it, so it is a manager's like a removal.
      when: (t) => !t.root && (d.manage || !t.dir),
      prompt: {
        placeholder: l.renamePlaceholder,
        initial: (t) => t.name,
        submit: l.renameSubmit,
      },
      run: (t, value) =>
        void library
          .move(
            `${section}/${t.path}`,
            `${section}/${[...t.path.split("/").slice(0, -1), value].join("/")}`,
          )
          .then(d.refresh)
          .catch(fail),
    },
    {
      key: "delete",
      label: (t) => l.delete(t.name),
      when: (t) => !t.root && d.manage,
      danger: true,
      // `t.dir` alone would delete a song with the single-file route and leave its folder.
      run: (t) =>
        void (
          t.dir || isSongFolder(entries, t.path)
            ? library.removeTree(`${section}/${t.path}`)
            : library.remove(`${section}/${t.path}`)
        )
          .then(d.refresh)
          .catch(fail),
    },
  ];
}
