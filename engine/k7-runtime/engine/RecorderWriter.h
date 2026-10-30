// RecorderWriter.h — the ONE thread that moves recorder rings onto disk, so a take is written
// while the message thread is busy building a graph or compiling Faust. JUCE-free and
// header-only, so tests/ has it in the fast binary. See docs/recorder.md.
//
// What a reader gets wrong: it holds the NODES, never the session map. A job is either the
// writer's (registered) or its owner's (removed or finished), and remove() returns only once the
// writer is out; finish() never waits, which is how a stop stays off the disk's clock.

#pragma once

#include <algorithm>
#include <chrono>
#include <condition_variable>
#include <exception>
#include <iostream>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

namespace studio {

class RecorderWriter {
public:
    /** What the writer pumps: a recorder node, or a fake one in the tests. */
    struct Job {
        virtual ~Job() = default;
        virtual void pump() = 0;
        /** The writer's last word on a job finish() handed it, right after its last pump: close what it writes. */
        virtual void finish() {}
    };

    explicit RecorderWriter(std::chrono::milliseconds period = std::chrono::milliseconds(20))
        : period_(period) {}
    ~RecorderWriter() { stop(); }

    RecorderWriter(const RecorderWriter&) = delete;
    RecorderWriter& operator=(const RecorderWriter&) = delete;

    /** OWNER THREAD. Hand a job to the writer; the thread is started on the first one. */
    void add(std::shared_ptr<Job> job) {
        std::lock_guard<std::mutex> lock(mx_);
        if (stopping_ || job == nullptr) return;
        if (std::find(jobs_.begin(), jobs_.end(), job) == jobs_.end()) jobs_.push_back(std::move(job));
        if (!thread_.joinable()) thread_ = std::thread([this] { run(); });
    }

    /** OWNER THREAD. Take a job back: on return the writer is not inside its pump() and never enters it again. */
    void remove(const Job* job) {
        std::unique_lock<std::mutex> lock(mx_);
        jobs_.erase(std::remove_if(jobs_.begin(), jobs_.end(),
                                   [job](const auto& j) { return j.get() == job; }),
                    jobs_.end());
        std::erase(finishing_, job);
        idle_.wait(lock, [this, job] { return current_ != job; });
    }

    /** OWNER THREAD, never waits: the writer pumps the job once more, finishes it and lets go — holds() turns false then. */
    void finish(const Job* job) {
        std::lock_guard<std::mutex> lock(mx_);
        if (!heldLocked(job)) return;
        if (std::find(finishing_.begin(), finishing_.end(), job) == finishing_.end()) finishing_.push_back(job);
    }

    /** Whether the writer holds this job — the owner must not touch what the job pumps while it does. */
    bool holds(const Job* job) const {
        std::lock_guard<std::mutex> lock(mx_);
        return heldLocked(job);
    }

    size_t size() const {
        std::lock_guard<std::mutex> lock(mx_);
        return jobs_.size();
    }

    /** Passes the thread has made over its jobs — what a test waits on rather than a sleep. */
    size_t passes() const {
        std::lock_guard<std::mutex> lock(mx_);
        return passes_;
    }

    /** Stop and join; a job being finished is finished here, the others are dropped unpumped. */
    void stop() {
        {
            std::lock_guard<std::mutex> lock(mx_);
            stopping_ = true;
        }
        wake_.notify_all();
        if (thread_.joinable()) thread_.join();
        std::vector<std::shared_ptr<Job>> last;
        {
            std::lock_guard<std::mutex> lock(mx_);
            for (auto& job : jobs_)
                if (std::find(finishing_.begin(), finishing_.end(), job.get()) != finishing_.end()) last.push_back(job);
            jobs_.clear();
            finishing_.clear();
        }
        // A stop pressed just before the engine quit still closes its take: the one place a disk wait is the caller's.
        for (auto& job : last) runGuarded(*job, true);
    }

private:
    void run() {
        std::vector<std::shared_ptr<Job>> pass;
        std::unique_lock<std::mutex> lock(mx_);
        while (!stopping_) {
            wake_.wait_for(lock, period_, [this] { return stopping_; });
            if (stopping_) break;
            pass = jobs_;
            for (auto& job : pass) {
                // A job removed since the copy is its owner's again, and must not be entered.
                if (stopping_) break;
                if (std::find(jobs_.begin(), jobs_.end(), job) == jobs_.end()) continue;
                // Read BEFORE the pump, so the pump that precedes a finish started after finish() was asked.
                const bool last = std::find(finishing_.begin(), finishing_.end(), job.get()) != finishing_.end();
                current_ = job.get();
                lock.unlock();
                runGuarded(*job, last);
                lock.lock();
                current_ = nullptr;
                if (last) {
                    std::erase(jobs_, job);
                    std::erase(finishing_, job.get());
                }
                idle_.notify_all();
            }
            ++passes_;
            // Released with the lock held off: a job's last owner may be this copy, and its teardown is no business of the lock.
            lock.unlock();
            pass.clear();
            lock.lock();
        }
    }

    bool heldLocked(const Job* job) const {
        return std::any_of(jobs_.begin(), jobs_.end(), [job](const auto& j) { return j.get() == job; });
    }

    static void runGuarded(Job& job, bool last) {
        try {
            job.pump();
            if (last) job.finish();
        } catch (const std::exception& e) {
            std::cerr << "[rec] writer: " << e.what() << '\n';
        } catch (...) {
            std::cerr << "[rec] writer: unknown exception\n";
        }
    }

    const std::chrono::milliseconds period_;
    mutable std::mutex mx_;
    std::condition_variable wake_;   // the period, cut short by stop()
    std::condition_variable idle_;   // a remove() waiting for the job being pumped
    std::vector<std::shared_ptr<Job>> jobs_;
    std::vector<const Job*> finishing_;   // jobs finish() handed back to the writer for a last pump
    const Job* current_ = nullptr;
    size_t passes_ = 0;
    bool stopping_ = false;
    std::thread thread_;
};

}  // namespace studio
