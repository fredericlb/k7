// Building the Tracktion Edit graph from a ProjectDoc — see EditBuilder.h.

#include "EditBuilder.h"

#include "Warnings.h"  // warn() — reaches the client, not just stderr
#include "NamPlugin.h" // a .nam model is loaded onto the plugin as the Edit is built

#include "PluginParams.h"    // applyPluginParams (via addPlugin)
#include "PluginScan.h"      // cachedPluginInfos (via makeExternalPlugin)

#include <algorithm>
#include <cctype>
#include <iostream>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace studio {

namespace {

// Convert a beat position on this edit's tempo map to engine time.
tt::TimePosition beatToTime(te::Edit& edit, double beats) {
    return edit.tempoSequence.toTime(tt::BeatPosition::fromBeats(beats));
}

// Resolve a clip's [start,end) as an engine ClipPosition.
te::ClipPosition clipPositionFor(te::Edit& edit, const ClipDoc& c, double naturalLen) {
    const auto start = beatToTime(edit, c.start);

    // The clip FILE's window into its source (seconds, see ClipDoc): `from` moves the in-point, `to` ends the
    // material early.
    const double from = juce::jlimit(0.0, naturalLen, c.sourceFrom);
    const double to = c.sourceTo > 0.0 ? juce::jlimit(from, naturalLen, c.sourceTo) : naturalLen;
    // The placement's own musical offset reads FURTHER into that window — the two stack, in-point first — so
    // what is left to play is measured from where reading actually starts, not from `from`. Measuring it from
    // `from` let an offset run off the end of the window and into the material the clip file excluded.
    const double inPoint =
        juce::jlimit(from, to, from + beatToTime(edit, c.offset).inSeconds());
    // What remains of the window is the clip's usable length — the natural length as far as everything below is
    // concerned, which is what makes an untimed placement play exactly the window.
    const double usable = juce::jmax(0.0, to - inPoint);

    auto end = c.length > 0.0 ? beatToTime(edit, c.start + c.length)
                              : start + tt::TimeDuration::fromSeconds(usable);
    // A placement asking for MORE than the window would read straight past `to` into material the clip file
    // excluded — so the window wins. Not applied to a looped clip: there the length says how many times the
    // window repeats, which is a different question and a legitimately longer region.
    if (c.length > 0.0 && c.loopEnd <= c.loopStart) {
        const auto windowEnd = start + tt::TimeDuration::fromSeconds(usable);
        if (windowEnd < end)
            end = windowEnd;
    }

    // The source in-point: read the wav from `inPoint` in, not from sample 0. Passing {} made every clip start
    // at the file's beginning, so leading silence baked into an exported source played first — heard as a fixed
    // per-clip latency. The doc offset is musical, converted on this edit's tempo map (edit time == source
    // time); `from` is already seconds, and inPoint is the two of them, clamped to the window.
    return { tt::TimeRange(start, end), tt::TimeDuration::fromSeconds(inPoint) };
}

// Loop a clip-relative beat region if the placement set one; setLoopRangeBeats is virtual on te::Clip, and the
// placed clip length decides how many times the region repeats.
void applyClipLoop(te::Clip& clip, const ClipDoc& c) {
    if (c.loopEnd > c.loopStart)
        clip.setLoopRangeBeats({ tt::BeatPosition::fromBeats(c.loopStart),
                                 tt::BeatDuration::fromBeats(c.loopEnd - c.loopStart) });
}

// Apply an imported warp to a wave clip. DAWproject markers map a SOURCE second to a TIMELINE beat; Tracktion
// realises the same with AUTO-TEMPO, treating the source as a loop of N beats stretched to the edit tempo — so
// the source's own tempo is the whole story for the overall stretch, and a clip recorded at the project tempo
// comes out unchanged. (WarpTimeManager clamps to the source length and can only re-time WITHIN it.)
// Intermediate markers become LoopInfo beat points, so each segment stretches independently.
void applyClipWarp(te::AudioClipBase& clip, te::Edit& edit, const ClipDoc& c) {
    const auto& markers = c.warp.markers;
    if (markers.size() < 2)
        return;
    const double srcSpanS = markers.back().second - markers.front().second; // source secs
    const double beatSpan = markers.back().first - markers.front().first;   // timeline beats
    if (srcSpanS <= 0.0 || beatSpan <= 0.0)
        return;

    // A warp that stretches by 1.0 and pins nothing in between is not a warp: the source
    // already runs at the project tempo, and every marker says so. Importers emit these
    // for any clip that needed no correction (11 of 31 in LEMO - DANSE).
    //
    // Skipping them is not just an optimisation. Auto-tempo hands playback to
    // AudioSegmentList::buildAutoTempo, whose NON-LOOPING branch emits a segment per sync
    // point with no bound against the clip's length, and whose removeExtraSegments then
    // "truncates" the straddling one with `seg.length = getEnd() - seg.start` — where
    // getEnd() is the last REMAINING segment, i.e. that very segment, since the loop runs
    // backwards and has already dropped the rest. The truncation is a no-op and the clip
    // plays its whole source past its declared end. Not entering that path is the only
    // part of this we can fix from outside Tracktion.
    const double tempo = edit.tempoSequence.getTempo(0)->getBpm();
    const double ratio = tempo > 0.0 ? (beatSpan * 60.0 / tempo) / srcSpanS : 1.0;
    if (markers.size() == 2 && std::abs(ratio - 1.0) < 1.0e-4)
        return;

    // Pick a stretch algorithm ACTUALLY COMPILED into this build: setTimeStretchMode() runs the request through
    // checkModeIsAvailable(), which silently returns `disabled` for an unlinked mode — and disabled means no
    // stretching at all. Elastique is licensed and usually absent, so fall back to SoundTouch, which ships.
    clip.setTimeStretchMode(te::TimeStretcher::elastiquePro);
    if (clip.getTimeStretchMode() == te::TimeStretcher::disabled)
        clip.setTimeStretchMode(te::TimeStretcher::soundtouchBetter);

    // Stretch INLINE in the playback graph rather than through a pre-rendered proxy: the proxy is a background
    // render job the headless renderer never pumps, so a proxy makes the render task loop forever. Inline costs CPU
    // per block but always completes, and keeps the live and offline paths identical.
    clip.setUsesProxy(false);

    // Declare the source's musical length and let auto-tempo stretch. WarpTime is off: the two are mutually
    // exclusive in AudioSegmentList, and auto-tempo is the one that can change duration. The time signature only
    // groups beats into bars, so a plain 4/4 is fine.
    clip.setWarpTime(false);
    auto& li = clip.getLoopInfo();
    li.setNumerator(4);
    li.setDenominator(4);
    li.setNumBeats(beatSpan);

    // Piecewise: pin each interior marker's SOURCE position as a beat point, so segments stretch independently.
    auto wi = clip.getWaveInfo();
    li.clearLoopPoints();
    for (size_t i = 1; i + 1 < markers.size(); ++i) {
        const auto sample = static_cast<tt::SampleCount>(markers[i].second * wi.sampleRate);
        li.addLoopPoint(sample, te::LoopInfo::LoopPointType::manual);
    }

    clip.setAutoTempo(true);
}

// ASCII case-insensitive equality: plugin names and formats round-trip through JSON and YAML, whose casing we
// do not control ("vst3" vs "VST3").
bool iequals(const std::string& a, const std::string& b) {
    return a.size() == b.size() &&
           std::equal(a.begin(), a.end(), b.begin(),
                      [](char x, char y) { return std::tolower((unsigned char)x) == std::tolower((unsigned char)y); });
}

// A PluginDoc.type naming an external plugin FORMAT rather than a built-in's xmlTypeName: externals resolve
// through the scan cache and load by description, built-ins are created straight from their type.
bool isExternalFormat(const std::string& type) {
    static const std::set<std::string> formats{"vst3", "vst", "vst2", "au", "audiounit", "clap", "lv2", "ladspa", "aax"};
    std::string low = type;
    std::transform(low.begin(), low.end(), low.begin(), [](unsigned char c) { return (char)std::tolower(c); });
    return formats.count(low) != 0;
}

// Instantiate an external plugin. The module carries only its format and name, so we look the file up in the
// scan cache, recover its full PluginDescription, and create an ExternalPlugin from it. Null (with a hint) when
// it isn't cached — the user needs to run a scan. The cache is read once and memoised across an apply.
te::Plugin::Ptr makeExternalPlugin(te::Edit& edit, const PluginDoc& p) {
    // The snapshot is held for the whole function: `info` points INTO it, and a background rescan
    // replaces the memo (PluginScan.h). Losing it here is a use-after-free, not a stale read.
    const auto infos = cachedPluginInfos();
    const PluginInfo* info = nullptr;
    for (const auto& i : *infos)
        if (iequals(i.format, p.type) && iequals(i.name, p.name)) {
            info = &i;
            break;
        }
    if (info == nullptr) {
        warn("plugin '" + p.name + "' (" + p.type +
                 ") is not in the cache — run 'st0 engine scan'",
             p.id);
        return {};
    }

    // Fast path: the cache holds the full PluginDescription as XML, so rebuild and instantiate directly — no
    // findAllTypesForFile, which would reload the binary just to re-derive it. Seeding Tracktion's knownPluginList
    // is what lets ExternalPlugin::findMatchingPlugin() resolve during initialiseFully(); without it the binary is
    // never loaded, getWrappedAudioProcessor() returns null, and the UI refuses to open.
    if (!info->descXml.empty()) {
        juce::PluginDescription desc;
        if (auto xml = juce::parseXML(juce::String(info->descXml)); xml && desc.loadFromXml(*xml)) {
            edit.engine.getPluginManager().knownPluginList.addType(desc);
            return edit.getPluginCache().createNewPlugin(te::ExternalPlugin::xmlTypeName, desc);
        }
    }

    // Fallback for an older cache with no stored description: introspect the file, which is slower. A forced
    // rescan populates the description and takes this path off the table.
    std::cerr << "note: plugin '" << p.name << "' has no cached description — run 'st0 engine scan --force' to speed up loading\n";
    auto& formats = edit.engine.getPluginManager().pluginFormatManager;
    juce::OwnedArray<juce::PluginDescription> descs;
    for (auto* fmt : formats.getFormats())
        if (iequals(fmt->getName().toStdString(), p.type)) {
            fmt->findAllTypesForFile(descs, juce::String(info->identifier));
            break;
        }

    juce::PluginDescription* chosen = nullptr;
    for (auto* d : descs)
        if (iequals(d->name.toStdString(), p.name)) {
            chosen = d;
            break;
        }
    if (chosen == nullptr && !descs.isEmpty())
        chosen = descs.getFirst(); // one plugin per file, name mismatch — take it
    if (chosen == nullptr) {
        warn("no plugin types found in '" + info->identifier + "'", p.id);
        return {};
    }
    // Same as the fast path: seed knownPluginList so findMatchingPlugin() works.
    edit.engine.getPluginManager().knownPluginList.addType(*chosen);
    return edit.getPluginCache().createNewPlugin(te::ExternalPlugin::xmlTypeName, *chosen);
}

// --- aux sends ---------------------------------------------------------------
// A send routes a copy of a source track's post-FX signal onto a shared bus; an AuxReturn on the destination
// injects that bus back into its chain, so the return's own plugins process the summed sends before the master.
// Source and return are linked by a bus number.

// Put the AuxReturn at the FRONT of the return track, so bus audio flows through that track's FX on the way out.
void addAuxReturn(te::Edit& edit, te::AudioTrack& busTrack, int bus) {
    auto plugin = edit.getPluginCache().createNewPlugin(te::AuxReturnPlugin::xmlTypeName, {});
    if (auto* aux = dynamic_cast<te::AuxReturnPlugin*>(plugin.get())) {
        aux->busNumber = bus;
        busTrack.pluginList.insertPlugin(plugin, 0, nullptr);
    }
}

// Append an AuxSend at the END of the source track (post-FX, post-fader), tapping `level` of its signal.
void addAuxSend(te::Edit& edit, te::AudioTrack& track, int bus, double level) {
    auto plugin = edit.getPluginCache().createNewPlugin(te::AuxSendPlugin::xmlTypeName, {});
    if (auto* aux = dynamic_cast<te::AuxSendPlugin*>(plugin.get())) {
        aux->busNumber = bus;
        aux->setGainDb(juce::Decibels::gainToDecibels((float)(level > 1.0e-4 ? level : 1.0e-4)));
        track.pluginList.insertPlugin(plugin, -1, nullptr);  // -1 == append
    }
}

}  // namespace

