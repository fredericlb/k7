#pragma once

// EngineHost — owns the Tracktion Engine and projects a ProjectDoc onto a live Edit. The ONLY layer that
// includes Tracktion/JUCE, and its interface keeps them out (forward decls only), so the WebSocket server
// compiles without seeing JUCE. applyFull() builds from scratch; apply(target) diffs and mutates in place,
// which stable ids are what make possible. See docs/engineHost.md.

#include <cstddef>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "ProjectDoc.h"
#include "ProjectDiff.h"
#include "WaveformTap.h"     // WaveformEnvelope — pure C++, no JUCE

// Forward-declare to keep Tracktion headers out of this interface.
namespace tracktion { inline namespace engine {
class Engine;
class Edit;
}}  // namespace tracktion::engine

namespace studio {

// A discovered plugin (plain struct — no JUCE in this interface).
struct PluginInfo {
    std::string name;
    std::string format;        // "VST3", "LADSPA", …
    std::string manufacturer;
    std::string identifier;    // file path / unique id
    bool isInstrument = false;
    std::string role;          // "instrument", "audioEffect", or "midiEffect"
    std::string descXml;       // full juce::PluginDescription as XML (empty in older caches), so the engine
                               // can instantiate without re-introspecting the binary
    // What KIND of effect this is, lower case, '' when unknown. Three sources in descending trustworthiness: an
    // AirWindows plugin's closed enum, a built-in's hand-assigned kind, and an external's freely-written
    // category ("Fx|Delay", but also "OnlyARA"). Good enough to file a module under; not a taxonomy.
    std::string category;
};

// An available audio interface (a plain struct — no JUCE in this interface). One physical device is usually
// offered by SEVERAL backends under the same name and they are NOT interchangeable, so a device is identified
// by name + type. See docs/engineHost.md.
struct AudioDeviceInfo {
    std::string name;
    std::string type;  // the backend offering it: "ASIO", "Windows Audio", …
    int inputs = 0;    // input channel count (0 if unknown until opened)
    int outputs = 0;   // output channel count
    bool current = false;   // the device currently open
    bool isDefault = false; // its backend's default device
};

class EngineHost {
public:
    EngineHost();
    ~EngineHost();

    // Open the default stereo output. Split out of the constructor so the server can bind its port FIRST and answer
    // probes at once, paying the device-open cost — seconds on a Bluetooth interface — after. Playback is silent
    // until it runs. Call once, on the message thread, before the first apply().
    void openAudioDevice();

    // Build a fresh Edit from the document and hand it to the engine, keeping a copy as the diff baseline.
    // baseDir resolves clip/plugin paths (empty when they are already absolute).
    void applyFull(const std::string& session, const ProjectDoc& doc, const std::string& baseDir);

    // Move the engine to `target` by the smallest set of changes: diff, apply incrementally (falling back to a full
    // rebuild when a change demands it), update the baseline, and return the changeset for logging.
    ProjectDiff apply(const std::string& session, const ProjectDoc& target, const std::string& baseDir);

    // Forget the project entirely — editors, plugins, preset state, the Edit and the diff baseline — leaving the
    // engine idle but alive with its audio device and scan cache. The next apply therefore rebuilds fully, so
    // nothing survives from the previous song. Message-thread only. See docs/engineHost.md.
    void reset(const std::string& session);

    // The document currently realised in the engine (source for the next diff). The empty doc
    // for a session nobody has sent one to — asking never creates it. Out of line because
    // Session is private.
    const ProjectDoc& current(const std::string& session) const;

    // Transport controls (message-thread only).
    void play(const std::string& session);
    void stop(const std::string& session);
    void rewind(const std::string& session); // move the playhead back to the start (beat 0)
    // Forget every session that holds nothing and has been quiet for `ttlMs`. Called by the state
    // timer, not a timer of its own. Returns how many went. See docs/sessions.md for why this is a
    // TTL on emptiness rather than a refcount of listeners.
    size_t reapEmptySessions(double ttlMs);

    /**
     * A socket driving this session arrived, or went. Message-thread only.
     *
     * "Driving" means a surface somebody is looking at, which declares itself on hello. The file
     * service is not one — it keeps a socket per session for as long as the machine is up, so
     * counting it would mean no project ever looks abandoned.
     */
    void addDriver(const std::string& session);
    void removeDriver(const std::string& session);

