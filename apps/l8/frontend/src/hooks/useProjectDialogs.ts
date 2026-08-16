// useProjectDialogs.ts — importing a foreign project (.dawproject or .als; two-phase: confirm
// runs the import and returns a log, then "open" activates the new project). It held the
// DELETE flow too, until l8 stopped showing a workspace to pick a project out of.

import { useCallback, useState } from "react";
import { api } from "../api";

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

// `useProjectDelete` was here, behind the `project delete` verb and its confirm dialog. Both
// are gone: l8 shows no workspace to pick a project out of, and st0 owns the repositories.
// The file service still has the route — that is what st0 calls.
