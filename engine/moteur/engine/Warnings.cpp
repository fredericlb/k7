// See Warnings.h.

#include "Warnings.h"

#include <iostream>

namespace studio {

namespace {
std::function<void(const Warning&)> g_sink;
// thread_local, so the message thread's current session cannot be read by the audio or scan threads
// — which have none, and whose warnings are genuinely nobody's project.
thread_local std::string g_session;
}

void setWarningSink(std::function<void(const Warning&)> sink) {
    g_sink = std::move(sink);
}

WarningScope::WarningScope(std::string session) : previous_(g_session) {
    g_session = std::move(session);
}

// Restores rather than clears, so nesting two scopes leaves the outer one intact.
WarningScope::~WarningScope() { g_session = std::move(previous_); }

void warn(std::string message, std::string subject) {
    // stderr first, and unconditionally: the sink can throw, be absent, or belong to a
    // client that has gone away, and none of that should cost the log its line.
    std::cerr << "warning: " << message;
    if (!subject.empty())
        std::cerr << " (for '" << subject << "')";
    std::cerr << std::endl;

    if (g_sink)
        g_sink(Warning{std::move(subject), std::move(message), g_session});
}

}  // namespace studio
