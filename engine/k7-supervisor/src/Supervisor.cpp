// Supervisor.cpp — see Supervisor.h. Every member of Impl is touched on the loop thread only; what
// blocks goes through `loop.work` and comes back as a posted task. Every pace below is argued in
// docs/supervisor.md; they are the TypeScript supervisor's, unchanged.

#include "Supervisor.h"

#include "Addresses.h"
#include "AudioPolicy.h"
#include "EngineProcess.h"
#include "EngineQueries.h"
#include "HostLock.h"
#include "Instruments.h"
#include "MachineJobs.h"
#include "Log.h"
#include "Paths.h"
#include "Performance.h"
#include "Registry.h"
#include "Rtc.h"
#include "TrustRoots.h"
#include "TunnelAgent.h"
#include "Url.h"

#include <algorithm>
#include <cstdlib>
#include <deque>
#include <future>
#include <map>
#include <optional>
#include <set>
#include <stdexcept>
#include <thread>

namespace k7 {

namespace {

using Ms = Loop::Ms;
// The library level this machine runs — song-schema's LIBRARY_LEVEL, kept equal by libraryLevel.test.ts.
constexpr int kLibraryLevel = 1;
constexpr Ms kHeartbeat{5000};
constexpr Ms kWatch{2000};
constexpr int kBackoffMaxS = 30;
constexpr Ms kDevicesPoll{10000};
constexpr Ms kEditPluginsPoll{3000};
constexpr Ms kSessionsPoll{2000};
constexpr Ms kPairingPoll{1000};
constexpr Ms kPluginsPoll{60000};
constexpr Ms kPluginsPollFast{2000};
constexpr Ms kDeregisterBound{1500};
constexpr Ms kKeptHistoryPurge{3600 * 1000};

using Clock = std::chrono::steady_clock;

/** The k7 instance a registry URL belongs to — its family's key, which pl8's registry shares. */
std::string instanceKey(const std::string& u)
{
    const auto k = url::studioFamily(u);
    return k.empty() ? u : k;
}

}  // namespace

struct Supervisor::Impl {
    Loop& loop;
    std::function<void()> exit;
    EngineIdentity identity;
    Settings settings;
    std::vector<std::string> registryUrls;
    protocol::Snapshot snap;
    std::string lastFrame;
    std::unique_ptr<EngineQueries> engine;
    std::optional<nlohmann::json> performance;
    bool shuttingDown = false;
    bool starting = false;
    int backoff = 1;
    Clock::time_point backoffUntil{};
    /** The last automatic switch asked for; a failing one is retried only once the device set moves. */
    std::optional<std::pair<std::string, std::string>> lastAttempt;
    std::vector<std::uint64_t> timers;
    std::uint64_t pluginsTimer = 0;
    /** One tunnel agent per registry, the way IN for a server that cannot dial this machine. */
    std::map<std::string, std::shared_ptr<tunnel::TunnelAgent>> tunnels;
    /** A heartbeat is in flight: the next tick skips rather than stack a second one behind it. */
    bool beating = false;
    /** Per registry: how many heartbeats in a row it refused and why — what `.studio.log` says, and when. */
    struct BeatTrack {
        int failures = 0;
        std::string lastDetail;
        bool everOk = false;
    };
    std::map<std::string, BeatTrack> beats;
    bool saidNoRegistry = false;
    /** A pairing poll is in flight: a slow engine call ahead of it must not stack a second one in the queue. */
    bool pairingPolling = false;
    /** The instruments waiting for the fetch worker, in order, and the one it holds: one at a time (docs/instruments.md). */
    std::deque<instruments::Instrument> queue;
    std::optional<std::string> fetching;
    /** Instruments whose folder is being deleted: a download of one waits until it is gone. */
    std::set<std::string> removing;

    Impl(Loop& l, std::function<void()> e) : loop(l), exit(std::move(e)) {}

    // --- the snapshot -------------------------------------------------------------------------------

    void publish()
    {
        snap.engineId = identity.id;
        snap.enginePort = settings.port;
        snap.audioPriority = settings.audioPriority;
        std::string joined;
        for (size_t i = 0; i < registryUrls.size(); ++i) joined += (i ? ", " : "") + registryUrls[i];
        // Joined for display: the snapshot carries ONE registry line.
        snap.registryUrl = joined;
        snap.instances = instances();
        snap.rootPath = paths::utf8(paths::rootDir());
        snap.mergedLogPath = paths::utf8(paths::mergedLog());
        const auto frame = protocol::stateFrame(snap);
        // `replace`: a device or host name not in UTF-8 must cost one character, never the frame.
        const std::string bytes = frame.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
        if (bytes == lastFrame) return;
        lastFrame = bytes;
        protocol::emit(frame);
    }