// --- .vstpreset (Steinberg container) load ----------------------------------
// External-plugin state lives in Steinberg .vstpreset files, which JUCE reads and writes natively. A no-op for
// built-ins, which have no wrapped VST3. Exported for both the rack/preset load and the editor's select path.
bool loadVstPreset(te::Plugin& plugin, const juce::File& file) {
    auto* ext = dynamic_cast<te::ExternalPlugin*>(&plugin);
    if (ext == nullptr || !file.existsAsFile())
        return false;
    auto* inst = ext->getAudioPluginInstance();
    juce::MemoryBlock bytes;
    if (inst == nullptr || !file.loadFileAsData(bytes))
        return false;
    return juce::VST3PluginFormat::setStateFromVSTPresetFile(inst, bytes);
}

te::AudioTrack* trackById(te::Edit& edit, const std::string& id,
                          const ProjectDoc& doc) {
    // Map the document's track id to the engine track at the same index.
    for (size_t i = 0; i < doc.tracks.size(); ++i)
        if (doc.tracks[i].id == id) {
            auto tracks = te::getAudioTracks(edit);
            if ((int)i < tracks.size()) return tracks[(int)i];
        }
    return nullptr;
}

void insertClip(te::Engine& engine, te::Edit& edit, te::AudioTrack& track,
                const ClipDoc& c, const std::string& baseDir) {
    // MIDI clips are carried in the model but not rendered on this path — playing them needs an instrument on the
    // track — so skip the wave path rather than warn about their correctly-empty source.
    if (c.type == ClipType::Midi)
        return;

    const auto path = (fs::path(baseDir) / c.source).string();
    const juce::File file{juce::String{path}};   // braces avoid the vexing parse
    te::AudioFile af(engine, file);
    if (!file.existsAsFile() || !af.isValid()) {
        warn("clip source not found/invalid: " + path);
        return;
    }
    // Name the clip by its doc id, as MIDI clips are, so identity is consistent and ClipRemoved can match it —
    // which is what lets a live-streamed audio pattern prune played one-shots instead of piling them up.
    auto clip = track.insertWaveClip(juce::String(c.name.empty() ? c.id : c.name), file,
                                     clipPositionFor(edit, c, af.getLength()), false);
    if (clip != nullptr) {
        applyClipLoop(*clip, c);
        applyClipWarp(*clip, edit, c); // imported time-stretch, if any (WarpTimeManager)
    }
}

