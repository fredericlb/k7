// The arpeggiator's clock and walk. JUCE-free, so it runs in the FAST binary — the PLUGIN around it
// needs a live te::Edit no suite here builds, exactly like the platter's loop.
//
// What would be wrong SILENTLY: a step that takes a note without releasing the last one (a chord
// piles up under the fingers and never lets go), and a chord let go while a note is sounding, whose
// note-off is then owed forever. Both play. See ../docs/arpeggiator.md.

#include "Arpeggiator.h"

#include "test_harness.h"

#include <cmath>
#include <vector>

using studio::ArpDirection;
using studio::Arpeggiator;
using studio::ArpEvent;

namespace {

/** One block's worth of events, so a test reads as "play this long and see what came out". */
std::vector<ArpEvent> run(Arpeggiator& a, double seconds, double step, int octaves = 1,
                          ArpDirection dir = ArpDirection::up)
{
    ArpEvent buf[64];
    const int n = a.advance(seconds, step, octaves, dir, buf, 64);
    return std::vector<ArpEvent>(buf, buf + n);
}

/** The note-ONS of a run, which is the melody; the offs are checked by their own test. */
std::vector<int> notes(const std::vector<ArpEvent>& evs)
{
    std::vector<int> out;
    for (const auto& e : evs)
        if (e.velocity > 0.0f) out.push_back(e.note);
    return out;
}

Arpeggiator holding(std::initializer_list<int> chord)
{
    Arpeggiator a;
    for (const auto n : chord) a.noteOn(n, 0.8f, 1, 0.0);
    return a;
}

void plays_the_held_chord_one_note_at_a_time()
{
    auto a = holding({60, 64, 67});
    // Four steps of 100 ms, and the first lands at once: a chord pressed is heard, not queued.
    const auto evs = run(a, 0.35, 0.1);
    CHECK(notes(evs) == std::vector<int>({60, 64, 67, 60}));
    CHECK(std::fabs(evs[0].at) < 1e-9);
}

void a_step_releases_before_it_takes()
{
    auto a = holding({60, 64, 67});
    const auto evs = run(a, 0.35, 0.1);
    int sounding = 0;
    for (const auto& e : evs) {
        sounding += e.velocity > 0.0f ? 1 : -1;
        // Never two at once: an arpeggiator that stacks its own notes is a chord with extra steps.
        CHECK(sounding >= 0 && sounding <= 1);
    }
    CHECK(a.sounding() >= 0);
}

void the_gate_releases_halfway_through_the_step()
{
    auto a = holding({60});
    const auto evs = run(a, 0.25, 0.1);
    // on at 0, off at 50 ms, on at 100 — the same note twice needs the gap, or the second one is swallowed.
    CHECK(evs.size() >= 3);
    CHECK(std::fabs(evs[0].at - 0.0) < 1e-9);
    CHECK(evs[1].velocity == 0.0f);
    CHECK(std::fabs(evs[1].at - 0.05) < 1e-9);
    CHECK(std::fabs(evs[2].at - 0.1) < 1e-9);
}

void the_clock_carries_across_blocks()
{
    auto a = holding({60, 64, 67});
    // Blocks of 28 ms against a step of 100: the notes land where they would have in one long block.
    std::vector<int> played;
    for (int i = 0; i < 10; ++i)
        for (const auto n : notes(run(a, 0.028, 0.1))) played.push_back(n);
    CHECK(played == std::vector<int>({60, 64, 67}));
}

void the_directions_walk_the_same_notes_in_another_order()
{
    auto up = holding({60, 64, 67});
    CHECK(notes(run(up, 0.35, 0.1, 1, ArpDirection::up)) == std::vector<int>({60, 64, 67, 60}));

    auto down = holding({60, 64, 67});
    CHECK(notes(run(down, 0.35, 0.1, 1, ArpDirection::down)) == std::vector<int>({67, 64, 60, 67}));

    // Neither end is played twice, which is what makes an up-down a line rather than a limp.
    auto both = holding({60, 64, 67});
    CHECK(notes(run(both, 0.55, 0.1, 1, ArpDirection::upDown))
          == std::vector<int>({60, 64, 67, 64, 60, 64}));
}

void random_stays_inside_the_chord()
{
    auto a = holding({60, 64, 67});
    for (const auto n : notes(run(a, 0.95, 0.1, 2, ArpDirection::random)))
        CHECK(n == 60 || n == 64 || n == 67 || n == 72 || n == 76 || n == 79);
}

void octaves_stack_by_twelve_and_stop_at_the_keyboard_end()
{
    auto a = holding({60, 64});
    CHECK(notes(run(a, 0.65, 0.1, 3)) == std::vector<int>({60, 64, 72, 76, 84, 88, 60}));

    // Clamped rather than folded: a stack running off the top repeats its last note, and plays SOMETHING.
    auto high = holding({120});
    for (const auto n : notes(run(high, 0.35, 0.1, 4))) CHECK(n <= 127);
}

void letting_the_chord_go_releases_the_note_that_is_sounding()
{
    auto a = holding({60, 64, 67});
    run(a, 0.05, 0.1);
    CHECK(a.sounding() == 60);
    a.noteOff(60);
    a.noteOff(64);
    a.noteOff(67);
    const auto evs = run(a, 0.05, 0.1);
    // At once, and at the top of the block: the finger is off the key, so nothing may still be ringing.
    CHECK(evs.size() == 1);
    CHECK(evs[0].note == 60);
    CHECK(evs[0].velocity == 0.0f);
    CHECK(std::fabs(evs[0].at) < 1e-9);
    CHECK(a.sounding() == -1);
    CHECK(run(a, 1.0, 0.1).empty());
}

void the_next_chord_starts_from_its_own_bottom_note()
{
    auto a = holding({60, 64, 67});
    run(a, 0.25, 0.1);
    a.noteOff(60);
    a.noteOff(64);
    a.noteOff(67);
    run(a, 0.05, 0.1);
    a.noteOn(72, 0.8f, 1, 0.0);
    a.noteOn(76, 0.8f, 1, 0.0);
    // A fresh chord restarts the walk; carrying the old step would enter the new one in the middle.
    CHECK(notes(run(a, 0.15, 0.1)) == std::vector<int>({72, 76}));
}

void a_key_pressed_mid_block_starts_where_the_finger_did()
{
    Arpeggiator a;
    a.noteOn(60, 0.8f, 1, 0.007);
    const auto evs = run(a, 0.01, 0.1);
    CHECK(evs.size() == 1);
    CHECK(std::fabs(evs[0].at - 0.007) < 1e-9);
}

void an_impossible_rate_does_not_spin()
{
    auto a = holding({60, 64, 67});
    // A step of zero is a hang: the floor is what stops the loop from filling the block with notes.
    const auto evs = run(a, 1.0, 0.0);
    CHECK(!evs.empty());
    CHECK(evs.size() <= 64);
    for (size_t i = 1; i < evs.size(); ++i) CHECK(evs[i].at >= evs[i - 1].at);
}

void a_chord_wider_than_the_array_is_dropped_rather_than_written_past_it()
{
    Arpeggiator a;
    for (int n = 40; n < 40 + Arpeggiator::maxHeld + 8; ++n) a.noteOn(n, 0.8f, 1, 0.0);
    CHECK(a.held() == Arpeggiator::maxHeld);
    // The notes it kept are the ones it heard first, and a key it dropped still lifts cleanly.
    a.noteOff(40);
    CHECK(a.held() == Arpeggiator::maxHeld - 1);
    a.noteOff(120);
    CHECK(a.held() == Arpeggiator::maxHeld - 1);
}

void a_note_held_down_twice_is_held_once()
{
    auto a = holding({60, 60, 64});
    CHECK(a.held() == 2);
    CHECK(notes(run(a, 0.25, 0.1)) == std::vector<int>({60, 64, 60}));
}

}  // namespace

int main()
{
    RUN(plays_the_held_chord_one_note_at_a_time);
    RUN(a_step_releases_before_it_takes);
    RUN(the_gate_releases_halfway_through_the_step);
    RUN(the_clock_carries_across_blocks);
    RUN(the_directions_walk_the_same_notes_in_another_order);
    RUN(random_stays_inside_the_chord);
    RUN(octaves_stack_by_twelve_and_stop_at_the_keyboard_end);
    RUN(letting_the_chord_go_releases_the_note_that_is_sounding);
    RUN(the_next_chord_starts_from_its_own_bottom_note);
    RUN(a_key_pressed_mid_block_starts_where_the_finger_did);
    RUN(an_impossible_rate_does_not_spin);
    RUN(a_chord_wider_than_the_array_is_dropped_rather_than_written_past_it);
    RUN(a_note_held_down_twice_is_held_once);
    TEST_MAIN_END();
}