    /** A row per studio FAMILY; one from `$STUDIO_REGISTRY_URL` is not removable, the environment not being ours. */
    std::vector<protocol::Instance> instances() const
    {
        std::vector<std::string> pinned;
        for (const auto& u : settings.registryUrls) pinned.push_back(instanceKey(u));
        std::vector<protocol::Instance> rows;
        for (const auto& u : registryUrls) {
            const auto key = instanceKey(u);
            if (std::any_of(rows.begin(), rows.end(), [&](const auto& r) { return r.url == key; })) continue;
            rows.push_back({key, std::find(pinned.begin(), pinned.end(), key) != pinned.end()});
        }
        return rows;
    }

    void reply(int id, bool ok, const std::string& message = "") { protocol::emit(protocol::resultFrame(id, ok, message)); }

    // --- the engine ---------------------------------------------------------------------------------

    /** Spawn or adopt, off the loop; `done(up)` back on it. */
    void startEngine(std::function<void(bool)> done)
    {
        snap.userStopped = false;
        starting = true;
        auto id = identity;
        const int port = settings.port;
        loop.work<engine::StartResult>([id, port] { return engine::start(id, port); },
                                       [this, done](engine::StartResult r) {
                                           starting = false;
                                           switch (r.kind) {
                                               case engine::StartKind::Spawned:
                                                   snap.ownsEngine = true;
                                                   snap.status = "running";
                                                   snap.error.clear();
                                                   break;
                                               case engine::StartKind::Adopted:
                                                   snap.ownsEngine = false;
                                                   snap.status = "running";
                                                   snap.error.clear();
                                                   break;
                                               case engine::StartKind::Missing:
                                                   snap.status = "error";
                                                   snap.error = "engine binary not found (build it)";
                                                   break;
                                               case engine::StartKind::Error:
                                                   snap.status = "error";
                                                   snap.error = "spawn failed: " + r.message;
                                                   break;
                                           }
                                           // The app shows the error; the log is what is still there tomorrow.
                                           if (snap.status == "error") log::host("engine did not start: " + snap.error);
                                           publish();
                                           if (done) done(snap.status == "running");
                                       });
    }

    void stopEngine()
    {
        snap.userStopped = true;
        // Only an engine we OWN is killed; a foreign one is never stopped from here.
        if (snap.ownsEngine) engine::stop();
        snap.ownsEngine = false;
        snap.status = "stopped";
        snap.error.clear();
        snap.pluginCount.reset();
        snap.plugins.clear();
        snap.pluginsSig.clear();
        snap.editPlugins.clear();
        snap.editPluginsSig.clear();
        snap.sessions.clear();
        snap.sessionsSig.clear();
        snap.pairRequests.clear();
        snap.pairedDevices.clear();
        snap.audioDevices.clear();
        snap.audioMenuSig.clear();
        lastAttempt.reset();
        // The socket died with the engine: the next start redials.
        engine->close();
        publish();
    }

    /** Relaunch an engine that died unasked; a dead process is nobody's, so ownership is not checked. */
    void crashWatch()
    {
        if (shuttingDown || snap.userStopped) {
            backoff = 1;
            return;
        }
        if (snap.status == "stopped" || starting) return;
        if (engine::running()) {
            backoff = 1;
            return;
        }
        if (Clock::now() < backoffUntil) return;
        log::host("engine is gone — relaunching");
        snap.status = "error";
        snap.error = "engine exited — restarting…";
        publish();
        startEngine([this](bool up) {
            if (up) return;
            backoffUntil = Clock::now() + std::chrono::seconds(backoff);
            backoff = std::min(backoff * 2, kBackoffMaxS);
        });
    }

    // --- engine queries -----------------------------------------------------------------------------

