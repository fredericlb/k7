// NodePorts.tsx — a card's sockets: a curve's automation out, an envelope's event in, a module's
// event outs, and its signal jacks spread across the width where `jackPoint` aims the cables. Which
// jacks a press arms, at rest and with a cable in hand, is decided here — docs/hosting.md.

import { EVENT_IN_AT, eventOutBottom } from "@studio/ui-chains/graph";
import { cableColorFor, MAUVE } from "./chainsCss";
import type { NodeProps } from "./nodeProps";

/** Every socket on the card, in the order the card has always drawn them. */
export function nodePorts({
  n,
  patchWant,
  onTapJack,
  onStartAutomation,
  onStartEvent,
  onLandEvent,
}: Pick<
  NodeProps,
  | "n"
  | "patchWant"
  | "onTapJack"
  | "onStartAutomation"
  | "onStartEvent"
  | "onLandEvent"
>) {
  return (
    <>
      {/* A curve gets one mauve socket and no input, kept out of `jacksFor` because it carries no signal. */}
      {n.kind === "curve" && (
        <span
          className={`dgx-port cout${onStartAutomation ? " plug" : ""}`}
          title={
            onStartAutomation
              ? "automation out — drag onto a knob to bind this curve to it"
              : "automation out — where the cable to the param it drives leaves"
          }
          // Where `curveOutPoint` says its cable leaves: the middle of its right edge (chainsCss's `.cout`).
          style={{ ["--jc" as string]: MAUVE }}
          // The press starts the cable, and is stopped so it does not also arm a pan.
          onPointerDown={
            onStartAutomation
              ? (e) => {
                  e.stopPropagation();
                  onStartAutomation(n);
                }
              : undefined
          }
        >
          <i />
        </span>
      )}
      {/* A curve an event fires LISTENS: one socket on its left edge, where the note-on cable lands. */}
      {n.eventIn && (
        <span
          className={`dgx-port ev evin${
            patchWant?.kind === "event" && n.curveOf?.module ? " plug" : ""
          }`}
          title={
            n.curveOf?.module
              ? "event in — a note-on restarts this envelope"
              : "event in — bind this curve to a param first, then a note-on can fire it"
          }
          style={{
            ["--jc" as string]: cableColorFor("event"),
            // The fraction eventPoint uses, so the cable meets the hole.
            top: `${EVENT_IN_AT * 100}%`,
          }}
          // Only a BOUND envelope can take one: the trigger is written onto the binding.
          onPointerUp={
            patchWant?.kind === "event" && n.curveOf?.module
              ? (e) => {
                  e.stopPropagation();
                  onLandEvent?.(n);
                }
              : undefined
          }
        >
          <i />
        </span>
      )}
      {/* …and a module ANNOUNCES, up its LEFT edge from the bottom, each socket saying which event it is. */}
      {(n.events ?? []).map((name, i) => (
        <span
          key={`ev:${name}`}
          className={`dgx-port ev evout${onStartEvent ? " plug" : ""}`}
          title={`${name} — drag onto a curve's event plug to make it fire that curve`}
          onPointerDown={
            onStartEvent
              ? (e) => {
                  e.stopPropagation();
                  onStartEvent(n, name);
                }
              : undefined
          }
          style={{
            ["--jc" as string]: cableColorFor("event"),
            // The same offset eventPoint uses, so the cable meets the hole.
            top: `calc(100% - ${eventOutBottom(i)}px)`,
          }}
        >
          <i />
          <span className="dgx-evlab evout">{name}</span>
        </span>
      ))}
      {n.kind !== "curve" &&
        (["in", "out"] as const).map((side) =>
          (n.jacks?.[side] ?? []).map((p, i, all) => {
            // Which jacks the patch gesture arms, at rest and with a cable in hand — docs/hosting.md.
            const plug =
              !!onTapJack &&
              (patchWant
                ? p.free &&
                  side === patchWant.seeking &&
                  p.type === patchWant.type &&
                  // …and never back onto the node the cable LEFT, which the verb refuses outright.
                  n.id !== patchWant.node
                : side === "out" || !p.free);
            return (
              <span
                key={`${side}:${i}:${p.name ?? ""}`}
                className={`dgx-port ${side}${p.free ? " free" : ""}${plug ? " plug" : ""}`}
                title={
                  p.name
                    ? `${p.name} (${p.type})${p.free ? " — free" : ""}`
                    : undefined
                }
                style={{
                  // Coloured by what the port carries, so a socket matches the cable for it.
                  ["--jc" as string]: cableColorFor(p.type),
                  // Spread across the WIDTH, and it MUST agree with `jackPoint` — docs/hosting.md.
                  left: `${((i + 1) / (all.length + 1)) * 100}%`,
                }}
                // The press, not the click, since a cable is drawn by DRAGGING out of a socket.
                onPointerDown={
                  plug
                    ? (e) => {
                        e.stopPropagation();
                        onTapJack?.(n, side, p, i, "down");
                      }
                    : undefined
                }
                // …and the release lands it — on the socket the press armed, that is a CLICK instead.
                onPointerUp={
                  plug
                    ? (e) => {
                        e.stopPropagation();
                        onTapJack?.(n, side, p, i, "up");
                      }
                    : undefined
                }
              >
                <i />
              </span>
            );
          }),
        )}
    </>
  );
}
