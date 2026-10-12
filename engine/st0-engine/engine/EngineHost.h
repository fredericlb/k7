// EngineHost — owns the Tracktion Engine and projects a ProjectDoc onto a live Edit. The ONLY layer that
// includes Tracktion/JUCE, and its interface keeps them out (forward decls only), so the WebSocket server
// compiles without seeing JUCE. applyFull() builds from scratch; apply(target) diffs and mutates in place,
// which stable ids are what make possible. See docs/engineHost.md.

#pragma once

#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "ProjectDoc.h"
#include "ProjectDiff.h"
#include "WaveformTap.h"     // WaveformEnvelope — pure C++, no JUCE
#include "RecorderTap.h"     // RecorderTake — likewise, and for the same reason

// Forward-declare to keep Tracktion headers out of this interface.
namespace tracktion { inline namespace engine {
class Engine;
class Edit;
}}  // namespace tracktion::engine

namespace studio {

// One recorder node's ring and takes. FORWARD-declared: its own header sees JUCE, and this one is
// the public interface, which does not — the same rule Impl follows (docs/recorder.md).
class RecorderNode;

// A discovered plugin (plain struct — no JUCE in this interface).
struct PluginInfo {
    std::string name;
    std::string format;        // "VST3", "LADSPA", …
    std::string manufacturer;
    std::string identifier;    // file path / unique id
    bool isInstrument = false;
    std::string role;          // "instrument", "audioEffect", or "midiEffect"
    std::string descXml;       // the full juce::PluginDescription as XML, so nothing re-introspects the binary (empty in older caches)
    std::string category;      // what KIND of effect this is, lower case, '' when unknown — not a taxonomy; see docs/engineHost.md
};

// An available audio interface (a plain struct — no JUCE here), identified by name + type since several backends offer one device. See docs/engineHost.md.
struct AudioDeviceInfo {
    std::string name;
    std::string type;  // the backend offering it: "ASIO", "Windows Audio", …
    int inputs = 0;    // input channel count (0 if unknown until opened)
    int outputs = 0;   // output channel count
    bool current = false;   // the device currently open — its OUTPUT side
    bool currentInput = false; // the device the open setup takes its INPUTS from, which may be another one
    bool isDefault = false; // its backend's default device
};

class EngineHost {
public:
    EngineHost();
    ~EngineHost();

    // Open the default stereo output; playback is silent until it runs. Call once, on the message thread, before the first apply(). See docs/engineHost.md.
    void openAudioDevice();

    // Build a fresh Edit from the document, kept as the diff baseline; baseDir resolves clip/plugin paths (empty when they are already absolute).
    void applyFull(const std::string& session, const ProjectDoc& doc, const std::string& baseDir);

    // Move the engine to `target` by the smallest set of changes, falling back to a full rebuild when one demands it; returns the changeset for logging.
    ProjectDiff apply(const std::string& session, const ProjectDoc& target, const std::string& baseDir);

    // Forget the project entirely, leaving the engine alive with its audio device and scan cache, so the next apply rebuilds fully. Message-thread only.
    void reset(const std::string& session);

    // The document realised in the engine (the next diff's source); the empty doc for a session nobody has sent one to — asking never creates it.
    const ProjectDoc& current(const std::string& session) const;

    // Transport controls (message-thread only).
    void play(const std::string& session);
    void stop(const std::string& session);
    /** Stop, then tell every plugin to let go AND reset — what a stop that did not work asks for. */
    void panic(const std::string& session);
    void rewind(const std::string& session); // move the playhead back to the start (beat 0)
    // Forget every session holding nothing and quiet for `ttlMs`, returning how many went; called by the state timer. See docs/sessions.md.
    size_t reapEmptySessions(double ttlMs);

    // A socket DRIVING this session arrived, or went — a surface somebody looks at, never the file service's. Message-thread only. See docs/engineHost.md.
    void addDriver(const std::string& session);
    void removeDriver(const std::string& session);

    // Free the Edit, plugins and meters of every project whose last driver left over `graceMs` ago; the SESSION stays. See docs/engineHost.md.
    size_t releaseAbandonedProjects(double graceMs);