    void pollDevices()
    {
        if (snap.status != "running") return;
        engine->listAudioDevices([this](auto devices) {
            if (!devices) return;
            snap.audioDevices = *devices;
            const auto want = audio::desiredSwitch(*devices, settings.audioPriority);
            const auto sig = audio::signature(*devices);
            if (!want) {
                lastAttempt.reset();
                finishDevices();
                return;
            }
            // A switch that did not take is not retried until the device SET changes.
            if (lastAttempt && lastAttempt->first == *want && lastAttempt->second == sig) {
                finishDevices();
                return;
            }
            lastAttempt = std::make_pair(*want, sig);
            engine->setAudioDevice(*want, deviceTypeOf(*want), [this](auto updated) {
                if (updated) snap.audioDevices = *updated;
                finishDevices();
            });
        });
    }

    void finishDevices()
    {
        snap.audioMenuSig = audio::menuSignature(snap.audioDevices, settings.audioPriority);
        publish();
    }

    // --- instruments ----------------------------------------------------------------------------------

    /** A host with no Downloads tab to choose in — the standalone app, the phone — keeps every instrument. */
    static bool keepsAll()
    {
        const char* v = std::getenv("STUDIO_INSTRUMENTS");
        return v != nullptr && std::string(v) == "all";
    }

    bool wanted(const std::string& name) const
    {
        if (keepsAll()) return true;
        const auto& w = settings.instruments;
        return w && std::find(w->begin(), w->end(), name) != w->end();
    }

    /** Add or drop `name` from the instruments this machine keeps, and remember it. */
    void keep(const std::string& name, bool on)
    {
        auto list = settings.instruments.value_or(std::vector<std::string>{});
        auto it = std::find(list.begin(), list.end(), name);
        if (on && it == list.end()) list.push_back(name);
        if (!on && it != list.end()) list.erase(it);
        settings.instruments = list;
        saveSettings(settings);
    }

    /** A first boot keeps what this machine already has and fetches nothing new: the rest is the user's to ask for. */
    void settleInstruments()
    {
        if (settings.instruments || keepsAll()) return;
        std::vector<std::string> kept;
        for (const auto& i : instruments::all())
            if (instruments::present(i)) kept.push_back(i.name);
        settings.instruments = kept;
        saveSettings(settings);
        log::host("instruments: keeping the " + std::to_string(kept.size()) + " already on this machine");
    }

    /** The Downloads tab's rows, re-read from disk: when a choice, an install or a removal changes them, never per frame. */
    void refreshInstruments()
    {
        snap.instruments.clear();
        for (const auto& i : instruments::all())
            snap.instruments.push_back({i.name, i.label, i.bytes, wanted(i.name), instruments::installed(i)});
    }

    /** Queue `i` behind whatever is fetching; a failed attempt's row is replaced, one already queued is left alone. */
    void enqueue(const instruments::Instrument& i)
    {
        if (fetching == i.name || std::any_of(queue.begin(), queue.end(), [&](const auto& q) { return q.name == i.name; }))
            return;
        auto& list = snap.downloads;
        list.erase(std::remove_if(list.begin(), list.end(), [&](const auto& d) { return d.name == i.name; }), list.end());
        list.push_back({i.name, i.label, 0, i.bytes, "queued", ""});
        queue.push_back(i);
    }

    /** Start the next queued fetch when none runs, on a worker; the app is told as it goes. */
    void pump()
    {
        if (fetching || queue.empty()) return;
        const auto i = queue.front();
        queue.pop_front();
        fetching = i.name;
        onDownload(i.name, 0, i.bytes, "downloading", "");
        // Detached: a download outlives no supervisor, and one cut short leaves only a .part to start over from.
        std::thread([this, i] {
            log::host("instrument " + i.name + ": downloading " + i.url);
            int lastPercent = -1;
            std::string lastPhase;
            std::string error;
            const bool ok = instruments::install(
                i,
                [&](const instruments::Progress& p) {
                    // A frame per whole percent at most: a chunk is a few KB, and each frame is a menu rebuilt.
                    const int percent = p.total ? static_cast<int>(100 * p.received / p.total) : 0;
                    if (percent == lastPercent && p.phase == lastPhase) return;
                    lastPercent = percent;
                    lastPhase = p.phase;
                    loop.post([this, name = i.name, p] { onDownload(name, p.received, p.total, p.phase, ""); });
                },
                error);
            log::host("instrument " + i.name + (ok ? ": installed" : ": " + error));
            loop.post([this, name = i.name, ok, error] {
                fetching.reset();
                refreshInstruments();
                if (ok) onDownload(name, 0, 0, "", "");
                else onDownload(name, 0, 0, "failed", error);
                pump();
            });
        }).detach();
    }

