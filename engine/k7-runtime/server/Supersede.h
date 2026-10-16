// Supersede.h — which queued jobs a newer message has made pointless before they ran, per session.
// JUCE-free and header-only, so tests/ has it in a FAST binary. The rule is docs/supersede.md.
// The one thing a reader would get wrong: a job is never REORDERED, only skipped, and the ticket is
// taken and the job posted under one lock, or two sockets could queue jobs in another order than the ledger saw.

#pragma once

#include <algorithm>
#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace studio {

class SupersedeLedger {
public:
    // True once a newer message has made the job pointless; read on the message thread when the job starts.
    using Ticket = std::shared_ptr<std::atomic<bool>>;

    static bool superseded(const Ticket& t) { return t != nullptr && t->load(std::memory_order_acquire); }

    // A whole document: it supersedes every document job of the session queued since its last barrier.
    template <typename PostFn>
    void postProject(const std::string& session, PostFn&& post) {
        std::lock_guard<std::mutex> lk(m_);
        auto& s = sessions_[session];
        for (auto& [key, t] : s.doc) mark(t);
        s.doc.clear();
        post(s.doc[kProjectKey] = fresh());
    }

    // A `tracks` delta: it supersedes only an earlier delta naming exactly the same tracks.
    template <typename PostFn>
    void postTracks(const std::string& session, std::vector<std::string> ids, PostFn&& post) {
        std::sort(ids.begin(), ids.end());
        ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
        std::string key = "tracks";
        for (const auto& id : ids) key += '\n' + id;
        std::lock_guard<std::mutex> lk(m_);
        auto& slot = sessions_[session].doc[key];
        mark(slot);
        post(slot = fresh());
    }

    // A live parameter write: it supersedes an earlier write to the same plugin's same parameter.
    template <typename PostFn>
    void postParam(const std::string& session, const std::string& plugin, const std::string& name,
                   PostFn&& post) {
        std::lock_guard<std::mutex> lk(m_);
        auto& slot = sessions_[session].params[plugin + '\n' + name];
        mark(slot);
        post(slot = fresh());
    }

    // Any other message about the session: nothing queued before it may be skipped for what comes after.
    void barrier(const std::string& session) {
        std::lock_guard<std::mutex> lk(m_);
        sessions_.erase(session);
    }

    // How many sessions hold pending tickets — for the tests, which check the ledger does not grow.
    size_t sessionCount() const {
        std::lock_guard<std::mutex> lk(m_);
        return sessions_.size();
    }

private:
    static constexpr const char* kProjectKey = "project";

    struct Pending {
        std::unordered_map<std::string, Ticket> doc;      // project / tracks, since the last barrier
        std::unordered_map<std::string, Ticket> params;   // plugin + param name, since the last barrier
    };

    static Ticket fresh() { return std::make_shared<std::atomic<bool>>(false); }
    static void mark(const Ticket& t) {
        if (t != nullptr) t->store(true, std::memory_order_release);
    }

    mutable std::mutex m_;
    std::unordered_map<std::string, Pending> sessions_;
};

}  // namespace studio
