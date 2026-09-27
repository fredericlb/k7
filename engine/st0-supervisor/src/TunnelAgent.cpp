// TunnelAgent.cpp — see TunnelAgent.h. The connection lives on a thread that owns the Impl through a
// shared pointer, so `stop` never has to wait for it and a late callback never finds it destroyed.

#include "TunnelAgent.h"

#include "PathMap.h"
#include "Paths.h"
#include "SerialQueue.h"
#include "TrustRoots.h"
#include "TunnelFiles.h"
#include "TunnelFrames.h"

#include <ixwebsocket/IXWebSocket.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <random>
#include <regex>
#include <thread>

namespace st0::tunnel {

namespace fs = std::filesystem;
using nlohmann::json;
using ojson = nlohmann::ordered_json;

namespace {

constexpr int kMaxBackoffMs = 30000;
constexpr int kPingSeconds = 20;

struct Channel {
    int ch = 0;
    bool jobs = false;
    std::unique_ptr<PathMap> map;
    std::shared_ptr<ix::WebSocket> engine;
    std::shared_ptr<SerialQueue> toEngine = SerialQueue::create();
    std::shared_ptr<SerialQueue> toHub = SerialQueue::create();
    std::mutex mutex;
    std::condition_variable cv;
    bool engineOpen = false;
    bool closed = false;

    /** Block a queued frame until the engine socket is up, or the channel is gone. */
    bool waitOpen()
    {
        std::unique_lock lock(mutex);
        cv.wait(lock, [&] { return engineOpen || closed; });
        return engineOpen && !closed;
    }

    void shut()
    {
        {
            std::lock_guard lock(mutex);
            closed = true;
        }
        cv.notify_all();
        toEngine->close();
        toHub->close();
        // Stopped elsewhere: this may run on the engine socket's own callback thread, which a stop there would join.
        if (engine) std::thread([e = engine] { e->stop(); }).detach();
    }
};

}  // namespace

struct TunnelAgent::Impl : HubLink, std::enable_shared_from_this<TunnelAgent::Impl> {
    AgentOptions opts;
    std::mutex mutex;
    std::condition_variable cv;
    std::shared_ptr<ix::WebSocket> ws;
    bool stopped = false;
    bool dropped = false;
    std::atomic<bool> up{false};
    int attempt = 0;
    /** The last reason the socket failed or closed — logged again only when it changes. Socket thread only. */
    std::string lastFail;
    std::map<int, std::shared_ptr<Channel>> channels;
    SyncLedger ledger;
    FileRequests files{*this};
    std::mutex sendMutex;

    explicit Impl(AgentOptions o) : opts(std::move(o))
    {
        if (!opts.log) opts.log = [](const std::string&) {};
    }

    // --- HubLink -------------------------------------------------------------------------------------

    std::shared_ptr<ix::WebSocket> socket()
    {
        std::lock_guard lock(mutex);
        return ws;
    }

    bool isOpen() override
    {
        auto s = socket();
        return s && s->getReadyState() == ix::ReadyState::Open;
    }

    bool sendText(const std::string& text) override
    {
        auto s = socket();
        if (!s || s->getReadyState() != ix::ReadyState::Open) return false;
        std::lock_guard lock(sendMutex);
        return s->sendText(text).success;
    }

    bool sendBinary(const std::string& bytes) override
    {
        auto s = socket();
        if (!s || s->getReadyState() != ix::ReadyState::Open) return false;
        std::lock_guard lock(sendMutex);
        return s->sendBinary(bytes).success;
    }

    size_t buffered() override
    {
        auto s = socket();
        return s ? s->bufferedAmount() : 0;
    }

    void tell(const ojson& m) { sendText(m.dump()); }

    // --- the connection ------------------------------------------------------------------------------

