#include "ProjectDiff.h"

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
    // Identity includes type, name and preset, not just the id: a module keeps its stable id when its plugin
    // definition changes, but a different type OR name — one VST3 swapped for another, both "vst3" — is a different
    // plugin and must read as a replace, not "the same plugin whose params drifted".
    const std::string base = p.id.empty() ? std::string{} : p.id + ":";
    std::string k = "plugin:" + base + p.type + ":" + p.name + ":" + p.path;
    // The sidechain source belongs in the IDENTITY, not in a later comparison: it is wired when the plugin is
    // inserted (EditBuilder sets the source id and its wires there and nowhere else), so re-aiming a second
    // input has to read as a replace. Left out, moving the cable produced an empty diff — the surest kind of
    // bug here, where the file says one thing and the engine goes on playing another with nothing to see.
    if (!p.sidechainFrom.empty()) k += "<-" + p.sidechainFrom;
    // A rack's sounds are built at insert time, not carried as params, so identity must fold them in — otherwise
    // remapping a note or clip reads as "same plugin" and the sampler never rebuilds. Compiled order is stable.
    for (const auto& e : p.rack)
        k += "|" + e.symbol + "=" + std::to_string(e.note) + "@" + e.clip
             + "[" + std::to_string(e.start) + "," + std::to_string(e.length) + "]";
    return k;
}

template <typename T, typename KeyFn>
std::map<std::string, const T*> index(const std::vector<T>& v, KeyFn key) {
    std::map<std::string, const T*> m;
    for (const auto& e : v) m.emplace(key(e), &e);
    return m;
}

bool clipMoved(const ClipDoc& a, const ClipDoc& b) {
    // Any timing change re-inserts the clip, because EVERY one of these is applied at insert time and nowhere
    // else (clipPositionFor, applyClipLoop, applyClipWarp). A field missing from this list is a field you can
    // edit while the engine is up and hear nothing change — which is how `offset` and the source window read
    // until this line was completed: the edit reached the doc, the doc reached the engine, and the engine
    // decided there was nothing to do.
    return a.start != b.start || a.length != b.length || a.source != b.source
        || a.offset != b.offset
        || a.sourceFrom != b.sourceFrom || a.sourceTo != b.sourceTo
        || a.loopStart != b.loopStart || a.loopEnd != b.loopEnd
        || a.warp.algorithm != b.warp.algorithm || a.warp.markers != b.warp.markers;
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
        // Bypass, compared here rather than left to a rebuild: the plugin object is the same one, only its enabled flag
        // moved, and re-instantiating the edit would cut every reverb tail and held note. Without this the diff was
        // EMPTY for a bypass toggle, so nothing reached the engine at all.
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

    // --- automation (coarse: replace a lane whenever its points change) ---
    // A finer breakpoint-level diff can replace this later.
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
            diffTrackContents(*it->second, *t, out);
        }
    }

    return out;
}

bool needsFullRebuild(const ProjectDiff& d) {
    // Plugin add/remove/replace have no faithful incremental path yet, so they rebuild wholesale — correctness over
    // speed until real incremental plugin ops land. A swap surfaces as PluginRemoved + PluginAdded and takes effect.
    // PluginParamChanged is deliberately NOT here: apply() sets the parameter on the live plugin by name, and
    // rebuilding for a param change re-instantiated every plugin on each tweak — the difference between a control
    // that can be dragged and one that can't. Known gap: diff() walks the NEW params, so a DELETED one emits
    // nothing and the live plugin keeps its value until the next full rebuild.
    for (const auto& c : d)
        switch (c.kind) {
            case ChangeKind::SampleRateChanged:
            case ChangeKind::PluginAdded:
            case ChangeKind::PluginRemoved:
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
        case ChangeKind::TimeSignatureChanged: s << "time sig -> " << c.intA << "/" << c.intB; break;
        case ChangeKind::SampleRateChanged:    s << "sample rate -> " << c.intA << " (full rebuild)"; break;
        case ChangeKind::TrackAdded:           s << "+ track " << c.trackId; break;
        case ChangeKind::TrackRemoved:         s << "- track " << c.trackId; break;
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
