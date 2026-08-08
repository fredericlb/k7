import { describe, expect, it } from "vitest";
import { modulePreviewDoc } from "./preview";

// Ce que le moteur reçoit quand on arme. Mesuré contre le moteur qui tourne : ce document,
// posé sur la session st0 avec un canal, donne inputLevels ~-94 dB et levels ~-89 dB — donc
// si l'aperçu reste muet, c'est que ces deux champs ne sont pas partis.
describe("modulePreviewDoc et l'entrée live", () => {
  const plugin = { type: "internal", name: "Bass Drive" };

  it("porte les canaux demandés sur la piste", () => {
    const t = modulePreviewDoc("amp", plugin, {}, [3]).tracks[0];
    expect(t?.inputChannels).toEqual([3]);
  });

  it("monitore `on` et non `auto`", () => {
    // `auto` ne monitore qu'une piste ARMÉE au sens enregistrement, et rien ici n'arme :
    // `recordDir` est vide exprès. `on` veut dire « laisse passer quoi que fasse le transport ».
    expect(modulePreviewDoc("amp", plugin, {}, [3]).tracks[0]?.monitor).toBe(
      "on",
    );
    expect(modulePreviewDoc("amp", plugin, {}, []).tracks[0]?.monitor).toBe(
      "on",
    );
  });

  it("ne porte AUCUN canal quand on n'a rien branché", () => {
    // Désarmé, le moteur libère l'entrée de la piste plutôt que de la garder en `off` :
    // le mode de monitoring est une propriété du périphérique, partagée avec ce qui est dessus.
    expect(
      modulePreviewDoc("amp", plugin, {}, []).tracks[0]?.inputChannels,
    ).toEqual([]);
    expect(modulePreviewDoc("amp", plugin).tracks[0]?.inputChannels).toEqual(
      [],
    );
  });

  it("garde le greffon résolu à côté de l'entrée", () => {
    // Les deux doivent voyager ensemble : une entrée câblée sur une piste sans greffon
    // s'entend, mais ne dit rien de ce que le module fait.
    const p = modulePreviewDoc("amp", plugin, {}, [1]).tracks[0]?.plugins[0];
    expect(p).toMatchObject({ type: "Bass Drive", id: "preview:amp" });
  });

  it("n'enregistre jamais — recordDir reste vide", () => {
    expect(modulePreviewDoc("amp", plugin, {}, [1]).recordDir).toBe("");
  });
});
