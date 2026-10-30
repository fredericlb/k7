// CrashLoop.h — when an engine that died unasked is started again, and in which mode. A death within
// kQuick of its start is a QUICK crash; quick crashes in a row back off 0, 2, 4… up to 30 s, and from
// the kSafeModeAfter-th the engine is started in SAFE MODE, which loads no external plugin. A death
// after a long run starts the count again. The one thing a reader would get wrong: safe mode is never
// left on its own, only by a start the user asks for or a new supervisor — docs/crashLoop.md.

#pragma once

#include <chrono>

namespace k7 {

class CrashLoop {
public:
    using Clock = std::chrono::steady_clock;
    using Time = Clock::time_point;

    static constexpr std::chrono::seconds kQuick{60};
    static constexpr int kSafeModeAfter = 3;
    static constexpr int kBackoffMaxS = 30;
    /** A message thread silent this long is wedged: past the engine's own 60 s exit, for the engine that cannot leave (docs/crashLoop.md). */
    static constexpr double kWedgedMs = 90000.0;

    /** Whether the `messageThreadMs` a whoami reports says the engine is up but frozen, and must be killed to be relaunched. */
    static bool wedged(double messageThreadMs) { return messageThreadMs >= kWedgedMs; }

    /** The engine is up, spawned or adopted. */
    void started(Time now);
    /** The engine that was up is gone, unasked; once per death. */
    void died(Time now);
    /** A start did not bring an engine up: backed off, but no crash, so never a way into safe mode. */
    void startFailed(Time now);
    /** The user started or stopped the engine: normal mode, nothing counted. */
    void reset();

    /** Whether an engine was up when last seen, so a death not yet counted is one. */
    bool up() const { return up_; }
    /** Whether a relaunch may go now. */
    bool due(Time now) const { return now >= until_; }
    /** Whether the next start is, and the running engine was, in safe mode. */
    bool safeMode() const { return safe_; }
    /** Quick crashes in a row. */
    int quickCrashes() const { return quick_; }

private:
    Time startedAt_{};
    Time until_{};
    int quick_ = 0;
    int failures_ = 0;
    bool up_ = false;
    bool safe_ = false;
};

}  // namespace k7
