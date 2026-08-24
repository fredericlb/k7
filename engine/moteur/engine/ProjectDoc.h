// ProjectDoc — the in-memory representation of a song, deliberately plain and engine-agnostic: the Node brain
// parses the files and sends this as JSON, and EngineHost projects it onto a live Tracktion Edit. Keeping it
// free of Tracktion/JUCE types is what lets two docs be diffed and only the changes applied.

#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace studio {

// Time is in beats in the file format; the engine adapter converts to seconds and samples via the tempo map.
using Beats = double;

// One sound in a `rack` — a MIDI note playing a window of an audio file, becoming a te::SamplerPlugin sound.
struct RackEntry {
    std::string symbol;   // the short label (e.g. "BD") — used as the sound's name
    int note = 0;         // MIDI note 0..127 this sound answers to
    std::string clip;     // absolute path: a per-symbol file for a "samples" rack, the shared source for a "slice"
    double start = 0.0;   // seconds into the file
    double length = 0.0;  // seconds; 0 == the file's natural length
};

struct PluginDoc {
    std::string id;                                    // stable id; falls back to index if empty
    std::string type;                                  // "vst3", "au", "builtin"... ("sampler" for a rack)
    std::string name;                                  // display / builtin device name
    std::string path;                                  // resolved .vstpreset to LOAD (module's, else its base's)
    std::string presetSave;                            // where a UI edit saves THIS module's .vstpreset
    std::string role;                                  // "instrument" | "audioFX" | "noteFX"
    bool enabled = true;
    std::string namFile;                               // .nam model to load (neural amp modeler module); empty otherwise
    // The DSP graph a "DSP Graph" module runs — the JSON DESCRIPTION inline, never a path (DspGraph.h); empty otherwise.
    std::string dspGraph;
    // …and a "Faust" module's SOURCE, likewise inline, but as text for THIS side to compile (FaustPlugin.h).
    std::string faustDsp;
    // The TRACK feeding this plugin's SECOND input port, by id; empty for one input or an unwired port (docs/sidechain.md).
    std::string sidechainFrom;
    std::unordered_map<std::string, double> params;    // param name -> normalised value
    std::vector<RackEntry> rack;                        // rack sounds (type "sampler"); empty for a plain plugin
};

// A single MIDI note within a ClipDoc (beats are relative to the clip).
struct NoteDoc {
    Beats time = 0.0;
    Beats duration = 0.0;
    int key = 0;          // MIDI note number
    double vel = 1.0;     // 0..1
    int channel = 0;
    double rel = 1.0;     // release velocity 0..1

    // A PAD's two effects, UNREALISED — `repeat` retriggers inside the note, `skip` silences every Nth pass; 0 == none (@studio/song docs/padEffects.md).
    int repeat = 0;
    int skip = 0;

    // Compared FIELD BY FIELD by the diff: notes reach the edit only at clip insert, so a changed note must re-insert.
    bool operator==(const NoteDoc& o) const {
        return time == o.time && duration == o.duration && key == o.key && vel == o.vel
            && channel == o.channel && rel == o.rel
            // The effects too, for the same reason: a pad that gained a repeat must re-insert or the change is silent.
            && repeat == o.repeat && skip == o.skip;
    }
    bool operator!=(const NoteDoc& o) const { return ! (*this == o); }
};

enum class ClipType { Audio, Midi };

// Time-stretch for an audio clip: a marker maps a TIMELINE beat to a SOURCE second — two are linear, more piecewise, none no warp (docs/warp.md).
struct WarpDoc {
    std::string algorithm;                          // "elastique" | "slice" | ...
    std::vector<std::pair<Beats, double>> markers;  // (timeline beat, source seconds)
};

struct ClipDoc {
    std::string id;       // stable id; falls back to (source,start) if empty
    ClipType type = ClipType::Audio;
    std::string name;
    std::string source;   // audio: absolute path; midi: empty
    Beats start = 0.0;
    Beats length = 0.0;   // 0 == use the source's natural length
    Beats offset = 0.0;   // audio: source in-point; midi: playStart
    // The clip FILE's window into its source (clips/<id>.yaml from/to) — SECONDS, since a file has no tempo; every placement plays that slice and no more.
    double sourceFrom = 0.0;  // 0 == from the file's start
    double sourceTo = 0.0;    // 0 == to the file's end
    Beats fadeIn = 0.0;
    Beats fadeOut = 0.0;
    Beats loopStart = 0.0;
    Beats loopEnd = 0.0;  // 0 == no loop
    std::vector<NoteDoc> notes;   // midi only
    WarpDoc warp;                 // audio only; empty markers == no warp
    // Silenced without being removed — a track's mute for one event; it stays in the doc because the surfaces DRAW it, dimmed.
    bool disabled = false;
};

