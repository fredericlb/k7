// Rtc.cpp — see Rtc.h. Peers are kept in a set while they live, so none is collected with its
// channel open; one nobody opened within thirty seconds is given up. Either end of a pipe closing
// closes both, and the peer with them.

#include "Rtc.h"

#include "RtcFrames.h"

#include <ixwebsocket/IXWebSocket.h>
#include <rtc/rtc.hpp>

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <set>
#include <thread>

namespace st0::rtc {

namespace {

constexpr auto kOpenWithin = std::chrono::seconds(30);

std::mutex peersMutex;
std::set<std::shared_ptr<::rtc::PeerConnection>> peers;

void drop(const std::shared_ptr<::rtc::PeerConnection>& pc)
{
    {
        std::lock_guard lock(peersMutex);
        if (!peers.erase(pc)) return;
    }
    // Closed off the peer's own callback thread, which a close from inside would wait on.
    std::thread([pc] { pc->close(); }).detach();
}

/** One data channel ↔ one engine socket. */
struct Pipe : std::enable_shared_from_this<Pipe> {
    std::shared_ptr<::rtc::DataChannel> dc;
    std::shared_ptr<ix::WebSocket> engine = std::make_shared<ix::WebSocket>();
    std::weak_ptr<::rtc::PeerConnection> pc;
    rtcframes::Joiner joiner;
    std::mutex mutex;
    bool engineOpen = false;
    bool ended = false;
    std::vector<rtcframes::Frame> held;
    std::function<void(const std::string&)> log;

    void start(int enginePort)
    {
        auto self = shared_from_this();
        engine->setUrl("ws://127.0.0.1:" + std::to_string(enginePort));
        engine->disableAutomaticReconnection();
        std::weak_ptr<Pipe> weak = self;
        engine->setOnMessageCallback([weak](const ix::WebSocketMessagePtr& m) {
            if (auto p = weak.lock()) p->onEngine(m);
        });
        dc->onMessage([weak](::rtc::message_variant msg) {
            auto p = weak.lock();
            if (!p) return;
            std::string bytes;
            if (auto* b = std::get_if<::rtc::binary>(&msg))
                bytes.assign(reinterpret_cast<const char*>(b->data()), b->size());
            else
                bytes = std::get<std::string>(msg);
            if (auto frame = p->joiner.push(bytes)) p->toEngine(std::move(*frame));
        });
        // The pipe owns itself through these two callbacks until either end closes.
        dc->onClosed([self] { self->end(); });
        dc->onError([self](std::string e) {
            if (self->log) self->log("rtc channel: " + e);
            self->end();
        });
        engine->start();
    }

    void toEngine(rtcframes::Frame f)
    {
        std::lock_guard lock(mutex);
        if (!engineOpen) {
            held.push_back(std::move(f));
            return;
        }
        if (f.binary)
            engine->sendBinary(f.data);
        else
            engine->sendText(f.data);
    }

    void onEngine(const ix::WebSocketMessagePtr& m)
    {
        if (m->type == ix::WebSocketMessageType::Open) {
            std::lock_guard lock(mutex);
            engineOpen = true;
            for (auto& f : held) {
                if (f.binary)
                    engine->sendBinary(f.data);
                else
                    engine->sendText(f.data);
            }
            held.clear();
        } else if (m->type == ix::WebSocketMessageType::Message) {
            if (!dc->isOpen()) return;
            for (const auto& frag : rtcframes::toFragments(m->str, m->binary)) {
                ::rtc::binary b(frag.size());
                std::memcpy(b.data(), frag.data(), frag.size());
                dc->send(std::move(b));
            }
        } else if (m->type == ix::WebSocketMessageType::Close || m->type == ix::WebSocketMessageType::Error) {
            std::thread([self = shared_from_this()] { self->end(); }).detach();
        }
    }

    void end()
    {
        {
            std::lock_guard lock(mutex);
            if (ended) return;
            ended = true;
        }
        try {
            dc->close();
        } catch (...) {
        }
        std::thread([e = engine] { e->stop(); }).detach();
        if (auto p = pc.lock()) drop(p);
        dc->onClosed(nullptr);
        dc->onError(nullptr);
    }
};

}  // namespace

std::string answerOffer(const std::string& offer, const Options& opts)
{
    ::rtc::Configuration config;
    for (const auto& s : opts.iceServers) config.iceServers.emplace_back(s);
    auto pc = std::make_shared<::rtc::PeerConnection>(config);
    {
        std::lock_guard lock(peersMutex);
        peers.insert(pc);
    }
    auto opened = std::make_shared<std::atomic<bool>>(false);
    std::weak_ptr<::rtc::PeerConnection> weak = pc;
    pc->onStateChange([weak](::rtc::PeerConnection::State s) {
        if (s == ::rtc::PeerConnection::State::Failed || s == ::rtc::PeerConnection::State::Closed)
            if (auto p = weak.lock()) drop(p);
    });
    pc->onDataChannel([weak, opened, opts](std::shared_ptr<::rtc::DataChannel> dc) {
        *opened = true;
        auto pipe = std::make_shared<Pipe>();
        pipe->dc = dc;
        pipe->pc = weak;
        pipe->log = opts.log;
        pipe->start(opts.enginePort);
    });
    std::thread([weak, opened] {
        std::this_thread::sleep_for(kOpenWithin);
        if (!*opened)
            if (auto p = weak.lock()) drop(p);
    }).detach();

    auto gathered = std::make_shared<std::pair<std::mutex, std::condition_variable>>();
    auto complete = std::make_shared<bool>(false);
    pc->onGatheringStateChange([gathered, complete](::rtc::PeerConnection::GatheringState s) {
        if (s != ::rtc::PeerConnection::GatheringState::Complete) return;
        {
            std::lock_guard lock(gathered->first);
            *complete = true;
        }
        gathered->second.notify_all();
    });
    pc->setRemoteDescription(::rtc::Description(offer, ::rtc::Description::Type::Offer));
    {
        std::unique_lock lock(gathered->first);
        gathered->second.wait_for(lock, std::chrono::milliseconds(opts.gatherMs), [&] { return *complete; });
    }
    const auto answer = pc->localDescription();
    if (!answer) {
        drop(pc);
        throw std::runtime_error("no local description");
    }
    return std::string(*answer);
}

}  // namespace st0::rtc
