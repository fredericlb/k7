// Loop.cpp — a task queue and a timer map behind one mutex. A periodic timer is re-armed from its
// due time rather than from now, so a slow tick does not drift the rest. See Loop.h.

#include "Loop.h"

namespace k7 {

void Loop::post(Fn fn)
{
    {
        std::lock_guard lock(mutex_);
        tasks_.push_back(std::move(fn));
    }
    wake_.notify_one();
}

std::uint64_t Loop::schedule(Ms delay, Ms period, Fn fn)
{
    std::uint64_t id;
    {
        std::lock_guard lock(mutex_);
        id = nextId_++;
        timers_.emplace(Clock::now() + delay, Timer{id, period, std::move(fn)});
    }
    wake_.notify_one();
    return id;
}

std::uint64_t Loop::after(Ms delay, Fn fn) { return schedule(delay, Ms(0), std::move(fn)); }

std::uint64_t Loop::every(Ms period, Fn fn) { return schedule(period, period, std::move(fn)); }

void Loop::cancel(std::uint64_t id)
{
    std::lock_guard lock(mutex_);
    for (auto it = timers_.begin(); it != timers_.end(); ++it)
        if (it->second.id == id) {
            timers_.erase(it);
            return;
        }
}

void Loop::stop()
{
    {
        std::lock_guard lock(mutex_);
        stopped_ = true;
    }
    wake_.notify_one();
}

void Loop::run()
{
    std::unique_lock lock(mutex_);
    while (!stopped_) {
        if (!tasks_.empty()) {
            Fn fn = std::move(tasks_.front());
            tasks_.pop_front();
            lock.unlock();
            fn();
            lock.lock();
            continue;
        }
        if (!timers_.empty() && timers_.begin()->first <= Clock::now()) {
            auto node = timers_.extract(timers_.begin());
            Timer timer = std::move(node.mapped());
            const auto due = node.key();
            // A periodic timer goes back in BEFORE it runs, so a cancel from inside its own tick sticks.
            Fn fn = timer.fn;
            if (timer.period.count() > 0) timers_.emplace(due + timer.period, std::move(timer));
            lock.unlock();
            fn();
            lock.lock();
            continue;
        }
        if (timers_.empty())
            wake_.wait(lock);
        else
            wake_.wait_until(lock, timers_.begin()->first);
    }
}

}  // namespace k7