    void life()
    {
        auto self = shared_from_this();
        std::mt19937 rng{std::random_device{}()};
        while (true) {
            auto sock = std::make_shared<ix::WebSocket>();
            sock->setUrl(tunnelUrl(opts.registryUrl, opts.id));
            sock->setExtraHeaders({{kTokenHeader, opts.token}});
            sock->setTLSOptions(tls::options());
            sock->disableAutomaticReconnection();
            // A pong that never comes closes the socket, which is what redials a tunnel gone quiet.
            sock->setPingInterval(kPingSeconds);
            std::weak_ptr<Impl> weak = self;
            sock->setOnMessageCallback([weak](const ix::WebSocketMessagePtr& m) {
                if (auto s = weak.lock()) s->onSocket(m);
            });
            {
                std::lock_guard lock(mutex);
                if (stopped) return;
                ws = sock;
                dropped = false;
            }
            sock->start();
            {
                std::unique_lock lock(mutex);
                cv.wait(lock, [&] { return stopped || dropped; });
            }
            sock->stop();
            teardown();
            std::unique_lock lock(mutex);
            ws.reset();
            if (stopped) return;
            // Full jitter over an exponential step, so a restarted server is not hit by every engine at once.
            const int step = std::min(kMaxBackoffMs, 1000 << std::min(attempt++, 5));
            const int wait = step / 2 + std::uniform_int_distribution<int>(0, step / 2)(rng);
            cv.wait_for(lock, std::chrono::milliseconds(wait), [&] { return stopped; });
            if (stopped) return;
        }
    }

    void teardown()
    {
        if (up.exchange(false)) opts.log("down from " + opts.registryUrl);
        files.failAll();
        std::map<int, std::shared_ptr<Channel>> gone;
        {
            std::lock_guard lock(mutex);
            gone.swap(channels);
        }
        for (auto& [_, c] : gone) c->shut();
    }

    void onSocket(const ix::WebSocketMessagePtr& m)
    {
        switch (m->type) {
            case ix::WebSocketMessageType::Open:
                attempt = 0;
                up = true;
                lastFail.clear();
                opts.log("up to " + opts.registryUrl);
                break;
            case ix::WebSocketMessageType::Message:
                if (m->binary)
                    onBinary(m->str);
                else
                    onText(m->str);
                break;
            case ix::WebSocketMessageType::Close:
            case ix::WebSocketMessageType::Error: {
                // WHY, once per reason: a server down for an hour redials a hundred times and says it once.
                const std::string why = m->type == ix::WebSocketMessageType::Error
                                            ? m->errorInfo.reason + (m->errorInfo.http_status
                                                                         ? " (HTTP " + std::to_string(m->errorInfo.http_status) + ")"
                                                                         : std::string())
                                            : "closed " + std::to_string(m->closeInfo.code) +
                                                  (m->closeInfo.reason.empty() ? "" : " " + m->closeInfo.reason);
                if (why != lastFail) opts.log("tunnel to " + opts.registryUrl + ": " + why);
                lastFail = why;
                {
                    std::lock_guard lock(mutex);
                    dropped = true;
                }
                cv.notify_all();
                break;
            }
            default:
                break;
        }
    }

    std::shared_ptr<Channel> channel(int ch)
    {
        std::lock_guard lock(mutex);
        auto it = channels.find(ch);
        return it == channels.end() ? nullptr : it->second;
    }

    void onText(const std::string& text)
    {
        auto m = json::parse(text, nullptr, false);
        if (!m.is_object()) return;
        const std::string t = m.value("t", "");
        if (t == "open") {
            openChannel(m.value("ch", 0), m.value("roots", json::array()), m.value("kind", "engine"));
        } else if (t == "close") {
            std::shared_ptr<Channel> c;
            {
                std::lock_guard lock(mutex);
                auto it = channels.find(m.value("ch", 0));
                if (it != channels.end()) {
                    c = it->second;
                    channels.erase(it);
                }
            }
            if (c) c->shut();
        } else if (t == "data") {
            toEngine(m.value("ch", 0), m.value("text", ""), false);
        } else if (t == "stat-reply") {
            files.onStatReply(m.value("req", 0), m.value("entries", json::array()));
        } else if (t == "put-reply") {
            files.onPutReply(m.value("req", 0), m.value("stat", json()), m.value("error", ""));
        } else if (t == "get-error") {
            files.onGetError(m.value("req", 0), m.value("error", ""));
        } else if (t == "rtc-offer") {
            answer(m.value("req", 0), m.value("sdp", ""));
        }
    }