    // This session's record enable: play() records its armed tracks only while this is on. Message-thread only.
    void setRecordEnabled(const std::string& session, bool on);
    bool recordEnabled(const std::string& session) const;
    // Whether anything is WATCHING this session — a waveform tap or a followed plugin; the state timer's test for a full-rate frame. See docs/protocol.md.
    bool sessionWatched(const std::string& session) const;
    void seek(const std::string& session, double seconds); // move the playhead to an absolute position (clamped at 0)
    // Set the transport loop [start, end) in seconds and turn looping on or off; playback wraps engine-side, and play() starts from the top. Message-thread only.
    void setLoop(const std::string& session, double startSeconds, double endSeconds, bool enabled);
    /** The transport loop as the engine holds it — what a client that reconnects draws, having no memory of setting it. */
    struct LoopState {
        bool on = false;
        double startSeconds = 0.0;
        double endSeconds = 0.0;
    };
    LoopState loop(const std::string& session) const;
    bool isPlaying(const std::string& session) const;
    double playheadSeconds(const std::string& session) const;

    // Audition `file` from `startSeconds` through a hidden one-shot SamplerPlugin voice, transport-independent; length <= 0 plays it whole. Message-thread only.
    void previewSample(const std::string& session, const std::string& file, double startSeconds, double lengthSeconds);

    // Audition one note on a TRACK'S OWN chain — what the piano roll's click plays; velocity 0..1, released after 100 ms. Message-thread only.
    void previewNote(const std::string& session, const std::string& trackId, int key, float velocity);

    // A keyboard PLAYED into a track's own chain: one channel message, held until its own note-off arrives (docs/protocol.md). Message-thread only.
    void liveMidi(const std::string& session, const std::string& trackId, const std::vector<uint8_t>& bytes);

    // Per-track output level in dB, for meters (-100 == silent).
    float trackLevelDb(const std::string& session, int trackIndex) const;

    // Per-track live INPUT peak since the last poll, in doc order (-100 with no input) — what an armed track would capture. Feeds trackInputLevelsDb.
    std::vector<float> inputLevelsDb(const std::string& session) const;

    // One metered channel set: its peak, and whether this rig HAS a device carrying it — without `found`, "nothing plugged in" and "no such channel" are both -100.
    struct ChannelLevel {
        float db = -100.0f;
        bool found = false;
    };

    // Peak dB per channel set, in order — the INTERFACE, not the song. Read off the tuner's own tap, which it ATTACHES on the first ask and leaves on. Message-thread only.
    std::vector<ChannelLevel> channelLevelsDb(const std::vector<std::vector<int>>& channelSets);

    // How this rig actually groups its inputs: one entry per wave input device with the 1-based channels it carries — stereo pairing is the normal case.
    struct InputDeviceInfo {
        std::string name;
        std::vector<int> channels;
        bool enabled = false;
    };
    std::vector<InputDeviceInfo> inputDevices() const;

    // Pair the input carrying `channel` (1-based) with its hardware partner, or split it back; false with no interface open. Message-thread only, docs/engineHost.md.
    bool setInputStereo(int channel, bool stereo);

    // One channel set's pitch, for the I/O panel's tuner; `hz` is 0 when nothing convincing was heard — the honest answer for silence, noise and a chord alike.
    struct ChannelPitch {
        float hz = 0.0f;
        float clarity = 0.0f;
    };

    // Fundamental per channel set, from each set's first channel since a stereo pair carries one instrument; starts the input tap on first call. Message-thread only.
    std::vector<ChannelPitch> channelPitches(const std::vector<std::vector<int>>& channelSets);

    // Peak dB leaving the master, read off the LevelMeterPlugin buildLevelMeters appends — an output DEVICE carries no measurer. -100 with no edit loaded.
    float masterLevelDb(const std::string& session) const;

    /** The master output for the STATE FRAME: peak and overload since the last one, through its own reader (EngineHostImpl's masterStateClient). */
    struct MasterLevel {
        float dB = -100.0f;
        bool overload = false;
    };
    MasterLevel masterState(const std::string& session) const;

    // --- Waveform taps (message-thread only; call via post()) ---------------

