// See Warnings.h.

#include "Warnings.h"

#include <algorithm>
#include <iostream>
#include <map>
#include <mutex>

namespace studio {

namespace {
std::mutex g_sinkMx;   // set on the message thread, read from any thread that warns
std::function<void(const Warning&)> g_sink;
// thread_local, so the audio and scan threads cannot read the message thread's session — their warnings are genuinely nobody's project.
thread_local std::string g_session;
// Whether this thread is inside a build, whose warnings outlive the moment they were sent.
thread_local bool g_building = false;
// The standing warnings per session, read off the message thread by a `hello`, hence the lock.
std::mutex g_standingMx;
std::map<std::string, std::vector<Warning>> g_standing;
// A bound, so a project of a thousand broken plugins cannot grow the replay without limit.
constexpr size_t kMaxStanding = 64;

void keepStanding(const Warning& w) {
    std::lock_guard<std::mutex> lk(g_standingMx);
    auto& list = g_standing[w.session];
    // One per subject, the latest winning, as a surface shows them; a general one is told apart by its text.
    const auto same = [&](const Warning& x) {
        return w.subject.empty() ? x.subject.empty() && x.message == w.message : x.subject == w.subject;
    };
    list.erase(std::remove_if(list.begin(), list.end(), same), list.end());
    if (list.size() < kMaxStanding) list.push_back(w);
}
}

BuildScope::BuildScope(const std::string& session, bool fresh) : previous_(g_building) {
    g_building = true;
    if (fresh) clearStandingWarnings(session);
}

BuildScope::~BuildScope() { g_building = previous_; }

std::vector<Warning> standingWarnings(const std::string& session) {
    std::lock_guard<std::mutex> lk(g_standingMx);
    const auto it = g_standing.find(session);
    return it == g_standing.end() ? std::vector<Warning>{} : it->second;
}

void clearStandingWarnings(const std::string& session) {
    std::lock_guard<std::mutex> lk(g_standingMx);
    g_standing.erase(session);
}

void setWarningSink(std::function<void(const Warning&)> sink) {
    std::lock_guard<std::mutex> lk(g_sinkMx);
    g_sink = std::move(sink);
}

WarningScope::WarningScope(std::string session) : previous_(g_session) {
    g_session = std::move(session);
}

// Restores rather than clears, so nesting two scopes leaves the outer one intact.
WarningScope::~WarningScope() { g_session = std::move(previous_); }

void warn(std::string message, std::string subject) {
    // stderr first and unconditionally: the sink can throw, be absent or belong to a client that has gone, and none of that may cost the log its line.
    std::cerr << "warning: " << message;
    if (!subject.empty())
        std::cerr << " (for '" << subject << "')";
    std::cerr << std::endl;

    // Kept before the sink is tried: a page that connects after this build still has to learn it.
    if (g_building && !g_session.empty()) {
        try {
            keepStanding(Warning{subject, message, g_session});
        } catch (...) {
            std::cerr << "warning: could not be kept for later clients" << std::endl;
        }
    }

    std::function<void(const Warning&)> sink;
    {
        std::lock_guard<std::mutex> lk(g_sinkMx);
        sink = g_sink;
    }
    if (!sink) return;
    // A warning is raised from destructors and worker threads alike, where an exception would be std::terminate.
    try {
        sink(Warning{std::move(subject), std::move(message), g_session});
    } catch (const std::exception& e) {
        std::cerr << "warning: could not be sent to clients: " << e.what() << std::endl;
    } catch (...) {
        std::cerr << "warning: could not be sent to clients" << std::endl;
    }
}

}  // namespace studio
