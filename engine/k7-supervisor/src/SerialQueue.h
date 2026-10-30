// SerialQueue.h — tasks run one at a time, in order, on a thread of their own: the C++ form of a
// promise chain. Closing it drops what is still queued and lets the thread end by itself, since the
// closer may be the very thread a queued task is waiting on — a join there would deadlock.

#pragma once

#include <condition_variable>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>

#include "Loop.h"

namespace k7 {

class SerialQueue {
public:
    static std::shared_ptr<SerialQueue> create()
    {
        auto q = std::shared_ptr<SerialQueue>(new SerialQueue());
        std::thread([q] { q->run(); }).detach();
        return q;
    }

    void push(std::function<void()> task)
    {
        {
            std::lock_guard lock(mutex_);
            if (closed_) return;
            tasks_.push_back(std::move(task));
        }
        cv_.notify_one();
    }

    void close()
    {
        {
            std::lock_guard lock(mutex_);
            closed_ = true;
            tasks_.clear();
        }
        cv_.notify_one();
    }

private:
    SerialQueue() = default;

    void run()
    {
        for (;;) {
            std::function<void()> task;
            {
                std::unique_lock lock(mutex_);
                cv_.wait(lock, [&] { return closed_ || !tasks_.empty(); });
                if (closed_) return;
                task = std::move(tasks_.front());
                tasks_.pop_front();
            }
            // A task that throws costs itself, never the thread the rest of the queue runs on.
            Loop::guarded("a queued task", task);
        }
    }

    std::mutex mutex_;
    std::condition_variable cv_;
    std::deque<std::function<void()>> tasks_;
    bool closed_ = false;
};

}  // namespace k7
