#include "ProjectDiff.h"

#include "SendPlan.h"   // the routing signature — JUCE-free, like this file
#include "Warnings.h"   // warn() on a duplicate id — JUCE-free, so the fast test binary can link it

#include <algorithm>
#include <cstdint>
#include <map>
#include <set>
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

// A long text as its length and a 64-bit FNV-1a hash: the key is rebuilt for every plugin on every apply, and a Faust program can be tens of KB.
std::string digestOf(const std::string& text) {
    std::uint64_t h = 1469598103934665603ULL;
    for (const unsigned char c : text) {
        h ^= c;
        h *= 1099511628211ULL;
    }
    std::ostringstream s;
    s << text.size() << "." << std::hex << h;
    return s.str();
}

// What the digest cannot promise, the pair check does: two programs sharing a key are compared in full, so a collision is a replace and never an unheard edit.
bool sameSource(const PluginDoc& a, const PluginDoc& b) {
    return a.faustDsp == b.faustDsp && a.dspGraph == b.dspGraph;
}

// A pair that shares a key and must STILL be re-created: its program differs, or a file it loaded is gone — nothing unloads one.
bool mustReplace(const PluginDoc& a, const PluginDoc& b) {
    const auto dropped = [&](const std::string PluginDoc::*f) { return !(a.*f).empty() && (b.*f).empty(); };
    return !sameSource(a, b) || dropped(&PluginDoc::path) || dropped(&PluginDoc::namFile) ||
           dropped(&PluginDoc::irFile) || dropped(&PluginDoc::deckFile) || dropped(&PluginDoc::sfzFile);
}

// …and one whose FILES or second input moved: loaded again into the same instance, so its tails and its place are kept.
bool filesMoved(const PluginDoc& a, const PluginDoc& b) {
    return a.path != b.path || a.namFile != b.namFile || a.irFile != b.irFile || a.deckFile != b.deckFile ||
           a.sfzFile != b.sfzFile || a.sidechainFrom != b.sidechainFrom || a.rack != b.rack;
}

std::string keyOf(const PluginDoc& p) {
    // Type and name, not just the id: one VST3 swapped for another must read as a replace. What a module LOADS is not identity — filesMoved() (docs/projectDiff.md).
    const std::string base = p.id.empty() ? std::string{} : p.id + ":";
    std::string k = "plugin:" + base + p.type + ":" + p.name;
    // A Faust program is compiled in the plugin's CONSTRUCTOR, so its source too — digested, and checked in full by sameSource().
    if (!p.faustDsp.empty()) k += "#" + digestOf(p.faustDsp);
    // A jsdsp GRAPH is built there too, params and all, so editing a module must read as a replace.
    if (!p.dspGraph.empty()) k += "~" + digestOf(p.dspGraph);
    // How a pattern picks and plays its events is fixed at construction; its SOURCE is not — an edit is PatternChanged, in place.
    if (!p.patternLabel.empty()) {
        k += "%" + p.patternLabel + (p.patternCatchAll ? "*" : "") + "/" + p.patternPlays + (p.patternOnly ? "!" : "");
        for (const auto& c : p.patternClaimed) k += "," + c;
        for (const auto& b : p.patternBanks) k += ";" + b;
    }
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
        || a.fadeIn != b.fadeIn || a.fadeOut != b.fadeOut
        || a.crossfadeIn != b.crossfadeIn || a.crossfadeOut != b.crossfadeOut
        || a.warp.algorithm != b.warp.algorithm || a.warp.markers != b.warp.markers
        // The NOTES, for the same reason — without this the whole note vocabulary reached the engine and did nothing.
        || a.notes != b.notes;
}