    /**
     * Let go of every project whose last driver left more than `graceMs` ago: stop the transport
     * and free the Edit, its plugins and its meters. The SESSION stays, so a tab coming back
     * re-sends its document into the same slot. Returns how many were freed.
     *
     * The grace is what makes this safe to do at all. A closing tab, a reload, a dropped
     * connection and a laptop lid are the same event from here, and only one of them means "I am
     * done" — so waiting is the only way to tell them apart. See docs/sessions.md.
     */
    size_t releaseAbandonedProjects(double graceMs);

    // This session's record enable: play() records its armed tracks only while this is on. Message-thread only.
    void setRecordEnabled(const std::string& session, bool on);
    bool recordEnabled(const std::string& session) const;
    /**
     * Whether anything is WATCHING this session — a waveform tap in the chain, or a plugin whose
     * parameters a client asked to follow.
     *
     * Read by the state timer to decide whether a frame is worth sending at full rate: those two
     * are the things that carry new numbers even when the transport is stopped and nothing sounds.
     * See docs/protocol.md.
     */
    bool sessionWatched(const std::string& session) const;
    void seek(const std::string& session, double seconds); // move the playhead to an absolute position (clamped at 0)
    // Set the transport loop [start, end) in seconds and turn looping on or off; playback wraps engine-side, and
    // play() drops the playhead onto the start first. Message-thread only.
    void setLoop(const std::string& session, double startSeconds, double endSeconds, bool enabled);
    bool isPlaying(const std::string& session) const;
    double playheadSeconds(const std::string& session) const;

    // Audition `file` over [start, start+length) seconds through a hidden one-shot sampler voice — the same
    // SamplerPlugin a rack uses, so it sounds as it would in the arrangement. length <= 0 plays the natural length.
    // Independent of the transport, so it works while stopped. Message-thread only.
    void previewSample(const std::string& session, const std::string& file, double startSeconds, double lengthSeconds);

    // Per-track output level in dB, for meters (-100 == silent).
    float trackLevelDb(const std::string& session, int trackIndex) const;

    // Per-track live INPUT level in dB, one per track in doc order (-100 with no input): the peak since the last
    // poll, the same signal an armed track would capture. Feeds the state frame's trackInputLevelsDb.
    std::vector<float> inputLevelsDb(const std::string& session) const;

    // One metered channel set: its peak, and whether this rig HAS a device carrying those channels at all.
    // `found` exists because without it the two failures are one number: a channel nothing is plugged into and a
    // channel that does not exist both read -100, and the panel could only draw the same dead bar for each.
    struct ChannelLevel {
        float db = -100.0f;
        bool found = false;
    };

    // Peak dB for each channel set given, in order (-100 for one this rig has no device for). Unlike
    // inputLevelsDb this asks about the INTERFACE, not the song: it needs no track, no arming and no edit, which is
    // what lets the I/O panel meter an input nothing is recording yet. ENABLES each device it finds — a disabled
    // one produces no signal to measure — so it is a poll with a side effect, and only worth making while a
    // surface is actually looking. Message-thread only: it touches JUCE devices.
    std::vector<ChannelLevel> channelLevelsDb(const std::vector<std::vector<int>>& channelSets);

    // How this rig actually groups its inputs: one entry per wave input device, with the 1-based interface
    // channels it carries. An interface pairing its inputs into stereo devices is the normal case and it is
    // invisible from everywhere else — which is precisely how a channel that "exists" can meter nothing.
    struct InputDeviceInfo {
        std::string name;
        std::vector<int> channels;
        bool enabled = false;
    };
    std::vector<InputDeviceInfo> inputDevices() const;

    // Pair the interface input carrying `channel` (1-based) with its hardware partner, or split it back into two
    // mono devices. False when there is no interface open to regroup.
    //
    // The partner is NOT a choice: Tracktion pairs even/odd hardware channels only, so 1 goes with 2, 3 with 4,
    // and channel 2 can never be paired with channel 3 (describeStandardDevices walks the list two at a time).
    // Passing either half of a pair names that pair. Tracktion persists the grouping itself, per audio device
    // TYPE, and rebuilds the device list — so this is the whole of it, and `inputDevices` reads the result back.
    //
    // Pairing DESTROYS the two mono devices: their names merge, and a device is identified by its name. Anything
    // still asking for one of those channels alone — a module with `channel: [2]` — then matches nothing and
    // reads as silence, which is the same rule findWaveInput has always had, met from the other side.
    // Message-thread only: it touches JUCE devices.
    bool setInputStereo(int channel, bool stereo);

