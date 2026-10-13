// dsp.dsp — le passe-bas en échelle de Moog, en Faust. La source que le moteur compile :
// deux réglages, un filtre par canal, et rien d'autre. Voir module.yaml à côté, et
// packages/song/docs/faustModules.md pour ce que le moteur en fait.

import("stdfaust.lib");

// `si.smoo` lisse le saut d'un potard entre deux blocs — le zipper que `glide` évite côté
// @studio/dsp, ici en une seule fonction de la bibliothèque standard.
cutoff = hslider("Cutoff", 1200, 20, 20000, 1) : si.smoo;
res    = hslider("Res", 0.3, 0, 0.95, 0.01) : si.smoo;

// Deux instances plutôt qu'une : un module est stéréo, et les deux voies ne partagent aucun
// état. C'est ce que `par` dit, et c'est aussi ce que le moteur attend d'un module audio.
process = par(i, 2, ve.moog_vcf(res, cutoff));