    /** Queue every instrument this machine keeps and has not got — a newer pinned archive included. */
    void fetchInstruments()
    {
        for (const auto& i : instruments::all())
            if (wanted(i.name) && !instruments::installed(i)) enqueue(i);
        publish();
        pump();
    }

    void instrumentDownload(const protocol::Command& cmd)
    {
        const auto* i = instruments::find(cmd.arg);
        if (i == nullptr) return reply(cmd.id, false, cmd.arg + " is not an instrument this engine plays");
        if (removing.count(i->name)) return reply(cmd.id, false, i->label + " is still being deleted");
        keep(i->name, true);
        if (!instruments::installed(*i)) enqueue(*i);
        refreshInstruments();
        publish();
        pump();
        reply(cmd.id, true);
    }

    void instrumentRemove(const protocol::Command& cmd)
    {
        const auto* i = instruments::find(cmd.arg);
        if (i == nullptr) return reply(cmd.id, false, cmd.arg + " is not an instrument this engine plays");
        // A download cannot be cut mid-file: the worker would write into a folder being deleted.
        if (fetching == i->name) return reply(cmd.id, false, i->label + " is downloading — remove it once it has landed");
        keep(i->name, false);
        queue.erase(std::remove_if(queue.begin(), queue.end(), [&](const auto& q) { return q.name == i->name; }),
                    queue.end());
        auto& list = snap.downloads;
        list.erase(std::remove_if(list.begin(), list.end(), [&](const auto& d) { return d.name == i->name; }), list.end());
        removing.insert(i->name);
        refreshInstruments();
        publish();
        const auto inst = *i;
        loop.work<std::string>(
            [inst] {
                std::string error;
                instruments::remove(inst, error);
                return error;
            },
            [this, cmd, name = inst.name](std::string error) {
                removing.erase(name);
                log::host("instrument " + name + (error.empty() ? ": removed" : ": " + error));
                refreshInstruments();
                publish();
                reply(cmd.id, error.empty(), error);
            });
    }

    /** One download's news, on the loop's thread: an empty phase is a finished one, which leaves the list. */
    void onDownload(const std::string& name, std::uint64_t received, std::uint64_t total, const std::string& phase,
                    const std::string& error)
    {
        auto& list = snap.downloads;
        auto it = std::find_if(list.begin(), list.end(), [&](const auto& d) { return d.name == name; });
        if (it == list.end()) return;
        if (phase.empty()) {
            list.erase(it);
        } else {
            it->phase = phase;
            it->error = error;
            if (phase != "failed") {
                it->received = received;
                it->total = total;
            }
        }
        publish();
    }

    std::string deviceTypeOf(const std::string& name) const
    {
        for (const auto& d : snap.audioDevices)
            if (d.name == name) return d.deviceType;
        return {};
    }

    void pollPlugins(std::function<void()> then)
    {
        if (snap.status != "running") {
            then();
            return;
        }
        engine->listPlugins([this, then](auto plugins) {
            if (plugins) {
                std::string sig;
                for (const auto& p : *plugins) sig += p.format + std::string(1, '\0') + p.name + "\n";
                // A rescan that found the same catalogue must still land: a null count is the spinner.
                if (sig != snap.pluginsSig || !snap.pluginCount) {
                    snap.plugins = *plugins;
                    snap.pluginsSig = sig;
                    snap.pluginCount = static_cast<int>(plugins->size());
                    publish();
                }
            }
            then();
        });
    }

    /** Ask hard until the scan lands, keeping the spinner honest, then once a minute. */
    void schedulePlugins()
    {
        pluginsTimer = loop.after(snap.pluginCount ? kPluginsPoll : kPluginsPollFast, [this] {
            if (!shuttingDown) pollPlugins([this] { schedulePlugins(); });
        });
    }

    void pollEditPlugins()
    {
        if (snap.status != "running") return;
        engine->listEditPlugins([this](auto plugins) {
            if (!plugins) return;
            // The OPENABLE ids, session-qualified: a name moving is not a menu that changed.
            std::string sig;
            for (const auto& p : *plugins)
                if (p.hasNativePluginUI) sig += p.session + std::string(1, '\0') + p.id + "\n";
            if (sig == snap.editPluginsSig) return;
            snap.editPlugins = *plugins;
            snap.editPluginsSig = sig;
            publish();
        });
    }