    // One channel set's pitch, for the I/O panel's tuner. `hz` is 0 when nothing convincing was heard, which is
    // the honest answer for silence, for noise, and for a chord — the UI shows no note rather than a wrong one.
    struct ChannelPitch {
        float hz = 0.0f;
        float clarity = 0.0f;
    };

    // Fundamental for each channel set given, in order — first channel of each set, since a stereo pair carries
    // one instrument. Starts the input tap on first call and follows the sets asked for, so nothing is analysed
    // while no surface is looking. Message-thread only, like the meters.
    std::vector<ChannelPitch> channelPitches(const std::vector<std::vector<int>>& channelSets);

    // Peak dB leaving the master — what an io "out" module puts on the interface. The output DEVICE carries no
    // measurer in Tracktion (only inputs do), so this reads a LevelMeterPlugin appended to the master plugin list
    // by buildLevelMeters. -100 with no edit loaded.
    float masterLevelDb(const std::string& session) const;

    // --- Waveform taps (message-thread only; call via post()) ---------------

    // Enable waveform tapping for a module: `id` is the PluginDoc id, `side` is input or output. Inserts a tap
    // into the chain beside that plugin; a no-op when already enabled for this id and side. The TRACK is derived
    // from the plugin, never passed in — the caller has no reliable track index to give (a chain can be a bus with
    // no track), and one that guessed put the tap on an unrelated lane.
    void enableWaveformTap(const std::string& session, const std::string& id, const std::string& side);

    // Disable waveform tapping for a module. Removes the tap plugin from the chain.
    void disableWaveformTap(const std::string& session, const std::string& id, const std::string& side);

    // `waveformData` drained ONE module's tap and was here with no caller — the only method in this
    // header without one. `drainAllWaveformTaps` below superseded it: the state timer drains every
    // tap per broadcast rather than asking module by module, so there was never a second reader.
    //
    // Drain every active tap, keyed "chain:module:side" — called by the state timer for each broadcast.
    std::map<std::string, std::vector<WaveformEnvelope>> drainAllWaveformTaps(const std::string& session);

    // --- Audio broadcast (TWO threads — read each method's own note) ---------
    //
    // The mix leaving for the interface, copied out for the network. Nothing is tapped
    // until somebody asks: the stream is ~3 Mbit/s uncompressed, so an engine nobody is
    // listening to must not pay a copy per block. See docs/broadcast.md.
    //
    // Unlike every other section here, this one is NOT uniformly message-thread. The two
    // setup calls are; the two ring calls belong to the sender thread and must never be
    // wrapped in post(), which would put a second reader on a single-consumer ring.

    // Put the tap on the master plugin list, or take it off. Idempotent. The tap survives
    // a project apply the way the level meters do — reasserted by buildLevelMeters.
    // Turning it ON creates the session (a client subscribing is a client driving); turning it
    // OFF never does — see docs/sessions.md.
    void enableBroadcast(const std::string& session, bool on);

    // What a drain answered with. `lostFrames` is what the writer overwrote before the
    // sender reached it — a real hole, which the sender reports as a sequence jump.
    struct BroadcastChunk {
        std::vector<float> samples;   // interleaved, channels() per frame
        size_t frames = 0;
        size_t lostFrames = 0;
        double sampleRate = 0.0;
    };
    static constexpr int broadcastChannels() { return 2; }

    // Take up to `maxFrames` frames. Empty (frames == 0) whenever there is nothing yet,
    // which is the ordinary case between audio callbacks.
    //
    // SENDER THREAD ONLY, and exactly one of them: the ring is single-producer/
    // single-consumer, and a second caller would race the read cursor. It never post()s — that
    // would put a second consumer on the ring — but it does take the session registry's lock
    // for the length of a memcpy, because the map it finds the ring in is written elsewhere.
    BroadcastChunk drainBroadcast(const std::string& session, size_t maxFrames);

