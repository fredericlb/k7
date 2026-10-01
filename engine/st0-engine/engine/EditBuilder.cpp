// Building the Tracktion Edit graph from a ProjectDoc — see EditBuilder.h.

#include "EditBuilder.h"

#include "AudioInputs.h"  // routeTrackOutput — which pair a track leaves by
#include "Warnings.h"  // warn() — reaches the client, not just stderr
#include "MixBlend.h"  // indexAfterModule — a module's @mix pair sits around it
#include "MasterGainPlugin.h" // the OUT node's Volume, behind the master chain
#include "NamPlugin.h" // a .nam model is loaded onto the plugin as the Edit is built
#include "TurntablePlugin.h" // …and a platter's record, for the same reason

#include "PluginParams.h"    // applyPluginParams (via addPlugin)
#include "PluginScan.h"      // cachedPluginInfos (via makeExternalPlugin)
#include "SendPlan.h"        // which bus each send lands on, shared with the diff

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

    // The clip FILE's window into its source, in seconds: `from` moves the in-point, `to` ends the material early.
    const double from = juce::jlimit(0.0, naturalLen, c.sourceFrom);
    const double to = c.sourceTo > 0.0 ? juce::jlimit(from, naturalLen, c.sourceTo) : naturalLen;
    // The placement's own musical offset reads FURTHER into that window, the two stacking in-point first — docs/editBuilder.md.
    const double inPoint =
        juce::jlimit(from, to, from + beatToTime(edit, c.offset).inSeconds());
    // What remains of the window is the clip's usable length, which is what makes an untimed placement play exactly the window.
    const double usable = juce::jmax(0.0, to - inPoint);

    auto end = c.length > 0.0 ? beatToTime(edit, c.start + c.length)
                              : start + tt::TimeDuration::fromSeconds(usable);
    // A placement asking for MORE than the window would read past `to`, so the window wins — except on a looped clip (docs/editBuilder.md).
    if (c.length > 0.0 && c.loopEnd <= c.loopStart) {
        const auto windowEnd = start + tt::TimeDuration::fromSeconds(usable);
        if (windowEnd < end)
            end = windowEnd;
    }

    // The source in-point: read the wav from `inPoint` in, never from sample 0 — docs/editBuilder.md.
    return { tt::TimeRange(start, end), tt::TimeDuration::fromSeconds(inPoint) };
}

// Loop a clip-relative beat region if the placement set one; the placed clip length decides how many times it repeats.
void applyClipLoop(te::Clip& clip, const ClipDoc& c) {
    if (c.loopEnd > c.loopStart)
        clip.setLoopRangeBeats({ tt::BeatPosition::fromBeats(c.loopStart),
                                 tt::BeatDuration::fromBeats(c.loopEnd - c.loopStart) });
}