// The cheap per-track params Tracktion supports directly: doc volume is a linear gain and the fader takes dB;
// doc pan is 0..1 and the plugin's is -1..1.
void applyTrackParams(te::AudioTrack& track, const TrackDoc& t) {
    // The track's own fader is left at unity: what a track sounds like is decided by the modules on it, and the
    // last of those is its mixer strip. Driving this one as well would be a second gain stage nothing names.
    track.setMute(t.mute);
}

// Solo is a mixer-wide relationship — any soloed track silences every non-soloed one — so re-apply mute across
// ALL tracks after a sync, since a per-track diff carries only the changed track. Tracks map to the edit's
// audio tracks by index, as populateEdit assigns them.
void applySoloMute(te::Edit& edit, const ProjectDoc& doc) {
    bool anySolo = false;
    for (const auto& t : doc.tracks)
        if (t.solo) { anySolo = true; break; }
    auto audioTracks = te::getAudioTracks(edit);
    for (size_t i = 0; i < doc.tracks.size() && i < static_cast<size_t>(audioTracks.size()); ++i) {
        const auto& t = doc.tracks[i];
        audioTracks[static_cast<int>(i)]->setMute(t.mute || (anySolo && !t.solo));
    }
}

// Create a MIDI clip on the track from a ClipDoc's notes. NB: ClipTrack::insertMIDIClip takes a TimeRange, NOT
// a ClipPosition, and MidiList::addNote takes (pitch, BeatPosition, BeatDuration, velocity, colour, undo).
void insertMidiClip(te::Edit& edit, te::AudioTrack& track, const ClipDoc& c) {
    const auto len = c.length > 0.0 ? c.length : 4.0;
    const tt::TimeRange range{beatToTime(edit, c.start), beatToTime(edit, c.start + len)};
    auto clip = track.insertMIDIClip(juce::String(c.name.empty() ? c.id : c.name), range, nullptr);
    if (clip == nullptr)
        return;
    auto& seq = clip->getSequence();
    for (const auto& n : c.notes)
        seq.addNote(n.key,
                    tt::BeatPosition::fromBeats(n.time),
                    tt::BeatDuration::fromBeats(n.duration > 0.0 ? n.duration : 0.25),
                    juce::jlimit(1, 127, juce::roundToInt(n.vel * 127.0)),
                    0, nullptr);
    applyClipLoop(*clip, c);
}

