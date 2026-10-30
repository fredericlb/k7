// CrashLoop_test.cpp — an engine dying at every start reaches safe mode at its third quick crash and
// backs off meanwhile, one that ran a while starts the count again, and a failed start is no crash.

#include "CrashLoop.h"

#include "test_harness.h"

using k7::CrashLoop;
using namespace std::chrono_literals;

namespace {

void quickCrashesReachSafeModeRun()
{
    CrashLoop c;
    auto t = CrashLoop::Time{} + 1000s;
    c.started(t);
    c.died(t + 2s);
    CHECK(c.quickCrashes() == 1);
    CHECK(!c.safeMode());
    CHECK(c.due(t + 2s));
    t += 2s;
    c.started(t);
    c.died(t + 2s);
    CHECK(c.quickCrashes() == 2);
    CHECK(!c.safeMode());
    CHECK(!c.due(t + 3s));
    CHECK(c.due(t + 4s));
    t += 4s;
    c.started(t);
    c.died(t + 2s);
    CHECK(c.quickCrashes() == 3);
    CHECK(c.safeMode());
    CHECK(!c.due(t + 5s));
    CHECK(c.due(t + 6s));
}

void backoffIsCappedRun()
{
    CrashLoop c;
    auto t = CrashLoop::Time{} + 1000s;
    for (int i = 0; i < 10; ++i) {
        c.started(t);
        c.died(t + 1s);
        t += 1s;
    }
    CHECK(!c.due(t + 29s));
    CHECK(c.due(t + 30s));
}

void aLongRunStartsTheCountAgainRun()
{
    CrashLoop c;
    auto t = CrashLoop::Time{} + 1000s;
    c.started(t);
    c.died(t + 1s);
    c.started(t + 1s);
    c.died(t + 2s);
    CHECK(c.quickCrashes() == 2);
    c.started(t + 4s);
    c.died(t + 4s + CrashLoop::kQuick);
    CHECK(c.quickCrashes() == 1);
    CHECK(c.due(t + 4s + CrashLoop::kQuick));
}

void safeModeOutlivesALongRunRun()
{
    CrashLoop c;
    auto t = CrashLoop::Time{} + 1000s;
    for (int i = 0; i < CrashLoop::kSafeModeAfter; ++i) {
        c.started(t);
        c.died(t + 1s);
        t += 60s;
    }
    CHECK(c.safeMode());
    c.started(t);
    c.died(t + 600s);
    CHECK(c.safeMode());
    c.reset();
    CHECK(!c.safeMode());
    CHECK(c.quickCrashes() == 0);
    CHECK(!c.up());
}

void aFailedStartIsNoCrashRun()
{
    CrashLoop c;
    auto t = CrashLoop::Time{} + 1000s;
    for (int i = 0; i < 5; ++i) c.startFailed(t);
    CHECK(c.quickCrashes() == 0);
    CHECK(!c.safeMode());
    CHECK(!c.due(t + 15s));
    CHECK(c.due(t + 16s));
    c.died(t);
    CHECK(c.quickCrashes() == 0);
}

void aWedgedEngineIsTheOneSilentPastTheBoundRun()
{
    CHECK(!CrashLoop::wedged(0.0));
    CHECK(!CrashLoop::wedged(60000.0));
    CHECK(!CrashLoop::wedged(CrashLoop::kWedgedMs - 1.0));
    CHECK(CrashLoop::wedged(CrashLoop::kWedgedMs));
}

}  // namespace

void runCrashLoopTests()
{
    RUN(aWedgedEngineIsTheOneSilentPastTheBoundRun);
    RUN(quickCrashesReachSafeModeRun);
    RUN(backoffIsCappedRun);
    RUN(aLongRunStartsTheCountAgainRun);
    RUN(safeModeOutlivesALongRunRun);
    RUN(aFailedStartIsNoCrashRun);
}