    // Drop whatever is buffered and resume from live. Same thread as drainBroadcast — the
    // read cursor belongs to it. Called when a listener arrives, so it hears now rather
    // than the third of a second that was already in the ring.
    void skipBroadcastToLive(const std::string& session);

    // Open a plugin's native editor — the window the plugin itself draws, not the module's widget grid. `id` is the
    // PluginDoc id, and only external plugins have one. Message-thread only.
    void showNativePluginUI(const std::string& session, const std::string& id);

    // One entry per plugin instance in the loaded edit: its PluginDoc id, display name, and whether
    // showNativePluginUI would open a window (built-ins report false). Feeds the tray's submenu. Message-thread only.
    struct PluginInstanceInfo {
        std::string id;
        std::string name;
        bool hasNativePluginUI;
    };
    std::vector<PluginInstanceInfo> pluginInstanceInfos(const std::string& session) const;

    // A selectable preset for an external plugin: an entry in its program list (pick by `index`) or a .vstpreset in
    // the standard folders (pick by `path`). A plain struct — no JUCE in this interface.
    struct PresetInfo {
        std::string name;
        std::string source;   // "program" | "file"
        int index = -1;       // program list index (source "program")
        std::string path;     // absolute .vstpreset path (source "file")
    };

    // List the presets a MODULE's live external plugin offers — its program list plus the .vstpreset files for it.
    // Empty when the module has no live external plugin. Message-thread only.
    std::vector<PresetInfo> listPresets(const std::string& session, const std::string& module);

    // Load a preset into EVERY live instance of `module` and persist it to the module's own .vstpreset, so the
    // choice survives a reload. A non-empty `presetPath` picks a file, else `programIndex` picks a program.
    void setPreset(const std::string& session, const std::string& module, int programIndex,
                   const std::string& presetPath);

    // Set one automatable parameter on a live plugin, in the parameter's native range. Applies to the LIVE plugin
    // only — the caller owns persistence, so the value is lost on the next full rebuild unless it also lands in the
    // project. The live-drag path: called at interactive rates, so it does not log. Message-thread only.
    void setPluginParam(const std::string& session, const std::string& id, const std::string& name, double value);

    // Every automatable parameter of `id` with its CURRENT value, in parameter order; empty when there is no such
    // plugin. This answers "what is it holding" — including defaults — unlike the broadcast and --dump-params,
    // which carry only what must be SAVED. Also the only way to enumerate a loaded plugin's names.
    std::vector<std::pair<std::string, double>> pluginParams(const std::string& session, const std::string& id) const;

    // The same set plus the metadata a control needs: the declared range and the default where there is one.
    // Ranges are in the parameter's OWN units, so a widget must take them as given rather than assume a convention.
    // Reported alongside the values, so a caller wanting only "what is it holding" keeps using pluginParams().
    struct PluginParamInfo {
        std::string name;
        double value, min, max;
        bool hasDefault;
        double def;
        // A discrete parameter's named settings and the value selecting each; empty when continuous. The value travels
        // with the label rather than being derived from its index — see ParamRef::states.
        std::vector<std::pair<std::string, double>> states;
    };
    std::vector<PluginParamInfo> pluginParamInfos(const std::string& session, const std::string& id) const;

    // Start or stop watching a plugin's parameters: while watched, every change is pushed to onPluginParamsLive,
    // which is how a knob turned in the plugin's OWN window reaches a remote UI — the one direction nothing else
    // covers. Per-plugin and off by default (a watch costs a read per tick), and an id with no live plugin is
    // accepted so the interest survives a rebuild. Message-thread only. See docs/engineHost.md.
    void watchPluginParams(const std::string& session, const std::string& id, bool on);

    // --- Record arming (message-thread only; call via post()) -------------

    // The outcome of setArmed: the resulting state, or why it was refused.
    struct ArmResult {
        bool ok = false;
        bool armed = false;      // the state the track is now in (when ok)
        std::string error;       // why it was refused (when !ok) — shown to the user
    };

    // Arm or disarm a track; an unset `armed` TOGGLES, resolved here against the flag rather than by the caller
    // reading and inverting — which would race the 20/sec broadcast it read from. A track with no live input
    // cannot be armed: it would record silence. The flag is session state Tracktion keeps on an Edit we never save.
    ArmResult setArmed(const std::string& session, const std::string& trackId, std::optional<bool> armed);
    // The currently armed track ids, in doc order. Read for the state broadcast.
    std::vector<std::string> armedTracks(const std::string& session) const;

