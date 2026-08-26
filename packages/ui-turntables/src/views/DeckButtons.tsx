// DeckButtons.tsx — the three button clusters a deck carries: its FX row (censor, echo-out, cue),
// one cue slot, and the sync button. Independent of the column that mounts them, which is why they
// are not in DeckSide.tsx. See ../../docs/fx.md, ../../docs/cues.md and ../../docs/bpm.md.

//
// It DRAWS the decks and owns nothing about them. The document — what is loaded, what it plays
// at, every gesture that changes either — is `useDeckSet`, held by Studio, because this view is
// unmounted the moment somebody opens the graph and a set does not stop existing then.

import { Button } from "@frediverse/ui/button";
import { Headphones, Link2, Repeat, Undo2 } from "lucide-react";

/** A deck's two MOMENTARY effects — held, never toggled. See ../../docs/fx.md.
 *
 * `onPointerUp` AND `onPointerLeave`, because a press that ends off the button still has to end:
 * without the second one a censor whose hand slid away leaves the record running backwards. */
export function FxButtons({
  side,
  censorable,
  onCensor,
  echoLive,
  echoingOut,
  onEchoOut,
}: {
  side: "A" | "B";
  /** A record has to be on the deck for running it backwards to mean anything. */
  censorable: boolean;
  onCensor: (on: boolean) => void;
  /** Does the project wire an echo for this deck? Unwired is ordinary, like an unwired cue. */
  echoLive: boolean;
  echoingOut: boolean;
  onEchoOut: (on: boolean) => void;
}) {
  const held = (on: (down: boolean) => void, enabled: boolean) =>
    enabled
      ? {
          onPointerDown: () => on(true),
          onPointerUp: () => on(false),
          onPointerLeave: () => on(false),
        }
      : {};
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="sm"
        variant="secondary"
        disabled={!censorable}
        className="shrink-0 px-2 text-xs"
        title={
          censorable
            ? `censurer la platine ${side} — le disque part à l'envers tant que le bouton est tenu`
            : `platine ${side} vide — rien à censurer`
        }
        {...held(onCensor, censorable)}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant={echoingOut ? "default" : "secondary"}
        disabled={!echoLive}
        className="shrink-0 px-2 text-xs"
        title={
          echoLive
            ? `echo-out sur la platine ${side} — coupe la voie et laisse l'écho sonner`
            : `cette platine n'a pas d'écho câblé — reliez \`deck${side}.echo\` dans surfaces/`
        }
        aria-pressed={echoingOut}
        {...held(onEchoOut, echoLive)}
      >
        <Repeat className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** One deck in the headphones — pre-fade, so the crossfader does not reach it. See ../../docs/cue.md. */
export function CueButton({
  side,
  on,
  wired,
  live,
  onClick,
}: {
  side: "A" | "B";
  on: boolean;
  /** Does the PROJECT wire a send for this deck? Unwired is ordinary, not a fault — ../../docs/cue.md. */
  wired: boolean;
  /** …and can this MACHINE play it? Two halves, two sentences: a button that lit and lied is worse. */
  live: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={on ? "default" : "secondary"}
      disabled={!live}
      className="shrink-0"
      title={
        // The reason, not the rule — and WHICH of the two is missing, since the fixes are different.
        !wired
          ? `cette platine n'a pas de départ casque — migrez le set (migrateSetCue) ou reliez \`deck${side}.cue\` dans surfaces/`
          : !live
            ? "cette machine n'a pas de paire pour le casque — nommez-la avec `system cue 3+4`, sinon le cue ne joue nulle part"
            : on
              ? `la platine ${side} est dans le casque — cliquer pour l'enlever`
              : `écouter la platine ${side} au casque, avant le crossfader`
      }
      onClick={onClick}
      aria-pressed={on}
    >
      <Headphones className="mr-1 h-3.5 w-3.5" />
      {side}
    </Button>
  );
}

/** One end of the sync pair: "this deck leads" — two buttons, ONE choice. See ../../docs/bpm.md. */
export function SyncButton({
  side,
  on,
  enabled,
  beats,
  onClick,
}: {
  side: "A" | "B";
  on: boolean;
  enabled: boolean;
  /** Can the two decks' beats be aligned, or only their tempos? */
  beats: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={on ? "default" : "secondary"}
      disabled={!enabled}
      className="shrink-0"
      title={
        !enabled
          ? "il faut un tempo sur les deux platines"
          : !beats
            ? `synchroniser sur la platine ${side} — tempo seulement : l'analyse n'a pas trouvé de grille fiable sur l'un des morceaux, les temps ne seront pas calés`
            : on
              ? `la platine ${side} mène — cliquer pour relâcher`
              : `synchroniser sur la platine ${side}`
      }
      onClick={onClick}
    >
      <Link2 className="mr-1 h-3.5 w-3.5" />
      SYNC {side}
    </Button>
  );
}
/** …read off the desk, so a third deck would not mean a third copy of these eleven lines. */
