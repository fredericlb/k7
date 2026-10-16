// JobSlots.h — at most N heavy jobs at once on this machine; the others wait their turn, in the
// order they asked. A slot is held by a guard, so a job that throws still gives it back.
// Why stem cuts are counted is docs/supervisor.md, "One stem cut at a time".

#pragma once

#include <condition_variable>
#include <cstddef>
#include <functional>
#include <mutex>

namespace k7 {

class JobSlots {
public:
    explicit JobSlots(std::size_t slots) : slots_(slots ? slots : 1) {}

    /** One slot, from `hold` until it is destroyed. */
    class Held {
    public:
        explicit Held(JobSlots& owner) : owner_(owner) {}
        ~Held() { owner_.release(); }
        Held(const Held&) = delete;
        Held& operator=(const Held&) = delete;

    private:
        JobSlots& owner_;
    };

    /** Wait for a slot, after every earlier caller; `waiting(ahead)` hears how many still wait in front, each time that changes. */
    [[nodiscard]] Held hold(const std::function<void(std::size_t ahead)>& waiting = {})
    {
        std::unique_lock lock(mutex_);
        const std::size_t ticket = nextTicket_++;
        std::size_t said = static_cast<std::size_t>(-1);
        while (ticket != serving_ || running_ >= slots_) {
            const std::size_t ahead = ticket - serving_;
            if (ahead != said && waiting) waiting(ahead);
            said = ahead;
            cv_.wait(lock);
        }
        ++serving_;
        ++running_;
        cv_.notify_all();
        return Held(*this);
    }

    std::size_t running()
    {
        std::lock_guard lock(mutex_);
        return running_;
    }

private:
    void release()
    {
        {
            std::lock_guard lock(mutex_);
            --running_;
        }
        cv_.notify_all();
    }

    std::mutex mutex_;
    std::condition_variable cv_;
    const std::size_t slots_;
    std::size_t running_ = 0;
    std::size_t nextTicket_ = 0;
    std::size_t serving_ = 0;
};

}  // namespace k7