bool saveVstPreset(te::Plugin& plugin, const juce::File& file) {
    auto* ext = dynamic_cast<te::ExternalPlugin*>(&plugin);
    if (ext == nullptr)
        return false;
    auto* inst = ext->getAudioPluginInstance();
    if (inst == nullptr)
        return false;
    struct Getter : juce::ExtensionsVisitor {
        juce::MemoryBlock preset;
        bool got = false;
        void visitVST3Client(const VST3Client& c) override {
            preset = c.getPreset();
            got = true;
        }
    } getter;
    inst->getExtensions(getter);
    if (!getter.got || getter.preset.getSize() == 0)
        return false;
    file.getParentDirectory().createDirectory();
    return file.replaceWithData(getter.preset.getData(), getter.preset.getSize());
}

// Normalize a built-in's type to the xmlTypeName createNewPlugin keys on: a project may use the human form
// ("Chorus") rather than the internal id ("chorus"), and Tracktion's lookup is exact-case. Built-ins sit in the
// scan cache as { format:"internal", name:<display>, identifier:<xmlTypeName> }, so match on either and hand
// back the xmlTypeName; return p.type unchanged when nothing matches and leave the warning to the caller.
std::string resolveBuiltInType(const std::string& ptype) {
    const auto infos = cachedPluginInfos();   // a snapshot, for the same reason makeExternalPlugin holds one
    for (const auto& i : *infos)
        if (i.format == "internal"
            && (iequals(i.name, ptype) || iequals(i.identifier, ptype)))
            return i.identifier;
    return ptype;
}