    void onBinary(const std::string& frame)
    {
        const auto d = decodeBinary(frame);
        if (!d) return;
        const std::string t = d->header.value("t", "");
        if (t == "chunk")
            files.onChunk(d->header.value("req", 0), d->header.value("last", false), d->payload);
        else if (t == "data")
            toEngine(d->header.value("ch", 0), d->payload, true);
    }

    void answer(int req, const std::string& offer)
    {
        auto self = shared_from_this();
        std::thread([self, req, offer] {
            try {
                if (!self->opts.answerOffer) throw std::runtime_error("WebRTC is not available on this machine");
                self->tell({{"t", "rtc-answer"}, {"req", req}, {"sdp", self->opts.answerOffer(offer)}});
            } catch (const std::exception& e) {
                self->tell({{"t", "rtc-answer"}, {"req", req}, {"error", e.what()}});
            }
        }).detach();
    }

    // --- channels ------------------------------------------------------------------------------------

    void openChannel(int ch, const json& roots, const std::string& kind)
    {
        static const std::regex safeName("^[A-Za-z0-9][A-Za-z0-9._-]*$");
        std::vector<MappedRoot> mapped;
        for (const auto& r : roots) {
            const std::string name = r.value("name", "");
            if (!std::regex_match(name, safeName)) {
                tell({{"t", "close"}, {"ch", ch}, {"reason", "refused a root name"}});
                return;
            }
            mapped.push_back({r.value("remote", ""), paths::utf8(opts.cacheDir / paths::fromUtf8(name)), r.value("writable", false)});
        }
        auto c = std::make_shared<Channel>();
        c->ch = ch;
        c->jobs = kind == "jobs";
        if (!mapped.empty()) c->map = std::make_unique<PathMap>(mapped, files.forChannel(ch), ledger, opts.log);
        {
            std::lock_guard lock(mutex);
            channels[ch] = c;
        }
        if (c->jobs) {
            tell({{"t", "opened"}, {"ch", ch}});
            return;
        }
        auto engine = std::make_shared<ix::WebSocket>();
        engine->setUrl("ws://127.0.0.1:" + std::to_string(opts.enginePort));
        engine->disableAutomaticReconnection();
        std::weak_ptr<Impl> weak = shared_from_this();
        std::weak_ptr<Channel> wc = c;
        engine->setOnMessageCallback([weak, wc](const ix::WebSocketMessagePtr& m) {
            auto self = weak.lock();
            auto chan = wc.lock();
            if (self && chan) self->onEngine(chan, m);
        });
        c->engine = engine;
        engine->start();
    }

    void onEngine(const std::shared_ptr<Channel>& c, const ix::WebSocketMessagePtr& m)
    {
        switch (m->type) {
            case ix::WebSocketMessageType::Open:
                {
                    std::lock_guard lock(c->mutex);
                    c->engineOpen = true;
                }
                c->cv.notify_all();
                tell({{"t", "opened"}, {"ch", c->ch}});
                break;
            case ix::WebSocketMessageType::Message:
                toHub(c, m->str, m->binary);
                break;
            case ix::WebSocketMessageType::Error:
                tell({{"t", "close"}, {"ch", c->ch}, {"reason", m->errorInfo.reason}});
                [[fallthrough]];
            case ix::WebSocketMessageType::Close: {
                bool ours = false;
                {
                    std::lock_guard lock(mutex);
                    auto it = channels.find(c->ch);
                    if (it != channels.end() && it->second == c) {
                        channels.erase(it);
                        ours = true;
                    }
                }
                if (!ours) return;
                c->shut();
                tell({{"t", "close"}, {"ch", c->ch}});
                break;
            }
            default:
                break;
        }
    }

