// See Warnings.h.

#include "Warnings.h"

#include <iostream>
#include <mutex>

namespace studio {

namespace {
std::mutex g_sinkMx;   // set on the message thread, read from any thread that warns
std::function<void(const Warning&)> g_sink;
// thread_local, so the audio and scan threads cannot read the message thread's session — their warnings are genuinely nobody's project.
thread_local std::string g_session;
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