// Instantiate a plugin from a PluginDoc and insert it at `index` (0 == front, before the built-in volume/pan);
// callers pass an increasing index so a chain keeps its order. A built-in comes from its xmlTypeName, an
// external from the scan cache. A resolved .vstpreset loads first, then text params override it.
te::Plugin::Ptr addPlugin(te::Edit& edit, te::AudioTrack& track, const PluginDoc& p, int index) {
    if (p.type.empty())
        return {};
    // A built-in is created from a STATE tree rather than a type name whenever the module carries something the
    // plugin must know before its constructor returns. That is the case for exactly one thing so far: a DSP
    // graph declares the plugin's parameters, and Tracktion plugins create their AutomatableParameters in the
    // constructor and never after — so the description has to be on the tree already. See GraphDspPlugin.
    const auto makeBuiltIn = [&]() -> te::Plugin::Ptr {
        const juce::String type{resolveBuiltInType(p.type)};
        if (p.dspGraph.empty())
            return edit.getPluginCache().createNewPlugin(type, {});
        juce::ValueTree v(te::IDs::PLUGIN);
        v.setProperty(te::IDs::type, type, nullptr);
        v.setProperty(juce::Identifier("graph"), juce::String(p.dspGraph), nullptr);
        return edit.getPluginCache().createNewPlugin(v);
    };
    te::Plugin::Ptr plugin = isExternalFormat(p.type) ? makeExternalPlugin(edit, p) : makeBuiltIn();
    if (plugin == nullptr) {
        warn("could not create plugin '" + (p.name.empty() ? p.type : p.name) + "' (" +
                 p.type + ")",
             p.id);
        return {};
    }
    track.pluginList.insertPlugin(plugin, index, nullptr);
    // Bypass. A step written `enabled: false` always reached the engine in the PluginDoc and was silently dropped
    // here, so a bypassed module went on processing. Tracktion's `enabled` is exactly this: the plugin stays in the
    // chain and passes its input through. Set BEFORE the preset and params, so flipping bypass off restores the
    // module as configured rather than as created.
    plugin->setEnabled(p.enabled);
    if (!p.path.empty())
        loadVstPreset(*plugin, juce::File(juce::String(p.path)));   // module's or its base's .vstpreset
    // A neural amp modeller's .nam model, loaded from the FILE the project names rather than the plugin's stored
    // blob: the song is the source of truth here as everywhere, so swapping an amp is picking a file. Loaded HERE,
    // on the message thread while the Edit is built — never from the audio thread, which is why
    // NamPlugin::loadModel says so in as many words.
    if (!p.namFile.empty())
        if (auto* nam = dynamic_cast<studio::NamPlugin*>(plugin.get())) {
            juce::String err;
            const juce::File f{juce::String(p.namFile)};
            if (!nam->loadModel(f, err))
                warn(err.toStdString(), p.id);
            else if (const double want = nam->modelSampleRate();
                     want > 0.0 && std::abs(want - edit.engine.getDeviceManager().getSampleRate()) > 1.0)
                // A model is trained at one rate and this plugin does not resample, so the amp simply sounds like a different
                // amp. Worth a line: nothing else in the signal path would tell you.
                warn("expects " + std::to_string(want) + " Hz but the engine runs at " +
                         std::to_string(edit.engine.getDeviceManager().getSampleRate()) +
                         " Hz - the model will not sound as trained",
                     p.id);
        }
    applyPluginParams(*plugin, p.params);                            // text params override the preset

    // Checked AFTER the params, because it depends on one of them: a model that declares no loudness leaves
    // Normalize with nothing to work from, and the resulting level is whatever the model happens to output.
    // Silent otherwise — a module that turned Normalize off has already said it does not care.
    if (!p.namFile.empty())
        if (auto* nam = dynamic_cast<studio::NamPlugin*>(plugin.get()))
            if (nam->normalize->getCurrentValue() >= 0.5f && !nam->modelLoudness().has_value()
                && !nam->modelPath().isEmpty())
                warn("model declares no loudness - Normalize has nothing to level it to, so its output stays "
                     "at whatever level it was trained at",
                     p.id);

    // A rack instrument carries its sounds in p.rack: each is a window of an audio file — a whole clip for a
    // "samples" rack, a slice of the shared source for a "slice" one — loaded pinned to its note.
    if (!p.rack.empty()) {
        if (auto* sampler = dynamic_cast<te::SamplerPlugin*>(plugin.get())) {
            for (const auto& e : p.rack)
                addRackSound(edit, *sampler, e.clip, e.symbol, e.note, e.start, e.length);
        } else {
            warn("carries a rack but is not a sampler (" + p.type + ")", p.id);
        }
    }
    return plugin;
}

