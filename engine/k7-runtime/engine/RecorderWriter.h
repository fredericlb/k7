// RecorderWriter.h — the ONE thread that moves recorder rings onto disk, so a take is written
// while the message thread is busy building a graph or compiling Faust. JUCE-free and
// header-only, so tests/ has it in the fast binary. See docs/recorder.md.
//
// What a reader gets wrong: it holds the NODES, never the session map. A job is either the
// writer's (registered) or its owner's (removed), and remove() returns only once the writer is out.

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
        idle_.wait(lock, [this, job] { return current_ != job; });
    }

    /** Whether the writer holds this job — the owner must not touch what the job pumps while it does. */
    bool holds(const Job* job) const {
        std::lock_guard<std::mutex> lock(mx_);
        return std::any_of(jobs_.begin(), jobs_.end(), [job](const auto& j) { return j.get() == job; });
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

    /** Stop and join; the jobs are dropped unpumped, so an owner wanting a last write removes them first. */
    void stop() {
        {
            std::lock_guard<std::mutex> lock(mx_);
            stopping_ = true;
        }
        wake_.notify_all();
        if (thread_.joinable()) thread_.join();
        std::lock_guard<std::mutex> lock(mx_);
        jobs_.clear();
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
                current_ = job.get();
                lock.unlock();
                try {
                    job->pump();
                } catch (const std::exception& e) {
                    std::cerr << "[rec] writer: " << e.what() << '\n';
                } catch (...) {
                    std::cerr << "[rec] writer: unknown exception\n";
                }
                lock.lock();
                current_ = nullptr;
                idle_.notify_all();
            }
            ++passes_;
            // Released with the lock held off: a job's last owner may be this copy, and its teardown is no business of the lock.
            lock.unlock();
            pass.clear();
            lock.lock();
        }
    }

    const std::chrono::milliseconds period_;
    mutable std::mutex mx_;
    std::condition_variable wake_;   // the period, cut short by stop()
    std::condition_variable idle_;   // a remove() waiting for the job being pumped
    std::vector<std::shared_ptr<Job>> jobs_;
    const Job* current_ = nullptr;
    size_t passes_ = 0;
    bool stopping_ = false;
    std::thread thread_;
};

}  // namespace studio
