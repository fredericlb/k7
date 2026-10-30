// ServePlugins.cpp — the messages about plugins: the installed catalogue and its scan, a plugin type's
// parameters, the live instances of a project, their windows, presets and watched values (docs/protocol.md).

#include "ServeContext.h"
#include "DocJson.h"

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
// Where the one scan stands, for every socket that asks or listens (docs/plugins.md).
ScanProgressBoard g_scanBoard;

json scanStatusJson(const PluginScanStatus& s) {
    return json{{"type", "plugin-scan"},
                {"scanning", s.scanning},
                {"done", s.done},
                {"total", s.total},
                {"current", s.current},
                {"version", s.version}};
}

}  // namespace

json pluginsJson(const std::vector<PluginInfo>& plugins, const std::string& filter) {
    const auto lower = [](std::string s) {
        for (auto& ch : s) ch = (char)std::tolower((unsigned char)ch);
        return s;
    };
    const std::string want = lower(filter);
    json arr = json::array();
    for (const auto& p : plugins) {
        if (!want.empty() && lower(p.format).find(want) == std::string::npos) continue;
        arr.push_back({
            {"name", p.name},
            {"format", p.format},
            {"manufacturer", p.manufacturer},
            {"instrument", p.isInstrument},
            {"role", p.role},
            {"category", p.category},
            {"id", p.identifier},
        });
    }
    // Whether a scan is running, so an asker knows this list is about to be replaced (docs/protocol.md).
    return json{{"type", "plugins"}, {"plugins", arr}, {"scanning", g_scanBoard.snapshot().scanning}};
}

std::vector<PluginInfo> ensurePluginsScanned(ServeContext& ctx, ScanWhen when, const ScanAnnounce& announce) {
    static std::mutex m;
    std::lock_guard<std::mutex> lock(m);
    if (when == ScanWhen::IfCold && pluginCacheWarm()) {
        auto cached = loadPluginCache();   // another caller already warmed it
        if (announce) announce(cached);
        return cached;
    }
    auto& broadcast = ctx.broadcast;
    broadcast(scanStatusJson(g_scanBoard.begin(ScanProgressBoard::Clock::now())));
    const auto progress = [&broadcast](int done, int total, const std::string& loading) {
        PluginScanStatus now;
        if (g_scanBoard.step(done, total, loading, ScanProgressBoard::Clock::now(), now))
            broadcast(scanStatusJson(now));
    };
    std::vector<PluginInfo> result;
    try {
        result = scanInstalledPlugins(when == ScanWhen::Force, progress);
    } catch (...) {
        // A scan that throws still ENDS, or every gate waiting on it would wait for nothing.
        const auto ended = g_scanBoard.finish();
        if (announce) announce(loadPluginCache());
        broadcast(scanStatusJson(ended));
        throw;
    }
    // The catalogue first, then the end: whoever re-reads on the end finds the new list already sent.
    const auto ended = g_scanBoard.finish();
    if (announce) announce(result);
    broadcast(scanStatusJson(ended));
    return result;
}