    // Audio-interface selection (message-thread only). The open output device's name, or "" — which means the
    // engine can neither sound nor KEEP TIME: with no output there is no callback to advance the playhead, so the
    // transport reports playing while nothing moves. Callers say so, because nothing else will.
    std::string outputDeviceName() const;

    // What the OPEN device costs in time — the buffer it works in and the rate it runs at. A
    // browser turns the pair into milliseconds (2 × buffer / rate: a block in, a block out)
    // and adds its measured round trip, which is what decides an engine's quality band. Both
    // zero when no device is open, meaning "not measured" and never "instant".
    // Reads two atomics and nothing else, so it is safe from ANY thread — which is the point:
    // `whoami` answers on the socket's own thread to keep the probe out of the message queue.
    struct AudioTiming {
        int bufferFrames = 0;
        double sampleRate = 0.0;
    };
    AudioTiming audioTiming() const;

    // Re-read the open device and publish what it costs. MESSAGE THREAD ONLY — it dereferences the
    // live device, which is exactly what audioTiming() must not do. Call it after anything that
    // opens, closes or re-buffers one.
    void publishAudioTiming();

    // listAudioDevices() enumerates the interfaces, ASIO first; setAudioDevice() opens one for input and output,
    // false when not found. An empty `type` means "any backend offering that name", which is arbitrary for a device
    // exposed by several — the brain always passes it.
    std::vector<AudioDeviceInfo> listAudioDevices();
    bool setAudioDevice(const std::string& name, const std::string& type = {});

    // --- Server support (headless, WebSocket-driven) ----------------------
    // These let a frontend live in another process or language: all JUCE threading stays behind this API, so the
    // C++ WebSocket server never includes JUCE.

    // A snapshot the server pushes to clients.
    struct EngineState {
        // WHICH session this frame describes. Empty is the default session — what a client
        // that has not asked for one drives. Carried on every frame because with N sessions
        // an unlabelled one is a frame nobody can route.
        std::string session;
        bool playing = false;
        double playheadSeconds = 0.0;
        std::vector<float> trackLevelsDb;   // one per track, -100 == silent
        // Live INPUT level per track in dB, same index order as trackLevelsDb: the peak since the last poll, -100 with
        // no live input. Only surfaced for armed tracks, but read for every one so it indexes like the output levels.
        std::vector<float> trackInputLevelsDb;
        // Ids of the record-armed tracks. Arming is SESSION state that lives here and nowhere else, dying with the
        // process — and Tracktion already keeps the flag on an Edit we never save, so this reads that rather than
        // holding a second copy. See docs/engineHost.md.
        std::vector<std::string> armedTracks;
        // This session's record enable. Arming says a track WOULD record; it records only while this is on and
        // the transport rolls. Session state, like the armed set.
        bool recordEnabled = false;
        // Per-module waveform envelopes keyed "chain:module:side", each the points drained since the last poll;
        // an empty map when no taps are active.
        std::map<std::string, std::vector<WaveformEnvelope>> waveformEnvelopes;
    };

    /** The sessions that exist, in id order. The state timer walks this. */
    std::vector<std::string> sessionIds() const;

    /**
     * What one session is holding — enough for a supervisor to LIST them without driving
     * any. Deliberately a summary and not a `ProjectDoc`: the tray draws a menu line, and
     * handing it the document would put a megabyte through the stdio pipe every poll.
     */
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

    // Sinks invoked (message thread) after a plugin's editor closes: onPresetSaved when its state went to the
    // module's .vstpreset (id + path written), onPluginParams when text params fully capture it (id + a JSON
    // object string). The server forwards both, and the brain persists them onto the module. Each leads with the
    // session whose plugin it was: the frame is about one project, so it has to say which.
    void onPresetSaved(std::function<void(const std::string& session, const std::string& id,
                                          const std::string& path)> cb);
    void onPluginParams(std::function<void(const std::string& session, const std::string& id,
                                           const std::string& paramsJson)> cb);

