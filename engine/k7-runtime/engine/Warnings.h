#pragma once

// Engine diagnostics that have to reach a HUMAN and not just stderr, which in the normal case nobody is reading — docs/audit-stabilite.md.

#include <functional>
#include <string>
#include <vector>

namespace studio {

struct Warning {
    std::string subject;  // usually a PluginDoc id ("chain:module"), so a surface can attach it to the thing on screen; "" when general
    std::string message;
    std::string session;  // which project it happened in, "" when it belongs to no one
};

// Report a problem. Always reaches stderr; also reaches the sink when one is set.
void warn(std::string message, std::string subject = {});

// Names the session that warnings raised on THIS thread belong to — a scope rather than a parameter, since warn() is called from a dozen places with none to pass.
class WarningScope {
public:
    explicit WarningScope(std::string session);
    ~WarningScope();
    WarningScope(const WarningScope&) = delete;
    WarningScope& operator=(const WarningScope&) = delete;

private:
    std::string previous_;
};

// Install (or clear, with {}) the sink; called once by the server and not thread-safe by design, being set before any client connects.
void setWarningSink(std::function<void(const Warning&)> sink);

// Marks what THIS thread warns, under a WarningScope, as the STANDING warnings of that session's build; `fresh` drops the last build's first (docs/sessions.md).
class BuildScope {
public:
    BuildScope(const std::string& session, bool fresh);
    ~BuildScope();
    BuildScope(const BuildScope&) = delete;
    BuildScope& operator=(const BuildScope&) = delete;

private:
    bool previous_;
};

// What the project `session` holds was built with, one per subject (or per message when it has none), oldest first.
std::vector<Warning> standingWarnings(const std::string& session);

// Forget them — the project they were about is gone.
void clearStandingWarnings(const std::string& session);

}  // namespace studio
