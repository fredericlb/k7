// PidFile_test.cpp — the pidfile as an identity: both formats read, and a pid the OS gave to another
// program is never judged to be the engine.

#include "PidFile.h"
#include "Processes.h"

#include "test_harness.h"

using namespace k7::pidfile;

namespace {

void aBarePidStillReadsButUnverified()
{
    const auto r = parse("4242\n");
    CHECK(r.pid == 4242);
    CHECK(r.start.empty());
    CHECK(!r.verified());
    CHECK(parse("  77").pid == 77);
}

void theExtendedFormatRoundTrips()
{
    Record r;
    r.pid = 123;
    r.start = "1760000000";
    r.exe = "/Applications/k7.app/Contents/Resources/k7-runtime";
    r.port = 8767;
    const auto back = parse(format(r));
    CHECK(back.pid == 123);
    CHECK(back.start == r.start);
    CHECK(back.exe == r.exe);
    CHECK(back.port == 8767);
    CHECK(back.verified());
    // The pid leads, so a reader taking only the leading number still finds it.
    CHECK(format(r).rfind("123\n", 0) == 0);
}

void garbageIsNoPid()
{
    CHECK(parse("").pid == 0);
    CHECK(parse("abc\n").pid == 0);
    CHECK(parse("-5\n").pid == 0);
    CHECK(parse("99999999999999\n").pid == 0);
    CHECK(parse("12\nstart=nope\n").start.empty());
    // No port, or one that is none, is the settings' first port to whoever reads it.
    CHECK(parse("12\n").port == 0);
    CHECK(parse("12\nport=x\n").port == 0);
    CHECK(parse("12\nport=70000\n").port == 0);
    CHECK(parse("12\nport=0\n").port == 0);
}

void theEngineIsKnownByItsName()
{
    CHECK(isEngineExecutable("/opt/k7/k7-runtime"));
    CHECK(isEngineExecutable("C:\\Program Files\\k7\\K7-Runtime.exe"));
    CHECK(!isEngineExecutable("/usr/bin/k7-runtime-helper"));
    CHECK(!isEngineExecutable("/bin/bash"));
    CHECK(!isEngineExecutable(""));
}

Record rec(int pid, const std::string& start, const std::string& exe)
{
    Record r;
    r.pid = pid;
    r.start = start;
    r.exe = exe;
    return r;
}

void onlyTheSameStartAndTheEngineAreSame()
{
    const auto engine = rec(10, "500", "/x/k7-runtime");
    CHECK(check(engine, engine, true) == Check::Same);
    CHECK(check(engine, rec(10, "501", "/x/k7-runtime"), true) == Check::Stale);
    CHECK(check(engine, rec(10, "500", "/usr/bin/vim"), true) == Check::Stale);
    CHECK(check(engine, std::nullopt, false) == Check::Stale);
    CHECK(check(engine, std::nullopt, true) == Check::Unverified);
    CHECK(check(rec(10, "", ""), rec(10, "500", "/x/k7-runtime"), true) == Check::Unverified);
    CHECK(check(rec(10, "", ""), rec(10, "500", "/usr/bin/vim"), true) == Check::Stale);
    CHECK(check(rec(0, "", ""), std::nullopt, true) == Check::Stale);
}

// This test binary is alive, described the same way twice, and is no engine.
void aLiveProcessIsDescribedAndIsNotTheEngine()
{
    const int self = k7::process::currentPid();
    const auto a = inspect(self);
    const auto b = inspect(self);
    CHECK(a.has_value() && b.has_value());
    if (!a || !b) return;
    CHECK(!a->start.empty());
    CHECK(a->start == b->start);
    CHECK(!a->exe.empty());
    CHECK(check(*a, a, true) == Check::Stale);
    CHECK(!inspect(0));
}

}  // namespace

void runPidFileTests()
{
    RUN(aBarePidStillReadsButUnverified);
    RUN(theExtendedFormatRoundTrips);
    RUN(garbageIsNoPid);
    RUN(theEngineIsKnownByItsName);
    RUN(onlyTheSameStartAndTheEngineAreSame);
    RUN(aLiveProcessIsDescribedAndIsNotTheEngine);
}
