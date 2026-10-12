// StrudelHost.h — one QuickJS runtime holding the embedded Strudel bundle and ONE evaluated pattern; JUCE-free.
// Never call it from the audio thread: a query can hit a GC pause of tens of ms (docs/patternPlugin.md).
// Callable from any other thread, one caller at a time — every entry takes the lock and re-anchors QuickJS's stack check.

#pragma once

#include <cstddef>
#include <mutex>
#include <string>
#include <vector>

struct JSRuntime;
struct JSContext;

namespace studio {

/** One event of one lane, in CYCLES; the caller turns cycles into time with the edit's tempo and metre. */
struct LaneEvent {
    double cycle = 0.0;
    double dur = 0.0;
    int key = 60;      // the pitch it plays at if it is a NOTE
    float vel = 0.9f;
    std::string s;     // the sound name, tried as a sample first; empty when the event names none
    int n = 0;         // the sample variant
};

class StrudelHost {
public:
    /** Boots the runtime and evaluates the embedded bundle — tens of ms, so not on the message thread either. */
    StrudelHost();
    ~StrudelHost();
    StrudelHost(const StrudelHost&) = delete;
    StrudelHost& operator=(const StrudelHost&) = delete;

    /** False if the bundle failed to evaluate, with the reason in `bootError()`; nothing else works then. */
    bool ready() const { return ready_; }
    const std::string& bootError() const { return bootError_; }

    /** Evaluates a pattern file's source; on failure the previous pattern stays current and `error` says why. */
    bool loadPattern(const std::string& code, std::string& error);

    /** The lane's events with an onset in [from, to) cycles: `label`'s, plus every unclaimed one when `catchAll`. */
    std::vector<LaneEvent> laneEvents(double from, double to, const std::string& label, bool catchAll,
                                      const std::vector<std::string>& claimed, std::string& error);

    /** The labels the pattern uses in [from, to) cycles, as written. */
    std::vector<std::string> labels(double from, double to);

    /** Wall-clock budget for one call into JS; a pattern that loops forever is cut off by it. */
    void setDeadlineMs(double ms) { deadlineMs_ = ms; }

    /** The C stack JS may use on the CALLING thread; a thread that sized its own stack raises it, everyone else keeps the default. */
    static void setThreadStackBudget(std::size_t bytes);
    /** What a thread that never called setThreadStackBudget gets: safe on any thread JUCE or Tracktion starts (512 KiB on macOS). */
    static constexpr std::size_t kDefaultStackBudget = 256 * 1024;

private:
    static int interrupt(JSRuntime*, void* opaque);
    /** Re-anchor QuickJS's stack check on the calling thread, with that thread's budget. */
    void enterOnThisThread();
    friend struct JsonCall;

    std::mutex lock_;
    JSRuntime* rt_ = nullptr;
    JSContext* ctx_ = nullptr;
    bool ready_ = false;
    std::string bootError_;
    double deadlineMs_ = 250.0;
    double deadlineAt_ = 0.0;
};

}  // namespace studio
