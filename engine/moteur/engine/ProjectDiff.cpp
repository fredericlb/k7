#include "ProjectDiff.h"

#include "Warnings.h"   // warn() on a duplicate id — JUCE-free, so the fast test binary can link it

#include <algorithm>
#include <map>
#include <sstream>

namespace studio {
namespace {

// Identity keys: prefer an explicit id, falling back to something stable-ish so terse files can still diff.
std::string keyOf(const TrackDoc& t) { return "track:" + t.id; }

std::string keyOf(const ClipDoc& c) {
    if (!c.id.empty()) return "clip:" + c.id;
    // Heuristic fallback of source + start: moving an id-less clip reads as remove+add, which still sounds right.
    std::ostringstream s;
    s << "clip:" << c.source << "@" << c.start;
    return s.str();
}

std::string keyOf(const PluginDoc& p) {
    // Type, name and preset, not just the id: one VST3 swapped for another must read as a replace (docs/projectDiff.md).
    const std::string base = p.id.empty() ? std::string{} : p.id + ":";
    std::string k = "plugin:" + base + p.type + ":" + p.name + ":" + p.path;
    // The sidechain source is IDENTITY: it is wired only at insert, so re-aiming the cable would be an empty diff.
    if (!p.sidechainFrom.empty()) k += "<-" + p.sidechainFrom;
    // A Faust program is compiled in the plugin's CONSTRUCTOR, so its source too — verbatim, since a hash could collide.
    if (!p.faustDsp.empty()) k += "#" + p.faustDsp;
    // A jsdsp GRAPH is built there too, params and all, so editing a module must read as a replace.
    if (!p.dspGraph.empty()) k += "~" + p.dspGraph;
    // A platter's RECORD is loaded at insert, so putting another one on has to read as a replace.
    if (!p.deckFile.empty()) k += "@" + p.deckFile;
    // A rack's sounds are built at insert time, so remapping a note without this reads as "same plugin".
    for (const auto& e : p.rack)
        k += "|" + e.symbol + "=" + std::to_string(e.note) + "@" + e.clip
             + "[" + std::to_string(e.start) + "," + std::to_string(e.length) + "]";
    return k;
}

// Key a vector for diffing — first-wins, and SAY SO when two entries answer to the same key (docs/projectDiff.md).
template <typename T, typename KeyFn>
std::map<std::string, const T*> index(const std::vector<T>& v, KeyFn key) {
    std::map<std::string, const T*> m;
    for (const auto& e : v) {
        auto k = key(e);
        if (!m.emplace(k, &e).second)
            warn("two entries share the id '" + k +
                 "' — only the first is diffed, so edits to the other will not be heard");
    }
    return m;
}

bool clipMoved(const ClipDoc& a, const ClipDoc& b) {
    // Every field here is applied at insert time and nowhere else, so one missing is one you can edit and not hear (docs/projectDiff.md).
    return a.start != b.start || a.length != b.length || a.source != b.source
        || a.offset != b.offset
        || a.sourceFrom != b.sourceFrom || a.sourceTo != b.sourceTo
        || a.loopStart != b.loopStart || a.loopEnd != b.loopEnd
        || a.warp.algorithm != b.warp.algorithm || a.warp.markers != b.warp.markers
        // The NOTES, for the same reason — without this the whole note vocabulary reached the engine and did nothing.
        || a.notes != b.notes;
}

// Is the master chain the same run, IN THE SAME ORDER, set the same way? (docs/projectDiff.md)
bool sameMasterChain(const std::vector<PluginDoc>& a, const std::vector<PluginDoc>& b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i)
        if (keyOf(a[i]) != keyOf(b[i]) || a[i].enabled != b[i].enabled ||
            a[i].params != b[i].params)
            return false;
    return true;
}

// Diff the contents of one track (that exists in both docs).
void diffTrackContents(const TrackDoc& from, const TrackDoc& to, ProjectDiff& out) {
    // --- clips ---
    auto fromClips = index(from.clips, [](const ClipDoc& c) { return keyOf(c); });
    auto toClips = index(to.clips, [](const ClipDoc& c) { return keyOf(c); });

    for (auto& [k, c] : fromClips)
        if (!toClips.count(k))
            out.push_back({ChangeKind::ClipRemoved, to.id, {}, *c, {}, {}, {}, 0, 0, 0, 0});

    for (auto& [k, c] : toClips) {
        auto it = fromClips.find(k);
        if (it == fromClips.end())
            out.push_back({ChangeKind::ClipAdded, to.id, {}, *c, {}, {}, {}, 0, 0, 0, 0});
        else if (clipMoved(*it->second, *c))
            out.push_back({ChangeKind::ClipMoved, to.id, {}, *c, {}, {}, {}, 0, 0, 0, 0});
    }

    // --- plugins ---
    auto fromPlugs = index(from.plugins, [](const PluginDoc& p) { return keyOf(p); });
    auto toPlugs = index(to.plugins, [](const PluginDoc& p) { return keyOf(p); });

    for (auto& [k, p] : fromPlugs)
        if (!toPlugs.count(k))
            out.push_back({ChangeKind::PluginRemoved, to.id, {}, {}, *p, {}, {}, 0, 0, 0, 0});

    for (auto& [k, p] : toPlugs) {
        auto it = fromPlugs.find(k);
        if (it == fromPlugs.end()) {
            out.push_back({ChangeKind::PluginAdded, to.id, {}, {}, *p, {}, {}, 0, 0, 0, 0});
            continue;
        }
        // Bypass compared here rather than left to a rebuild, which would cut every reverb tail; without it the diff was EMPTY.
        if (p->enabled != it->second->enabled) {
            Change ch{ChangeKind::PluginEnabledChanged, to.id};
            ch.plugin = *p;
            ch.enabled = p->enabled;
            out.push_back(std::move(ch));
        }
        // Same plugin: emit a param change per differing/added parameter.
        for (const auto& [name, val] : p->params) {
            auto old = it->second->params.find(name);
            if (old == it->second->params.end() || old->second != val) {
                Change ch{ChangeKind::PluginParamChanged, to.id};
                ch.plugin = *p;
                ch.paramName = name;
                ch.paramValue = val;
                out.push_back(std::move(ch));
            }
        }
    }

    // --- automation (coarse: replace a lane whenever its points change; a breakpoint-level diff can replace it) ---
    if (from.automation.size() != to.automation.size() ||
        !std::equal(from.automation.begin(), from.automation.end(), to.automation.begin(),
                    [](const AutomationDoc& a, const AutomationDoc& b) {
                        return a.param == b.param && a.pluginId == b.pluginId &&
                               a.bipolar == b.bipolar && a.points == b.points;
                    })) {
        for (const auto& lane : to.automation) {
            Change ch{ChangeKind::AutomationChanged, to.id};
            ch.automation = lane;
            out.push_back(std::move(ch));
        }
    }
}

}  // namespace