    void pollSessions(std::function<void()> then = nullptr)
    {
        if (snap.status != "running") {
            if (then) then();
            return;
        }
        engine->listSessions([this, then](auto sessions) {
            if (sessions) {
                // What the menu SHOWS, the playhead excluded.
                std::string sig;
                for (const auto& s : *sessions)
                    sig += s.id + "\x1f" + s.project + "\x1f" + (s.playing ? "1" : "0") + "\x1f" + std::to_string(s.tracks) +
                           "\x1f" + std::to_string(s.listeners) + "\n";
                if (sig != snap.sessionsSig) {
                    snap.sessions = *sessions;
                    snap.sessionsSig = sig;
                    publish();
                }
            }
            if (then) then();
        });
    }

    /** Pending requests and paired devices together: both are short, and a request must reach the musician fast. */
    void pollPairing(std::function<void()> then = nullptr)
    {
        if (snap.status != "running" || pairingPolling) {
            if (then) then();
            return;
        }
        pairingPolling = true;
        engine->listPairRequests([this, then](auto requests) {
            if (requests) snap.pairRequests = *requests;
            engine->listPairedDevices([this, then](auto devices) {
                pairingPolling = false;
                if (devices) snap.pairedDevices = *devices;
                // publish() emits only when the frame's bytes changed, so an idle poll stays silent.
                publish();
                if (then) then();
            });
        });
    }

    // --- tunnels ------------------------------------------------------------------------------------

    /** What a job asks of the settings, answered HERE: the loop is their one writer, or a save would undo another's. */
    MachineAccess access()
    {
        MachineAccess a;
        a.onnxProviders = [this](const std::optional<std::vector<std::string>>& set) {
            auto answer = std::make_shared<std::promise<std::vector<std::string>>>();
            auto got = answer->get_future();
            loop.post([this, set, answer] {
                if (set) {
                    settings.onnxProviders = *set;
                    saveSettings(settings);
                }
                answer->set_value(settings.onnxProviders);
            });
            return got.get();
        };
        return a;
    }

    /** An agent for every registry that has none, and none for a registry that left the list. */
    void syncTunnels()
    {
        for (auto it = tunnels.begin(); it != tunnels.end();) {
            if (std::find(registryUrls.begin(), registryUrls.end(), it->first) == registryUrls.end()) {
                it->second->stop();
                it = tunnels.erase(it);
            } else {
                ++it;
            }
        }
        for (const auto& u : registryUrls) {
            if (tunnels.count(u)) continue;
            tunnel::AgentOptions o;
            o.registryUrl = u;
            o.id = identity.id;
            o.token = identity.token;
            // Set on the server's own engine only, whose one registry is the server that shares the key.
            if (const char* key = std::getenv("STUDIO_RENDER_KEY"); key && *key) o.renderKey = key;
            o.enginePort = settings.port;
            o.cacheDir = paths::remoteCache(url::cacheKey(u));
            o.jobs = machineJobs(access());
            o.log = [](const std::string& m) { log::line("tunnel", m); };
            const int port = settings.port;
            o.answerOffer = [port](const std::string& offer) {
                rtc::Options r;
                r.enginePort = port;
                r.log = [](const std::string& m) { log::line("tunnel", m); };
                return rtc::answerOffer(offer, r);
            };
            auto agent = tunnel::TunnelAgent::create(std::move(o));
            agent->start();
            tunnels[u] = agent;
        }
    }

    // --- registry -----------------------------------------------------------------------------------

    nlohmann::json presenceNow() const
    {
        auto p = addresses::presence(settings.port);
        if (performance) p["performance"] = *performance;
        p["libraryLevel"] = kLibraryLevel;
        return p;
    }

