// The stalled-callback decision. JUCE-free, so it runs in a fast binary; the reopen it asks for
// needs a live device no suite here opens, which `audio-cost` checks by hand instead.
//
// What would be wrong SILENTLY: a watchdog that reopens a healthy device (a counter reset read as
// a stall), and one that retries a driver another application holds for ever. See
// ../docs/audioDevice.md.

#include "CallbackWatchdog.h"

#include "test_harness.h"

using studio::CallbackWatchdog;
using Action = CallbackWatchdog::Action;

namespace {

void a_counter_that_moves_is_never_touched()
{
    CallbackWatchdog w;
    for (long long runs = 0; runs < 50; runs += 188)
        CHECK(w.check(true, runs) == Action::none);
}

void the_first_check_is_only_a_baseline()
{
    CallbackWatchdog w;
    CHECK(w.check(true, 4598989) == Action::none);
    CHECK(w.check(true, 4599177) == Action::none);
}

void a_stall_is_acted_on_after_the_checks_it_is_given()
{
    CallbackWatchdog w;
    w.check(true, 100);
    for (int i = 1; i < CallbackWatchdog::kStalledChecks; ++i)
        CHECK(w.check(true, 100) == Action::none);
    CHECK(w.check(true, 100) == Action::reopen);
    CHECK(w.reopens() == 1);
}

void a_callback_after_a_reopen_reads_as_resumed_ONCE()
{
    CallbackWatchdog w;
    w.check(true, 100);
    w.check(true, 100);
    CHECK(w.check(true, 100) == Action::reopen);
    // The reopened device's statistics start again from zero: that is progress, not a stall.
    w.reopened(0);
    CHECK(w.check(true, 12) == Action::resumed);
    CHECK(w.check(true, 200) == Action::none);
    CHECK(w.reopens() == 0);
}

void it_gives_up_after_the_last_reopen_and_says_so_once()
{
    CallbackWatchdog w;
    w.check(true, 7);
    int reopens = 0;
    int giveUps = 0;
    for (int i = 0; i < 40; ++i) {
        const auto a = w.check(true, 7);
        if (a == Action::reopen) ++reopens;
        if (a == Action::giveUp) ++giveUps;
    }
    CHECK(reopens == CallbackWatchdog::kMaxReopens);
    CHECK(giveUps == 1);
    // …and a device that comes back on its own is still noticed.
    CHECK(w.check(true, 8) == Action::resumed);
}

void a_closed_device_is_not_a_stall_and_forgets_the_history()
{
    CallbackWatchdog w;
    w.check(true, 5);
    w.check(true, 5);
    CHECK(w.check(true, 5) == Action::reopen);
    CHECK(w.check(false, 0) == Action::none);
    CHECK(w.reopens() == 0);
    // Reopened later: a fresh baseline, not a stall carried over.
    CHECK(w.check(true, 5) == Action::none);
    CHECK(w.check(true, 5) == Action::none);
}

}  // namespace

int main()
{
    RUN(a_counter_that_moves_is_never_touched);
    RUN(the_first_check_is_only_a_baseline);
    RUN(a_stall_is_acted_on_after_the_checks_it_is_given);
    RUN(a_callback_after_a_reopen_reads_as_resumed_ONCE);
    RUN(it_gives_up_after_the_last_reopen_and_says_so_once);
    RUN(a_closed_device_is_not_a_stall_and_forgets_the_history);
    TEST_MAIN_END();
}