    // Enable a module's waveform tap — `id` the PluginDoc id, `side` input or output; a no-op when already on, and the TRACK comes from the plugin, never the caller.
    void enableWaveformTap(const std::string& session, const std::string& id, const std::string& side);

    // Disable waveform tapping for a module. Removes the tap plugin from the chain.
    void disableWaveformTap(const std::string& session, const std::string& id, const std::string& side);

    // Drain every active tap at once, keyed "chain:module:side" — no per-module drain exists, so nothing can empty one the state timer is about to read.
    std::map<std::string, std::vector<WaveformEnvelope>> drainAllWaveformTaps(const std::string& session);

    // --- The RECORDER node: a tape machine the DOCUMENT declares, free-running and transport-independent. docs/recorder.md.

    // What a recorder verb answered; `error` is the sentence the client shows, empty when ok.
    struct RecorderResult {
        bool ok = false;
        std::string error;
    };

    // Start or stop the take on that node; idempotent, so two clients cannot fight over one light.
    RecorderResult setRecorderRecording(const std::string& session, const std::string& id, bool on);

    // Drop the most recent take, file and all. Stops first if it is the one being written.
    RecorderResult clearLastTake(const std::string& session, const std::string& id);

    // Send every recorder's WHOLE picture on the next state frame rather than only what is new.
    // What a client that just connected needs, and harmless for the ones already drawing it.
    void rewindRecorderEnvelopes(const std::string& session);

    // Whether ANY node is recording — the state pump asks before it decides a session is idle.
    bool anyRecording(const std::string& session) const;

    // …and whether THIS one is, which is what a toggle needs: `anyRecording` would flip the wrong
    // node the moment a project has two.
    bool recorderRecording(const std::string& session, const std::string& id) const;

    // One node as the state frame carries it: `envelope` is the points SINCE THE LAST POLL, and
    // `envelopeFrom` where they START in the take — what lets a client tell an append from a resend.
    struct RecorderReport {
        bool recording = false;
        double seconds = 0.0;
        std::vector<RecorderTake> takes;
        std::vector<WaveformEnvelope> envelope;
        size_t envelopeFrom = 0;
    };

    // Drain every recording node onto its file and report them all — the state tick's, message thread.
    std::map<std::string, RecorderReport> pumpRecorders(const std::string& session);

    // Point every RecorderPlugin in the running edit at its session-owned ring; after each build.
    void attachRecorderTaps(const std::string& session);

    // --- Audio broadcast: the mix copied out for the network only once somebody asks, and NOT uniformly message-thread — read each method. docs/broadcast.md.

    // Put the tap on the master plugin list or take it off; idempotent, reasserted by buildLevelMeters. ON creates the session, OFF never — docs/sessions.md.
    void enableBroadcast(const std::string& session, bool on);

    // What a drain answered with; `lostFrames` is what the writer overwrote before the sender reached it — a real hole, reported as a sequence jump.
    struct BroadcastChunk {
        std::vector<float> samples;   // interleaved, channels() per frame
        size_t frames = 0;
        size_t lostFrames = 0;
        double sampleRate = 0.0;
    };
    static constexpr int broadcastChannels() { return 2; }

    // Take up to `maxFrames`; empty between audio callbacks, the ordinary case. SENDER THREAD ONLY and exactly one — the ring is SPSC. See docs/engineHost.md.
    BroadcastChunk drainBroadcast(const std::string& session, size_t maxFrames);

    // Drop whatever is buffered and resume from live, on drainBroadcast's thread — an arriving listener hears now, not the ring's third of a second.
    void skipBroadcastToLive(const std::string& session);

    // Open a plugin's OWN window rather than the module's widget grid; `id` is the PluginDoc id, and only external plugins have one. Message-thread only.
    void showNativePluginUI(const std::string& session, const std::string& id);

    // One entry per plugin instance in the loaded edit — id, display name, and whether it has a native window (built-ins false). Feeds the tray's submenu.
    struct PluginInstanceInfo {
        std::string id;
        std::string name;
        bool hasNativePluginUI;
    };
    std::vector<PluginInstanceInfo> pluginInstanceInfos(const std::string& session) const;

