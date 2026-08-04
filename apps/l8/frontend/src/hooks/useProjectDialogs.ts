// useProjectDialogs.ts — the two project-level dialog flows: importing a foreign project
// (.dawproject or .als; two-phase: confirm runs the import and returns a log, then "open"
// activates the new project) and deleting a project (confirmed, recycled — not erased).
// Extracted from App.tsx; behaviour unchanged.

import { useCallback, useState } from "react";
import { api } from "../api";
import type { WorkspaceInfo } from "../types";

export function useProjectImport(opts: {
  openProject: (path: string) => Promise<void>;
  onStatus: (s: string) => void;
}): {
  importPath: string | null;
  importing: boolean;
  importError: string | null;
  importLog: string[] | null;
  askImport: (p: string) => void;
  confirmImport: () => Promise<void>;
  openImported: () => Promise<void>;
  cancelImport: () => void;
} {
  const [importPath, setImportPath] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importLog, setImportLog] = useState<string[] | null>(null);
  const [importedProject, setImportedProject] = useState<string | null>(null);

  const askImport = useCallback((p: string) => {
    setImportError(null);
    setImportLog(null);
    setImportedProject(null);
    setImportPath(p);
  }, []);

  // Phase 1: translate the file and keep the log; the dialog then offers to open it (phase 2, below).
  const confirmImport = useCallback(async () => {
    if (!importPath) return;
    setImporting(true);
    setImportError(null);
    try {
      const { project, log } = await api.importProject(importPath);
      setImportLog(log);
      setImportedProject(project);
      opts.onStatus(`imported ${importPath} → ${project}`);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importPath]);

  // Phase 2: open the freshly imported project.
  const openImported = useCallback(async () => {
    const target = importedProject;
    setImportPath(null);
    setImportLog(null);
    setImportedProject(null);
    if (target) await opts.openProject(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importedProject]);

  const cancelImport = useCallback(() => {
    setImportPath(null);
    setImportLog(null);
    setImportedProject(null);
  }, []);

  return {
    importPath,
    importing,
    importError,
    importLog,
    askImport,
    confirmImport,
    openImported,
    cancelImport,
  };
}

export function useProjectDelete(opts: {
  onStatus: (s: string) => void;
  /** Called with the fresh workspace after a successful delete. */
  onDeleted: (w: WorkspaceInfo) => void;
}): {
  deletePath: string | null;
  deleting: boolean;
  deleteError: string | null;
  /** Open the confirm dialog for this project (clears any previous error). */
  askDelete: (path: string) => void;
  confirmDelete: () => Promise<void>;
  cancelDelete: () => void;
} {
  const [deletePath, setDeletePath] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const askDelete = useCallback((path: string) => {
    setDeleteError(null);
    setDeletePath(path);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deletePath) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { recycled } = await api.deleteProject(deletePath);
      opts.onStatus(`deleted ${deletePath} → ${recycled}`);
      setDeletePath(null);
      const w = await api.workspace();
      opts.onDeleted(w);
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deletePath]);

  const cancelDelete = useCallback(() => setDeletePath(null), []);

  return {
    deletePath,
    deleting,
    deleteError,
    askDelete,
    confirmDelete,
    cancelDelete,
  };
}
