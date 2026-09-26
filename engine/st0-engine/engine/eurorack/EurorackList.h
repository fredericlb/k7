// EurorackList.h — every eurorack module, once. PluginScan.cpp expands it twice, into the catalogue
// and into the registrations, which keeps the two from drifting (AirWindowsList.h is the same idea).
// EURORACK(class, role, category). No includes here: it is expanded inside functions — EurorackPlugins.h.

EURORACK(MacroOscillator2Plugin, "instrument", "instrument")
EURORACK(MacroOscillatorPlugin, "instrument", "instrument")
EURORACK(ResonatorPlugin, "instrument", "instrument")
EURORACK(ModalSynthesizerPlugin, "instrument", "instrument")