    /** Gated on the PIDFILE rather than our status: ground truth across a crash not yet noticed. */
    void beat(std::function<void()> then = nullptr)
    {
        // Kept in step with the list here rather than hooked into each place that edits it.
        syncTunnels();
        if (!engine::running()) {
            snap.lastHeartbeatOk = false;
            publish();
            if (then) then();
            return;
        }
        auto urls = registryUrls;
        if (urls.empty()) {
            // Said once: an engine no studio lists is a setup question, and `registryUrls` is the field for it.
            if (!saidNoRegistry) log::host("no registry configured — this engine is listed at no studio");
            saidNoRegistry = true;
            snap.lastHeartbeatOk = false;
            publish();
            if (then) then();
            return;
        }
        saidNoRegistry = false;
        // One in flight at a time: a dead network stacked a beat every 5 s, each holding its sockets, until none were left.
        if (beating) {
            if (then) then();
            return;
        }
        beating = true;
        auto id = identity;
        auto presence = presenceNow();
        loop.work<registry::Result>([urls, id, presence] { return registry::heartbeat(urls, id, presence); },
                                    [this, then](registry::Result r) {
                                        beating = false;
                                        for (const auto& o : r.outcomes) noteBeat(o);
                                        snap.lastHeartbeatOk = r.ok();
                                        publish();
                                        if (then) then();
                                    });
    }

    /** One registry's answer, into `.studio.log` — its first refusal, each NEW reason, a reminder a minute, the recovery. */
    void noteBeat(const registry::Outcome& o)
    {
        auto& t = beats[o.url];
        if (o.ok) {
            if (t.failures > 0)
                log::line("registry", "heartbeat to " + o.url + " accepted again after " + std::to_string(t.failures) +
                                          " failure(s)");
            else if (!t.everOk)
                log::line("registry", "listed at " + o.url + " (heartbeat accepted)");
            t = {0, "", true};
            return;
        }
        ++t.failures;
        // A minute of heartbeats between reminders: a registry down for an hour is sixty lines, not seven hundred.
        const int perMinute = static_cast<int>(60000 / kHeartbeat.count());
        if (t.failures == 1 || o.detail != t.lastDetail)
            log::line("registry", "heartbeat to " + o.url + " failed: " + o.detail +
                                      " — until it is accepted, browsers cannot select this engine");
        else if (t.failures % perMinute == 0)
            log::line("registry", "heartbeat to " + o.url + " still failing (" + std::to_string(t.failures) +
                                      " in a row): " + o.detail);
        t.lastDetail = o.detail;
    }

    void deregisterFrom(std::vector<std::string> urls, std::function<void()> then)
    {
        auto id = identity;
        loop.work<registry::Result>([urls, id] { return registry::deregister(urls, id); },
                                    [this, then](registry::Result r) {
                                        for (const auto& o : r.outcomes) {
                                            beats.erase(o.url);
                                            if (!o.ok)
                                                log::line("registry", "could not leave " + o.url + ": " + o.detail +
                                                                          " — it drops this engine once its heartbeats stop");
                                        }
                                        if (then) then();
                                    });
    }

    /** ADD a registry — always its family's root — persist, adopt, announce; an add and never a replace. */
    void addRegistry(const std::string& named, std::function<void()> then)
    {
        const auto u = url::engineRegistryUrl(named);
        if (u.empty()) {
            then();
            return;
        }
        if (std::find(registryUrls.begin(), registryUrls.end(), u) == registryUrls.end()) {
            log::line("registry", "added " + u);
            registryUrls.push_back(u);
            // Persisted as the explicit list, so the next boot takes it rather than the ambient env var.
            settings.registryUrls = registryUrls;
            saveSettings(settings);
        }
        publish();
        beat(then);
    }

    /** Disconnect one instance: its registry leaves the pinned list and is told at once. */
    void removeInstance(const std::string& u, std::function<void()> then)
    {
        const auto key = instanceKey(u);
        std::vector<std::string> kept, dropped;
        for (const auto& p : settings.registryUrls) (instanceKey(p) == key ? dropped : kept).push_back(p);
        if (dropped.empty()) {
            publish();
            then();
            return;
        }
        settings.registryUrls = kept;
        saveSettings(settings);
        for (const auto& d : dropped) log::line("registry", "removed " + d);
        // Emptied, the list falls back to `$STUDIO_REGISTRY_URL` — what a fresh boot would resolve.
        registryUrls = registry::resolve(settings.registryUrls);
        publish();
        if (engine::running())
            deregisterFrom(registry::resolve(dropped), then);
        else
            then();
    }

    // --- commands -----------------------------------------------------------------------------------

