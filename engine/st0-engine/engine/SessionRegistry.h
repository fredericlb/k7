#pragma once

// The engine's sessions by id, behind a lock covering the MAP and never a session's contents, and JUCE-free so the fast test binary can build it — docs/sessions.md.

#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace studio {

template <typename T>
class SessionRegistry {
public:
    /** MESSAGE THREAD. The session by that id, created empty if it is new. */
    T& emplace(const std::string& id, bool* created = nullptr) {
        std::lock_guard<std::mutex> lock(mx_);
        auto& slot = map_[id];
        if (created) *created = !slot;
        if (!slot) slot = std::make_unique<T>();
        // Safe past the lock: std::map never invalidates a reference to an existing element, and only the message thread erases.
        return *slot;
    }

    /** MESSAGE THREAD. …or nullptr. For readers that must not conjure a session by asking about one. */
    T* find(const std::string& id) {
        std::lock_guard<std::mutex> lock(mx_);
        auto it = map_.find(id);
        return it == map_.end() ? nullptr : it->second.get();
    }

    /** ANY THREAD. Runs `fn(T&)` under the lock and says whether it ran — the reference never escapes, and `fn` must not re-enter or outlast the lock (docs/sessions.md). */
    template <typename F>
    bool withSession(const std::string& id, F&& fn) {
        std::lock_guard<std::mutex> lock(mx_);
        auto it = map_.find(id);
        if (it == map_.end()) return false;
        fn(*it->second);
        return true;
    }

    /** MESSAGE THREAD. Forget a session entirely — its Edit, plugins, meters and taps. */
    void erase(const std::string& id) {
        // Taken out under the lock and destroyed after it: a session's teardown is not what the sender thread should wait on.
        std::unique_ptr<T> gone;
        {
            std::lock_guard<std::mutex> lock(mx_);
            auto it = map_.find(id);
            if (it == map_.end()) return;
            gone = std::move(it->second);
            map_.erase(it);
        }
    }

    /** Which sessions exist, copied out so the caller can walk them without holding the lock. */
    std::vector<std::string> ids() const {
        std::lock_guard<std::mutex> lock(mx_);
        std::vector<std::string> out;
        out.reserve(map_.size());
        for (const auto& [id, _] : map_) out.push_back(id);
        return out;
    }

    size_t size() const {
        std::lock_guard<std::mutex> lock(mx_);
        return map_.size();
    }

private:
    mutable std::mutex mx_;
    std::map<std::string, std::unique_ptr<T>> map_;
};

}  // namespace studio