void addPluginHandlers(HandlerTable& t) {
    // Where the scan stands, to the asking socket alone; while one runs the same frame is broadcast, rate-limited (docs/protocol.md).
    t.add({"plugin-scan"}, [](ServeContext&, ix::WebSocket& ws, const json&, const std::string&, const std::string&) {
        ws.send(scanStatusJson(g_scanBoard.snapshot()).dump());
    });

    t.add({"list-plugins", "rescan-plugins"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string&, const std::string& type) {
        auto& broadcast = ctx.broadcast;
        // list-plugins returns the cache, scanning once if cold; rescan-plugins always refreshes, detached because a scan spawns a child per plugin and blocks. "filter" narrows by format, "force" re-scans all.
        const std::string filter = j.value("filter", std::string{});
        const bool doScan = (type == "rescan-plugins");
        const bool force = j.value("force", false);

        // IXWebSocket send() is thread-safe, so the scan thread can broadcast too.
        auto reply = [&broadcast, filter](const std::vector<studio::PluginInfo>& plugins) {
            broadcast(pluginsJson(plugins, filter));
        };

        // Say when a scan starts and why: it is by far the slowest thing the engine does, so a cold cache turning a list into a minute of work otherwise looks like a hang.
        if (doScan) {
            std::cerr << "[plugins] rescan requested" << (force ? " (force)" : "")
                      << " — scanning, this can take a while\n";
            ctx.work.spawn([&ctx, reply, force] {
                ensurePluginsScanned(ctx, force ? ScanWhen::Force : ScanWhen::Always, reply);
            });
        } else {
            auto cached = studio::loadPluginCache();
            // Count the EXTERNALS, not the entries: built-ins are synthesised in code, so a truncated exts.json still yields ~212 and logs a reassuring "212 from cache" while every VST silently fails.
            const auto externals = std::count_if(
                cached.begin(), cached.end(),
                [](const studio::PluginInfo& p) { return p.format != "internal"; });
            // Never written, stale built-ins, or no externals where there could be: pluginCacheWarm says which counts.
            if (!studio::pluginCacheWarm()) {
                std::cerr << "[plugins] exts.json cold (" << cached.size() << " listed, "
                          << externals << " external) — scanning once to fill it, this can take a while\n";
                ctx.work.spawn([&ctx, reply] { ensurePluginsScanned(ctx, ScanWhen::IfCold, reply); });
            } else {
                std::cerr << "[plugins] " << cached.size() << " from cache (" << externals
                          << " external)"
                          << (filter.empty() ? std::string{}
                                             : " (filter '" + filter + "')")
                          << "\n";
                reply(cached);
            }
        }
    });

    t.add({"list-plugin-params"}, [](ServeContext& ctx, ix::WebSocket& ws, const json& j, const std::string&, const std::string&) {
        auto& broadcast = ctx.broadcast;
        // Every parameter of an installed plugin TYPE, by instantiating it and asking — nothing short of a live instance can list them, so it runs DETACHED like a scan and broadcasts its reply.
        const std::string fmt = j.value("format", std::string{});
        const std::string id = j.value("id", std::string{});
        if (fmt.empty() || id.empty()) {
            ws.send(json{{"type", "error"},
                         {"message", "list-plugin-params needs a format and an id"}}
                        .dump());
        } else if (!ctx.takeProbe()) {
            ws.send(json{{"type", "error"}, {"message", "too many plugins loading at once — ask again in a moment"}}.dump());
        } else {
            ctx.work.spawn([&ctx, &broadcast, fmt, id] {
                // The slot goes back however the load ends, a throw included.
                const struct Slot { ServeContext& c; ~Slot() { c.probes.fetch_sub(1); } } slot{ctx};
                const auto found = studio::pluginParamsOf(fmt, id);
                json arr = json::array();
                for (const auto& p : found.value_or(std::vector<studio::PluginParamInfo>{})) {
                    json one{{"name", p.name}, {"min", p.min}, {"max", p.max}};
                    if (p.hasDefault) one["def"] = p.def;
                    if (!p.states.empty()) {
                        json states = json::array();
                        for (const auto& [label, value] : p.states)
                            states.push_back({{"label", label}, {"value", value}});
                        one["states"] = states;
                    }
                    arr.push_back(one);
                }
                std::cerr << "[plugin-param-list] " << id << ": "
                          << (found ? std::to_string(arr.size()) + " parameters"
                                    : std::string{"could not be loaded"})
                          << "\n";
                // `plugin-param-LIST`, since `plugin-params` already carries a loaded INSTANCE's values, and `found` carries what an empty array cannot: could not load, versus loaded and publishes nothing.
                broadcast(json{{"type", "plugin-param-list"},
                               {"format", fmt},
                               {"id", id},
                               {"found", found.has_value()},
                               {"params", arr}});
            });
        }
    });

    t.add({"list-edit-plugins"}, [](ServeContext& ctx, ix::WebSocket&, const json&, const std::string&, const std::string&) {
        auto& host = ctx.host;
        auto& broadcast = ctx.broadcast;
        // Every session's plugin instances for the supervisor's plugin list, each row naming its session — ENGINE-GLOBAL, since the asker drives none (docs/sessions.md); message thread, and broadcast.
        if (!ctx.pending.admit("list-edit-plugins")) return;
        host.post([&ctx, &host, &broadcast] {
            ctx.pending.started("list-edit-plugins");
            json arr = json::array();
            for (const auto& sid : host.sessionIds())
                for (const auto& p : host.pluginInstanceInfos(sid))
                    arr.push_back({{"session", sid},
                                   {"id", p.id},
                                   {"name", p.name},
                                   {"hasNativePluginUI", p.hasNativePluginUI}});
            broadcast(json{{"type", "edit-plugins"}, {"plugins", arr}});
        });
    });

    t.add({"show-native-plugin-ui"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        // Open a plugin's native editor window (external plugins only); the id is the PluginDoc id. Message thread.
        const std::string id = j.value("id", std::string{});
        host.post([session, &host, id] {
            std::cerr << "[native-plugin-ui] open '" << id << "'\n";
            host.showNativePluginUI(session, id);
        });
    });

    t.add({"show-native-plugin-ui-of"}, [](ServeContext& ctx, ix::WebSocket& ws, const json& j, const std::string&, const std::string&) {
        auto& host = ctx.host;
        auto& broadcast = ctx.broadcast;
        // …and the same window for a plugin in NO project, on an ORPHAN instance saved nowhere: the seconds-long load runs detached, and only the window itself needs the message thread.
        const std::string fmt = j.value("format", std::string{});
        const std::string id = j.value("id", std::string{});
        if (fmt.empty() || id.empty()) {
            ws.send(json{{"type", "error"},
                         {"message", "show-native-plugin-ui-of needs a format and an id"}}
                        .dump());
        } else if (!ctx.takeProbe()) {
            ws.send(json{{"type", "error"}, {"message", "too many plugins loading at once — ask again in a moment"}}.dump());
        } else {
            ctx.work.spawn([&ctx, &host, &broadcast, fmt, id] {
                const struct Slot { ServeContext& c; ~Slot() { c.probes.fetch_sub(1); } } slot{ctx};
                std::cerr << "[native-plugin-ui] loading '" << id << "'" << "\n";
                // ANSWERED either way, not out of politeness: a load can hang outright, and a caller told nothing cannot tell a slow load from a dead one.
                if (!studio::prepareNativePluginUI(fmt, id)) {
                    std::cerr << "[native-plugin-ui] '" << id << "' did not load" << "\n";
                    broadcast(json{{"type", "native-plugin-ui-opened"},
                                   {"format", fmt},
                                   {"id", id},
                                   {"ok", false}});
                    return;   // prepareNativePluginUI has already warned, which reaches a human
                }
                host.post([&broadcast, fmt, id] {
                    const bool ok = studio::showNativePluginUIOf(fmt, id);
                    std::cerr << "[native-plugin-ui] " << (ok ? "open '" : "could not open '")
                              << id << "'" << "\n";
                    broadcast(json{{"type", "native-plugin-ui-opened"},
                                   {"format", fmt},
                                   {"id", id},
                                   {"ok", ok}});
                });
            });
        }
    });

    t.add({"snapshot-plugin-base"}, [](ServeContext& ctx, ix::WebSocket& ws, const json& j, const std::string&, const std::string&) {
        auto& host = ctx.host;
        auto& broadcast = ctx.broadcast;
        // Keep what the orphan window holds, as a .vstpreset at an absolute `path` the file service chose — MESSAGE THREAD, since the instance exists already and its state is read where its editor lives.
        const std::string fmt = j.value("format", std::string{});
        const std::string id = j.value("id", std::string{});
        const std::string path = j.value("path", std::string{});
        if (fmt.empty() || id.empty() || path.empty()) {
            ws.send(json{{"type", "error"},
                         {"message", "snapshot-plugin-base needs a format, an id and a path"}}
                        .dump());
        } else {
            host.post([&broadcast, fmt, id, path] {
                const bool ok = studio::snapshotOrphanPluginTo(fmt, id, path);
                std::cerr << "[plugin-base] " << (ok ? "wrote " : "could not write ")
                          << path << "\n";
                // Answered rather than left for the caller to look: no instance open and a plugin with no state both leave no file at all.
                broadcast(json{{"type", "plugin-base-saved"},
                               {"format", fmt},
                               {"id", id},
                               {"path", path},
                               {"ok", ok}});
            });
        }
    });

    t.add({"set-plugin-param"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        // Set one plugin parameter on the LIVE edit for a control being dragged; it does NOT persist — the client writes on release — and it is unlogged, arriving at interactive rates.
        const std::string id = j.value("id", std::string{});
        const std::string name = j.value("name", std::string{});
        const double value = j.value("value", 0.0);
        // Only the newest value of a parameter still queued is worth setting (docs/supersede.md).
        ctx.supersede.postParam(session, id, name, [&](SupersedeLedger::Ticket ticket) {
            host.post([session, &host, id, name, value, ticket] {
                if (!SupersedeLedger::superseded(ticket)) host.setPluginParam(session, id, name, value);
            });
        });
    });

    t.add({"get-plugin-params"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& broadcastTo = ctx.broadcastTo;
        // Every automatable parameter of a live plugin with its CURRENT value — EVERY one, unlike the editor-close broadcast's minimal preset, since a control drawn at its minimum for want of a saved value is simply wrong; `meta` rides alongside as a SEPARATE object.
        const std::string id = j.value("id", std::string{});
        // The reply goes to the whole session, so a second identical ask joins the one already waiting.
        const std::string key = "get-plugin-params\n" + session + "\n" + id;
        if (!ctx.pending.admit(key)) return;
        host.post([&ctx, key, session, &host, &broadcastTo, id] {
            ctx.pending.started(key);
            json params = json::object();
            json meta = json::object();
            for (const auto& p : host.pluginParamInfos(session, id)) {
                params[p.name] = p.value;
                json m{{"min", p.min}, {"max", p.max}};
                if (p.hasDefault)
                    m["def"] = p.def;
                if (!p.states.empty()) {
                    json states = json::array();
                    for (const auto& [label, value] : p.states)
                        states.push_back({{"label", label}, {"value", value}});
                    m["states"] = states;
                }
                meta[p.name] = m;
            }
            broadcastTo(session, json{{"type", "plugin-params"},
                                      {"id", id},
                                      {"params", params},
                                      {"meta", meta}});
        });
    });

    t.add({"list-presets"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        auto& broadcastTo = ctx.broadcastTo;
        // The presets a MODULE's external plugin offers — programs plus .vstpreset files — for the editor's dropdown; `module` is a name the engine resolves to a live instance.
        const std::string module = j.value("module", std::string{});
        const std::string key = "list-presets\n" + session + "\n" + module;
        if (!ctx.pending.admit(key)) return;
        host.post([&ctx, key, session, &host, &broadcastTo, module] {
            ctx.pending.started(key);
            json arr = json::array();
            for (const auto& p : host.listPresets(session, module))
                arr.push_back({{"name", p.name},
                               {"source", p.source},
                               {"index", p.index},
                               {"path", p.path}});
            broadcastTo(session, json{{"type", "presets"}, {"module", module}, {"presets", arr}});
        });
    });

    t.add({"set-preset"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        // Load a preset into every live instance of `module` and persist it to the module's .vstpreset — `path` picks a file, else `index` a program.
        const std::string module = j.value("module", std::string{});
        const int index = j.value("index", -1);
        const std::string path = j.value("path", std::string{});
        host.post([session, &host, module, index, path] {
            std::cerr << "[preset] " << module << " <- "
                      << (path.empty() ? ("program " + std::to_string(index)) : path)
                      << "\n";
            host.setPreset(session, module, index, path);
        });
    });

    t.add({"watch-plugin-params"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string&) {
        auto& host = ctx.host;
        // Subscribe a plugin to the live parameter stream — how a knob turned in its own window reaches this client; the watch set is the ENGINE's, so a second watcher is a no-op and the last unwatch stops it for everyone.
        const std::string id = j.value("id", std::string{});
        const bool on = j.value("on", true);
        if (!id.empty())
            host.post([session, &host, id, on] { host.watchPluginParams(session, id, on); });
    });

    t.add({"subscribe-waveform", "unsubscribe-waveform"}, [](ServeContext& ctx, ix::WebSocket&, const json& j, const std::string& session, const std::string& type) {
        auto& host = ctx.host;
        // Subscribe a module's waveform tap by PluginDoc `id` and `side` — deliberately no `trackIndex`, since the graph has none and a client sending 0 would meter the FIRST track instead; no waveform beats a confidently wrong one.
        const std::string wfId = j.value("id", std::string{});
        const std::string side = j.value("side", std::string{"output"});
        const bool subscribe = (type == "subscribe-waveform");
        // `input` or `output`, nothing else: every other string would be one more tap and one more rebuild.
        if (side != "input" && side != "output") return;
        if (!wfId.empty())
            host.post([session, &host, wfId, side, subscribe] {
                if (subscribe)
                    host.enableWaveformTap(session, wfId, side);
                else
                    host.disableWaveformTap(session, wfId, side);
            });
    });
}

}  // namespace studio