// Apply an imported warp to a wave clip: auto-tempo for the overall ratio, a warp map for the interior — docs/warp.md.
void applyClipWarp(te::AudioClipBase& clip, te::Edit& edit, const ClipDoc& c) {
    const auto& markers = c.warp.markers;
    if (markers.size() < 2)
        return;
    const double srcSpanS = markers.back().second - markers.front().second; // source secs
    const double beatSpan = markers.back().first - markers.front().first;   // timeline beats
    if (srcSpanS <= 0.0 || beatSpan <= 0.0)
        return;

    // A warp that stretches by 1.0 and pins nothing between its ends is not a warp, and entering that path breaks the clip — docs/editBuilder.md.
    const double tempo = edit.tempoSequence.getTempo(0)->getBpm();
    const double ratio = tempo > 0.0 ? (beatSpan * 60.0 / tempo) / srcSpanS : 1.0;
    if (markers.size() == 2 && std::abs(ratio - 1.0) < 1.0e-4)
        return;

    // VARISPEED: no stretcher at all, just a playback rate, so the pitch follows the tempo like a platter's does.
    if (c.warp.algorithm == "varispeed") {
        clip.setAutoTempo(false);
        clip.setTimeStretchMode(te::TimeStretcher::disabled);
        clip.setUsesProxy(false);
        // Source seconds per timeline second: Tracktion divides the source length by it — docs/warp.md.
        clip.setSpeedRatio(1.0 / ratio);
        return;
    }

    // Pick a stretch algorithm ACTUALLY COMPILED in: an unlinked mode silently becomes `disabled`, which is no stretching at all.
    clip.setTimeStretchMode(te::TimeStretcher::elastiquePro);
    if (clip.getTimeStretchMode() == te::TimeStretcher::disabled)
        clip.setTimeStretchMode(te::TimeStretcher::soundtouchBetter);

    // Stretch INLINE rather than through a proxy: a proxy is a background render job the headless renderer never pumps.
    clip.setUsesProxy(false);

    // Declare the source's musical length and let auto-tempo stretch — the OVERALL ratio, first marker to last.
    auto& li = clip.getLoopInfo();
    li.setNumerator(4);
    li.setDenominator(4);
    li.setNumBeats(beatSpan);
    li.clearLoopPoints();
    clip.setAutoTempo(true);

    // The interior markers, as a WARP MAP — auto-tempo cannot place them and loop points do not either; docs/warp.md.
    if (markers.size() > 2) {
        // Both layers apply, so the map carries only the DEVIATION from linear and its endpoints come out identity (docs/warp.md).
        const double srcStart = markers.front().second;
        const double beatStart = markers.front().first;
        auto& wtm = clip.getWarpTimeManager();
        wtm.removeAllMarkers(); // back to the two identity endpoints Tracktion seeds
        for (size_t i = 1; i + 1 < markers.size(); ++i) {
            const double linear =
                srcStart + (markers[i].first - beatStart) / beatSpan * srcSpanS;
            wtm.insertMarker(te::WarpMarker(tt::TimePosition::fromSeconds(markers[i].second),
                                            tt::TimePosition::fromSeconds(linear)));
        }
        // AFTER setUsesProxy(false) above, and that order is the whole safety of it — docs/editBuilder.md.
        clip.setWarpTime(true);
    }
}

// ASCII case-insensitive equality: plugin names and formats round-trip through JSON and YAML, whose casing we do not control.
bool iequals(const std::string& a, const std::string& b) {
    return a.size() == b.size() &&
           std::equal(a.begin(), a.end(), b.begin(),
                      [](char x, char y) { return std::tolower((unsigned char)x) == std::tolower((unsigned char)y); });
}

// A PluginDoc.type naming an external plugin FORMAT rather than a built-in's xmlTypeName — the two resolve differently.
bool isExternalFormat(const std::string& type) {
    static const std::set<std::string> formats{"vst3", "vst", "vst2", "au", "audiounit", "clap", "lv2", "ladspa", "aax"};
    std::string low = type;
    std::transform(low.begin(), low.end(), low.begin(), [](unsigned char c) { return (char)std::tolower(c); });
    return formats.count(low) != 0;
}

