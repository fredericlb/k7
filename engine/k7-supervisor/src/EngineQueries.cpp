// EngineQueries.cpp — see EngineQueries.h. The deadlines are generous on purpose: a plugin list
// can be thousands of entries, and a device switch opens hardware.

#include "EngineQueries.h"

#include "Log.h"
#include "Paths.h"

#include <ixwebsocket/IXWebSocket.h>

#include <algorithm>
#include <cctype>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>

namespace k7 {

using nlohmann::json;
using protocol::AudioDevice;
using protocol::EditPlugin;
using protocol::Plugin;
using protocol::Session;

namespace {

constexpr int kConnectMs = 4000;
constexpr int kDevicesMs = 6000;
constexpr int kPluginsMs = 8000;
constexpr int kSetDeviceMs = 8000;
constexpr int kEditPluginsMs = 6000;
constexpr int kSessionsMs = 6000;
constexpr int kPairingMs = 4000;

std::string lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
    return s;
}

std::string str(const json& o, const char* key)
{
    auto it = o.find(key);
    return it != o.end() && it->is_string() ? it->get<std::string>() : std::string();
}

bool flag(const json& o, const char* key)
{
    auto it = o.find(key);
    return it != o.end() && it->is_boolean() && it->get<bool>();
}

int number(const json& o, const char* key)
{
    auto it = o.find(key);
    return it != o.end() && it->is_number() ? it->get<int>() : 0;
}

std::int64_t millis(const json& o, const char* key)
{
    auto it = o.find(key);
    return it != o.end() && it->is_number() ? it->get<std::int64_t>() : 0;
}

std::vector<AudioDevice> devicesOf(const json& msg)
{
    std::vector<AudioDevice> out;
    for (const auto& d : msg.value("devices", json::array())) out.push_back({str(d, "name"), str(d, "type"), flag(d, "current"), flag(d, "currentInput")});
    return out;
}

}  // namespace

struct EngineQueries::Worker {
    int port;
    std::mutex mutex;
    std::condition_variable cv;
    std::deque<std::function<void()>> jobs;
    bool quit = false;

    // The socket and what its callback hands the waiting job, under `mutex`.
    std::unique_ptr<ix::WebSocket> ws;
    bool open = false;
    bool failed = false;
    std::string awaited;
    std::optional<json> reply;

    explicit Worker(int p) : port(p) {}

    void enqueue(std::function<void()> job)
    {
        {
            std::lock_guard lock(mutex);
            jobs.push_back(std::move(job));
        }
        cv.notify_all();
    }

    void run()
    {
        for (;;) {
            std::function<void()> job;
            {
                std::unique_lock lock(mutex);
                cv.wait(lock, [&] { return quit || !jobs.empty(); });
                if (quit) return;
                job = std::move(jobs.front());
                jobs.pop_front();
            }
            job();
        }
    }

    void drop()
    {
        std::unique_ptr<ix::WebSocket> old;
        {
            std::lock_guard lock(mutex);
            old = std::move(ws);
            open = false;
        }
        if (old) old->stop();
    }

    bool connect()
    {
        {
            std::lock_guard lock(mutex);
            if (ws && open) return true;
        }
        drop();
        auto sock = std::make_unique<ix::WebSocket>();
        sock->setUrl("ws://127.0.0.1:" + std::to_string(port));
        sock->disableAutomaticReconnection();
        sock->setOnMessageCallback([this](const ix::WebSocketMessagePtr& m) { onMessage(m); });
        {
            std::lock_guard lock(mutex);
            failed = false;
            open = false;
        }
        sock->start();
        std::unique_lock lock(mutex);
        cv.wait_for(lock, std::chrono::milliseconds(kConnectMs), [&] { return open || failed; });
        const bool up = open;
        ws = std::move(sock);
        lock.unlock();
        // Errors are routine — the engine may not be up yet.
        if (!up) drop();
        return up;
    }