// Load one rack sound: honour the requested window clamped to the file, falling back to the whole file when no
// usable length was given. Pinned to exactly its note and open-ended, so a short note still plays the whole hit.
bool addRackSound(te::Edit& edit, te::SamplerPlugin& sampler, const std::string& file,
                  const std::string& name, int note, double start, double length) {
    const juce::File f{juce::String(file)};
    double natural = 0.0;
    if (f.existsAsFile()) {
        te::AudioFile af(edit.engine, f);
        if (af.isValid()) natural = af.getLength();
    }
    if (natural <= 0.0) {
        warn("rack sound '" + name + "' -> '" + file +
             "' is missing or unreadable; skipped");
        return false;
    }
    const double s = juce::jlimit(0.0, natural, start);
    const double len = length > 0.0 ? juce::jmin(length, natural - s) : natural - s;
    const juce::String err =
        sampler.addSound(juce::String(file), juce::String(name), s, len, 0.0f);
    if (err.isNotEmpty()) {
        warn("rack sound '" + name + "': " + err.toStdString());
        return false;
    }
    const int idx = sampler.getNumSounds() - 1;
    sampler.setSoundParams(idx, note, note, note);   // one sound, one note
    sampler.setSoundOpenEnded(idx, true);            // one-shot playback
    return true;
}

