// Unit tests for HangWatch.h — when a stuck callback or a silent message thread counts as hung, once
// per hang, and never right after the process slept. JUCE-free, so it builds in seconds (../docs/hangWatch.md).

#include "HangWatch.h"
#include "test_harness.h"

#include <atomic>
#include <chrono>
#include <cstdint>
#include <thread>

using namespace studio;

namespace {

struct FakeClocks {
    std::uint32_t now = 1000;
    std::uint32_t entered = 0;
    std::uint32_t heartbeat = 0;
    HangWatchdog::Clocks clocks() {
        return {[this] { return now; }, [this] { return entered; }, [this] { return heartbeat; }};
    }
};

void ages_wrap_and_never_go_negative() {
    CHECK(ageMs(5000, 0) == 0);
    CHECK(ageMs(5000, 5001) == 0);
    CHECK(ageMs(5000, 4000) == 1000);
    // The counter wraps at 2^32 ms: a stamp just before the wrap is still a few ms old just after it.
    CHECK(ageMs(10u, 0xFFFFFFF0u) == 26);
}

void the_verdicts() {
    CHECK(judgeHang(100000, 0, 0) == Hang::none);
    CHECK(judgeHang(100000, 100000 - kStuckCallbackMs + 1, 0) == Hang::none);
    CHECK(judgeHang(100000, 100000 - kStuckCallbackMs, 0) == Hang::callback);
    CHECK(judgeHang(100000, 0, 100000 - kStuckMessageThreadMs + 1) == Hang::none);
    CHECK(judgeHang(100000, 0, 100000 - kStuckMessageThreadMs) == Hang::messageThread);
    // Both: the callback is named, since it is what the message thread is likely waiting on.
    CHECK(judgeHang(100000, 1, 1) == Hang::callback);
}

void a_hang_is_reported_once_and_again_after_recovery() {
    FakeClocks c;
    HangWatchdog w;
    w.setClocks(c.clocks());
    c.heartbeat = c.now;
    CHECK(w.step() == Hang::none);
    for (std::uint32_t s = 1; s <= kStuckMessageThreadMs / 1000; ++s) {
        c.now += 1000;
        const Hang h = w.step();
        CHECK(h == (s == kStuckMessageThreadMs / 1000 ? Hang::messageThread : Hang::none));
    }
    c.now += 1000;
    CHECK(w.step() == Hang::none);   // already said
    c.heartbeat = c.now;
    c.now += 1000;
    CHECK(w.step() == Hang::none);   // recovered
    c.entered = c.now;
    for (std::uint32_t s = 1; s <= kStuckCallbackMs / 1000; ++s) {
        c.now += 1000;
        c.heartbeat = c.now;
        const Hang h = w.step();
        CHECK(h == (s == kStuckCallbackMs / 1000 ? Hang::callback : Hang::none));
    }
}

void a_process_that_slept_is_given_grace() {
    FakeClocks c;
    HangWatchdog w;
    w.setClocks(c.clocks());
    c.heartbeat = c.now;
    CHECK(w.step() == Hang::none);
    // An hour asleep: every clock looks ancient on waking, and nothing is hung.
    c.now += 3600 * 1000;
    for (int i = 0; i < kGraceSteps; ++i) {
        CHECK(w.step() == Hang::none);
        c.now += 1000;
        if (i == 2) c.heartbeat = c.now;   // the message thread ticks again a few looks later
    }
    CHECK(w.step() == Hang::none);
}

void the_thread_reports_and_stops() {
    // Hung from the very first look, so no clock has to move under the thread.
    std::atomic<std::uint32_t> now{1 + kStuckCallbackMs};
    std::atomic<int> reports{0};
    HangWatchdog w;
    w.start(std::chrono::milliseconds(1),
            {[&] { return now.load(); }, [] { return std::uint32_t{1}; }, [] { return std::uint32_t{0}; }},
            [&](Hang h) {
                if (h == Hang::callback) reports.fetch_add(1);
            });
    const auto until = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (reports.load() == 0 && std::chrono::steady_clock::now() < until)
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    w.stop();
    CHECK(reports.load() == 1);
}

}  // namespace

int main() {
    RUN(ages_wrap_and_never_go_negative);
    RUN(the_verdicts);
    RUN(a_hang_is_reported_once_and_again_after_recovery);
    RUN(a_process_that_slept_is_given_grace);
    RUN(the_thread_reports_and_stops);
    TEST_MAIN_END();
}
