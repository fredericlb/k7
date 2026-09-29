// AudioSender.h — the audio broadcast: drains each session's master tap and pushes it as BINARY to the
// sockets listening to that session, on ITS OWN THREAD because a server-side sendBinary blocks (docs/broadcast.md).
// The one thing a reader would get wrong: only this thread may move a ring's read cursor, which is why arrivals are queued.

#pragma once

#include "ServeContext.h"

#include <ixwebsocket/IXWebSocketServer.h>

#include <atomic>
#include <cstdint>
#include <functional>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <thread>

namespace studio {

class AudioSender {
public:
    AudioSender(ServeContext& ctx, ix::WebSocketServer& server, std::function<double()> sinceBoot);
    AudioSender(const AudioSender&) = delete;
    AudioSender& operator=(const AudioSender&) = delete;
    ~AudioSender();

    // `onTick` runs on the sender thread once a pass — where serve() turns a signal's flag into quit().
    void start(std::function<void()> onTick);
    // Stop looping; a send in progress is ended by closing the server, then join().
    void stop() { running_.store(false, std::memory_order_relaxed); }
    void join();

    /** ANY THREAD. The session's first listener just arrived: start it from live, on the next pass. */
    void markArrived(const std::string& session);

private:
    void run();
    void pump(const std::string& sid, const std::vector<std::shared_ptr<ix::WebSocket>>& targets);
    uint32_t nextSeq(const std::string& s, uint32_t by) { return seq_[s] += by; }

    ServeContext& ctx_;
    ix::WebSocketServer& server_;
    std::function<double()> sinceBoot_;
    std::function<void()> onTick_;
    std::atomic<bool> running_{false};
    std::thread thread_;

    std::mutex arrivedMx_;
    std::set<std::string> arrived_;

    // Sender thread only. One sequence per session: a shared counter would have each service read the other's frames as dropped.
    std::map<std::string, uint32_t> seq_;
    // Per SESSION, not per engine: one latch would have the second project's unprepared tap withhold frames in silence.
    std::set<std::string> warnedNoRate_;
};

}  // namespace studio
