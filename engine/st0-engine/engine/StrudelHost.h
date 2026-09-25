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

/** One note of one lane, in CYCLES; the caller turns cycles into time with the edit's tempo and metre. */
struct LaneNote {
    double cycle = 0.0;
    double dur = 0.0;
    int key = 60;
    float vel = 0.9f;
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

    /** The notes whose onset lies in [from, to) cycles, for `label` (empty: every event). */
    std::vector<LaneNote> laneNotes(double from, double to, const std::string& label, std::string& error);

    /** Bytes the JS heap holds. */
    std::size_t memoryBytes();

    /** Wall-clock budget for one call into JS; a pattern that loops forever is cut off by it. */
    void setDeadlineMs(double ms) { deadlineMs_ = ms; }

private:
    static int interrupt(JSRuntime*, void* opaque);

    std::mutex lock_;
    JSRuntime* rt_ = nullptr;
    JSContext* ctx_ = nullptr;
    bool ready_ = false;
    std::string bootError_;
    double deadlineMs_ = 250.0;
    double deadlineAt_ = 0.0;
};

}  // namespace studio