    void toEngine(int ch, const std::string& data, bool binary)
    {
        auto c = channel(ch);
        if (!c) return;
        auto self = shared_from_this();
        c->toEngine->push([self, c, data, binary] {
            try {
                if (!c->jobs && !c->waitOpen()) return;
                const std::string out = !binary && c->map ? c->map->outbound(data) : data;
                if (c->jobs) {
                    // Started once its files are here, and NOT awaited: a job takes minutes.
                    if (!binary) self->runJob(c, out);
                    return;
                }
                if (binary)
                    c->engine->sendBinary(out);
                else
                    c->engine->sendText(out);
            } catch (const std::exception& e) {
                self->opts.log("ch" + std::to_string(c->ch) + " → engine: " + e.what());
            }
        });
    }

    void toHub(const std::shared_ptr<Channel>& c, const std::string& data, bool binary)
    {
        auto self = shared_from_this();
        c->toHub->push([self, c, data, binary] {
            try {
                if (binary) {
                    self->sendBinary(encodeBinary({{"t", "data"}, {"ch", c->ch}}, data));
                    return;
                }
                const std::string text = c->map ? c->map->inbound(data) : data;
                self->tell({{"t", "data"}, {"ch", c->ch}, {"text", text}});
            } catch (const std::exception& e) {
                self->opts.log("ch" + std::to_string(c->ch) + " → server: " + e.what());
            }
        });
    }

    /** Hand one request to its handler on a thread of its own; every reply goes back through the map. */
    void runJob(const std::shared_ptr<Channel>& c, const std::string& text)
    {
        auto req = json::parse(text, nullptr, false);
        if (!req.is_object()) return;
        auto self = shared_from_this();
        const json id = req.contains("id") ? req["id"] : json();
        Emit emit = [self, c, id](const ojson& reply) {
            ojson out = ojson::object();
            if (!id.is_null()) out["id"] = id;
            for (auto it = reply.begin(); it != reply.end(); ++it) out[it.key()] = it.value();
            self->toHub(c, out.dump(), false);
        };
        const std::string type = req.value("type", "");
        auto it = opts.jobs.find(type);
        if (it == opts.jobs.end()) {
            // Said here too: the server shows it to one person, the log keeps it for whoever looks at this machine.
            if (opts.log) opts.log("refused job '" + type + "': this machine does not do it");
            emit({{"type", "error"}, {"error", "this machine does not do '" + type + "'"}});
            return;
        }
        JobHandler handler = it->second;
        auto log = opts.log;
        std::thread([handler, req, emit, c, type, log] {
            JobContext ctx;
            ctx.fetch = [c](const std::string& local) { return c->map ? c->map->ensureLocal(local) : false; };
            try {
                handler(req, emit, ctx);
            } catch (const std::exception& e) {
                if (log) log("job '" + type + "' failed: " + e.what());
                emit({{"type", "error"}, {"error", e.what()}});
            }
        }).detach();
    }
};

TunnelAgent::TunnelAgent(AgentOptions opts) : impl_(std::make_shared<Impl>(std::move(opts))) {}

std::shared_ptr<TunnelAgent> TunnelAgent::create(AgentOptions opts)
{
    return std::shared_ptr<TunnelAgent>(new TunnelAgent(std::move(opts)));
}

TunnelAgent::~TunnelAgent() { stop(); }

void TunnelAgent::start()
{
    std::thread([impl = impl_] { impl->life(); }).detach();
}

void TunnelAgent::stop()
{
    {
        std::lock_guard lock(impl_->mutex);
        impl_->stopped = true;
    }
    impl_->cv.notify_all();
}

bool TunnelAgent::connected() const { return impl_->up; }

}  // namespace st0::tunnel