void applyAutomationLane(te::Edit& edit, te::Plugin& plugin, const AutomationDoc& lane) {
    // Resolve the target parameter by the same display name namedParams() uses, so a curve authored against
    // "Filter Freq" finds the 4OSC's cutoff.
    te::AutomatableParameter* param = nullptr;
    for (auto& [name, p] : namedParams(plugin))
        if (name.toStdString() == lane.param) { param = p; break; }
    if (param == nullptr) {
        warn("automation param not found: " + lane.param, lane.pluginId);
        return;
    }

    // Map the curve's output onto the param's range: unipolar (0..1) spans it fully, bipolar (-1..1) modulates
    // ±half around the param's set value — so a wobble rides where the knob sits rather than sweeping the control.
    const auto range = param->getValueRange();
    const float lo = range.getStart();
    const float hi = range.getEnd();
    const float base = param->getCurrentValue();
    const float half = (hi - lo) * 0.5f;

    auto& curve = param->getCurve();
    curve.clear();
    for (const auto& [beat, out] : lane.points) {
        const float value = lane.bipolar
            ? juce::jlimit(lo, hi, base + static_cast<float>(out) * half)
            : param->valueRange.convertFrom0to1(juce::jlimit(0.0f, 1.0f, static_cast<float>(out)));
        curve.addPoint(beatToTime(edit, beat), value, 0.0f);
    }
}

