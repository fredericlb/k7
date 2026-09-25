// Loop.h — the one thread every piece of supervisor STATE lives on, like Node's event loop was:
// timers and posted tasks run here, one at a time, so nothing needs a lock but the queue itself.
// Anything that blocks — a socket, a child, a disk probe — runs in `work()` on its own thread and
// posts its result back. A task that blocks the loop freezes every timer. See docs/supervisor.md.

#pragma once

#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <thread>

namespace st0 {

class Loop {
public:
    using Fn = std::function<void()>;
    using Ms = std::chrono::milliseconds;

    /** Queue `fn` to run on the loop thread; safe from any thread. */
    void post(Fn fn);

    /** Run `fn` once after `delay`; the id cancels it. */
    std::uint64_t after(Ms delay, Fn fn);

    /** Run `fn` every `period`, the first time after one period. */
    std::uint64_t every(Ms period, Fn fn);

    /** Forget a timer; a no-op for one that already fired or never was. */
    void cancel(std::uint64_t id);

    /** Run tasks and timers until `stop()`; returns on the thread that called it. */
    void run();

    /** Make `run()` return once the task in hand is done; safe from any thread. */
    void stop();

    /** Run blocking `job` off the loop, then `then(result)` back on it. */
    template <class T>
    void work(std::function<T()> job, std::function<void(T)> then)
    {
        std::thread([this, job = std::move(job), then = std::move(then)]() mutable {
            auto result = std::make_shared<T>(job());
            post([then = std::move(then), result]() { then(std::move(*result)); });
        }).detach();
    }

private:
    struct Timer {
        std::uint64_t id;
        Ms period;
        Fn fn;
    };
    using Clock = std::chrono::steady_clock;

    std::mutex mutex_;
    std::condition_variable wake_;
    std::deque<Fn> tasks_;
    std::multimap<Clock::time_point, Timer> timers_;
    std::uint64_t nextId_ = 1;
    bool stopped_ = false;

    std::uint64_t schedule(Ms delay, Ms period, Fn fn);
};

}  // namespace st0
