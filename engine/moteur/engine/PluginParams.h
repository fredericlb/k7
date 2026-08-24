#pragma once

// A plugin's parameters as text (name -> value), st0's alternative to an opaque .vstpreset — INTERNAL header (it includes Tracktion/JUCE).

#include "EngineTypes.h"

#include <functional>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace studio {

// One addressable parameter, however it is stored: automatable, or a ValueTree property this engine names by hand (docs/builtinParams.md).
struct ParamRef {
    juce::String name;               // the display name st0 keys everything by
    std::function<double()> get;
    std::function<void(double)> set;
    std::optional<double> def;       // absent when the plugin publishes no default
    // The value range, so a bound widget sizes itself: an AutomatableParameter publishes its own, a state param's is authored.
    double min = 0.0, max = 1.0;
    // A DISCRETE parameter's named settings in order, each carrying the VALUE that selects it — the mapping is not always index/(n-1).
    std::vector<std::pair<juce::String, double>> states;
};

// Every parameter in a stable order: the automatable ones plus this type's authored property set. `withStates` costs — docs/plugins.md.
std::vector<ParamRef> pluginParams(te::Plugin& plugin, bool withStates = false);

// Ordered (display-name, parameter) pairs with UNIQUE keys, AUTOMATABLE only — what a curve needs; a repeated name gets a deterministic " #n".
std::vector<std::pair<juce::String, te::AutomatableParameter*>> namedParams(te::Plugin& plugin);

// name -> current value for EVERY automatable parameter, keyed like namedParams() — what a UI shows, unlike paramsJson()'s non-default subset.
std::vector<std::pair<std::string, double>> allParams(te::Plugin& plugin);

// Set a plugin's parameters from a text map, in each parameter's native range; an unknown name is skipped with a warning.
void applyPluginParams(te::Plugin& plugin, const std::unordered_map<std::string, double>& params);

// A JSON object of name -> value for the NON-DEFAULT params only — the "preset" in text form, restored verbatim by applyPluginParams().
juce::String paramsJson(te::Plugin& plugin);

// name -> value (the non-default subset) for re-applying a dumped set in the completeness check.
std::unordered_map<std::string, double> currentParamValues(te::Plugin& plugin);

/** An installed plugin instantiated on nothing and kept for the process — docs/plugins.md; null when it cannot be found, created or LOADED. */
te::Plugin::Ptr orphanPluginFor(const std::string& formatName, const std::string& identifier);

/** …and the same orphan ONLY IF one is already loaded, never creating it — the distinction is the point, docs/plugins.md. */
te::Plugin::Ptr orphanPluginIfLoaded(const std::string& formatName, const std::string& identifier);

}  // namespace studio