ProjectDiff diff(const ProjectDoc& from, const ProjectDoc& to) {
    ProjectDiff out;

    // --- global ---
    if (from.sampleRate != to.sampleRate) {
        Change ch{ChangeKind::SampleRateChanged};
        ch.intA = to.sampleRate;
        out.push_back(std::move(ch));
    }
    if (from.tempo != to.tempo) {
        Change ch{ChangeKind::TempoChanged};
        ch.doubleValue = to.tempo;
        out.push_back(std::move(ch));
    }
    // A float compared for exact equality on purpose: it is carried verbatim from the document, never computed here.
    if (from.masterVolume != to.masterVolume) {
        Change ch{ChangeKind::MasterVolumeChanged};
        ch.doubleValue = to.masterVolume;
        out.push_back(std::move(ch));
    }
    // The MASTER CHAIN, compared whole — any difference is one change and a full rebuild, which stops playback (docs/projectDiff.md).
    if (!sameMasterChain(from.masterPlugins, to.masterPlugins))
        out.push_back(Change{ChangeKind::MasterChainChanged});
    if (from.timeSigNumerator != to.timeSigNumerator ||
        from.timeSigDenominator != to.timeSigDenominator) {
        Change ch{ChangeKind::TimeSignatureChanged};
        ch.intA = to.timeSigNumerator;
        ch.intB = to.timeSigDenominator;
        out.push_back(std::move(ch));
    }

    auto fromTracks = index(from.tracks, [](const TrackDoc& t) { return keyOf(t); });
    auto toTracks = index(to.tracks, [](const TrackDoc& t) { return keyOf(t); });

    // Removals first, so indices/contents settle before adds.
    for (auto& [k, t] : fromTracks) {
        if (!toTracks.count(k)) {
            Change ch{ChangeKind::TrackRemoved, t->id};
            ch.track = *t;
            out.push_back(std::move(ch));
        }
    }
    // Adds, and content diffs for tracks present in both.
    for (auto& [k, t] : toTracks) {
        auto it = fromTracks.find(k);
        if (it == fromTracks.end()) {
            Change ch{ChangeKind::TrackAdded, t->id};
            ch.track = *t;
            out.push_back(std::move(ch));      // add the track (empty)…
            diffTrackContents(TrackDoc{t->id}, *t, out);  // …then fill it.
            // TrackAdded only creates the lane, so an input it arrives with is hooked up explicitly, as a later change is.
            if (!t->inputChannels.empty()) {
                Change in{ChangeKind::TrackInputChanged, t->id};
                in.track = *t;
                out.push_back(std::move(in));
            }
            // …and the same for a pair it leaves by, or a cue bus the diff ADDED would arrive on the mixer's sum.
            if (!t->outputChannels.empty()) {
                Change o{ChangeKind::TrackOutputChanged, t->id};
                o.track = *t;
                out.push_back(std::move(o));
            }
        } else {
            if (it->second->name != t->name) {
                Change ch{ChangeKind::TrackRenamed, t->id};
                ch.track = *t;
                out.push_back(std::move(ch));
            }
            if (it->second->mute != t->mute || it->second->solo != t->solo) {
                Change ch{ChangeKind::TrackParamsChanged, t->id};
                ch.track = *t;
                out.push_back(std::move(ch));
            }
            if (it->second->inputChannels != t->inputChannels ||
                it->second->monitor != t->monitor ||
                it->second->inputGain != t->inputGain) {
                Change ch{ChangeKind::TrackInputChanged, t->id};
                ch.track = *t;
                out.push_back(std::move(ch));
            }
            if (it->second->outputChannels != t->outputChannels) {
                Change ch{ChangeKind::TrackOutputChanged, t->id};
                ch.track = *t;
                out.push_back(std::move(ch));
            }
            diffTrackContents(*it->second, *t, out);
        }
    }

    return out;
}