    // A selectable preset for an external plugin: a program list entry (by `index`) or a .vstpreset in the standard folders (by `path`). A plain struct — no JUCE.
    struct PresetInfo {
        std::string name;
        std::string source;   // "program" | "file"
        int index = -1;       // program list index (source "program")
        std::string path;     // absolute .vstpreset path (source "file")
    };

    // The presets a MODULE's live external plugin offers — its program list plus the .vstpreset files for it; empty when there is none. Message-thread only.
    std::vector<PresetInfo> listPresets(const std::string& session, const std::string& module);

    // Load a preset into EVERY live instance of `module` and persist it to the module's own .vstpreset; a non-empty `presetPath` wins over `programIndex`.
    void setPreset(const std::string& session, const std::string& module, int programIndex,
                   const std::string& presetPath);

    // Set one automatable parameter on the LIVE plugin only, in its native range — persistence is the caller's, and this drag path never logs. Message-thread only.
    void setPluginParam(const std::string& session, const std::string& id, const std::string& name, double value);

    // Every automatable parameter of `id` with its CURRENT value, defaults included — "what is it holding", not what must be SAVED; empty when no such plugin.
    std::vector<std::pair<std::string, double>> pluginParams(const std::string& session, const std::string& id) const;

    // The same set plus what a control needs to draw itself: the range and the default, in the parameter's OWN units. See docs/engineHost.md.
    struct PluginParamInfo {
        std::string name;
        double value, min, max;
        bool hasDefault;
        double def;
        // A discrete parameter's named settings, each with the value that selects it and never its index; empty when continuous — see ParamRef::states.
        std::vector<std::pair<std::string, double>> states;
    };
    std::vector<PluginParamInfo> pluginParamInfos(const std::string& session, const std::string& id) const;

    // Start or stop watching a plugin's parameters, feeding onPluginParamsLive; off by default, and an unloaded id is accepted. Message-thread only, docs/engineHost.md.
    void watchPluginParams(const std::string& session, const std::string& id, bool on);

    // --- Record arming (message-thread only; call via post()) -------------

    // The outcome of setArmed: the resulting state, or why it was refused.
    struct ArmResult {
        bool ok = false;
        bool armed = false;      // the state the track is now in (when ok)
        std::string error;       // why it was refused (when !ok) — shown to the user
    };

    // Arm or disarm a track; an unset `armed` TOGGLES, resolved here rather than by the caller, and a track with no live input is refused. See docs/engineHost.md.
    ArmResult setArmed(const std::string& session, const std::string& trackId, std::optional<bool> armed);
    // The currently armed track ids, in doc order. Read for the state broadcast.
    std::vector<std::string> armedTracks(const std::string& session) const;

    // The open output device's name, or "" — which means the engine can neither sound nor KEEP TIME, the playhead needing that callback. Message-thread only.
    std::string outputDeviceName() const;

    // What the OPEN device costs in time — buffer and rate, both zero when none is open, meaning "not measured". Two atomics, so ANY thread. docs/engineHost.md.
    struct AudioTiming {
        int bufferFrames = 0;
        double sampleRate = 0.0;
    };
    AudioTiming audioTiming() const;

    // Re-read the open device and publish what it costs, after anything that opens, closes or re-buffers one. MESSAGE THREAD ONLY: it dereferences the device.
    void publishAudioTiming();

    // What the audio CALLBACK has cost since the last reset. Tracktion measures it on the audio thread itself and stores it in an atomic, so ANY thread may read — docs/audit-stabilite.md.
    struct CallbackCost {
        double meanSeconds = 0.0;
        double maxSeconds = 0.0;   // the block that came closest to the deadline: what a driver notices
        double minSeconds = 0.0;
        long long runs = 0;
        double deadlineSeconds = 0.0;  // frames / rate — over it the driver is waiting on us
    };
    CallbackCost callbackCost() const;
    void resetCallbackCost();

    // Once a second: when the OPEN device has stopped calling back, reopen that same device and re-wire the inputs. MESSAGE THREAD ONLY. docs/audioDevice.md.
    void checkAudioCallback();
    // Once a second, Android only: a device that underran gets the next buffer size up, to a cap. MESSAGE THREAD ONLY. docs/android.md.
    void checkXRuns();

