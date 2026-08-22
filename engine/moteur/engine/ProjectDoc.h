#pragma once

// ProjectDoc — the in-memory representation of a song, deliberately plain and engine-agnostic: the Node brain
// parses the files and sends this as JSON, and EngineHost projects it onto a live Tracktion Edit. Keeping it
// free of Tracktion/JUCE types is what lets two docs be diffed and only the changes applied.

#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace studio {

// Time is in beats in the file format; the engine adapter converts to seconds and samples via the tempo map.
using Beats = double;

// One sound in a `rack`: a MIDI note playing a window of an audio file. `clip` is absolute — a per-symbol clip
// for a "samples" rack, the shared source for a "slice" one — and start/length are seconds (0 == natural).
// Each entry becomes a te::SamplerPlugin sound pinned to `note`.
struct RackEntry {
    std::string symbol;   // the short label (e.g. "BD") — used as the sound's name
    int note = 0;         // MIDI note 0..127 this sound answers to
    std::string clip;     // absolute path to the audio file
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
    // The DSP graph a "DSP Graph" module runs, as JSON — the DESCRIPTION itself, not a path: the compiler has
    // already read (and may have generated) it, and the engine should no more re-read it than it re-reads a
    // chain. See DspGraph.h. Empty for every other plugin.
    std::string dspGraph;
    // …and a "Faust" module's SOURCE, likewise inline. The difference from the line above is who compiles: a
    // graph arrives already described, a Faust program arrives as text for this side to build. See FaustPlugin.h.
    std::string faustDsp;
    // The TRACK feeding this plugin's SECOND input port, by id — empty when it has one input, or when the
    // port is declared and left unwired (which is a legitimate state; see packages/song/docs/ports.md).
    // A track and not a chain: the engine's model has lanes, and Tracktion routes one such source per
    // plugin, so the brain resolves whatever the chains file named down to the lane it compiles onto.
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

    // A step sequencer PAD's two effects, arriving UNREALISED — this side is what expands them
    // (insertMidiClip). `repeat` retriggers the note that many times inside its own duration;
    // `skip` silences it on every Nth pass of the pattern. 0 == none.
    // The compiler deliberately does not resolve them: unrolling `skip` needs the passes written
    // out, and the sequencer draws the very same document. See @studio/song docs/padEffects.md.
    int repeat = 0;
    int skip = 0;

    // Compared FIELD BY FIELD by the diff: a MIDI clip's notes are applied when the clip is
    // inserted and nowhere else, so a clip whose notes changed has to be re-inserted. Without
    // this the whole note vocabulary — add, remove, velocity, move — reached the engine and
    // changed nothing you could hear. See ProjectDiff's clipMoved.
    bool operator==(const NoteDoc& o) const {
        return time == o.time && duration == o.duration && key == o.key && vel == o.vel
            && channel == o.channel && rel == o.rel
            // The effects too, and for exactly the same reason: they are realised at insert time,
            // so a pad that gained a repeat must re-insert or the change is silent.
            && repeat == o.repeat && skip == o.skip;
    }
    bool operator!=(const NoteDoc& o) const { return ! (*this == o); }
};

enum class ClipType { Audio, Midi };

// Time-stretch for an imported audio clip: each marker maps a TIMELINE beat to a SOURCE second, two being a
// linear stretch and more piecewise. Empty markers mean no warp, and the clip plays at its natural rate.
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
    // The clip FILE's window into its source, in SECONDS (clips/<id>.yaml's from/to) — seconds and not beats
    // because they measure into a file, which has no tempo. Every placement plays that slice and no more.
    double sourceFrom = 0.0;  // 0 == from the file's start
    double sourceTo = 0.0;    // 0 == to the file's end
    Beats fadeIn = 0.0;
    Beats fadeOut = 0.0;
    Beats loopStart = 0.0;
    Beats loopEnd = 0.0;  // 0 == no loop
    std::vector<NoteDoc> notes;   // midi only
    WarpDoc warp;                 // audio only; empty markers == no warp
    // Silenced without being removed — a track's mute, for one event. The clip is still
    // in the doc because the surfaces DRAW it (dimmed); this side simply doesn't play it.
    bool disabled = false;
};

// The Tracktion clip name this ClipDoc gets: its PLACEMENT id, which is what tells two placements of
// one material apart. Every insert and every removal must use it — see ProjectDoc.cpp.
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
    // No volume and no pan: a track's level and position are a MIXER MODULE at the end of its chain (see
    // MixerPlugin), so they arrive as plugin params like any other and this struct has nothing to hold.
    bool mute = false;
    bool solo = false;          // soloed track(s) silence the rest of the mixer
    bool disabled = false;      // true ⇒ the track file is ignored (filtered by the brain)
    // The live interface input feeding this track: 1-BASED channel indices, one for mono or two for a stereo pair,
    // empty for none. The brain resolves any label first — the engine has none and sees only physical channels —
    // and these match against WaveInputDevice::getChannels(), whose indexInDevice is 0-based.
    std::vector<int> inputChannels;
    // "off" | "auto" | "on", mapping to te::InputDevice::MonitorMode; ignored when inputChannels is empty.
    std::string monitor = "auto";
    // Input trim in dB applied at the interface device, 0 == unity; ignored when inputChannels is empty. Like
    // the monitor mode this is a property of the DEVICE, so two tracks on one physical input share it.
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
    // The song's OUTPUT level in dB, on the master fader — 0 is unity, and unity is what a doc that
    // says nothing means. It used to be pinned to 0 outright in EditBuilder, because Tracktion's own
    // default of -3 dB was silently costing every mixdown 3 dB; the pin is now this value.
    //
    // +6 is the top of the fader and not a policy: `decibelsToVolumeFaderPosition` is
    // `exp((dB - 6) / 20)` clamped to 1, so anything above +6 sets the same position. The brain's
    // schema refuses it rather than letting it be quietly clamped here.
    float masterVolume = 0.0f;
    // The absolute directory a live recording writes into — the brain's <project>/clips, where an audio clip's file
    // lives. The engine still parses no project files: this is the one location it is told, because a take has to
    // land somewhere before the brain can declare it. Empty means the project cannot record, and arming is refused.
    std::string recordDir;
    // The metronome enable from the project's settings. The engine clicks during playback when true, emphasising
    // each bar's first beat. The single source of truth: a surface toggles it by rewriting settings and re-sending.
    bool metronome = false;
    // How loud the click is, 0.2 … 1 (settings.yaml's `metronome_level`). NEVER 0 — silencing it is
    // `metronome` above, and Tracktion clamps this to those two bounds anyway, so a 0 here would be
    // played as 0.2 and read back as a level nobody chose. Default is Tracktion's own.
    double metronomeLevel = 0.6;
    // Count-in length in BARS. When recording, the transport rolls this many bars clicking before capture, so the
    // take starts cleanly on the beat. 0 means none, and Tracktion's CountIn mode clamps anything above two.
    int countIn = 0;
    std::vector<TrackDoc> tracks;
};

}  // namespace studio