// The Tracktion clip name this ClipDoc gets — its PLACEMENT id; every insert and every removal must use it (docs/clipIdentity.md).
std::string clipNameFor(const ClipDoc& c);

// A send from this track to a destination (return) track.
struct SendDoc {
    std::string to;       // destination track id
    double level = 0.0;
    bool enabled = false;
};

struct AutomationDoc {
    std::string param;                              // target parameter name
    std::string pluginId;                           // the plugin this drives (a "chain:module" id)
    bool bipolar = false;                           // source curve polarity: false = 0..1, true = -1..1
    std::vector<std::pair<Beats, double>> points;   // (beat, output) breakpoints, output in the curve's range
};

struct TrackDoc {
    std::string id;       // STABLE identity across edits — never derive from index
    std::string name;
    std::string role;           // "regular" | "effect" | "master"
    std::string contentType;    // "audio" | "notes" | "audio notes"
    std::string color;
    // No volume and no pan: those are a MIXER MODULE at the end of the chain (MixerPlugin), arriving as plugin params.
    bool mute = false;
    bool solo = false;          // soloed track(s) silence the rest of the mixer
    bool disabled = false;      // true ⇒ the track file is ignored (filtered by the brain)
    // The live input feeding this track — 1-BASED PHYSICAL channels (one mono, two stereo), labels resolved by the brain; empty none, indexInDevice 0-based.
    std::vector<int> inputChannels;
    // "off" | "auto" | "on", mapping to te::InputDevice::MonitorMode; ignored when inputChannels is empty.
    std::string monitor = "auto";
    // Input trim in dB at the interface DEVICE, 0 == unity — so two tracks on one physical input share it; ignored when inputChannels is empty.
    double inputGain = 0.0;
    std::vector<PluginDoc> plugins;
    std::vector<ClipDoc> clips;
    std::vector<SendDoc> sends;
    std::vector<AutomationDoc> automation;
};

struct ProjectDoc {
    std::string name = "untitled";
    double tempo = 120.0;
    int sampleRate = 48000;
    int timeSigNumerator = 4;
    int timeSigDenominator = 4;
    // The song's OUTPUT level in dB on the master fader, 0 == unity, written on every build; +6 is the top (docs/protocol.md).
    float masterVolume = 0.0f;
    // The MASTER CHAIN — plugins over the summed mix, MIX to OUT, ahead of the meter and the tap; empty is one wire (packages/song/docs/masterChain.md).
    std::vector<PluginDoc> masterPlugins;
    // The absolute directory a live recording writes into (the brain's <project>/clips) — the one location the engine is told; empty refuses arming.
    std::string recordDir;
    // The metronome enable from settings.yaml: click during playback, emphasising each bar's first beat; a surface toggles it by re-sending.
    bool metronome = false;
    // How loud the click is, 0.2 … 1 (settings.yaml `metronome_level`) — NEVER 0, which Tracktion clamps to 0.2; silence is `metronome` above.
    double metronomeLevel = 0.6;
    // Count-in length in BARS rolled clicking before capture, so the take starts on the beat; 0 == none, and Tracktion clamps above two.
    int countIn = 0;
    std::vector<TrackDoc> tracks;
};

// This translation unit's view of the model's LAYOUT — see AGENTS.md, "a half-rebuilt engine".
inline std::size_t modelLayoutHere() {
    return sizeof(ProjectDoc) * 31u + sizeof(TrackDoc) * 17u + sizeof(ClipDoc) * 7u +
           sizeof(PluginDoc) * 3u + sizeof(SendDoc);
}

// The same number as seen by the units that READ a document — each compiled separately, docs/projectDiff.md.
std::size_t modelLayoutInDiff();
std::size_t modelLayoutInBuilder();

}  // namespace studio