    // Enumerate the interfaces (ASIO first) and open one for input and output, false when not found; an empty `type` is "any backend". See docs/engineHost.md.
    std::vector<AudioDeviceInfo> listAudioDevices();
    bool setAudioDevice(const std::string& name, const std::string& type = {});

    // --- Server support: a frontend in another process or language, with all JUCE threading behind this API ------

    /** One plugin's cost, for the node that holds it — docs/load.md. */
    struct PluginLoad {
        double cpu = 0.0;     // its share of an audio block's time, 0..1, smoothed by Tracktion
        int64_t bytes = -1;   // what it says it holds (HeldMemory); -1 when it cannot say
    };

    // A snapshot the server pushes to clients.
    struct EngineState {
        // WHICH session this frame describes; empty is the default one. On every frame, because with N sessions an unlabelled one is a frame nobody can route.
        std::string session;
        bool playing = false;
        double playheadSeconds = 0.0;
        // The transport loop, on every frame like the playhead: a page reloaded mid-loop learns it here, never from itself.
        LoopState loop;
        std::vector<float> trackLevelsDb;   // one per track, -100 == silent
        // Live INPUT peak per track, indexed like trackLevelsDb (-100 with none): read for every track so the two line up, surfaced only for armed ones.
        std::vector<float> trackInputLevelsDb;
        // Ids of the record-armed tracks — SESSION state, read off the Edit Tracktion never saves rather than held twice. See docs/engineHost.md.
        std::vector<std::string> armedTracks;
        // This session's record enable: an armed track records only while this is on and the transport rolls. Session state, like the armed set.
        bool recordEnabled = false;
        // The MASTER output in dB (-100 == silent) — one number for the whole song, where trackLevelsDb is one per lane.
        float masterLevelDb = -100.0f;
        // LATCHED by Tracktion between reads: "it overloaded since the last frame", not "it is over now" — a 20 Hz poll would step over almost every clip.
        bool masterOverload = false;
        // Per-module waveform envelopes keyed "chain:module:side", each drained since the last poll; an empty map when no taps are active.
        std::map<std::string, std::vector<WaveformEnvelope>> waveformEnvelopes;
        // Each PLATTER's needle in seconds of its own record, by plugin id — its own clock, docs/turntable.md.
        std::map<std::string, double> platterSeconds;
        // Each RECORDER node's state, by plugin id — empty when the project declares none.
        std::map<std::string, RecorderReport> recorders;
        // Every plugin's cost and the process's memory, on a frame in four: they change slowly, and a frame without them keeps the last (docs/load.md).
        bool hasLoad = false;
        std::map<std::string, PluginLoad> pluginLoads;
        int64_t processBytes = -1;
    };

    /** Every plugin of this session's cost, keyed by plugin id. MESSAGE thread. */
    std::map<std::string, PluginLoad> pluginLoads(const std::string& session) const;

    /** Every PLATTER's needle in this session, keyed by plugin id — empty when the deck plays a clip. */
    std::map<std::string, double> platterPositions(const std::string& session) const;

    /** The sessions that exist, in id order. The state timer walks this; the broadcast sender does too, so ANY THREAD — the registry copies them out under its lock. */
    std::vector<std::string> sessionIds() const;
    // Whether a session by that id exists, without creating it; any thread, like sessionIds().
    bool hasSession(const std::string& id) const;

    /** What one session holds — a summary and not a `ProjectDoc`, since the tray draws a menu line and the document would be a megabyte per poll. */
    struct SessionInfo {
        std::string id;
        /** The loaded project's name; meaningless unless `loaded`, since a fresh doc says "untitled". */
        std::string project;
        /** Whether a project has been applied at all — a named session can exist holding nothing. */
        bool loaded = false;
        bool playing = false;
        int trackCount = 0;
    };

    /** A summary of every session, in id order. Message thread: it reads the live edits. */
    std::vector<SessionInfo> sessionInfos() const;

    /** Forget a session entirely. What `flush` means once it addresses one project. */
    void dropSession(const std::string& session);

    // Marshal `fn` onto the engine (message) thread — safe from any thread, which is how the network thread mutates.
    void post(std::function<void()> fn);