    void weburiAdd(const protocol::Command& cmd)
    {
        const auto origin = url::normaliseUserOrigin(cmd.arg);
        if (!origin) {
            snap.instanceCheck = protocol::InstanceCheck{cmd.arg, "refused", cmd.arg + " is not a web address"};
            publish();
            reply(cmd.id, false, "not a valid web UI address");
            return;
        }
        // ASKED before anything is written: a heartbeat carries this engine's token.
        const auto reg = url::engineRegistryUrl(*origin);
        snap.instanceCheck = protocol::InstanceCheck{reg, "checking", ""};
        publish();
        loop.work<registry::Probe>([reg] { return registry::probe(reg); }, [this, cmd, reg, o = *origin](registry::Probe p) {
            if (!p.ok) {
                log::line("registry", "not adding " + reg + ": " + p.why);
                snap.instanceCheck = protocol::InstanceCheck{reg, "refused", p.why + " — nothing was added"};
                publish();
                reply(cmd.id, false, p.why);
                return;
            }
            snap.instanceCheck.reset();
            addRegistry(o, [this, cmd, o] { reply(cmd.id, true, o); });
        });
    }

    void audioPriority(const protocol::Command& cmd)
    {
        // The WHOLE ranking, in one command: a reorder is one act.
        std::vector<std::string> ranked;
        for (const auto& n : protocol::splitUnits(cmd.arg))
            if (std::find(ranked.begin(), ranked.end(), n) == ranked.end()) ranked.push_back(n);
        settings.audioPriority = ranked;
        lastAttempt.reset();
        // REMEMBER first, then switch: a refused device must not cost the user the order they just set.
        saveSettings(settings);
        finishDevices();
        const auto want = audio::desiredSwitch(snap.audioDevices, settings.audioPriority);
        if (!want) {
            reply(cmd.id, true);
            return;
        }
        engine->setAudioDevice(*want, deviceTypeOf(*want), [this, cmd](auto updated) {
            if (updated) {
                snap.audioDevices = *updated;
                finishDevices();
            }
            reply(cmd.id, updated.has_value());
        });
    }

    void onCommand(const protocol::Command& cmd)
    {
        const auto& c = cmd.cmd;
        if (c == "engine.start") {
            startEngine([this, cmd](bool up) { reply(cmd.id, up, snap.error); });
        } else if (c == "engine.stop") {
            stopEngine();
            // Out of the picker NOW rather than aging out: that immediacy is Stop versus Restart.
            deregisterFrom(registryUrls, [this, cmd] { reply(cmd.id, true); });
        } else if (c == "engine.restart") {
            stopEngine();
            startEngine([this, cmd](bool up) { reply(cmd.id, up, snap.error); });
        } else if (c == "weburi.add") {
            weburiAdd(cmd);
        } else if (c == "weburi.remove") {
            removeInstance(cmd.arg, [this, cmd] { reply(cmd.id, true); });
        } else if (c == "registry.deregister") {
            snap.lastHeartbeatOk = false;
            publish();
            deregisterFrom(registryUrls, [this, cmd] { reply(cmd.id, true); });
        } else if (c == "audio.priority") {
            audioPriority(cmd);
        } else if (c == "plugins.rescan") {
            // The spinner at once: the scan runs inside the engine and its count comes back through the poll.
            snap.pluginCount.reset();
            publish();
            engine->rescanPlugins([this, cmd] { reply(cmd.id, true); });
        } else if (c == "plugin.showUI") {
            // `<session>\x1f<id>`, an id alone naming one row PER SESSION.
            const auto sep = cmd.arg.find(protocol::kUnitSep);
            std::optional<std::string> session;
            std::string id = cmd.arg;
            if (sep != std::string::npos) {
                session = cmd.arg.substr(0, sep);
                id = cmd.arg.substr(sep + protocol::kUnitSep.size());
            }
            engine->showNativePluginUI(id, session, [this, cmd] { reply(cmd.id, true); });
        } else if (c == "session.drop") {
            // Polled at once: a row still listed for two seconds reads as a click that missed.
            engine->dropSession(cmd.arg, [this, cmd] { pollSessions([this, cmd] { reply(cmd.id, true); }); });
        } else if (c == "pair.approve" || c == "pair.deny" || c == "pair.revoke") {
            const std::string verb = c == "pair.approve" ? "pair-approve" : c == "pair.deny" ? "pair-deny" : "unpair-device";
            // Polled at once, like a dropped session: the row must leave the window with the click.
            engine->pairVerb(verb, cmd.arg, [this, cmd] { pollPairing([this, cmd] { reply(cmd.id, true); }); });
        } else if (c == "instruments.download") {
            instrumentDownload(cmd);
        } else if (c == "instruments.remove") {
            instrumentRemove(cmd);
        } else if (c == "shutdown") {
            shutdown();
        } else {
            reply(cmd.id, false, c + " is not a supervisor command");
        }
    }

