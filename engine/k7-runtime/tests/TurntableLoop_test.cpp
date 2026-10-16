// The platter's loop arithmetic. JUCE-free, so it runs in the fast binary — and this is the only
// coverage the loop has, `applyToBuffer` needing a live te::Edit no suite here builds.
//
// What would be wrong SILENTLY: a roll that hands back where it started rather than where the
// record would have reached, and a wrap that clamps instead of wrapping — both play, and both
// leave the record somewhere nobody asked for. See ../docs/turntable.md.

#include "TurntableLoop.h"

#include "test_harness.h"

#include <cmath>

using studio::TurntableLoop;

namespace {

/** Close enough for a position in FRAMES: the arithmetic is doubles and the edges are exact. */
bool near(double a, double b, double eps = 1e-9)
{
    return std::fabs(a - b) < eps;
}

void loop_is_off_until_the_edges_are_apart()
{
    TurntableLoop l;
    CHECK(!l.active());
    l.aim(1000.0, 1000.0, false, 0.0);
    CHECK(!l.active());
    // A hair apart is a HANG, not a loop — the audio thread would spin inside it.
    l.aim(1000.0, 1004.0, false, 0.0);
    CHECK(!l.active());
    l.aim(1000.0, 2000.0, false, 0.0);
    CHECK(l.active());
    CHECK(near(l.length(), 1000.0));
}

void an_edge_wraps_rather_than_stopping()
{
    TurntableLoop l;
    l.aim(1000.0, 2000.0, false, 1500.0);
    // Forwards, out by the end.
    CHECK(near(l.step(1999.5, 1.0), 1000.5));
    // …and BACKWARDS out by the start, which a clamp would have parked at 1000.
    CHECK(near(l.step(1000.5, -1.0), 1999.5));
    // Nothing happens to a position already inside.
    CHECK(near(l.step(1500.0, 1.0), 1501.0));
}

void a_needle_dropped_far_outside_lands_INSIDE()
{
    TurntableLoop l;
    l.aim(1000.0, 2000.0, false, 1500.0);
    // Several loop-lengths away — one subtraction would not have been enough.
    CHECK(near(l.wrap(5300.0), 1300.0));
    CHECK(near(l.wrap(-1700.0), 1300.0));
}

void engaging_a_loop_pulls_the_needle_in()
{
    TurntableLoop l;
    // The record is at 8000 and the loop is aimed elsewhere: the needle goes to the loop.
    const auto at = l.aim(1000.0, 2000.0, false, 8000.0);
    CHECK(near(at, 1000.0));
}

void a_plain_loop_is_left_where_it_lands()
{
    TurntableLoop l;
    l.aim(1000.0, 2000.0, false, 1000.0);
    auto pos = 1000.0;
    for (int i = 0; i < 1500; ++i) pos = l.step(pos, 1.0);
    CHECK(near(pos, 1500.0));
    // Released: a loop that is not a roll stays exactly where the release found it.
    CHECK(near(l.aim(0.0, 0.0, false, pos), 1500.0));
}

void a_roll_hands_back_where_the_record_WOULD_have_reached()
{
    TurntableLoop l;
    l.aim(1000.0, 2000.0, true, 1000.0);
    auto pos = 1000.0;
    // Three and a half times round: the needle is mid-loop, the record is 3500 frames further on.
    for (int i = 0; i < 3500; ++i) pos = l.step(pos, 1.0);
    CHECK(near(pos, 1500.0));
    CHECK(near(l.aim(0.0, 0.0, false, pos), 4500.0));
    CHECK(!l.rolling());
}

void the_roll_decision_is_LATCHED_at_the_engage()
{
    TurntableLoop l;
    l.aim(1000.0, 2000.0, true, 1000.0);
    auto pos = 1000.0;
    for (int i = 0; i < 2500; ++i) pos = l.step(pos, 1.0);
    // `Roll` going back to 0 while the loop still runs must NOT turn a roll into a plain loop:
    // two params arrive one at a time, and this is the ordering race the latch exists to kill.
    l.aim(1000.0, 2000.0, false, pos);
    CHECK(l.rolling());
    CHECK(near(l.aim(0.0, 0.0, false, pos), 3500.0));
}

void a_roll_run_BACKWARDS_hands_back_a_position_behind_it()
{
    TurntableLoop l;
    l.aim(1000.0, 2000.0, true, 2000.0);
    auto pos = 2000.0;
    for (int i = 0; i < 1200; ++i) pos = l.step(pos, -1.0);
    // The shadow follows the same signed rate: a censored roll owes the record 1200 frames BACK.
    CHECK(near(l.aim(0.0, 0.0, false, pos), 800.0));
}

void halving_a_loop_UNDER_the_needle_brings_it_in()
{
    TurntableLoop l;
    l.aim(1000.0, 2000.0, false, 1000.0);
    auto pos = 1000.0;
    for (int i = 0; i < 800; ++i) pos = l.step(pos, 1.0);
    CHECK(near(pos, 1800.0));
    // The end moves in behind the needle — it wraps into the new half rather than playing on.
    CHECK(near(l.aim(1000.0, 1500.0, false, pos), 1300.0));
    // …and the loop is still the same one, so a roll's latch survives the resize.
    CHECK(l.active());
}

void the_shadow_only_moves_for_a_ROLL()
{
    TurntableLoop l;
    // Seeded at the engage either way — what a plain loop must not do is let it MOVE.
    l.aim(1000.0, 2000.0, false, 1000.0);
    l.carry(500.0);
    CHECK(near(l.shadow(), 1000.0));
    l.aim(0.0, 0.0, false, 1400.0);
    l.aim(1000.0, 2000.0, true, 1000.0);
    l.carry(500.0);
    CHECK(near(l.shadow(), 1500.0));
}

void with_no_loop_a_step_is_a_plain_advance()
{
    TurntableLoop l;
    CHECK(near(l.step(4242.0, 1.5), 4243.5));
    CHECK(near(l.step(4242.0, -1.5), 4240.5));
    CHECK(near(l.wrap(999999.0), 999999.0));
}

}  // namespace

int main()
{
    RUN(loop_is_off_until_the_edges_are_apart);
    RUN(an_edge_wraps_rather_than_stopping);
    RUN(a_needle_dropped_far_outside_lands_INSIDE);
    RUN(engaging_a_loop_pulls_the_needle_in);
    RUN(a_plain_loop_is_left_where_it_lands);
    RUN(a_roll_hands_back_where_the_record_WOULD_have_reached);
    RUN(the_roll_decision_is_LATCHED_at_the_engage);
    RUN(a_roll_run_BACKWARDS_hands_back_a_position_behind_it);
    RUN(halving_a_loop_UNDER_the_needle_brings_it_in);
    RUN(the_shadow_only_moves_for_a_ROLL);
    RUN(with_no_loop_a_step_is_a_plain_advance);
    std::printf("%d checks, %d failures\n", tdtest::g_checks, tdtest::g_failures);
    return tdtest::g_failures == 0 ? 0 : 1;
}
