#pragma once

// Reading and writing a plugin's automatable parameters as text (name -> value) — l8's alternative to
// opaque .vstpreset blobs. INTERNAL header (it includes Tracktion/JUCE), shared by the live edit, the graph
// builder, the diff-apply path and the param-dump CLI.

#include "EngineTypes.h"

#include <functional>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace studio {

// One addressable parameter of a plugin, however it is actually stored. Most plugins register
// AutomatableParameters, which a generic walk discovers along with range, default and curve. A few Tracktion
// built-ins register NONE — their controls are CachedValue members on the ValueTree, reachable only if you know
// the concrete class — so this engine carries their metadata by hand (see STATE_PARAMS and docs/builtinParams.md).
// Hence the indirection: everything treating a parameter as "a name holding a number" works for both. Automation
// does not — a curve needs a real AutomatableParameter, so a state param simply cannot be automated.
struct ParamRef {
    juce::String name;               // the display name l8 keys everything by
    std::function<double()> get;
    std::function<void(double)> set;
    std::optional<double> def;       // absent when the plugin publishes no default
    // The value range: an AutomatableParameter publishes its own (an external's is normalised, a built-in's is
    // native), and a state param's is authored. This is what lets a bound widget size itself instead of guessing.
    double min = 0.0, max = 1.0;
    // A DISCRETE parameter's named settings in order, empty for a continuous one. Each carries the VALUE that
    // selects it, taken from the parameter, because the mapping is not always index/(n-1): a built-in spreads its
    // states evenly, but an external's come from VSTXML entries where each state sits at the midpoint of its own
    // sub-range — so a client computing the value from an index would land between states.
    std::vector<std::pair<juce::String, double>> states;
};

// Every parameter of a plugin in a stable order: its automatable ones, or the authored property set for its
// type when it has none. Empty for a plugin with neither, whose state isn't parameters at all.
// `withStates` is OFF by default because collecting it asks an external plugin for every step's display string —
// fine once, ruinous on a hot path: this runs per watched plugin per state frame, and a 138-parameter VST3 made
// that enough work to starve the message thread. States can't change while loaded, so that path never needs them.
std::vector<ParamRef> pluginParams(te::Plugin& plugin, bool withStates = false);

// Ordered (display-name, parameter) pairs with UNIQUE keys — the AUTOMATABLE parameters only. A caller needing
// a curve must use this; one that only reads or writes should use pluginParams(), which also covers built-ins
// that register none. A name is human-readable but not unique, so a repeat gets a deterministic " #n" suffix,
// and an empty name falls back to the paramID — enumerated in parameter order, so suffixing is stable across
// two instances of the same plugin. Both dump and apply key by this, so params round-trip by name.
std::vector<std::pair<juce::String, te::AutomatableParameter*>> namedParams(te::Plugin& plugin);

// name -> current value for EVERY automatable parameter, in parameter order — the opposite of the non-default
// subset paramsJson() emits. That answers "what must be saved"; this answers "what is it holding right now",
// which is what a UI must show: a parameter at its default has a value like any other, and drawing the control
// at its range minimum would misreport it (4OSC's filter opens at 69 of 0..135).
// Keyed like namedParams(), so a caller can also use it as the plugin's parameter LIST.
std::vector<std::pair<std::string, double>> allParams(te::Plugin& plugin);

// Set a plugin's automatable parameters from a text map — l8's replacement for an opaque .vstpreset.
// Values are in each parameter's native range; an unknown name is skipped with a warning.
void applyPluginParams(te::Plugin& plugin, const std::unordered_map<std::string, double>& params);

// A JSON object string of name -> value for the NON-DEFAULT params only: the "preset" in text form, which
// applyPluginParams() restores verbatim onto a fresh instance. Built by hand so arbitrary names are escaped.
juce::String paramsJson(te::Plugin& plugin);

// name -> value (the non-default subset) for re-applying a dumped set in the completeness check.
std::unordered_map<std::string, double> currentParamValues(te::Plugin& plugin);

/**
 * An installed plugin instantiated on nothing, kept for the process — ParamDump.cpp's, since that is
 * where the one offline engine lives.
 *
 * ORPHAN in the strict sense: it sits on the shared offline edit, on no track, wired to nothing,
 * belonging to no session and saved nowhere. That is what makes it answerable at all — the module
 * being authored may name a plugin the open project does not load, or there may be no project.
 *
 * Declared in the params header because asking is what an orphan is FOR. `pluginParamsOf` reads its
 * parameter list and drops it in the same breath; this hands the same instance back and keeps it,
 * for the caller that wants the plugin's own window instead of a list of names — the difference
 * being that a window stays on screen and the instance behind it has to still be there.
 *
 * Null when this machine cannot find, create or LOAD the plugin, exactly as `pluginParamsOf`
 * returns `nullopt` for those three. SECONDS on the first call for a given plugin (it loads a
 * binary), instant thereafter. Any thread — it takes the same lock the param query does.
 */
te::Plugin::Ptr orphanPluginFor(const std::string& formatName, const std::string& identifier);

}  // namespace studio
