// EngineGate.tsx — choose the engine before the editor mounts. It is no longer a fixed
// localhost socket: engines register themselves, so this lists them, MEASURES each one's latency,
// and mounts <App/> with the chosen ws address. The pick belongs to the ACCOUNT — it comes
// back on any browser — and is reused whenever it is still reachable.

import { useRelook } from "@studio/engine-browser/relook";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { engines } from "../api";
import type { RankedEngine } from "../types";
import { EngineSelect } from "./EngineSelect";
import { ProjectGate } from "./ProjectGate";

type Phase =
  | { k: "loading" }
  | { k: "picking" }
  | { k: "chosen"; engine: RankedEngine };

export function EngineGate() {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [ranked, setRanked] = useState<RankedEngine[]>([]);
  const [busy, setBusy] = useState(false);

  // Re-measure and redraw the picker, for the Refresh button and the way back from a switch.
  const refresh = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      setRanked((await engines.find()).ranked);
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * La liste se re-mesure toute seule TANT QUE le sélecteur est à l'écran.
   *
   * Une sonde est un instantané, et `unreachable` n'est pas une latence lente mais un état à
   * part : une seule course ratée figeait « hors de portée » jusqu'au rechargement de la page.
   * C'est justement en regardant cette liste qu'on attend qu'elle change d'avis.
   *
   * Seulement en `picking` : une fois le moteur choisi, re-mesurer pourrait ramener l'écran en
   * arrière sous les doigts de quelqu'un qui travaille. Et sans toucher `busy` — c'est le
   * bouton Rafraîchir qui le possède, et le voir clignoter tout seul dirait qu'on a cliqué.
   */
  const relook = useRelook();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `relook` est un déclencheur, pas une valeur lue ici — il dit QUAND re-mesurer.
  useEffect(() => {
    if (phase.k !== "picking") return;
    let cancelled = false;
    void engines
      .find()
      .then((l) => {
        if (!cancelled) setRanked(l.ranked);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [relook, phase.k]);

  const pick = useCallback(async (r: RankedEngine): Promise<boolean> => {
    if (!r.wsUrl || !r.fileBase || r.token === null) return false;
    try {
      await engines.select(r.engine.id, r.token, r.latency?.totalMs ?? 0); // token verified server-side
    } catch {
      return false; // engine vanished — stay on the picker
    }
    // Remembered on the ACCOUNT, not in this tab. sessionStorage meant a second tab was
    // back at the picker and a second browser had never chosen anything — while the whole
    // premise is that an engine belongs to a person, changeable in settings.
    // Fire-and-forget: failing the pick because a preference did not save would take the
    // engine away too, and the user is trying to open their song.
    engines.savePrefs({ engineId: r.engine.id }).catch(() => {});
    setPhase({ k: "chosen", engine: r });
    return true;
  }, []);

  // The assignment is a LEASE this tab keeps alive. The loop is shared — see
  // @studio/engine-browser/docs/lease.md — and nothing here but when to start it.
  useEffect(() => {
    if (phase.k !== "chosen") return;
    return engines.hold(phase.engine);
  }, [phase]);

  useEffect(() => {
    // StrictMode runs this twice in dev; both probes are harmless, and a ref guard would strand us on the spinner.
    let cancelled = false;
    void (async () => {
      // List, preference, probe and policy in one call — the same four steps in the same
      // order as st0 and m9, from @studio/engine-browser/access rather than three copies.
      const { ranked: r, chosen } = await engines.find();
      if (cancelled) return;
      setRanked(r);
      if (chosen && (await pick(chosen))) return;
      // Nothing remembered and reachable, or several to choose between. The picker is the honest
      // answer; the preference is left alone, so coming back on the right network still works
      // without choosing again.
      if (!cancelled) setPhase({ k: "picking" });
    })();
    return () => {
      cancelled = true;
    };
  }, [pick]);

  if (phase.k === "chosen")
    // Hand the chosen engine to the project gate; key by wsUrl so switching engines remounts cleanly.
    return (
      <ProjectGate
        key={phase.engine.wsUrl!}
        engine={phase.engine}
        // Re-probe on the way back: the list behind the picker is minutes old by now, and
        // showing a stale one would offer engines that have since gone.
        onChangeEngine={() => {
          setPhase({ k: "picking" });
          void refresh();
        }}
      />
    );

  if (phase.k === "loading")
    return (
      <div className="flex h-full items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );

  return (
    <EngineSelect
      ranked={ranked}
      loading={busy}
      onRefresh={() => void refresh()}
      onPick={(r) => void pick(r)}
    />
  );
}
