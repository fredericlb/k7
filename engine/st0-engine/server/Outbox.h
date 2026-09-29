// Outbox.h — every JSON the engine pushes at its clients, sent from ONE writer thread, so the message
// thread never waits on a peer (docs/audit-stabilite.md). What a reader would get wrong: a stuck peer
// still delays the OTHERS' JSON, by up to the server's send timeout — it just no longer freezes the engine.

#pragma once

#include <ixwebsocket/IXWebSocket.h>

#include <condition_variable>
#include <cstddef>
#include <deque>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace studio {

class Outbox {
public:
    // Queued past this, a droppable frame is refused at the door: it is superseded twenty times a second anyway.
    static constexpr size_t kMaxQueuedBytes = 8 * 1024 * 1024;
    // …and a reply is refused only past four times that, which means the writer has been stuck for a long while.
    static constexpr size_t kMaxQueuedReplyBytes = 4 * kMaxQueuedBytes;
    // A droppable frame is skipped for a socket that has more than this unsent.
    static constexpr size_t kMaxSocketBacklog = 64 * 1024;

    Outbox() = default;
    Outbox(const Outbox&) = delete;
    Outbox& operator=(const Outbox&) = delete;
    ~Outbox() { stop(); join(); }

    void start() { writer_ = std::thread([this] { run(); }); }

    /** ANY THREAD. Queue `payload` for `to`; `droppable` is a state frame, which a backlog may skip. */
    void post(std::shared_ptr<ix::WebSocket> to, std::shared_ptr<const std::string> payload, bool droppable) {
        {
            std::lock_guard<std::mutex> lk(m_);
            if (stopping_) return;
            const size_t cap = droppable ? kMaxQueuedBytes : kMaxQueuedReplyBytes;
            if (queuedBytes_ + payload->size() > cap) {
                if (!droppable && !warnedFull_) {
                    warnedFull_ = true;
                    std::cerr << "[outbox] full — replies are being dropped until the writer catches up\n";
                }
                return;
            }
            queuedBytes_ += payload->size();
            q_.push_back({std::move(to), std::move(payload), droppable});
        }
        cv_.notify_one();
    }

    /** Stop taking work and wake the writer; a send in progress is ended by closing the server, then join(). */
    void stop() {
        {
            std::lock_guard<std::mutex> lk(m_);
            stopping_ = true;
        }
        cv_.notify_all();
    }

    void join() {
        if (writer_.joinable()) writer_.join();
    }

private:
    struct Item {
        std::shared_ptr<ix::WebSocket> to;
        std::shared_ptr<const std::string> payload;
        bool droppable;
    };

    void run() {
        for (;;) {
            Item item;
            {
                std::unique_lock<std::mutex> lk(m_);
                cv_.wait(lk, [this] { return stopping_ || !q_.empty(); });
                if (stopping_) return;
                item = std::move(q_.front());
                q_.pop_front();
                queuedBytes_ -= item.payload->size();
                if (queuedBytes_ == 0) warnedFull_ = false;
            }
            if (item.droppable && item.to->bufferedAmount() > kMaxSocketBacklog) continue;
            item.to->send(*item.payload);
        }
    }

    std::mutex m_;
    std::condition_variable cv_;
    std::deque<Item> q_;
    size_t queuedBytes_ = 0;
    bool stopping_ = false;
    bool warnedFull_ = false;
    std::thread writer_;
};

}  // namespace studio
