// ServeProject.cpp — the messages that act on ONE project: its document, its transport, its auditions and
// its recording. Every one names a session, and every reply goes to that session's sockets (docs/protocol.md).

#include "ServeContext.h"
#include "DocJson.h"

#include "../engine/PathRoots.h"
#include "../engine/Warnings.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <iostream>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include <EngineHost.h>
#include <ProjectDiff.h>

using json = nlohmann::json;

namespace studio {

namespace {

// Totals across the doc's tracks, for the one-line [project] summary.
size_t countClips(const ProjectDoc& d) {
    size_t n = 0;
    for (const auto& t : d.tracks) n += t.clips.size();
    return n;
}

size_t countPlugins(const ProjectDoc& d) {
    size_t n = 0;
    for (const auto& t : d.tracks) n += t.plugins.size();
    return n;
}

}  // namespace

void addProjectHandlers(HandlerTable& t) {
    t.add({"project"}, [](ServeContext& ctx, ix::WebSocket& ws, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& broadcastTo = ctx.broadcastTo;
        studio::ProjectDoc doc;
        try {
            doc = docFromJson(j.at("doc"));
        } catch (const std::exception& e) {
            ws.send(json{{"type", "error"}, {"message", std::string("bad project: ") + e.what()}}.dump());
            return;
        }
        // Apply on the engine thread; broadcast the resulting changeset — unless a newer document overtook this one in the queue (docs/supersede.md).
        ctx.supersede.postProject(session, [&](SupersedeLedger::Ticket ticket) {
            host.post([session, &host, &broadcastTo, ticket, doc = std::move(doc)]() mutable {
                // No `busy` and no `applied`: the document that overtook it answers for both.
                if (SupersedeLedger::superseded(ticket)) {
                    std::cerr << "[project] '" << doc.name << "' superseded before it ran — skipped\n";
                    return;
                }
                // What we were asked to play: with the [applied] lines and [applyFull]'s timings, the log answers "what arrived", "what did the engine do" and "why so long".
                std::cerr << "[project] '" << doc.name << "' " << doc.tempo << "bpm "
                          << doc.tracks.size() << " track(s) " << countClips(doc)
                          << " clip(s) " << countPlugins(doc) << " plugin(s)\n";

                // Say that the engine is about to go deaf — a first apply instantiates every plugin, seconds long, on the thread that reads the transport; sent inside the lambda so it marks when the work starts.
                broadcastTo(session, json{{"type", "busy"}, {"busy", true}});

                // Timed whichever path it takes: `[applyFull]` prints its own phases, but an INCREMENTAL apply — the common one — has only this number (std::chrono, this being the JUCE-free half).
                const auto applyT0 = std::chrono::steady_clock::now();
                studio::ProjectDiff changes;
                try {
                    changes = host.apply(session, doc, "");   // paths are absolute
                } catch (const std::exception& e) {
                    // Caught here rather than by post()'s net, so the client that saw busy:true also sees it end.
                    std::cerr << "[project] apply failed: " << e.what() << "\n";
                    broadcastTo(session, json{{"type", "error"}, {"message", std::string("apply failed: ") + e.what()}});
                    broadcastTo(session, json{{"type", "busy"}, {"busy", false}});
                    return;
                }
                const double applyMs =
                    std::chrono::duration<double, std::milli>(
                        std::chrono::steady_clock::now() - applyT0)
                        .count();
                // The WHOLE standing set, not this apply's: a no-op apply answers with what the last build left too.
                json r{{"type", "applied"}, {"changes", json::array()}, {"warnings", standingWarningsJson(session)}};
                std::vector<std::string> described;
                described.reserve(changes.size());
                for (const auto& c : changes) {
                    described.push_back(studio::describe(c));
                    r["changes"].push_back(described.back());
                }
                broadcastTo(session, r);

                // The diff the engine ran, in the LOG rather than only at whichever client is listening: a no-op re-send says so, and long changesets are capped so one apply cannot bury the rest.
                if (described.empty()) {
                    std::cerr << "[applied] no changes (project already current)\n";
                } else {
                    constexpr size_t kMaxLogged = 12;
                    std::cerr << "[applied] " << described.size() << " change(s) in "
                              << applyMs << "ms\n";
                    for (size_t i = 0; i < described.size() && i < kMaxLogged; ++i)
                        std::cerr << "    " << described[i] << "\n";
                    if (described.size() > kMaxLogged)
                        std::cerr << "    … and " << (described.size() - kMaxLogged)
                                  << " more\n";
                }
                broadcastTo(session, json{{"type", "busy"}, {"busy", false}});
            });
        });
    });

    t.add({"tracks"}, [](ServeContext& ctx, ix::WebSocket& ws, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& broadcastTo = ctx.broadcastTo;
        // REPLACE these tracks in the document this session already holds, then run the same apply — 3.7 KB against 137 KB, and an unknown id is a disagreement, not an append (docs/protocol.md).
        std::vector<studio::TrackDoc> tracks;
        try {
            for (const auto& t : j.at("tracks"))
                tracks.push_back(trackFromJson(t));
        } catch (const std::exception& e) {
            ws.send(json{{"type", "error"},
                         {"message", std::string("bad tracks: ") + e.what()}}
                        .dump());
            return;
        }
        std::vector<std::string> ids;
        ids.reserve(tracks.size());
        for (const auto& tr : tracks) ids.push_back(tr.id);
        ctx.supersede.postTracks(session, std::move(ids), [&](SupersedeLedger::Ticket ticket) {
            host.post([session, &host, &broadcastTo, ticket,
                       tracks = std::move(tracks)]() mutable {
                if (SupersedeLedger::superseded(ticket)) return;
                studio::ProjectDoc doc = host.current(session);
                if (doc.tracks.empty()) {
                    broadcastTo(session,
                                json{{"type", "error"},
                                     {"message", "tracks: this session holds no project"}});
                    return;
                }
                size_t unknown = 0;
                for (auto& t : tracks) {
                    const auto it = std::find_if(
                        doc.tracks.begin(), doc.tracks.end(),
                        [&](const studio::TrackDoc& x) { return x.id == t.id; });
                    if (it == doc.tracks.end()) {
                        ++unknown;
                        continue;
                    }
                    *it = std::move(t);
                }
                if (unknown > 0) {
                    // Stamped, so the surface driving THIS project is the one told.
                    studio::WarningScope scoped(session);
                    studio::warn(std::to_string(unknown) +
                                     " track(s) named in an update this project does not "
                                     "hold — the whole document has to be re-sent",
                                 "tracks");
                }
                // No `busy` and no `applied`: this path is incremental by construction, and announcing six times a second would drown the changeset that matters.
                host.apply(session, std::move(doc), "");
            });
        });
    });

    t.add({"flush"}, [](ServeContext& ctx, ix::WebSocket&, const json&, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& broadcastTo = ctx.broadcastTo;
        // Forget the project — plugins, edit, diff baseline — when the client switches projects; the engine stays up with its audio device and scan cache.
        host.post([session, &host, &broadcastTo]() {
            host.reset(session);
            broadcastTo(session, json{{"type", "flushed"}});
        });
    });

    t.add({"transport"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        const std::string action = j.value("action", std::string{});
        const double position = j.value("position", 0.0);   // seconds; "seek" only
        const double loopStart = j.value("start", 0.0);      // seconds; "loop" only
        const double loopEnd = j.value("end", 0.0);          // seconds; "loop" only
        const bool loopOn = j.value("enabled", false);       // "loop" only
        host.post([session, &host, action, position, loopStart, loopEnd, loopOn] {
            // One line per transport move tells "the engine never got play" from "it played and you heard nothing"; the 20 Hz state frame stays out of the log.
            std::cerr << "[transport] " << action;
            if (action == "seek") std::cerr << " -> " << position << "s";
            if (action == "loop")
                std::cerr << (loopOn ? " on" : " off") << " [" << loopStart
                          << ", " << loopEnd << "]";
            if (action == "toggle")
                std::cerr << " (" << (host.isPlaying(session) ? "playing -> stop"
                                                      : "stopped -> play") << ")";
            std::cerr << "\n";

            if (action == "play") host.play(session);
            else if (action == "stop") host.stop(session);
            else if (action == "toggle") host.isPlaying(session) ? host.stop(session) : host.play(session);
            else if (action == "rewind") host.rewind(session);
            else if (action == "panic") host.panic(session);
            else if (action == "seek") host.seek(session, position);
            else if (action == "loop") host.setLoop(session, loopStart, loopEnd, loopOn);
        });
    });

    t.add({"preview"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        // Audition one sample over [start, start+length) seconds, length <= 0 being up to 30 s of it — independent of the transport, so it works while stopped.
        const std::string file = j.value("file", std::string{});
        const double start = j.value("start", 0.0);
        const double length = j.value("length", 0.0);
        // A file named outside any document, held to the same read roots as one inside (docs/pathRoots.md).
        if (! file.empty() && ! studio::readAllowed(file)) {
            std::cerr << "[preview] refused " << file << ": outside the folders this engine reads\n";
            return;
        }
        if (! file.empty())
            host.post([session, &host, file, start, length] {
                std::cerr << "[preview] " << file << " [" << start << ", "
                          << length << "]\n";
                host.previewSample(session, file, start, length);
            });
    });

    t.add({"note-preview"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        // Audition one note through a track's OWN chain — the piano roll's click. Transport-independent, like `preview`.
        const std::string track = j.value("track", std::string{});
        const int key = j.value("key", -1);
        const double vel = j.value("vel", 1.0);
        if (! track.empty() && key >= 0 && key <= 127)
            host.post([session, &host, track, key, vel] {
                host.previewNote(session, track, key, (float) vel);
            });
    });

    t.add({"midi-live"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        // A keyboard played into a track's own chain, one channel message at a time — held until its note-off (docs/protocol.md).
        const std::string track = j.value("track", std::string{});
        std::vector<uint8_t> bytes;
        if (j.contains("data") && j.at("data").is_array())
            for (const auto& b : j.at("data"))
                if (b.is_number_integer()) bytes.push_back((uint8_t) std::clamp(b.get<int>(), 0, 255));
        if (! track.empty() && ! bytes.empty())
            host.post([session, &host, track, bytes] { host.liveMidi(session, track, bytes); });
    });

    t.add({"arm"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& broadcastTo = ctx.broadcastTo;
        // Arm or disarm a track, omitting "armed" to toggle; the reply says which way it went, so the caller reports it without racing the state frame.
        const std::string track = j.value("track", std::string{});
        std::optional<bool> armed;
        if (j.contains("armed") && j.at("armed").is_boolean())
            armed = j.at("armed").get<bool>();
        host.post([session, &host, &broadcastTo, track, armed] {
            const auto r = host.setArmed(session, track, armed);
            if (!r.ok) {
                std::cerr << "[rec] refused: " << r.error << '\n';
                broadcastTo(session, json{{"type", "error"}, {"message", r.error}});
                return;
            }
            broadcastTo(session, json{{"type", "armed"}, {"track", track}, {"armed", r.armed}});
        });
    });

    t.add({"recorder"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& broadcastTo = ctx.broadcastTo;
        // The RECORDER node's two engine verbs, free-running and transport-independent:
        // `record` (omit "on" to toggle) and `clear`, which pops the last take. `save` is
        // NOT here — the engine's job ends at a wav on disk. See docs/recorder.md.
        const std::string node = j.value("node", std::string{});
        const std::string action = j.value("action", std::string{});
        std::optional<bool> on;
        if (j.contains("on") && j.at("on").is_boolean())
            on = j.at("on").get<bool>();
        host.post([session, &host, &broadcastTo, node, action, on] {
            if (node.empty()) return;
            const auto r = (action == "clear")
                ? host.clearLastTake(session, node)
                : host.setRecorderRecording(session, node,
                                            on.value_or(!host.recorderRecording(session, node)));
            if (!r.ok) {
                std::cerr << "[rec] refused: " << r.error << std::endl;
                broadcastTo(session, json{{"type", "error"}, {"message", r.error}});
            }
            // No reply on success: the state frame carries the light, at 20 Hz.
        });
    });

    t.add({"record-enable"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        // This session's record enable — whether play() records its armed tracks; omitting "enabled" toggles, and the state frame's recordEnabled carries the result.
        const bool has = j.contains("enabled") && j.at("enabled").is_boolean();
        const std::optional<bool> want =
            has ? std::optional<bool>(j.at("enabled").get<bool>()) : std::nullopt;
        host.post([session, &host, want] {
            host.setRecordEnabled(session, want.value_or(!host.recordEnabled(session)));
        });
    });
}

}  // namespace studio
