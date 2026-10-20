// HelpPage.tsx — the documentation at /docs (opened by `help`, bound to `?`), laid out as
// a DOCUMENT: a table of contents beside one long scrollable body, so ctrl-F reaches all
// of it. The PROSE lives in k7/docs/ (see docs/pages.ts); this file is layout plus
// the one section that can't be written down — the generated command reference.

import { Button } from "@frediverse/ui/button";
import { ArrowLeft } from "@frediverse/ui/icons";
import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import type { CommandPrefs } from "../commandPrefs";
import { DOC_PARTS } from "../docs/pages";
import { useWindowKey } from "../hooks/useWindowKey";
import { shortcutsByCommand } from "../keys";
import { usePopin } from "../popins";
import type { CommandInfo } from "../types";
import { Markdown } from "./Markdown";

// The shell's view commands, described here because only this page needs the prose. In display order.
const VIEW_COMMANDS: { command: string; help: string }[] = [
  {
    command: "ui global",
    help: "back to the home page — the timeline, or the first pane a project without one declares",
  },
  { command: "ui editor", help: "fullscreen the editor pane" },
  { command: "ui timeline", help: "fullscreen the timeline pane" },
  { command: "ui chains", help: "fullscreen the chains (routing) pane" },
  {
    command: "ui turntables",
    help: "fullscreen the DJ desk (projects declaring a turntables surface)",
  },
  {
    command: "ui mastering",
    help: "fullscreen the master strip (projects declaring a mastering surface)",
  },
  {
    command: "ui viewport",
    help: "show or hide the floating video viewport (video songs only)",
  },
  {
    command: "ui focus next",
    help: "move the keyboard to the next global-view pane",
  },
  { command: "ui close", help: "close the bottom panel" },
  {
    command: "ui popin close",
    help: "close the overlay in front — what Esc reaches for first",
  },
  {
    command: "ui slot close",
    help: "put the chains graph back where a grid, a clip or a take had taken its place",
  },
  {
    command: "ui file",
    help: "open a file in the editor by fuzzy name (completes against the project)",
  },
  {
    command: "ui edit sequence",
    help: "open a MIDI sequence's file in the editor (its grids are tabs there)",
  },
  {
    command: "ui edit clip",
    help: "open an audio clip's waveform in the file editor",
  },
  {
    command: "sequence edit roll",
    help: "a sequence's notes as a piano roll, where the graph is (× puts the graph back)",
  },
  {
    command: "sequence edit tracker",
    help: "the same, as a tracker — arrows move, keys type notes",
  },
  {
    command: "ui select",
    help: "toggle the timeline caret ↔ a selection rectangle",
  },
  { command: "ui zoom", help: "frame the timeline selection" },
  { command: "ui zoom out", help: "back out one zoom level" },
  { command: "ui zoom reset", help: "back to the whole song" },
  {
    command: "transport locate",
    help: "move the playhead to the timeline caret",
  },
  {
    command: "transport replay",
    help: "play again from where playback last started",
  },
  { command: "ui help", help: "show this help" },
];

function CommandRow({
  cmd,
  shortcut,
}: {
  // The backend's shape minus what a row draws: VIEW_COMMANDS are shell-only and carry no argument spec.
  cmd: Pick<CommandInfo, "command" | "help">;
  shortcut?: string;
}) {
  // Every translation on one line, active locale first: each one dispatches, so the row is what you can type.
  const names = [cmd.command];
  return (
    <div className="flex items-baseline gap-3 py-0.5">
      <code className="shrink-0 font-mono text-xs">
        {names.map((n, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground">/</span>}
            <span
              className={i === 0 ? "text-foreground" : "text-muted-foreground"}
            >
              {n}
            </span>
          </span>
        ))}
      </code>
      {shortcut && (
        <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
          {shortcut}
        </kbd>
      )}
      <span className="ml-auto text-right text-xs text-muted-foreground">
        {cmd.help}
      </span>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    // scroll-mt keeps the heading clear of the sticky header when the nav jumps here.
    <section id={id} className="scroll-mt-4">
      <h3 className="mb-1.5 border-b border-border/60 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function HelpPage({
  onBack,
  prefs,
}: {
  onBack: () => void;
  /** The person's command prefs — their own keys must be what the legend advertises. */
  prefs?: CommandPrefs;
}) {
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const shortcuts = shortcutsByCommand(prefs);

  // Fetched on open, and the one section that CAN'T be markdown: it is generated from commands.yaml. Best-effort.
  useEffect(() => {
    let alive = true;
    api
      .commands()
      .then((c) => alive && setCommands(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Mounted only while it is showing, and registered so the shell's Esc stops at this page instead of closing the slot under it.
  usePopin(true, onBack);

  useWindowKey((e) => {
    if (e.key === "Escape") onBack();
  });

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <div className="text-sm font-semibold">Documentation</div>
        <div className="text-xs text-muted-foreground">
          commands · file formats · architecture
        </div>
      </header>

      {/* A documentation LAYOUT — a fixed table of contents over one scrollable body; tabs would break ctrl-F and deep links. */}
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-56 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-card/40 p-2 md:flex">
          {DOC_PARTS.map((part) => (
            <div key={part.part} className="flex flex-col">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/70">
                {part.label}
              </div>
              {part.part === "commands" && (
                <NavLink id="command-reference" label="Command reference" />
              )}
              {part.pages.map((pg) => (
                <NavLink key={pg.id} id={pg.id} label={pg.title} />
              ))}
            </div>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-8 pb-24">
            {DOC_PARTS.map((part) => (
              <Fragment key={part.part}>
                {part.pages.map((pg) => (
                  <Section key={pg.id} id={pg.id} title={pg.title}>
                    <Markdown body={pg.body} />
                  </Section>
                ))}
                {/* The generated half of the commands part, after its prose. */}
                {part.part === "commands" && (
                  <Section
                    id="command-reference"
                    title={`Command reference (${commands.length + VIEW_COMMANDS.length})`}
                  >
                    <div className="flex flex-col divide-y divide-border/60">
                      {commands.map((c) => (
                        <CommandRow
                          key={c.command}
                          cmd={c}
                          shortcut={shortcuts[c.command]}
                        />
                      ))}
                      {VIEW_COMMANDS.map((c) => (
                        <CommandRow
                          key={c.command}
                          cmd={c}
                          shortcut={shortcuts[c.command]}
                        />
                      ))}
                    </div>
                  </Section>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavLink({ id, label }: { id: string; label: string }) {
  return (
    <a
      href={`#${id}`}
      onClick={(e) => {
        e.preventDefault();
        document
          .getElementById(id)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className="truncate rounded px-2 py-1 pl-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {label}
    </a>
  );
}
