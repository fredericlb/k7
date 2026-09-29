// SendPlan.h — which bus every send of a song lands on, decided ONCE: the builder wires it, the diff compares it,
// and a level change finds its aux send by it. JUCE-free, so the fast test binary has it (docs/projectDiff.md).
// The one thing a reader would get wrong: a muted track that sends is a ROUTING, not a muted lane (docs/editBuilder.md).

#pragma once

#include "ProjectDoc.h"

#include <map>
#include <set>
#include <string>
#include <vector>

namespace studio {

// A muted track that sends feeds its bus INSTEAD of the mix: its first destination is where its output goes.
inline bool feedsBusOnly(const TrackDoc& t) {
    if (!t.mute) return false;
    for (const auto& s : t.sends)
        if (s.enabled) return true;
    return false;
}

struct PlannedSend {
    size_t source = 0;          // the sending track's index in the document
    std::string to;             // the destination track's id
    bool found = false;         // whether the document holds that destination; an absent one is skipped
    bool routing = false;       // the source's OUTPUT goes to `to`, rather than an aux send
    int bus = 0;                // the aux bus, from 1; 0 for a routing or an absent destination
    bool firstOnBus = false;    // the send that wires the bus's return on the destination
    double level = 0.0;         // linear
};

// Every enabled send, in document order, with its bus decided exactly as the builder wires it.
inline std::vector<PlannedSend> planSends(const ProjectDoc& doc) {
    std::set<std::string> ids;
    for (const auto& t : doc.tracks) ids.insert(t.id);
    std::vector<PlannedSend> plan;
    std::map<std::string, int> busForDest;
    std::set<size_t> routed;
    int nextBus = 1;
    for (size_t i = 0; i < doc.tracks.size(); ++i)
        for (const auto& s : doc.tracks[i].sends) {
            if (!s.enabled) continue;
            PlannedSend p;
            p.source = i;
            p.to = s.to;
            p.level = s.level;
            p.found = ids.count(s.to) != 0;
            if (p.found) {
                // The FIRST destination of a bus-only track is its routing; the rest are sends.
                if (feedsBusOnly(doc.tracks[i]) && routed.insert(i).second) {
                    p.routing = true;
                } else {
                    auto hit = busForDest.find(s.to);
                    p.firstOnBus = hit == busForDest.end();
                    p.bus = p.firstOnBus ? (busForDest[s.to] = nextBus++) : hit->second;
                }
            }
            plan.push_back(p);
        }
    return plan;
}

// Everything the plan decides EXCEPT the levels: two songs with the same signature are wired identically.
inline std::string routingSignature(const ProjectDoc& doc) {
    std::string sig;
    for (const auto& p : planSends(doc)) {
        sig += doc.tracks[p.source].id + (p.routing ? "=>" : "->") + p.to + (p.found ? "" : "?") + "#" +
               std::to_string(p.bus) + ";";
    }
    return sig;
}

}  // namespace studio