    // Invoke `cb` with a fresh snapshot every intervalMs, on the engine thread.
    void onState(std::function<void(const EngineState&)> cb, int intervalMs = 50);

    // Sink invoked on the message thread once a plugin's editor closes and text params captured it, as JSON; leads with its session.
    void onPluginParams(std::function<void(const std::string& session, const std::string& id,
                                           const std::string& paramsJson)> cb);

    // watchPluginParams' sink: an id and its FULL parameter set whenever any value moved — deliberately NOT onPluginParams. See docs/engineHost.md.
    void onPluginParamsLive(
        std::function<void(const std::string& session, const std::string& id,
                           const std::vector<std::pair<std::string, double>>& params)> cb);

    // Report any watched plugin whose parameters moved; called by the state timer, so a watch is SAMPLED at the meters' cadence. See docs/engineHost.md.
    void pumpPluginParamWatches(const std::string& session);

    // The sink invoked once a take is finished, closed and renamed: track id, absolute .wav path, and position in SECONDS. See docs/engineHost.md.
    void onRecorded(std::function<void(const std::string& session, const std::string& trackId,
                                       const std::string& file, double startSeconds,
                                       double lengthSeconds)> cb);

    // Run the engine/message loop; blocks until quit(). Call on the main thread.
    void run();
    void quit();

private:
    // Drop everything derived from the current project — editors, plugin refs, preset state, meters — editors first, so none outlives its plugin.
    void teardownProjectState(const std::string& session);

    // Append a per-track LevelMeterPlugin + metering client after a rebuild, so trackLevelDb() has levels to report.
    void buildLevelMeters(const std::string& session);

    // Project the doc's metronome flag onto the Edit's click track, on every apply path after the session's `current` is updated; a no-op with no Edit.
    void applyMetronome(const std::string& session);

    // Point a track at its live input (or clear it) and set the monitor mode; runs AFTER ensureContextAllocated(), the input instances living on the context.
    void applyTrackInput(const std::string& session, const TrackDoc& t);
    // Re-apply every track's input, for the full-rebuild path where the whole playback context was just replaced.
    void applyAllTrackInputs(const std::string& session, const ProjectDoc& doc);
    // The same after an INTERFACE change, restoring the arm flags from the sets read BEFORE the switch — after it there is nothing left. See docs/audioDevice.md.
    void reconnectTrackInputs(const std::map<std::string, std::vector<std::string>>& armedBefore);

    // Send a track out by its own interface pair rather than the mixer's sum — what a CUE bus is. See docs/cueOutput.md.
    void applyTrackOutput(const std::string& session, const TrackDoc& t);
    // Re-route every track that asked for one, for the full-rebuild path where the tracks were just remade.
    void applyAllTrackOutputs(const std::string& session, const ProjectDoc& doc);

    // Name each armed track's take and point the input devices at recordDir_, from play() just before the roll; false (and logged) with no recordDir.
    bool prepareTakes(const std::string& session);

    // This node's ring and take state, minted on first use — a recorder is not known until asked for.
    RecorderNode& recorderNode(const std::string& session, const std::string& id);

    // Create once and attach the record listener to the current edit's transport; defined in Recording.cpp, where RecordListener is complete.
    void attachRecordListener(const std::string& session);

    // Catches the end of a take: a friend rather than a copy of the pending take names, the doc and the edit it needs to name what was recorded.
    friend struct RecordListener;

    // Owns the plugin-editor windows and param/preset persistence; a friend purely to name Impl, which is private.
    friend class PluginEditorController;