    // --- lifetime -----------------------------------------------------------------------------------

    void shutdown()
    {
        if (shuttingDown) return;
        shuttingDown = true;
        for (auto t : timers) loop.cancel(t);
        loop.cancel(pluginsTimer);
        for (auto& [_, agent] : tunnels) agent->stop();
        tunnels.clear();
        engine->close();
        // Deregister FIRST, while the entry still means something — bounded, or a hung registry hangs Quit.
        auto finished = std::make_shared<bool>(false);
        auto finish = [this, finished] {
            if (*finished) return;
            *finished = true;
            // Unlike Stop, this does NOT spare an adopted engine: one left listening holds the device.
            engine::stop();
            hostlock::release();
            exit();
        };
        loop.after(kDeregisterBound, finish);
        deregisterFrom(registryUrls, finish);
    }

    static void purgeKeptHistoryNow()
    {
        if (const auto n = purgeKeptHistory(paths::studioDir() / "remote"))
            log::line("supervisor", "purged " + std::to_string(n) + " kept undo file(s) older than a month");
    }

    void installLoops()
    {
        timers.push_back(loop.every(kHeartbeat, [this] { beat(); }));
        timers.push_back(loop.every(kWatch, [this] { crashWatch(); }));
        timers.push_back(loop.every(kDevicesPoll, [this] { pollDevices(); }));
        timers.push_back(loop.every(kEditPluginsPoll, [this] { pollEditPlugins(); }));
        timers.push_back(loop.every(kSessionsPoll, [this] { pollSessions(); }));
        timers.push_back(loop.every(kPairingPoll, [this] { pollPairing(); }));
        // The undo audio servers asked this machine to keep: a month after its last use, it goes.
        purgeKeptHistoryNow();
        timers.push_back(loop.every(kKeptHistoryPurge, [] { purgeKeptHistoryNow(); }));
        schedulePlugins();
    }
};

Supervisor::Supervisor(Loop& loop, std::function<void()> exit) : impl_(std::make_unique<Impl>(loop, std::move(exit))) {}

Supervisor::~Supervisor() = default;

void Supervisor::start()
{
    auto& s = *impl_;
    // Before anything is spawned or adopted: a second supervisor would adopt the FIRST one's engine.
    if (int holder = hostlock::acquire())
        throw std::runtime_error("an engine supervisor is already running (pid " + std::to_string(holder) +
                                 ") — quit it first");
    s.timers.push_back(s.loop.every(Ms(hostlock::kRefreshMs), [] { hostlock::refresh(); }));
    s.settings = loadSettings();
    s.identity = ensureEngineIdentity();
    s.registryUrls = registry::resolve(s.settings.registryUrls);
    s.engine = std::make_unique<EngineQueries>(s.loop, s.settings.port);
    s.settleInstruments();
    s.refreshInstruments();
    // The first snapshot: the app draws nothing until it arrives.
    s.publish();
    log::host("supervisor started (native), " + std::to_string(tls::rootCount()) + " trusted roots");
    // What every heartbeat will carry, said once: when a registry refuses one, the reason names a field of this.
    log::host("engine " + s.identity.id + ", presence " +
              addresses::presence(s.settings.port).dump(-1, ' ', false, nlohmann::json::error_handler_t::replace));

    // Before the engine, so the CPU loop is not measuring its plugin scan.
    auto dir = paths::studioDir();
    s.loop.work<performance::Metrics>([dir] { return performance::measure(dir); }, [&s](performance::Metrics m) {
        s.performance = performance::toJson(m);
        log::host("performance " + std::to_string(performance::score(m)) + " " +
                  s.performance->dump(-1, ' ', false, nlohmann::json::error_handler_t::replace));
        // Started HERE rather than on an app's command: nothing should wait for a screen to be built.
        s.startEngine([&s](bool) { s.beat([&s] { s.installLoops(); }); });
        // …and the instruments this machine keeps, whether or not a song names one yet.
        s.fetchInstruments();
    });
}

void Supervisor::onCommand(const protocol::Command& cmd) { impl_->onCommand(cmd); }

void Supervisor::shutdown() { impl_->shutdown(); }

}  // namespace k7