// Instantiate an external plugin from the scan cache, which holds its full PluginDescription; null with a hint when it is not cached.
te::Plugin::Ptr makeExternalPlugin(te::Edit& edit, const PluginDoc& p) {
    // The snapshot is held for the whole function: `info` points INTO it, so losing it here is a use-after-free (docs/plugins.md).
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

    // Fast path: the cache holds the description as XML, and seeding knownPluginList is what makes the plugin LOAD — docs/plugins.md.
    if (!info->descXml.empty()) {
        juce::PluginDescription desc;
        if (auto xml = juce::parseXML(juce::String(info->descXml)); xml && desc.loadFromXml(*xml)) {
            edit.engine.getPluginManager().knownPluginList.addType(desc);
            return edit.getPluginCache().createNewPlugin(te::ExternalPlugin::xmlTypeName, desc);
        }
    }

    // Fallback for an older cache with no stored description: introspect the file, which is slower; a forced rescan removes this path.
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

// Auxiliary sends: a copy of a source track's post-FX signal onto a shared bus, injected back by an AuxReturn — docs/editBuilder.md.

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

// Load a Steinberg .vstpreset container — a no-op for built-ins, and the ONE reader of that format (docs/plugins.md).
bool loadVstPreset(te::Plugin& plugin, const juce::File& file) {
    auto* ext = dynamic_cast<te::ExternalPlugin*>(&plugin);
    if (ext == nullptr || !file.existsAsFile())
        return false;
    auto* inst = ext->getAudioPluginInstance();
    juce::MemoryBlock bytes;
    if (inst == nullptr || !file.loadFileAsData(bytes))
        return false;
#if JUCE_PLUGINHOST_VST3
    return juce::VST3PluginFormat::setStateFromVSTPresetFile(inst, bytes);
#else
    return false;  // no VST3 hosting (Android): there is no external plugin to hand a preset to
#endif
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
    // MIDI clips are carried in the model but not rendered here, so skip rather than warn about their correctly-empty source.
    if (c.type == ClipType::Midi)
        return;

    const auto path = (fs::path(baseDir) / c.source).string();
    const juce::File file{juce::String{path}};   // braces avoid the vexing parse
    te::AudioFile af(engine, file);
    if (!file.existsAsFile() || !af.isValid()) {
        warn("clip source not found/invalid: " + path);
        return;
    }
    // Named by its PLACEMENT id, never its material — docs/clipIdentity.md.
    auto clip = track.insertWaveClip(juce::String(clipNameFor(c)), file,
                                     clipPositionFor(edit, c, af.getLength()), false);
    if (clip != nullptr) {
        applyClipLoop(*clip, c);
        applyClipWarp(*clip, edit, c); // imported time-stretch, if any (WarpTimeManager)
    }
}

// The cheap per-track params Tracktion supports directly — docs/editBuilder.md for why the fader is not one of them.
void applyTrackParams(te::AudioTrack& track, const TrackDoc& t) {
    // The track's own fader is left at unity: the modules decide, and driving this too would be a second gain stage nothing names.
    track.setMute(t.mute);
}

// Solo is a mixer-wide relationship, so re-apply mute across ALL tracks after a sync — a per-track diff carries only the changed one.
/** A lane heard through its buses and nowhere else: ROUTED to the first, aux-sent to the rest — docs/editBuilder.md. */
void applySendLevels(te::Edit& edit, const ProjectDoc& doc, const std::string& trackId) {
    auto* lane = trackById(edit, trackId, doc);
    if (lane == nullptr) return;
    for (const auto& p : planSends(doc)) {
        if (p.bus == 0 || doc.tracks[p.source].id != trackId) continue;
        for (auto* plugin : lane->pluginList)
            if (auto* aux = dynamic_cast<te::AuxSendPlugin*>(plugin); aux && aux->busNumber == p.bus)
                aux->setGainDb(juce::Decibels::gainToDecibels((float)(p.level > 1.0e-4 ? p.level : 1.0e-4)));
    }
}

void applySoloMute(te::Edit& edit, const ProjectDoc& doc) {
    bool anySolo = false;
    for (const auto& t : doc.tracks)
        if (t.solo) { anySolo = true; break; }
    auto audioTracks = te::getAudioTracks(edit);
    for (size_t i = 0; i < doc.tracks.size() && i < static_cast<size_t>(audioTracks.size()); ++i) {
        const auto& t = doc.tracks[i];
        // A routed lane carries its mute as an OUTPUT, so muting it here would silence the bus too.
        const bool mute = t.mute && !feedsBusOnly(t);
        audioTracks[static_cast<int>(i)]->setMute(mute || (anySolo && !t.solo));
    }
}

// One note into the sequence, retriggered `repeat` times inside its OWN duration — a pad's ratchet, docs/editBuilder.md.
static void addNoteWithRepeat(te::MidiList& seq, const NoteDoc& n, double atBeat) {
    const double dur = n.duration > 0.0 ? n.duration : 0.25;
    const int hits = n.repeat >= 2 ? n.repeat : 1;
    const double each = dur / hits;
    const int vel = juce::jlimit(1, 127, juce::roundToInt(n.vel * 127.0));
    for (int i = 0; i < hits; ++i)
        seq.addNote(n.key,
                    tt::BeatPosition::fromBeats(atBeat + i * each),
                    tt::BeatDuration::fromBeats(each),
                    vel, 0, nullptr);
}

/** A MIDI clip, with its pads' effects realised — `skip` UNROLLS the passes, and why is docs/editBuilder.md. */
void insertMidiClip(te::Edit& edit, te::AudioTrack& track, const ClipDoc& c) {
    const auto len = c.length > 0.0 ? c.length : 4.0;
    const tt::TimeRange range{beatToTime(edit, c.start), beatToTime(edit, c.start + len)};
    auto clip = track.insertMIDIClip(juce::String(clipNameFor(c)), range, nullptr);
    if (clip == nullptr)
        return;
    auto& seq = clip->getSequence();

    const double win = c.loopEnd > c.loopStart ? c.loopEnd - c.loopStart : 0.0;
    bool anySkip = false;
    for (const auto& n : c.notes)
        if (n.skip >= 2) { anySkip = true; break; }

    if (!anySkip || win <= 0.0) {
        // The path every pattern took before pad effects existed, `repeat` aside.
        for (const auto& n : c.notes)
            addNoteWithRepeat(seq, n, n.time);
        applyClipLoop(*clip, c);
        return;
    }

    // How many times the window fits the clip. Rounded rather than truncated, so a last pass a few ulps short is not dropped.
    const long long wanted = std::llround(len / win);
    // Bounded: a window of a few ulps would otherwise unroll billions of passes on the message thread.
    constexpr long long kMaxPasses = 4096;
    if (wanted > kMaxPasses)
        warn("clip '" + c.id + "' loops its window " + std::to_string(wanted) + " times — only the first " +
             std::to_string(kMaxPasses) + " are written");
    const int passes = (int)std::clamp<long long>(wanted, 1, kMaxPasses);
    for (int p = 0; p < passes; ++p)
        for (const auto& n : c.notes) {
            // Every Nth pass falls silent, counting the first as pass 1: `skip: 2` plays one pass in two, `skip: 4` three in four.
            if (n.skip >= 2 && ((p + 1) % n.skip) == 0)
                continue;
            // Clip-relative, as the loop range would have made it: the window's start becomes the clip's start.
            addNoteWithRepeat(seq, n, (n.time - c.loopStart) + p * win);
        }
    // Deliberately NO applyClipLoop: the repetition is written out, and looping it again would play the whole expansion over.
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

// Normalize a built-in's type to the xmlTypeName createNewPlugin keys on, matching either spelling — docs/builtinParams.md.
std::string resolveBuiltInType(const std::string& ptype) {
    const auto infos = cachedPluginInfos();   // a snapshot, for the same reason makeExternalPlugin holds one
    for (const auto& i : *infos)
        if (i.format == "internal"
            && (iequals(i.name, ptype) || iequals(i.identifier, ptype)))
            return i.identifier;
    return ptype;
}

// The whole of plugin creation, onto whichever LIST it is going: a track's, or the edit's master list — docs/editBuilder.md.
// The FILES a module loads — its preset, its model and cabinet, its record — where they differ from `was`, all of them when null (docs/projectDiff.md).
void loadPluginFiles(te::Edit& edit, te::Plugin& plugin, const PluginDoc& p, const PluginDoc* was) {
    const auto moved = [&](const std::string PluginDoc::*field) {
        return !(p.*field).empty() && (was == nullptr || was->*field != p.*field);
    };
    if (moved(&PluginDoc::path))
        loadVstPreset(plugin, juce::File(juce::String(p.path)));   // module's or its base's .vstpreset
    // The .nam model, loaded from the FILE the project names rather than the plugin's stored blob — on the message thread, never the audio one.
    if (moved(&PluginDoc::namFile))
        if (auto* nam = dynamic_cast<studio::NamPlugin*>(&plugin)) {
            juce::String err;
            const juce::File f{juce::String(p.namFile)};
            if (!nam->loadModel(f, err))
                warn(err.toStdString(), p.id);
            else if (const double want = nam->modelSampleRate();
                     want > 0.0 && std::abs(want - edit.engine.getDeviceManager().getSampleRate()) > 1.0)
                // Not a warning: it sounds as trained. Said once, so a latency on this lane has a reason in the log.
                std::cerr << "[nam] " << p.id << ": model at " << nam->modelSampleRate()
                          << " Hz, resampled from the engine's rate\n";
        }
    // …and the cabinet IR it convolves after the model, the same way and on the same thread.
    if (moved(&PluginDoc::irFile))
        if (auto* nam = dynamic_cast<studio::NamPlugin*>(&plugin)) {
            juce::String err;
            if (!nam->loadImpulseResponse(juce::File{juce::String(p.irFile)}, err))
                warn(err.toStdString(), p.id);
        }
    // A rack's sounds, in place — only when reloading: a new sampler gets them from addPluginTo, after its params.
    if (was != nullptr && was->rack != p.rack) reloadRack(edit, plugin, p);
    // The RECORD a platter owns, decoded on its own loader thread — neither the message thread nor the audio one waits on it.
    if (moved(&PluginDoc::deckFile))
        if (auto* deck = dynamic_cast<studio::TurntablePlugin*>(&plugin)) {
            juce::String err;
            if (!deck->loadRecordAsync(juce::File(juce::String(p.deckFile)), err, p.id))
                warn(err.toStdString(), p.id);
        }
}

// A module's SECOND input, aimed at `from` resolved through `doc` — or unwired when `from` is empty (docs/sidechain.md).
void wireSidechain(te::Edit& edit, te::Plugin& plugin, const std::string& from, const ProjectDoc& doc) {
    if (from.empty()) {
        plugin.setSidechainSourceID({});
        return;
    }
    auto* src = trackById(edit, from, doc);
    if (src == nullptr) {
        warn("second input source track not found: " + from);
        return;
    }
    // Its own lane is not a second signal but the one already flowing in, so say so rather than wire a loop.
    if (plugin.getOwnerTrack() == src) {
        warn("second input source '" + from + "' is this module's own track - that signal is already its first input");
        return;
    }
    plugin.setSidechainSourceID(src->itemID);
    if (plugin.getNumWires() == 0)
        plugin.guessSidechainRouting();
}

te::Plugin::Ptr addPluginTo(te::Edit& edit, te::PluginList& list, const PluginDoc& p, int index) {
    if (p.type.empty())
        return {};
    // A built-in is created from a STATE tree when the module carries what the plugin must know before its constructor returns.
    const auto makeBuiltIn = [&]() -> te::Plugin::Ptr {
        const juce::String type{resolveBuiltInType(p.type)};
        // A pattern lane's plugin reads its source, its label and the id its warnings name, all before its worker starts.
        if (!p.patternSource.empty() || !p.patternLabel.empty()) {
            juce::ValueTree v(te::IDs::PLUGIN);
            v.setProperty(te::IDs::type, type, nullptr);
            v.setProperty("pattern", juce::String(p.patternSource), nullptr);
            v.setProperty("label", juce::String(p.patternLabel), nullptr);
            v.setProperty("docId", juce::String(p.id), nullptr);
            v.setProperty("catchAll", p.patternCatchAll, nullptr);
            v.setProperty("plays", juce::String(p.patternPlays.empty() ? "both" : p.patternPlays), nullptr);
            v.setProperty("only", p.patternOnly, nullptr);
            // Lists one entry per line: a label and a folder path both hold anything but a newline.
            const auto joined = [](const std::vector<std::string>& xs) {
                juce::StringArray a;
                for (const auto& x : xs) a.add(juce::String(x));
                return a.joinIntoString("\n");
            };
            v.setProperty("claimed", joined(p.patternClaimed), nullptr);
            v.setProperty("banks", joined(p.patternBanks), nullptr);
            return edit.getPluginCache().createNewPlugin(v);
        }
        // Never both: a module names one plugin, and that plugin reads one of these two properties.
        const char* const prop = !p.dspGraph.empty() ? "graph" : (!p.faustDsp.empty() ? "faust" : nullptr);
        if (prop == nullptr)
            return edit.getPluginCache().createNewPlugin(type, {});
        juce::ValueTree v(te::IDs::PLUGIN);
        v.setProperty(te::IDs::type, type, nullptr);
        v.setProperty(juce::Identifier(prop),
                      juce::String(!p.dspGraph.empty() ? p.dspGraph : p.faustDsp), nullptr);
        return edit.getPluginCache().createNewPlugin(v);
    };
    te::Plugin::Ptr plugin = isExternalFormat(p.type) ? makeExternalPlugin(edit, p) : makeBuiltIn();
    if (plugin == nullptr) {
        warn("could not create plugin '" + (p.name.empty() ? p.type : p.name) + "' (" +
                 p.type + ")",
             p.id);
        return {};
    }
    list.insertPlugin(plugin, index, nullptr);
    // Bypass: Tracktion's `enabled` keeps the plugin in the chain and passes its input through, and it is set BEFORE the preset and params.
    plugin->setEnabled(p.enabled);
    loadPluginFiles(edit, *plugin, p, nullptr);
    applyPluginParams(*plugin, p.params);                            // text params override the preset

    // Checked AFTER the params, because it depends on one: Normalize with no declared loudness has nothing to level to.
    if (!p.namFile.empty())
        if (auto* nam = dynamic_cast<studio::NamPlugin*>(plugin.get()))
            // Only a .nam can declare a loudness: an RTNeural model never does, and is levelled by its trims.
            if (nam->normalize->getCurrentValue() >= 0.5f && !nam->modelLoudness().has_value()
                && nam->modelIsNam())
                warn("model declares no loudness - Normalize has nothing to level it to, so its output stays "
                     "at whatever level it was trained at",
                     p.id);

    // A rack instrument carries its sounds in p.rack: each is a window of an audio file, loaded pinned to its note.
    if (!p.rack.empty()) reloadRack(edit, *plugin, p);
    return plugin;
}

te::Plugin::Ptr addPlugin(te::Edit& edit, te::AudioTrack& track, const PluginDoc& p, int index) {
    return addPluginTo(edit, track.pluginList, p, index);
}

/** The MASTER CHAIN — the song's `MIX -> OUT` run — FIRST on the edit's master plugin list; docs/editBuilder.md. */
void populateMasterChain(te::Edit& edit, const ProjectDoc& doc,
                         std::map<std::string, te::Plugin::Ptr>* pluginsOut) {
    int index = 0;
    for (const auto& p : doc.masterPlugins)
        if (auto pl = addPluginTo(edit, edit.getMasterPluginList(), p, index)) {
            index = indexAfterModule(edit.getMasterPluginList(), pl.get());
            // BY ID as a track's are: everything keyed by id skips a master module otherwise, in silence — docs/recorder.md.
            if (pluginsOut) (*pluginsOut)[p.id] = pl;
        }

    /** …and the OUT node's `Volume` behind them, made HERE so an offline render gets it too — docs/editBuilder.md. */
    if (auto gain = edit.getPluginCache().createNewPlugin(MasterGainPlugin::xmlTypeName, {})) {
        edit.getMasterPluginList().insertPlugin(gain, -1, nullptr);
        if (auto* mg = dynamic_cast<MasterGainPlugin*>(gain.get())) mg->setGainDb(doc.masterVolume);
    }
}

te::Plugin::Ptr masterGainOf(te::Edit& edit) {
    for (auto p : edit.getMasterPluginList())
        if (dynamic_cast<MasterGainPlugin*>(p) != nullptr) return p;
    return {};
}

// Load one rack sound: the requested window clamped to the file, pinned to its note and open-ended so a short note plays the whole hit.
// The excerpt a rack sound plays, clamped to the file: false, and said, when the file is missing or unreadable.
static bool rackExcerpt(te::Edit& edit, const std::string& file, const std::string& name, double start,
                        double length, const std::string& subject, double& s, double& len) {
    const juce::File f{juce::String(file)};
    double natural = 0.0;
    if (f.existsAsFile()) {
        te::AudioFile af(edit.engine, f);
        if (af.isValid()) natural = af.getLength();
    }
    if (natural <= 0.0) {
        warn("rack sound '" + name + "' -> '" + file + "' is missing or unreadable; skipped", subject);
        return false;
    }
    s = juce::jlimit(0.0, natural, start);
    len = length > 0.0 ? juce::jmin(length, natural - s) : natural - s;
    return true;
}

bool addRackSound(te::Edit& edit, te::SamplerPlugin& sampler, const std::string& file,
                  const std::string& name, int note, double start, double length,
                  const std::string& subject) {
    double s = 0.0, len = 0.0;
    if (!rackExcerpt(edit, file, name, start, length, subject, s, len)) return false;
    const juce::String err =
        sampler.addSound(juce::String(file), juce::String(name), s, len, 0.0f);
    if (err.isNotEmpty()) {
        warn("rack sound '" + name + "': " + err.toStdString(), subject);
        return false;
    }
    const int idx = sampler.getNumSounds() - 1;
    sampler.setSoundParams(idx, note, note, note);   // one sound, one note
    sampler.setSoundOpenEnded(idx, true);            // one-shot playback
    return true;
}

void reloadRack(te::Edit& edit, te::Plugin& plugin, const PluginDoc& p) {
    auto* sampler = dynamic_cast<te::SamplerPlugin*>(&plugin);
    if (sampler == nullptr) {
        if (!p.rack.empty()) warn("carries a rack but is not a sampler (" + p.type + ")", p.id);
        return;
    }
    // Slot by slot, and only what differs: a property set to its own value changes nothing, so an untouched pad costs nothing.
    int slot = 0;
    for (const auto& e : p.rack) {
        double s = 0.0, len = 0.0;
        if (!rackExcerpt(edit, e.clip, e.symbol, e.start, e.length, p.id, s, len)) continue;
        if (slot < sampler->getNumSounds()) {
            sampler->setSoundMedia(slot, juce::String(e.clip));
            sampler->setSoundExcerpt(slot, s, len);
            sampler->setSoundName(slot, juce::String(e.symbol));
        } else if (const auto err = sampler->addSound(juce::String(e.clip), juce::String(e.symbol), s, len, 0.0f);
                   err.isNotEmpty()) {
            warn("rack sound '" + e.symbol + "': " + err.toStdString(), p.id);
            continue;
        }
        sampler->setSoundParams(slot, e.note, e.note, e.note);   // one sound, one note
        sampler->setSoundOpenEnded(slot, true);                  // one-shot playback
        ++slot;
    }
    while (sampler->getNumSounds() > slot) sampler->removeSound(sampler->getNumSounds() - 1);
}

void applyAutomationLane(te::Edit& edit, te::Plugin& plugin, const AutomationDoc& lane) {
    // Resolve the target by the same display name namedParams() uses, so a curve authored against "Filter Freq" finds 4OSC's cutoff.
    te::AutomatableParameter* param = nullptr;
    for (auto& [name, p] : namedParams(plugin))
        if (name.toStdString() == lane.param) { param = p; break; }
    if (param == nullptr) {
        warn("automation param not found: " + lane.param, lane.pluginId);
        return;
    }

    // Map the curve onto the param's range: unipolar spans it fully, bipolar rides ±half around where the knob already sits.
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

// Build the Edit graph from a doc, shared by the live server path and the offline renderer — docs/editBuilder.md.
void populateEdit(te::Engine& engine, te::Edit& edit, const ProjectDoc& doc,
                  const std::string& baseDir,
                  std::map<std::string, te::Plugin::Ptr>* pluginsOut,
                  std::map<std::string, std::string>* presetSaveOut) {
    // Every media path in a doc is ABSOLUTE, so the resolver points straight at the file — docs/editBuilder.md.
    edit.filePathResolver = [](const juce::String& s) { return juce::File(s); };

    // Tracktion's master fader defaults to -3 dB and is pinned to a hard 0 here; the song's own level is a gain beside it — docs/editBuilder.md.
    if (auto master = edit.getMasterVolumePlugin()) master->setVolumeDb(0.0f);

    // …and the song's own master chain onto that same bus, before anything the engine appends.
    populateMasterChain(edit, doc, pluginsOut);

    edit.tempoSequence.getTempo(0)->setBpm(doc.tempo);
    if (auto* ts = edit.tempoSequence.getTimeSig(0)) {
        ts->numerator = doc.timeSigNumerator;
        ts->denominator = doc.timeSigDenominator;
    }

    edit.ensureNumberOfAudioTracks(static_cast<int>(std::max<size_t>(1, doc.tracks.size())));
    auto audioTracks = te::getAudioTracks(edit);

    // Plugins whose second input is wired, resolved in a pass of their own below: a track has no EditItemID until it has been made.
    std::vector<std::pair<te::Plugin::Ptr, std::string>> sidechains;

    for (size_t i = 0; i < doc.tracks.size(); ++i) {
        const auto& tdoc = doc.tracks[i];
        auto* track = audioTracks[static_cast<int>(i)];
        track->setName(juce::String(tdoc.name));
        applyTrackParams(*track, tdoc);
        // Where it LEAVES by. HERE too, since an offline render builds its edit through this alone — docs/cueOutput.md.
        routeTrackOutput(engine, *track, tdoc);
        for (const auto& c : tdoc.clips) {
            // A disabled event is placed but silent: it reaches us so the timeline can draw it, and is never built into the edit.
            if (c.disabled) continue;
            if (c.type == ClipType::Midi) insertMidiClip(edit, *track, c);
            else insertClip(engine, edit, *track, c, baseDir);
        }
        int pluginIndex = 0;
        std::map<std::string, te::Plugin*> pluginsOnTrack;   // by id, for automation below
        for (const auto& p : tdoc.plugins)
            if (auto pl = addPlugin(edit, *track, p, pluginIndex)) {
                // Past the module AND its @mix pair, which addPlugin may have put around it — docs/mix.md.
                pluginIndex = indexAfterModule(track->pluginList, pl.get());
                pluginsOnTrack[p.id] = pl.get();
                if (!p.sidechainFrom.empty()) sidechains.emplace_back(pl, p.sidechainFrom);
                if (pluginsOut) {
                    (*pluginsOut)[p.id] = pl;   // so `open <module>` can find it by id
                    if (presetSaveOut && !p.presetSave.empty())
                        (*presetSaveOut)[p.id] = p.presetSave;   // where a UI edit saves it
                }
            }
        // Automation, once every plugin on this track exists; a lane targeting one that failed to instantiate is skipped.
        for (const auto& lane : tdoc.automation)
            if (auto it = pluginsOnTrack.find(lane.pluginId); it != pluginsOnTrack.end())
                applyAutomationLane(edit, *it->second, lane);
    }

    // Second inputs, now that every lane has an itemID — one sidechain source per plugin, summed past the stereo pair (docs/sidechain.md).
    for (auto& [plugin, from] : sidechains)
        wireSidechain(edit, *plugin, from, doc);

    // Auxiliary sends, a second pass once every track exists, wired from the plan the diff compares (SendPlan.h, docs/editBuilder.md).
    for (const auto& p : planSends(doc)) {
        auto* src = audioTracks[static_cast<int>(p.source)];
        auto* dest = p.found ? trackById(edit, p.to, doc) : nullptr;
        if (dest == nullptr) {
            warn("send target track not found: " + p.to);
            continue;
        }
        // A routing is what removes the dry path.
        if (p.routing) {
            src->getOutput().setOutputToTrack(dest);
            continue;
        }
        if (p.firstOnBus)
            addAuxReturn(edit, *dest, p.bus);
        addAuxSend(edit, *src, p.bus, p.level);
    }

    applySoloMute(edit, doc);   // resolve mute across the mixer once every track exists
}

}  // namespace studio

namespace studio {
// Compiled HERE, so a stale object answers with the layout it was built against — AGENTS.md.
std::size_t modelLayoutInBuilder() { return modelLayoutHere(); }
}  // namespace studio
