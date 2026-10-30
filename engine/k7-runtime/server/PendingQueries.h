// PendingQueries.h — which read-only queries already wait on the message thread, so an identical one
// is not queued behind them: their answer is broadcast, so the waiting one answers the asker too.
// JUCE-free and header-only, so tests/ has it in a fast binary (docs/supersede.md).
// What reads wrong: a key leaves as its job STARTS, so a query asked while one runs is queued again.

#pragma once

#include <cstddef>
#include <mutex>
#include <string>
#include <unordered_set>

namespace studio {

class PendingQueries {
public:
    // True when no identical query waits, and it now does: post the job, and have it call started() first.
    bool admit(const std::string& key) {
        std::lock_guard<std::mutex> lock(mx_);
        return waiting_.insert(key).second;
    }

    // The job for `key` began: the next identical query is queued, since what it would read may have changed.
    void started(const std::string& key) {
        std::lock_guard<std::mutex> lock(mx_);
        waiting_.erase(key);
    }

    std::size_t size() const {
        std::lock_guard<std::mutex> lock(mx_);
        return waiting_.size();
    }

private:
    mutable std::mutex mx_;
    std::unordered_set<std::string> waiting_;
};

}  // namespace studio
