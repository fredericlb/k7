// ProjectDiff — the difference between two ProjectDocs as an ordered list of Changes, and the beating heart of
// the text-based model: diffing instead of rebuilding means no audio glitch, plugins keep their internal state
// (a reverb tail, a held note), and a 200-track edit doesn't rebuild because one clip moved.
//
// The scheme depends on STABLE IDENTITY: tracks, clips and plugins match by `id`, falling back to a
// positional/heuristic key when a file omits one (see keyOf()) — so a rename is "same id, new name", not
// remove+add. Ordering matters too: removals before adds, and tracks before their contents, so apply() never
// references a track that doesn't exist yet.

#pragma once

#include <optional>
#include <string>
#include <vector>

#include "ProjectDoc.h"

namespace studio {

enum class ChangeKind {
    // Global — some of these force a full rebuild (see needsFullRebuild).
    TempoChanged,
    TimeSignatureChanged,
    MasterVolumeChanged,      // the song's output fader — applied in place, no rebuild
    MasterChainChanged,       // the MIX -> OUT run — forces full rebuild (see needsFullRebuild)
    SampleRateChanged,        // forces full rebuild: the device must reopen

    // Structural
    TrackAdded,
    TrackRemoved,
    TrackRenamed,
    TrackParamsChanged,       // volume / pan / mute — applied in place
    TrackInputChanged,        // live input channels / monitor mode — applied in place
    TrackOutputChanged,       // which interface pair the track LEAVES by — applied in place, see docs/cueOutput.md

    // Track contents
    ClipAdded,
    ClipRemoved,
    ClipMoved,                // same clip, new start/length
    PluginAdded,
    PluginRemoved,
    PluginParamChanged,
    PluginEnabledChanged,     // bypass toggled — applied in place, like a param
    PatternChanged,           // a pattern lane's source edited — applied in place, so the lane keeps its time
    AutomationChanged,        // coarse for now: whole lane replaced
};

struct Change {
    ChangeKind kind;
    std::string trackId;      // which track (empty for global changes)

    // New-state snapshots, populated per `kind`; they are copies so apply() outlives the docs that produced them.
    std::optional<TrackDoc> track;
    std::optional<ClipDoc> clip;
    std::optional<PluginDoc> plugin;
    std::optional<AutomationDoc> automation;

    // For PluginParamChanged.
    std::string paramName;
    double paramValue = 0.0;

    // For PluginEnabledChanged: the plugin's new bypass state.
    bool enabled = true;

    // Global scalars (tempo / time sig).
    double doubleValue = 0.0;
    int intA = 0, intB = 0;
};

using ProjectDiff = std::vector<Change>;

// Produce the ordered changeset that turns `from` into `to`.
ProjectDiff diff(const ProjectDoc& from, const ProjectDoc& to);

// True when any change can't be applied incrementally and the caller should fall back to applyFull().
bool needsFullRebuild(const ProjectDiff&);

// Human-readable one-liner per change, for the UI log ("~ track drums: gain 0.8").
std::string describe(const Change&);

}  // namespace studio
