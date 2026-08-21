// dsp.dsp — le Wurlitzer, en Faust : deux paires FM sommées, l'algorithme 5 du TX81Z.
// Porté depuis `stk::Wurley` (Synthesis ToolKit, CCRMA), dont les nombres sont repris tels
// quels — voir packages/dsp/docs/wurlitzer.md pour la table de correspondance, les trois
// écarts assumés et ce qui manque encore pour l'entendre.

import("stdfaust.lib");

// --- la note ----------------------------------------------------------------
//
// Les trois noms que l'enveloppe polyphonique de Faust (`mydsp_poly`) remplit elle-même. Ce
// ne sont donc PAS des réglages du panneau et ils n'ont rien à faire dans le `params:` du
// module : ils viennent d'une touche enfoncée, pas d'un potard.
freq = hslider("freq", 440, 27.5, 4186, 0.01);
gain = hslider("gain", 1, 0, 1, 0.01);
gate = button("gate");

// --- les trois réglages -----------------------------------------------------
//
// `control1` et `control2` de STK, sous leurs vrais noms. Les deux valent 1 au repos, ce qui
// est le réglage d'usine de l'instrument.
index = hslider("Index", 1, 0, 2, 0.01); // profondeur de modulation de la paire du corps
tine = hslider("Tine", 1, 0, 2, 0.01); // combien de la paire d'attaque entre dans le mélange
// Le vibrato est à ZÉRO au repos, et c'est celui de STK : `modDepth_` vaut 0 tant qu'un
// contrôleur ne l'ouvre pas. Un Wurlitzer ne vibre pas tout seul.
vibrato = hslider("Vibrato", 0, 0, 0.5, 0.01);

// --- les briques ------------------------------------------------------------

// La table de gains de STK : `fmGains_[i] = 0.933033 ^ (99 - i)`, donc [99] vaut l'unité.
// Recalculée plutôt que recopiée — quatre valeurs sur cent, et la formule dit d'où elles viennent.
fmGain(i) = pow(0.933033, 99 - i);

// Modulation de phase. `m` est en CYCLES et non en radians, comme l'`addPhaseOffset` de STK,
// pour que les gains ci-dessous se lisent contre le C++ sans conversion à faire de tête.
phasemod(f, m) = sin(2 * ma.PI * (os.phasor(1.0, f) + m));

// Le deux-zéros de STK, gain 2 : y = 2·(x − x[n−2]). Il adoucit le modulateur d'attaque avant
// qu'il ne pousse sa porteuse, ce qui est ce qui empêche la frappe de claquer.
tz(x) = 2.0 * (x - x@2);

// Les quatre enveloppes, `setAllTimes(attaque, chute, tenue, relâche)` de Wurley. La tenue est
// à zéro pour les quatre : une lame frappée décroît, elle ne se maintient pas — c'est ce qui
// fait qu'un Wurlitzer est un piano et non un orgue.
e0 = en.adsr(0.001, 1.50, 0.0, 0.04, gate);
e1 = en.adsr(0.001, 1.50, 0.0, 0.04, gate);
e2 = en.adsr(0.001, 0.25, 0.0, 0.04, gate);
e3 = en.adsr(0.001, 0.15, 0.0, 0.04, gate);

vib = os.osc(8.0) * vibrato;

// --- la vélocité entre dans les QUATRE gains, pas dans la sortie -------------
//
// `noteOn` de STK fait `gains_[i] = amplitude * fmGains_[j]` sur les quatre opérateurs, et
// c'est tout le caractère de l'instrument. Le gain d'un MODULATEUR est son indice de
// modulation : le baisser n'atténue pas, ça enlève des harmoniques. Frapper fort ouvre donc le
// timbre en même temps que le niveau — ce qu'une lame fait vraiment.
//
// La première version mettait la vélocité une seule fois, à la sortie. Le résultat sonnait
// juste et ne bougeait pas : chaque note avait exactement le même timbre, seulement plus ou
// moins fort. Sur un piano électrique c'est l'essentiel qui manque.
g(i) = gain * fmGain(i);

// --- les deux paires --------------------------------------------------------
//
// Paire A, le CORPS : l'opérateur 1 (rapport 4) module l'opérateur 0 (rapport 1). C'est la
// partie qui suit la note et qui tient une seconde et demie.
modA = g(82) * e1 * phasemod(freq * 4.0, 0);
carA = g(99) * e0 * phasemod(freq, modA * index);

// Paire B, l'ATTAQUE : l'opérateur 3 module l'opérateur 2, et les deux sont à 510 Hz FIXES —
// un rapport négatif chez STK veut dire une fréquence absolue. D'où le « bark » qui ne
// transpose pas : le bruit du marteau sur la lame est celui du mécanisme, pas de la note.
modB = g(68) * e3 * phasemod(510.0, vib);
carB = g(82) * e2 * phasemod(510.0, tz(modB));

// Le mélange de STK, y compris le facteur 2 de sortie. Plus de `* gain` ici : il est déjà dans
// les quatre gains ci-dessus, et l'appliquer deux fois ferait décroître le niveau au carré.
out = ((1.0 - tine * 0.5) * carA + tine * 0.5 * carB) * 2.0;

// Stéréo par dédoublement : les deux paires sont mono chez STK, et rien ici ne les décorrèle.
// Élargir serait une décision d'effet, pas de modèle, et elle se prend dans la chaîne.
process = out <: _, _;