// Build the Edit graph from a doc: tempo, tracks with their clips, plugins and aux sends. Shared by the live
// server path and the offline renderer — both need exactly this graph, and only what follows differs.
void populateEdit(te::Engine& engine, te::Edit& edit, const ProjectDoc& doc,
                  const std::string& baseDir,
                  std::map<std::string, te::Plugin::Ptr>* pluginsOut,
                  std::map<std::string, std::string>* presetSaveOut) {
    // Every media path in a doc is ABSOLUTE. Tracktion's SourceFileReference — which SamplerPlugin uses to open a
    // rack sound — otherwise reads a source string as a ProjectItemID or a path relative to the nonexistent edit
    // file, so the sound is silent. Point the resolver straight at the file; nothing else here goes through one.
    edit.filePathResolver = [](const juce::String& s) { return juce::File(s); };

    // Tracktion's master fader defaults to -3 dB, and nothing here ever moved it. Every mixdown this engine
    // has written came out 3 dB below the material that made it, on a fader no surface draws and nobody set.
    //
    // Found by measuring, after two wrong guesses: a one-track doc with no plugins rendered 3 dB low WITH the
    // master (`useMaster=true`) and exactly at unity without it, so a stem was always right and a mixdown
    // always low. It is not a pan law — the plugin was asked, and answered `vol=-3, pan=0`. Track faders were
    // never involved.
    //
    // Set here, so playback, `--render` and a freeze move together: a bounce that came back at one level and
    // played at another would be audible the moment you froze a track. It matters most where a render is
    // written BACK onto the material — `clip process` treated the same audio 3 dB quieter every pass.
    // See packages/commands/docs/peakPass.md.
    if (auto master = edit.getMasterVolumePlugin()) master->setVolumeDb(0.0f);

    edit.tempoSequence.getTempo(0)->setBpm(doc.tempo);
    if (auto* ts = edit.tempoSequence.getTimeSig(0)) {
        ts->numerator = doc.timeSigNumerator;
        ts->denominator = doc.timeSigDenominator;
    }

    edit.ensureNumberOfAudioTracks(static_cast<int>(std::max<size_t>(1, doc.tracks.size())));
    auto audioTracks = te::getAudioTracks(edit);

    // Plugins whose second input port is wired, resolved in a pass of their own below: the source is a TRACK,
    // and a track has no EditItemID until it has been made — so a chain that sidechains from a lane later in
    // the doc would find nothing at all if this were done inline.
    std::vector<std::pair<te::Plugin::Ptr, std::string>> sidechains;

    for (size_t i = 0; i < doc.tracks.size(); ++i) {
        const auto& tdoc = doc.tracks[i];
        auto* track = audioTracks[static_cast<int>(i)];
        track->setName(juce::String(tdoc.name));
        applyTrackParams(*track, tdoc);
        for (const auto& c : tdoc.clips) {
            // A disabled event is placed but silent: it reaches us so the timeline can
            // draw it, and is simply never built into the edit.
            if (c.disabled) continue;
            if (c.type == ClipType::Midi) insertMidiClip(edit, *track, c);
            else insertClip(engine, edit, *track, c, baseDir);
        }
        int pluginIndex = 0;
        std::map<std::string, te::Plugin*> pluginsOnTrack;   // by id, for automation below
        for (const auto& p : tdoc.plugins)
            if (auto pl = addPlugin(edit, *track, p, pluginIndex++)) {
                pluginsOnTrack[p.id] = pl.get();
                if (!p.sidechainFrom.empty()) sidechains.emplace_back(pl, p.sidechainFrom);
                if (pluginsOut) {
                    (*pluginsOut)[p.id] = pl;   // so `open <module>` can find it by id
                    if (presetSaveOut && !p.presetSave.empty())
                        (*presetSaveOut)[p.id] = p.presetSave;   // where a UI edit saves it
                }
            }
        // Automation: bake each lane onto its target plugin's parameter curve, once every plugin on this track exists.
        // A lane targeting a plugin that failed to instantiate is skipped.
        for (const auto& lane : tdoc.automation)
            if (auto it = pluginsOnTrack.find(lane.pluginId); it != pluginsOnTrack.end())
                applyAutomationLane(edit, *it->second, lane);
    }

    // Second inputs, now that every lane has an itemID. Tracktion carries one sidechain source per plugin and
    // sums it into the render buffer past the stereo pair, which is where DspGraph's `ain` port 1 reads it
    // (see docs/sidechain.md). The wires are what actually map channels, so a plugin with none gets the
    // default routing — with our channel names that is source L/R onto channels 2/3.
    for (auto& [plugin, from] : sidechains) {
        auto* src = trackById(edit, from, doc);
        if (src == nullptr) {
            warn("second input source track not found: " + from);
            continue;
        }
        // Its own lane is not a second signal, it is the one already flowing in — and Tracktion excludes the
        // owner track from a sidechain source for exactly that reason. Say so rather than wire a loop.
        if (plugin->getOwnerTrack() == src) {
            warn("second input source '" + from + "' is this module's own track - that signal is already its first input");
            continue;
        }
        plugin->setSidechainSourceID(src->itemID);
        if (plugin->getNumWires() == 0)
            plugin->guessSidechainRouting();
    }

    // Aux sends, a second pass once every track including the return buses exists: each destination gets a bus
    // number and one AuxReturn, and every enabled send feeding it gets an AuxSend at its level.
    std::map<std::string, int> busForDest;   // dest track id -> bus number
    int nextBus = 1;
    for (size_t i = 0; i < doc.tracks.size(); ++i) {
        auto* src = audioTracks[static_cast<int>(i)];
        for (const auto& s : doc.tracks[i].sends) {
            if (!s.enabled)
                continue;
            auto* dest = trackById(edit, s.to, doc);
            if (dest == nullptr) {
                warn("send target track not found: " + s.to);
                continue;
            }
            auto found = busForDest.find(s.to);
            const int bus = found != busForDest.end() ? found->second : (busForDest[s.to] = nextBus++);
            if (found == busForDest.end())
                addAuxReturn(edit, *dest, bus);   // first sender wires the return
            addAuxSend(edit, *src, bus, s.level);
        }
    }

    applySoloMute(edit, doc);   // resolve mute across the mixer once every track exists
}

}  // namespace studio
