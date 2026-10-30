#pragma once

// HangWatch.h — when the engine is HUNG rather than busy: an audio callback inside the graph too long,
// or a message thread whose heartbeat stopped. Its own thread, since the message thread is what may be
// stuck. JUCE-free and header-only, so tests/ has it in a fast binary; the exit is EngineHost's (docs/hangWatch.md).
// What reads wrong: the clocks are 32-bit milliseconds that wrap, so every age is a SIGNED difference.

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <mutex>
#include <thread>
#include <utility>

namespace studio {

enum class Hang { none, callback, messageThread };

// A callback inside the graph this long is not slow, it is stuck: nothing short of a restart frees the audio thread.
constexpr std::uint32_t kStuckCallbackMs = 10000;
// A message thread silent this long is wedged: longer than any first apply or Faust compile takes.
constexpr std::uint32_t kStuckMessageThreadMs = 60000;
// A look that comes this late means the whole process was asleep, not that a thread hung.
constexpr std::uint32_t kSuspendGapMs = 5000;
// …and the looks skipped after one, while the threads that slept with it catch up.
constexpr int kGraceSteps = 10;

// Milliseconds since `then`, 0 when `then` is 0 (never stamped) or ahead of `now`.
inline std::uint32_t ageMs(std::uint32_t now, std::uint32_t then) {
    if (then == 0) return 0;
    const auto d = static_cast<std::int32_t>(now - then);
    return d > 0 ? static_cast<std::uint32_t>(d) : 0;
}

// The verdict on one look: a stuck callback first, since it is the likeliest reason the message thread waits.
inline Hang judgeHang(std::uint32_t now, std::uint32_t callbackEntered, std::uint32_t heartbeat) {
    if (ageMs(now, callbackEntered) >= kStuckCallbackMs) return Hang::callback;
    if (ageMs(now, heartbeat) >= kStuckMessageThreadMs) return Hang::messageThread;
    return Hang::none;
}

class HangWatchdog {
public:
    // The three clocks it reads, each a millisecond counter that may wrap; 0 from the last two means "none".
    struct Clocks {
        std::function<std::uint32_t()> now;
        std::function<std::uint32_t()> callbackEntered;
        std::function<std::uint32_t()> heartbeat;
    };

    HangWatchdog() = default;
    HangWatchdog(const HangWatchdog&) = delete;
    HangWatchdog& operator=(const HangWatchdog&) = delete;
    ~HangWatchdog() { stop(); }

    // One look: the hang to report, once per hang — `none` while fine, after a report, or in the grace after a sleep.
    Hang step() {
        const std::uint32_t now = clocks_.now();
        const std::uint32_t gap = lastStep_ == 0 ? 0 : ageMs(now, lastStep_);
        lastStep_ = now == 0 ? 1 : now;
        if (gap >= kSuspendGapMs) grace_ = kGraceSteps;
        if (grace_ > 0) {
            --grace_;
            return Hang::none;
        }
        const Hang v = judgeHang(now, clocks_.callbackEntered(), clocks_.heartbeat());
        if (v == reported_) return Hang::none;
        reported_ = v;
        return v;
    }

    // Look every `period` on a thread of its own, handing each hang to `onHang` there.
    void start(std::chrono::milliseconds period, Clocks clocks, std::function<void(Hang)> onHang) {
        stop();
        clocks_ = std::move(clocks);
        onHang_ = std::move(onHang);
        {
            std::lock_guard<std::mutex> lock(mx_);
            stopping_ = false;
        }
        thread_ = std::thread([this, period] {
            std::unique_lock<std::mutex> lock(mx_);
            while (!stopping_) {
                wake_.wait_for(lock, period, [this] { return stopping_; });
                if (stopping_) break;
                lock.unlock();
                if (const Hang h = step(); h != Hang::none) onHang_(h);
                lock.lock();
            }
        });
    }

    void stop() {
        {
            std::lock_guard<std::mutex> lock(mx_);
            stopping_ = true;
        }
        wake_.notify_all();
        if (thread_.joinable()) thread_.join();
    }

    // For tests, which call step() by hand.
    void setClocks(Clocks clocks) { clocks_ = std::move(clocks); }

private:
    Clocks clocks_;
    std::function<void(Hang)> onHang_;
    std::uint32_t lastStep_ = 0;
    int grace_ = 0;
    Hang reported_ = Hang::none;
    std::mutex mx_;
    std::condition_variable wake_;
    bool stopping_ = false;
    std::thread thread_;
};

}  // namespace studio