    void onMessage(const ix::WebSocketMessagePtr& m)
    {
        std::lock_guard lock(mutex);
        if (m->type == ix::WebSocketMessageType::Open) {
            open = true;
        } else if (m->type == ix::WebSocketMessageType::Close || m->type == ix::WebSocketMessageType::Error) {
            open = false;
            failed = true;
        } else if (m->type == ix::WebSocketMessageType::Message) {
            auto msg = json::parse(m->str, nullptr, false);
            if (!msg.is_object()) return;
            // Another project's news: a frame naming a session is not ours, the supervisor driving none.
            if (auto s = msg.find("session"); s != msg.end() && s->is_string() && !s->get<std::string>().empty()) return;
            if (!awaited.empty() && str(msg, "type") == awaited) reply = std::move(msg);
        }
        cv.notify_all();
    }

    /** Send `frame`, then wait for a frame of type `type`; null on no connection, a send failure or the deadline. */
    std::optional<json> request(const json& frame, const std::string& type, int ms)
    {
        if (!connect()) return std::nullopt;
        std::unique_lock lock(mutex);
        awaited = type;
        reply.reset();
        ws->send(frame.dump());
        const bool got = cv.wait_for(lock, std::chrono::milliseconds(ms), [&] { return reply.has_value() || !open; });
        awaited.clear();
        if (!got || !reply) {
            // A timeout usually means the engine went away mid-call: force a redial.
            open = false;
            return std::nullopt;
        }
        auto out = std::move(reply);
        reply.reset();
        return out;
    }

    void send(const json& frame)
    {
        if (!connect()) return;
        std::lock_guard lock(mutex);
        ws->send(frame.dump());
    }
};

EngineQueries::EngineQueries(Loop& loop, int port) : loop_(loop), worker_(std::make_shared<Worker>(port))
{
    std::thread([w = worker_] { w->run(); }).detach();
}

EngineQueries::~EngineQueries()
{
    {
        std::lock_guard lock(worker_->mutex);
        worker_->quit = true;
    }
    worker_->cv.notify_all();
}

void EngineQueries::close()
{
    worker_->enqueue([w = worker_] { w->drop(); });
}

void EngineQueries::listAudioDevices(Reply<std::vector<AudioDevice>> done)
{
    worker_->enqueue([w = worker_, &loop = loop_, done = std::move(done)] {
        auto msg = w->request({{"type", "list-audio-devices"}}, "audio-devices", kDevicesMs);
        std::optional<std::vector<AudioDevice>> out;
        if (msg) out = devicesOf(*msg);
        loop.post([done, out] { done(out); });
    });
}

void EngineQueries::setAudioDevice(const std::string& name, const std::string& deviceType,
                                   Reply<std::vector<AudioDevice>> done)
{
    json frame = {{"type", "set-audio-device"}, {"name", name}};
    if (!deviceType.empty()) frame["deviceType"] = deviceType;
    worker_->enqueue([w = worker_, &loop = loop_, frame, done = std::move(done)] {
        auto msg = w->request(frame, "audio-devices", kSetDeviceMs);
        std::optional<std::vector<AudioDevice>> out;
        if (msg) out = devicesOf(*msg);
        loop.post([done, out] { done(out); });
    });
}

void EngineQueries::listPlugins(Reply<std::vector<Plugin>> done)
{
    worker_->enqueue([w = worker_, &loop = loop_, done = std::move(done)] {
        auto msg = w->request({{"type", "list-plugins"}}, "plugins", kPluginsMs);
        std::optional<std::vector<Plugin>> out;
        if (msg) {
            std::vector<Plugin> list;
            for (const auto& p : msg->value("plugins", json::array()))
                list.push_back({str(p, "name"), str(p, "format"), str(p, "manufacturer"), str(p, "role")});
            std::sort(list.begin(), list.end(), [](const Plugin& a, const Plugin& b) {
                const auto an = lower(a.name), bn = lower(b.name);
                return an != bn ? an < bn : a.format < b.format;
            });
            out = std::move(list);
        }
        loop.post([done, out] { done(out); });
    });
}

