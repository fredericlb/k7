#pragma once

// The engine's sessions, by id, behind a lock that covers the MAP and never a session's contents.
// JUCE-free on purpose: it holds no audio state, so tests/SessionRegistry_test.cpp builds it into the
// fast binary. Who may create, who may only look, and why the lock is this narrow: docs/sessions.md.

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
        // Safe past the lock: std::map never invalidates a reference to an existing element, and only
        // the message thread erases — so nothing can free this while the message thread holds it.
        return *slot;
    }

    /** MESSAGE THREAD. …or nullptr. For readers that must not conjure a session by asking about one. */
    T* find(const std::string& id) {
        std::lock_guard<std::mutex> lock(mx_);
        auto it = map_.find(id);
        return it == map_.end() ? nullptr : it->second.get();
    }

    /**
     * ANY THREAD. Runs `fn(T&)` under the lock, or nothing at all when there is no such session;
     * returns whether it ran. The reference is handed out INSIDE the lock so a thread that is not the
     * message thread cannot keep it afterwards — which is the whole reason this is not a find().
     * Do not call back into the registry from `fn`, and keep it to the work the lock is meant to
     * cover: nobody may hold this while an Edit is rebuilt.
     */
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
        std::lock_guard<std::mutex> lock(mx_);
        map_.erase(id);
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