    // The sink for watchPluginParams: an id and its FULL parameter set whenever any value moved. Deliberately NOT
    // onPluginParams, which means "this is the state to persist" — routing a mid-drag feed there would rewrite the
    // project file tens of times a second. Values, not deltas: a partial update would need merge rules everywhere.
    void onPluginParamsLive(
        std::function<void(const std::string& session, const std::string& id,
                           const std::vector<std::pair<std::string, double>>& params)> cb);

    // Report any watched plugin whose parameters moved, called by the state timer — so a watch is bounded by the
    // meters' cadence. Sampling rather than listening is what stops a fast drag flooding the socket; the cost is
    // that a change reverted within a tick is never seen, which for a display is the right trade.
    void pumpPluginParamWatches(const std::string& session);

    // The sink invoked once a take is finished, closed and renamed: track id, absolute .wav path, and position in
    // SECONDS. The engine stops there — the brain turns that into a clip and a placement. Seconds, not beats,
    // because the tempo map is the brain's to read.
    void onRecorded(std::function<void(const std::string& session, const std::string& trackId,
                                       const std::string& file, double startSeconds,
                                       double lengthSeconds)> cb);

    // Run the engine/message loop; blocks until quit(). Call on the main thread.
    void run();
    void quit();

private:
    // Drop everything derived from the current project — editors, plugin refs, preset state, meters — in the order
    // that keeps editors from outliving their plugins. Shared by applyFull() and reset(); leaves the Edit alone.
    void teardownProjectState(const std::string& session);

    // Append a per-track LevelMeterPlugin + metering client after a rebuild, so trackLevelDb() has levels to report.
    void buildLevelMeters(const std::string& session);

    // Project the doc's metronome flag onto the Edit's click track (enable + emphasise bars). Called by every apply
    // path after the session's `current` is updated, so the click follows the doc; a no-op with no Edit.
    void applyMetronome(const std::string& session);

    // Point a track at its live input (or clear it) and set the monitor mode. Needs an allocated playback context —
    // the input instances live on it — so it runs AFTER ensureContextAllocated(), never inside populateEdit().
    void applyTrackInput(const std::string& session, const TrackDoc& t);
    // Re-apply every track's input, for the full-rebuild path where the whole playback context was just replaced.
    void applyAllTrackInputs(const std::string& session, const ProjectDoc& doc);
    // The same after an INTERFACE change, plus putting back the arm flags the rebuild dropped — see
    // docs/audioDevice.md. Takes the arm sets read before the switch, since after it there is nothing left to read.
    void reconnectTrackInputs(const std::map<std::string, std::vector<std::string>>& armedBefore);

    // Name each armed track's take and point the input devices at recordDir_, called from play() the moment before
    // the transport rolls so the filename's timestamp is the take's start. False (and logged) with no recordDir.
    bool prepareTakes(const std::string& session);

    // Create once and attach the record listener to the current edit's transport. Defined in Recording.cpp, where
    // RecordListener is complete; applyFull() calls it after building the edit.
    void attachRecordListener(const std::string& session);

    // Catches the end of a take. It needs the pending take names, the current doc and the edit to turn "target X
    // finished" into "track drums recorded this file", so it is a friend rather than carrying copies of all three.
    friend struct RecordListener;

    // Owns the plugin-editor windows and param/preset persistence. It operates on Impl only, but Impl is private,
    // so it is a friend purely to name the type.
    friend class PluginEditorController;