bool needsFullRebuild(const ProjectDiff& d) {
    // Plugin add/remove/param are deliberately absent: a rebuild costs 4026 ms of a 4169 ms apply on a 32-plugin song (docs/projectDiff.md).

    // A track added in the SAME diff excludes the incremental plugin insert: trackById maps by INDEX, so the lane would be wrong. (A track REMOVED takes the whole diff to a rebuild below.)
    bool tracksMoved = false;
    for (const auto& c : d)
        if (c.kind == ChangeKind::TrackAdded) tracksMoved = true;

    for (const auto& c : d)
        switch (c.kind) {
            case ChangeKind::SampleRateChanged:
                return true;
            // A track GOING is a rebuild: trackById maps a doc INDEX onto a lane, so a lane outliving a shortened document moves every later track's — docs/projectDiff.md.
            case ChangeKind::TrackRemoved:
                return true;
            // The master list is not on the incremental path — that one walks TRACKS — so the chain is rebuilt whole.
            case ChangeKind::MasterChainChanged:
                return true;
            case ChangeKind::PluginAdded:
                if (tracksMoved) return true;
                // A sidechain is wired by a pass that runs once every track exists, which no insert can do here.
                if (c.plugin && !c.plugin->sidechainFrom.empty()) return true;
                break;
            default:
                break;
        }
    return false;
}

std::string describe(const Change& c) {
    std::ostringstream s;
    switch (c.kind) {
        case ChangeKind::TempoChanged:         s << "tempo -> " << c.doubleValue << " bpm"; break;
        case ChangeKind::MasterVolumeChanged:  s << "master -> " << c.doubleValue << " dB"; break;
        case ChangeKind::MasterChainChanged:   s << "~ master chain (full rebuild)"; break;
        case ChangeKind::TimeSignatureChanged: s << "time sig -> " << c.intA << "/" << c.intB; break;
        case ChangeKind::SampleRateChanged:    s << "sample rate -> " << c.intA << " (full rebuild)"; break;
        case ChangeKind::TrackAdded:           s << "+ track " << c.trackId; break;
        case ChangeKind::TrackRemoved:         s << "- track " << c.trackId << " (full rebuild)"; break;
        case ChangeKind::TrackRenamed:         s << "~ track " << c.trackId << " renamed"; break;
        case ChangeKind::TrackParamsChanged:   s << "~ track " << c.trackId << " mute/solo"; break;
        case ChangeKind::TrackInputChanged: {
            s << "~ track " << c.trackId << " input ";
            if (!c.track || c.track->inputChannels.empty()) {
                s << "cleared";
            } else {
                const auto& ch = c.track->inputChannels;
                for (size_t i = 0; i < ch.size(); ++i) s << (i ? "+" : "") << ch[i];
                s << " monitor=" << c.track->monitor;
                if (c.track->inputGain != 0.0) s << " gain=" << c.track->inputGain << "dB";
            }
            break;
        }
        case ChangeKind::TrackOutputChanged: {
            s << "~ track " << c.trackId << " output ";
            if (!c.track || c.track->outputChannels.empty()) {
                s << "-> mix";
            } else {
                const auto& ch = c.track->outputChannels;
                for (size_t i = 0; i < ch.size(); ++i) s << (i ? "+" : "") << ch[i];
            }
            break;
        }
        case ChangeKind::ClipAdded:            s << "+ clip on " << c.trackId; break;
        case ChangeKind::ClipRemoved:          s << "- clip on " << c.trackId; break;
        case ChangeKind::ClipMoved:            s << "~ clip on " << c.trackId << " moved"; break;
        case ChangeKind::PluginAdded:          s << "+ plugin on " << c.trackId; break;
        case ChangeKind::PluginRemoved:        s << "- plugin on " << c.trackId; break;
        case ChangeKind::PluginParamChanged:   s << "~ " << c.trackId << ": " << c.paramName
                                                 << " = " << c.paramValue; break;
        case ChangeKind::PluginEnabledChanged: s << "~ " << c.trackId << ": "
                                                 << (c.plugin ? c.plugin->id : std::string{})
                                                 << (c.enabled ? " active" : " bypassed"); break;
        case ChangeKind::AutomationChanged:    s << "~ automation on " << c.trackId; break;
    }
    return s.str();
}

}  // namespace studio

namespace studio {
// Compiled HERE, so a stale object answers with the layout it was built against — AGENTS.md.
std::size_t modelLayoutInDiff() { return modelLayoutHere(); }
}  // namespace studio
