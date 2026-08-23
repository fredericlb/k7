#pragma once

// Building the Tracktion Edit graph from a ProjectDoc: tempo, tracks with their clips, plugins and aux sends.
// INTERNAL header (it includes Tracktion/JUCE). populateEdit() is shared by the live server path and the offline
// renderer; the smaller helpers are what the incremental diff-apply path also reaches for.

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

// Insert a wave clip (MIDI clips are skipped — see insertMidiClip).
void insertClip(te::Engine& engine, te::Edit& edit, te::AudioTrack& track,
                const ClipDoc& c, const std::string& baseDir);

// Create a MIDI clip on the track from a ClipDoc's notes.
void insertMidiClip(te::Edit& edit, te::AudioTrack& track, const ClipDoc& c);

// Instantiate a plugin from a PluginDoc and insert it at `index` (built-in by xmlTypeName, external from the
// scan cache). Null on failure.
te::Plugin::Ptr addPlugin(te::Edit& edit, te::AudioTrack& track, const PluginDoc& p, int index);

// …the same, onto any plugin list — the master list is the other one. See populateMasterChain.
te::Plugin::Ptr addPluginTo(te::Edit& edit, te::PluginList& list, const PluginDoc& p, int index);

// The song's MIX -> OUT run onto the edit's master list, first, and then the OUT node's own
// `Volume` as a MasterGainPlugin — so the meter and the broadcast tap that buildLevelMeters
// appends sit AFTER both and answer for what actually leaves.
void populateMasterChain(te::Edit& edit, const ProjectDoc& doc);

// That gain, found again on the master list — how the live path takes hold of the one
// populateMasterChain made rather than making a second. Null if there is none.
te::Plugin::Ptr masterGainOf(te::Edit& edit);

// Load one rack sound into `sampler`: the window [start, start+length) seconds of `file`, pinned to `note` and
// open-ended so a short note still plays the whole hit; length <= 0 means the natural length. Shared by the
// rack builder and the editor's sample preview.
bool addRackSound(te::Edit& edit, te::SamplerPlugin& sampler, const std::string& file,
                  const std::string& name, int note, double start, double length);

// Write a plugin's state to a Steinberg .vstpreset container (no-op for built-ins).
bool saveVstPreset(te::Plugin& plugin, const juce::File& file);

// Load a Steinberg .vstpreset into an external plugin (a no-op for built-ins) — the inverse of saveVstPreset,
// also used to apply a preset the user picked without opening the UI.
bool loadVstPreset(te::Plugin& plugin, const juce::File& file);

// Bake a curve automation lane onto a plugin parameter: find it by display name, map each breakpoint onto its
// value range, and replace the curve. Output is the CURVE's range — spanning the param's full range when
// unipolar, or centred on its set value ±half when bipolar. Shared by the full build and the diff path.
void applyAutomationLane(te::Edit& edit, te::Plugin& plugin, const AutomationDoc& lane);

// Build the whole Edit graph from a doc, shared by the live path and the offline renderer. With pluginsOut and
// presetSaveOut, records each created plugin by its PluginDoc id and its preset-save path.
void populateEdit(te::Engine& engine, te::Edit& edit, const ProjectDoc& doc,
                  const std::string& baseDir,
                  std::map<std::string, te::Plugin::Ptr>* pluginsOut = nullptr,
                  std::map<std::string, std::string>* presetSaveOut = nullptr);

}  // namespace studio
