// NewWorkspace.tsx — a workspace of one's own, made on the server. It holds nothing yet,
// deliberately: which archetype the first project takes is a question the editor asks on the
// empty workspace, where the answer is about to be looked at. With several links it picks one,
// the main one first. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import { HardDrive } from "@frediverse/ui/icons";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { NameFormDialog, useNameSubmit } from "./NameForm";
import { workspaceFolderName } from "./projectName";
import { linkLabel, type SyncLink } from "./syncLinks";

export function NewWorkspace({
  /** Why it is impossible, or "" — a file service not answering is one. */
  blocked,
  onCreate,
  primary = false,
  links = [],
}: {
  blocked: string;
  onCreate: (
    workspace: string,
    onStep: (s: string) => void,
    link?: string,
  ) => Promise<void>;
  /** In the empty list's place, where making a workspace IS the page's one act. */
  primary?: boolean;
  /** The links it may sync with, the main one first; a picker only when there are several. */
  links?: SyncLink[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  // Empty is the main one, which the backend takes without being told.
  const [link, setLink] = useState("");
  const { busy, step, error, run } = useNameSubmit();

  const { folder, error: badName } = workspaceFolderName(name);

  const submit = () => {
    if (!folder) return;
    run(
      (onStep) => onCreate(folder, onStep, link || undefined),
      () => {
        setOpen(false);
        setName("");
      },
    );
  };

  return (
    <>
      {/* Secondary in the header: a workspace is made once in a while, a project every session — the page's primary is New project. */}
      <Button
        size="sm"
        variant={primary ? "default" : "secondary"}
        disabled={Boolean(blocked)}
        title={blocked || m["ws.newHint"]()}
        onClick={() => setOpen(true)}
      >
        <HardDrive className="h-4 w-4" /> {m["ws.new"]()}
      </Button>

      <NameFormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={m["ws.newTitle"]()}
        description={m["ws.newBody"]()}
        placeholder={m["ws.namePlaceholder"]()}
        name={name}
        onName={setName}
        onSubmit={submit}
        busy={busy}
        step={step}
        error={error}
        badName={badName}
        preview={folder}
        note={
          links.length > 1 && (
            <label className="flex items-center gap-2 text-muted-foreground text-xs">
              {m["ws.newLink"]()}
              <select
                className="min-w-0 flex-1 rounded-md border border-border bg-secondary px-2 py-1 text-foreground text-xs"
                value={link}
                disabled={busy}
                onChange={(e) => setLink(e.target.value)}
              >
                {links.map((l) => (
                  <option
                    key={l.id ?? l.origin}
                    value={l.main ? "" : (l.id ?? l.origin)}
                  >
                    {l.main
                      ? m["ws.newLinkMain"]({ link: linkLabel(l) })
                      : linkLabel(l)}
                  </option>
                ))}
              </select>
            </label>
          )
        }
        submit={m["common.create"]()}
        canSubmit={Boolean(folder)}
      />
    </>
  );
}