    struct Impl;
    std::unique_ptr<Impl> impl_;
    // `current_`, `baseDir_` and `recordEnabled_` moved INTO the session (EngineHostImpl.h):
    // they describe a project, and there are N of those now. Nothing project-shaped is left here.
};

// --- Plugin discovery (out-of-process, cached in ~/.studio/exts.json) -------
//
// loadPluginCache reads the cached list without scanning; scanInstalledPlugins loads only the new or changed
// ones, each in a child process, and updates the cache; runPluginScanChild is that child, isolating one plugin
// so a crashy one kills only itself; runPluginScanCli is the `scan` entry. See docs/engineHost.md.
std::vector<PluginInfo> loadPluginCache();
std::vector<PluginInfo> scanInstalledPlugins(bool forceRescan);
int runPluginScanChild(const std::string& format, const std::string& identifier);
int runPluginScanCli(bool forceRescan);

// Entry for `--list-audio-devices`: enumerate the interfaces and print sentinel-fenced JSON, ASIO first.
// Standalone — it builds only a JUCE device manager, opening no device and starting no engine, so
// `l8 config interfaces` works with nothing running.
int runAudioDevicesCli();

// Enumerate a plugin's automatable parameters as sentinel-fenced JSON — l8's text alternative to an
// opaque .vstpreset, where `complete` means the params fully reproduce the state. The translator calls these on
// import. Wired from `--dump-params` and `--dump-params-ext`. See docs/engineHost.md.
int dumpPluginParams(const std::string& type);
int dumpPluginParamsExternal(const std::string& format, const std::string& identifier,
                             const std::string& stateFile);

// Every BUILT-IN's full parameter list — name, range and default, per plugin — as sentinel-fenced JSON.
//
// Not the same question as `--dump-params`, and that is why it is its own mode: that one emits the
// NON-DEFAULT subset, the "preset" of an instance somebody configured, so on a freshly created plugin it
// prints `{}` however many parameters the thing has. This one asks what a plugin type HAS, which is the
// question the module builder needs answered before any instance exists. Wired from `--dump-builtin-params`;
// `scripts/gen-builtin-params.mjs` turns its output into the table @studio/song ships.
int dumpBuiltinParams();

// Offline render (bounce) to wav with NO audio device, so MIDI and instrument tracks are rendered unlike an
// ffmpeg mixdown: writes mix.wav plus, with `stems`, one wav per track, and prints a JSON manifest.
// Wired from `--render <doc.json|-> --out <dir> [--stems]`.
// A Tracktion engine for the OFFLINE tools — render, freeze, param dump. Headless: it opens no audio device,
// which is what lets any of them run while the live engine holds one. See its definition for what that cost.
std::unique_ptr<tracktion::engine::Engine> makeOfflineEngine();

int renderOffline(const ProjectDoc& doc, const std::string& baseDir,
                  const std::string& outDir, bool stems);

// THROWAWAY PROBE — play several documents at once on ONE audio device and report whether
// each one's master actually produced signal. It exists to answer whether N services can
// share one low-latency device as N Edits rather than as N processes, which is the
// difference between keeping ASIO and falling back to shared-mode WASAPI. Delete it once
// the answer is written down; see docs/multiEdit.md. Wired from `--multi-edit-test`.
int runMultiEditTest(const std::vector<ProjectDoc>& docs,
                     const std::vector<std::string>& baseDirs, double seconds,
                     const std::string& deviceName = {},
                     const std::string& deviceType = {});

// Bounce ONE track through its own plugins, no master — the render a FROZEN track plays in place of computing
// itself. Prints the written path as a JSON string. Wired from `--freeze <doc.json|-> --track <id> --out <file>`.
int freezeTrack(const ProjectDoc& doc, const std::string& baseDir, const std::string& trackId,
                const std::string& outFile);

// The transient detector's default threshold, in standard deviations above the mean jump. Mirrors
// detectTransients' default in packages/commands/src/waveform.ts.
constexpr double kDefaultTransientSensitivity = 2.0;

// Decode an audio file and write a placement-independent peak+RMS envelope, its detected transient onsets, and a
// content fingerprint beside it as `{audioPath}.cache`. BOTH the fingerprint and the transient detector MUST match
// waveformCache.ts / @studio/commands/waveform.ts on the Node side. See docs/cliModes.md.
int writeWaveformCache(const std::string& audioPath,
                       double transientSensitivity = kDefaultTransientSensitivity);

// `NormalizeItem` and `normalizeClips` were here, behind a `--normalize` CLI mode, and are gone with the
// `track normalize` / `clip normalize` commands that were their only caller. Normalising is a treatment
// now: a chain naming the médiathèque's `normalize` module, bounced through `--render` like any other.

// The TRUE peak of one file — the loudest sample on ANY channel — printed as JSON on stdout. What a cold
// module's measuring pass reads before a render (@studio/commands' peakPass.ts). Deliberately not taken
// from the `{file}.cache` envelope: that one is a mono sum at four decimals, which is right for drawing a
// waveform and up to 6 dB wrong for setting a gain. See docs/cliModes.md.
int printFilePeak(const std::string& audioPath);

}  // namespace studio