// Is the master chain the same run, IN THE SAME ORDER, set the same way? (docs/projectDiff.md)
bool sameMasterChain(const std::vector<PluginDoc>& a, const std::vector<PluginDoc>& b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i)
        if (keyOf(a[i]) != keyOf(b[i]) || mustReplace(a[i], b[i]) || filesMoved(a[i], b[i]) || a[i].enabled != b[i].enabled ||
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

    for (auto& [k, p] : fromPlugs) {
        const auto there = toPlugs.find(k);
        if (there == toPlugs.end() || mustReplace(*p, *there->second))
            out.push_back({ChangeKind::PluginRemoved, to.id, {}, {}, *p, {}, {}, 0, 0, 0, 0});
    }

    // In CHAIN order, not key order: an add is placed after its predecessor, which must already be in (EngineHost::apply).
    for (const auto& pd : to.plugins) {
        const auto k = keyOf(pd);
        // A duplicate key is diffed once, as index() keeps it.
        if (const auto own = toPlugs.find(k); own == toPlugs.end() || own->second != &pd) continue;
        const PluginDoc* p = &pd;
        auto it = fromPlugs.find(k);
        if (it == fromPlugs.end() || mustReplace(*it->second, *p)) {
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
        // Another preset, model, IR, record or second input, into the SAME instance (docs/projectDiff.md).
        if (filesMoved(*it->second, *p)) {
            Change ch{ChangeKind::PluginReloaded, to.id};
            ch.plugin = *p;
            out.push_back(std::move(ch));
        }
        // A save of the pattern file: the plugin re-evaluates it and plays on, where a replace would restart the lane.
        if (p->patternSource != it->second->patternSource) {
            Change ch{ChangeKind::PatternChanged, to.id};
            ch.plugin = *p;
            out.push_back(std::move(ch));
        }
        // Same plugin: emit a param change per differing/added parameter.
        for (const auto& [name, val] : p->params) {
            auto old = it->second->params.find(name);
            if (old == it->second->params.end() || old->second != val) {
                Change ch{ChangeKind::PluginParamChanged, to.id};
                ch.pluginId = p->id;
                ch.paramName = name;
                ch.paramValue = val;
                out.push_back(std::move(ch));
            }
        }
        // A removed param is left where it was, EXCEPT the engine's own stage, whose absence means neutral (docs/mix.md).
        for (const auto& [intrinsic, neutral] : {std::pair<const char*, double>{"@mix", 1.0},
                                                 {"@input-volume", 0.0},
                                                 {"@output-volume", 0.0}})
            if (it->second->params.count(intrinsic) && !p->params.count(intrinsic)) {
                Change ch{ChangeKind::PluginParamChanged, to.id};
                ch.pluginId = p->id;
                ch.paramName = intrinsic;
                ch.paramValue = neutral;
                out.push_back(std::move(ch));
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

    // Sends are wired for the whole song in one pass, so a routing that moved anywhere is one change; only a LEVEL can move in place.
    if (routingSignature(from) != routingSignature(to)) {
        out.push_back(Change{ChangeKind::SendsRewired, {}});
    } else {
        for (const auto& [k, t] : toTracks) {
            const auto was = fromTracks.find(k);
            if (was == fromTracks.end()) continue;
            bool moved = was->second->sends.size() != t->sends.size();
            for (size_t i = 0; !moved && i < t->sends.size(); ++i)
                moved = was->second->sends[i].level != t->sends[i].level;
            if (moved) {
                Change ch{ChangeKind::SendLevelChanged, t->id};
                ch.track = *t;
                out.push_back(std::move(ch));
            }
        }
    }

    // The tracks both documents hold, in each one's order: a lane is found by index, so a reorder is a change even with nothing else moving.
    // An ADDED track is in place only at the END: one inserted before a kept track shifts every lane after it, which is a reorder too.
    {
        std::vector<std::string> kept, now;
        for (const auto& t : from.tracks) if (toTracks.count(keyOf(t))) kept.push_back(t.id);
        bool addedSeen = false, keptAfterAdded = false;
        for (const auto& t : to.tracks) {
            if (fromTracks.count(keyOf(t))) {
                now.push_back(t.id);
                keptAfterAdded = keptAfterAdded || addedSeen;
            } else {
                addedSeen = true;
            }
        }
        if (kept != now || keptAfterAdded) out.push_back(Change{ChangeKind::TracksReordered, {}});
    }

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

    // A second input whose SOURCE track just arrived is wired now, though its module did not change: the build wired it once, to nothing.
    std::set<std::string> fromIds, toIds;
    for (const auto& t : from.tracks) fromIds.insert(t.id);
    for (const auto& t : to.tracks) toIds.insert(t.id);
    for (const auto& t : to.tracks) {
        const auto was = fromTracks.find(keyOf(t));
        if (was == fromTracks.end()) continue;
        for (const auto& p : t.plugins) {
            if (p.sidechainFrom.empty() || fromIds.count(p.sidechainFrom) == toIds.count(p.sidechainFrom)) continue;
            for (const auto& q : was->second->plugins)
                if (keyOf(q) == keyOf(p) && !mustReplace(q, p) && !filesMoved(q, p)) {
                    Change ch{ChangeKind::PluginReloaded, t.id};
                    ch.plugin = p;
                    out.push_back(std::move(ch));
                }
        }
    }

    return out;
}

bool needsFullRebuild(const ProjectDiff& d) {
    // Plugin add/remove/param are deliberately absent: a rebuild costs 4026 ms of a 4169 ms apply on a 32-plugin song (docs/projectDiff.md).

    for (const auto& c : d)
        switch (c.kind) {
            case ChangeKind::SampleRateChanged:
                return true;
            // A track GOING is a rebuild: trackById maps a doc INDEX onto a lane, so a lane outliving a shortened document moves every later track's — docs/projectDiff.md.
            case ChangeKind::TrackRemoved:
                return true;
            // …and so are the tracks MOVING, a track inserted before a kept one included: a lane is found by its index.
            case ChangeKind::TracksReordered:
                return true;
            // Buses are numbered across the whole song, so a routing change re-plans every send.
            case ChangeKind::SendsRewired:
                return true;
            // The master list is not on the incremental path — that one walks TRACKS — so the chain is rebuilt whole.
            case ChangeKind::MasterChainChanged:
                return true;
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
        case ChangeKind::TracksReordered:      s << "~ tracks reordered (full rebuild)"; break;
        case ChangeKind::SendsRewired:         s << "~ sends rewired (full rebuild)"; break;
        case ChangeKind::PluginReloaded:       s << "~ " << c.trackId << ": " << (c.plugin ? c.plugin->id : std::string{}) << " reloaded"; break;
        case ChangeKind::SendLevelChanged:     s << "~ " << c.trackId << ": send level"; break;
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
        case ChangeKind::PatternChanged:       s << "~ " << c.trackId << ": "
                                                 << (c.plugin ? c.plugin->id : std::string{}) << " pattern edited"; break;
        case ChangeKind::AutomationChanged:    s << "~ automation on " << c.trackId; break;
    }
    return s.str();
}

}  // namespace studio

namespace studio {
// Compiled HERE, so a stale object answers with the layout it was built against — AGENTS.md.
std::size_t modelLayoutInDiff() { return modelLayoutHere(); }
}  // namespace studio