void EngineQueries::listEditPlugins(Reply<std::vector<EditPlugin>> done)
{
    worker_->enqueue([w = worker_, &loop = loop_, done = std::move(done)] {
        auto msg = w->request({{"type", "list-edit-plugins"}}, "edit-plugins", kEditPluginsMs);
        std::optional<std::vector<EditPlugin>> out;
        if (msg) {
            std::vector<EditPlugin> list;
            for (const auto& e : msg->value("plugins", json::array()))
                list.push_back({str(e, "session"), str(e, "id"), str(e, "name"), flag(e, "hasNativePluginUI")});
            out = std::move(list);
        }
        loop.post([done, out] { done(out); });
    });
}

void EngineQueries::listSessions(Reply<std::vector<Session>> done)
{
    worker_->enqueue([w = worker_, &loop = loop_, done = std::move(done)] {
        auto msg = w->request({{"type", "list-sessions"}}, "sessions", kSessionsMs);
        std::optional<std::vector<Session>> out;
        if (msg) {
            std::vector<Session> list;
            for (const auto& s : msg->value("sessions", json::array()))
                list.push_back({str(s, "id"), str(s, "project"), flag(s, "loaded"), flag(s, "playing"), number(s, "tracks"),
                                number(s, "listeners")});
            out = std::move(list);
        }
        loop.post([done, out] { done(out); });
    });
}

void EngineQueries::listPairRequests(Reply<std::vector<protocol::PairRequest>> done)
{
    worker_->enqueue([w = worker_, &loop = loop_, done = std::move(done)] {
        auto msg = w->request({{"type", "list-pair-requests"}}, "pair-requests", kPairingMs);
        std::optional<std::vector<protocol::PairRequest>> out;
        if (msg) {
            std::vector<protocol::PairRequest> list;
            for (const auto& r : msg->value("requests", json::array()))
                list.push_back({str(r, "requestId"), str(r, "name"), str(r, "ip"), str(r, "code"), millis(r, "since")});
            out = std::move(list);
        }
        loop.post([done, out] { done(out); });
    });
}

void EngineQueries::listPairedDevices(Reply<std::vector<protocol::PairedDevice>> done)
{
    worker_->enqueue([w = worker_, &loop = loop_, done = std::move(done)] {
        auto msg = w->request({{"type", "list-paired-devices"}}, "paired-devices", kPairingMs);
        std::optional<std::vector<protocol::PairedDevice>> out;
        if (msg) {
            std::vector<protocol::PairedDevice> list;
            for (const auto& d : msg->value("devices", json::array()))
                list.push_back({str(d, "deviceId"), str(d, "name"), millis(d, "created"), millis(d, "lastSeen")});
            out = std::move(list);
        }
        loop.post([done, out] { done(out); });
    });
}

void EngineQueries::pairVerb(const std::string& verb, const std::string& id, std::function<void()> done)
{
    const json frame = {{"type", verb}, {verb == "unpair-device" ? "deviceId" : "requestId", id}};
    worker_->enqueue([w = worker_, &loop = loop_, frame, done = std::move(done)] {
        w->send(frame);
        loop.post(done);
    });
}

void EngineQueries::dropSession(const std::string& session, std::function<void()> done)
{
    worker_->enqueue([w = worker_, &loop = loop_, session, done = std::move(done)] {
        w->send({{"type", "drop-session"}, {"session", session}});
        loop.post(done);
    });
}

void EngineQueries::showNativePluginUI(const std::string& id, const std::optional<std::string>& session,
                                       std::function<void()> done)
{
    json frame = {{"type", "show-native-plugin-ui"}, {"id", id}};
    if (session) frame["session"] = *session;
    worker_->enqueue([w = worker_, &loop = loop_, frame, done = std::move(done)] {
        w->send(frame);
        loop.post(done);
    });
}

void EngineQueries::rescanPlugins(std::function<void()> done)
{
    std::error_code ec;
    std::filesystem::remove(paths::extsCache(), ec);
    if (ec) log::host("could not delete exts.json — the rescan may return stale results");
    worker_->enqueue([w = worker_, &loop = loop_, done = std::move(done)] {
        w->send({{"type", "rescan-plugins"}, {"force", true}});
        loop.post(done);
    });
}

}  // namespace k7
