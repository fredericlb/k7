#pragma once

// Building the Tracktion Edit graph from a ProjectDoc — INTERNAL header (it includes Tracktion/JUCE). See docs/editBuilder.md.

#include "EngineTypes.h"
#include "ProjectDoc.h"

#include <map>
#include <string>

namespace studio {

// Map the document's track id to the engine track at the same index (null if none).
te::AudioTrack* trackById(te::Edit& edit, const std::string& id, const ProjectDoc& doc);

// Apply the "cheap" per-track params Tracktion supports directly (volume/pan/mute).
void applyTrackParams(te::AudioTrack& track, const TrackDoc& t);

// Re-apply mute across the whole mixer to resolve solo (a mixer-wide relationship).
void applySoloMute(te::Edit& edit, const ProjectDoc& doc);

// The files a module loads, where they differ from `was` (all of them when null); params are the caller's, since a preset overrides them.
void loadPluginFiles(te::Edit& edit, te::Plugin& plugin, const PluginDoc& p, const PluginDoc* was);

// A sampler's sounds made to match `p.rack`, slot by slot, touching only what differs.
void reloadRack(te::Edit& edit, te::Plugin& plugin, const PluginDoc& p);

// A module's second input aimed at `from` through `doc`, or unwired when `from` is empty.
void wireSidechain(te::Edit& edit, te::Plugin& plugin, const std::string& from, const ProjectDoc& doc);

// One track's send LEVELS on the live aux sends, found by the bus the plan gives them — only valid while the routing signature is unchanged.
void applySendLevels(te::Edit& edit, const ProjectDoc& doc, const std::string& trackId);

// Insert a wave clip (MIDI clips are skipped — see insertMidiClip).
void insertClip(te::Engine& engine, te::Edit& edit, te::AudioTrack& track,
                const ClipDoc& c, const std::string& baseDir);

// Create a MIDI clip on the track from a ClipDoc's notes.
void insertMidiClip(te::Edit& edit, te::AudioTrack& track, const ClipDoc& c);

// Instantiate a plugin from a PluginDoc and insert it at `index` (built-in by xmlTypeName, external from the scan cache); null on failure.
te::Plugin::Ptr addPlugin(te::Edit& edit, te::AudioTrack& track, const PluginDoc& p, int index);

// …the same, onto any plugin list — the master list is the other one. See populateMasterChain.
te::Plugin::Ptr addPluginTo(te::Edit& edit, te::PluginList& list, const PluginDoc& p, int index);

// The song's MIX -> OUT run onto the edit's master list, then the OUT node's own `Volume` as a MasterGainPlugin — docs/editBuilder.md.
void populateMasterChain(te::Edit& edit, const ProjectDoc& doc,
                         std::map<std::string, te::Plugin::Ptr>* pluginsOut = nullptr);

// That gain, found again on the master list, so the live path takes hold of it rather than making a second; null if there is none.
te::Plugin::Ptr masterGainOf(te::Edit& edit);

// Load one rack sound: the window [start, start+length) of `file`, pinned to `note` and open-ended; length <= 0 means its natural length.
// `subject` is the PluginDoc id a failure belongs to, so a surface can badge the node; empty for a sound that is on no node, like a preview.
bool addRackSound(te::Edit& edit, te::SamplerPlugin& sampler, const std::string& file,
                  const std::string& name, int note, double start, double length,
                  const std::string& subject = {});

// Write a plugin's state to a Steinberg .vstpreset container (no-op for built-ins).
bool saveVstPreset(te::Plugin& plugin, const juce::File& file);

// Load a Steinberg .vstpreset into an external plugin (a no-op for built-ins) — the ONE reader of that container, docs/plugins.md.
bool loadVstPreset(te::Plugin& plugin, const juce::File& file);

// Bake an automation lane onto a plugin parameter, found by display name: unipolar spans its range, bipolar rides ±half around its set value.
void applyAutomationLane(te::Edit& edit, te::Plugin& plugin, const AutomationDoc& lane);

// Build the whole Edit graph from a doc; pluginsOut and presetSaveOut record each created plugin by its id and its preset-save path.
void populateEdit(te::Engine& engine, te::Edit& edit, const ProjectDoc& doc,
                  const std::string& baseDir,
                  std::map<std::string, te::Plugin::Ptr>* pluginsOut = nullptr,
                  std::map<std::string, std::string>* presetSaveOut = nullptr);

}  // namespace studio
