// NewWorkspace.tsx — a workspace of one's own, made on the server. It holds nothing yet,
// deliberately: which archetype the first project takes is a question the editor asks on the
// empty workspace, where the answer is about to be looked at. See ../../docs/projects.md.

import { Button } from "@frediverse/ui/button";
import { HardDrive } from "@frediverse/ui/icons";
import { useState } from "react";
import { m } from "../paraglide/messages.js";
import { NameFormDialog, useNameSubmit } from "./NameForm";
import { workspaceFolderName } from "./projectName";

export function NewWorkspace({
  /** Why it is impossible, or "" — a file service not answering is one. */
  blocked,
  onCreate,
  primary = false,
}: {
  blocked: string;
  onCreate: (workspace: string, onStep: (s: string) => void) => Promise<void>;
  /** In the empty list's place, where making a workspace IS the page's one act. */
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { busy, step, error, run } = useNameSubmit();

  const { folder, error: badName } = workspaceFolderName(name);

  const submit = () => {
    if (!folder) return;
    run(
      (onStep) => onCreate(folder, onStep),
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
        submit={m["common.create"]()}
        canSubmit={Boolean(folder)}
      />
    </>
  );
}
