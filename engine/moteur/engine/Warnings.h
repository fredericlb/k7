#pragma once

// Engine diagnostics that have to reach a HUMAN, not just stderr.
//
// A warning printed to stderr is invisible in the normal case: the tray adopts an engine
// it did not spawn, so nothing captures its output. That is how a Neural Amp Modeler
// silently refusing its model — "unsupported version 0.7.0", the one line that explained
// why a plugin passed audio through untouched — cost an afternoon to find. The plugin was
// in the chain, the module looked healthy, and the only evidence was on a pipe nobody read.
//
// So: warn() still writes stderr (the log file, when there IS one, stays complete), and
// ALSO hands the warning to whatever sink is installed — the server installs one that
// broadcasts to every connected client. `subject` is what the warning is ABOUT, usually a
// PluginDoc id ("chain:module"), so a surface can attach it to the thing on screen rather
// than dumping a string in a corner.

#include <functional>
#include <string>

namespace studio {

struct Warning {
    std::string subject;  // what it is about — a plugin id, a clip path, "" when general
    std::string message;
    std::string session;  // which project it happened in, "" when it belongs to no one
};

// Report a problem. Always reaches stderr; also reaches the sink when one is set.
void warn(std::string message, std::string subject = {});

// Names the session that warnings raised on THIS thread belong to, for as long as it is in scope.
// A scope rather than a parameter because warn() is called from a dozen places that have no session
// to pass — see docs/sessions.md for which entry points open one and why the rest go unstamped.
class WarningScope {
public:
    explicit WarningScope(std::string session);
    ~WarningScope();
    WarningScope(const WarningScope&) = delete;
    WarningScope& operator=(const WarningScope&) = delete;

private:
    std::string previous_;
};

// Install (or clear, with {}) the sink. Called once by the server. Not thread-safe by
// design: it is set before any client connects and never changes after.
void setWarningSink(std::function<void(const Warning&)> sink);

}  // namespace studio