    struct Impl;
    std::unique_ptr<Impl> impl_;
    // Nothing project-shaped is left here: `current_`, `baseDir_` and `recordEnabled_` describe a project, and there are N of those, so they moved INTO the session.
};

// --- Plugin discovery, out-of-process and cached in `<state>/exts.json`; what each entry point does is in docs/engineHost.md ---
std::vector<PluginInfo> loadPluginCache();
std::vector<PluginInfo> scanInstalledPlugins(bool forceRescan);
/** Whether this build can host an external plugin at all — false on Android, where only the built-ins exist. */
bool hostsExternalPlugins();
/** Whether `<state>/exts.json` needs no scan: written, holding this binary's built-ins, and an external if this build can host one. */
bool pluginCacheWarm();
int runPluginScanChild(const std::string& format, const std::string& identifier);
int runPluginScanCli(bool forceRescan);

// Entry for `--list-audio-devices`: the interfaces as sentinel-fenced JSON, ASIO first, from a bare device manager — no device opened, no engine started.
int runAudioDevicesCli();

// A plugin's automatable parameters as sentinel-fenced JSON, st0's text alternative to an opaque .vstpreset; `--dump-params` / `-ext`. See docs/engineHost.md.
int dumpPluginParams(const std::string& type);
int dumpPluginParamsExternal(const std::string& format, const std::string& identifier,
                             const std::string& stateFile);

// Every BUILT-IN's full parameter list as sentinel-fenced JSON — what a plugin TYPE HAS, where `--dump-params` emits what one instance holds. docs/builtinParams.md.
int dumpBuiltinParams();
// Surge XT's parameters and its oscillator and effect slot names as JSON on stdout; 1 when Surge is not compiled in.
int dumpSurgeLayout();

/** One parameter of a plugin TYPE — name, span, named settings. A plain struct like PluginInfo beside it: the server serialises this and must not see JUCE. */
struct PluginParamInfo {
    std::string name;
    double min = 0.0, max = 1.0;
    bool hasDefault = false;
    double def = 0.0;
    /** A discrete parameter's settings in order, each with the VALUE that selects it — the mapping is not always index/(n-1). Empty when continuous. */
    std::vector<std::pair<std::string, double>> states;
};

// Every parameter of the EXTERNAL plugin named, by instantiating it offline; `nullopt` is "could not find, create OR LOAD it", empty is "it publishes none".
std::optional<std::vector<PluginParamInfo>> pluginParamsOf(const std::string& format,
                                                           const std::string& identifier);

// …and the same plugin's OWN WINDOW, on an ORPHAN instance that saves NOTHING: prepare loads the binary (SECONDS, off the message thread), then show draws it.
bool prepareNativePluginUI(const std::string& format, const std::string& identifier);
bool showNativePluginUIOf(const std::string& format, const std::string& identifier);

// Write what that orphan is CURRENTLY holding to `outFile` (absolute, its parent created); false with no already-loaded instance, and never a fresh one.
bool snapshotOrphanPluginTo(const std::string& format, const std::string& identifier,
                            const std::string& outFile);

// A Tracktion engine for the OFFLINE tools — render, freeze, param dump — headless, so it opens no device and runs beside the live engine holding one.
std::unique_ptr<tracktion::engine::Engine> makeOfflineEngine();

// Offline render (bounce) to wav with NO audio device, so MIDI and instrument tracks render: mix.wav, one per track with `stems`, and a JSON manifest.
int renderOffline(const ProjectDoc& doc, const std::string& baseDir,
                  const std::string& outDir, bool stems);

// Print a symbolised stack when the process is about to die of an access violation, then let it die — there is no debugger here. Same dbghelp walk as watchdogStack.
void installCrashHandler();

// THROWAWAY PROBE, wired from `--multi-edit-test`: several documents at once on ONE audio device, reporting whether each master made signal. See docs/multiEdit.md.
int runMultiEditTest(const std::vector<ProjectDoc>& docs,
                     const std::vector<std::string>& baseDirs, double seconds,
                     const std::string& deviceName = {},
                     const std::string& deviceType = {});

// `<state>` as a path, for the server, which sees no JUCE: the one spelling, LoadGuard.cpp's studioStateDir().
std::string studioStatePath();

// Judge what a previous engine left loading, then mark every risky load from here on — the server's, before anything loads (LoadGuard.h).
void enableLoadGuards();

// Decode one file to stdout — a JSON header line, then interleaved float32 frames; what is measured from them is @studio/audio-analysis's. docs/cliModes.md.
int decodeToStdout(const std::string& audioPath);

// `NormalizeItem`, `normalizeClips` and `--normalize` are gone: normalising is a treatment now, a chain naming the library's `normalize` module, bounced by `--render`.

}  // namespace studio
