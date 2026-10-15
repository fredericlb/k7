// The held set, the step clock and the gate — what a MIDI graph keeps between blocks. JUCE-free, so
// it runs in the FAST binary; the GRAPH around it is tested in MidiGraph_test.cpp, which links
// Tracktion for its message list.
//
// What would be wrong SILENTLY: a strike that takes without releasing the last one (the chord piles
// up under the fingers), and a key lifted while its copy is sounding, whose note-off is then owed
// forever. Both play. See ../docs/midiGraph.md.

#include "NoteClock.h"

#include "test_harness.h"

#include <cmath>
#include <string>
#include <vector>

using studio::NoteClock;
using studio::NoteEvent;
using studio::NoteSteps;
using studio::StepMode;

namespace {

/** One block's worth of events, so a test reads as "play this long and see what came out". */
std::vector<NoteEvent> run(NoteClock& r, double seconds, double step, double gate = 0.5)
{
    NoteEvent buf[128];
    const int n = r.advance(seconds, step, gate, buf, 128);
    return std::vector<NoteEvent>(buf, buf + n);
}

/** The note-ONS of a run, which is what is heard; the offs are checked by their own tests. */
std::vector<int> strikes(const std::vector<NoteEvent>& evs)
{
    std::vector<int> out;
    for (const auto& e : evs)
        if (e.velocity > 0.0f) out.push_back(e.note);
    return out;
}

NoteClock holding(std::initializer_list<int> keys)
{
    NoteClock r;
    for (const auto n : keys) r.noteOn(n, 0.8f, 1, 0.0);
    return r;
}

void repeats_the_held_note_on_the_step()
{
    auto r = holding({60});
    // Three steps of 100 ms, and the first lands at once: a key pressed is heard, not queued.
    const auto evs = run(r, 0.25, 0.1);
    CHECK(strikes(evs) == std::vector<int>({60, 60, 60}));
    CHECK(std::fabs(evs[0].at) < 1e-9);
}

void a_whole_chord_is_struck_together_on_one_clock()
{
    auto r = holding({60, 64, 67});
    // Not an arpeggio: every held note is struck at the SAME instant, twice over two steps.
    const auto evs = run(r, 0.15, 0.1);
    CHECK(strikes(evs) == std::vector<int>({60, 64, 67, 60, 64, 67}));
    CHECK(std::fabs(evs[0].at - evs[2].at) < 1e-9);
}

void the_gate_says_when_the_repeat_is_released()
{
    auto r = holding({60});
    const auto evs = run(r, 0.09, 0.1, 0.25);
    // One strike at 0, its note-off a quarter of the step later, and nothing else in the block.
    CHECK(evs.size() == 2);
    CHECK(evs[0].velocity > 0.0f);
    CHECK(evs[1].velocity == 0.0f);
    CHECK(std::fabs(evs[1].at - 0.025) < 1e-9);
}

void a_gate_of_one_releases_at_the_next_strike_and_not_after_it()
{
    auto r = holding({60});
    const auto evs = run(r, 0.15, 0.1, 1.0);
    // on, off, on — the release is at the same instant as the strike, and BEFORE it in the list.
    CHECK(evs.size() == 3);
    CHECK(evs[1].velocity == 0.0f);
    CHECK(evs[2].velocity > 0.0f);
    CHECK(std::fabs(evs[1].at - evs[2].at) < 1e-9);
}

void a_strike_releases_before_it_takes()
{
    auto r = holding({60, 64});
    const auto evs = run(r, 0.35, 0.1);
    int sounding = 0;
    for (const auto& e : evs) {
        sounding += e.velocity > 0.0f ? 1 : -1;
        // Never more than the chord: a copy is always released before its replacement is taken.
        CHECK(sounding >= 0 && sounding <= 2);
    }
}

void lifting_the_key_stops_it_and_releases_what_is_sounding()
{
    auto r = holding({60});
    run(r, 0.05, 0.1);  // struck at 0, still sounding — the gate is at 50 ms
    CHECK(r.sounding() == 1);
    r.noteOff(60);
    const auto evs = run(r, 0.5, 0.1);
    // The note-off is owed and paid at once, and nothing is struck after it.
    CHECK(evs.size() == 1);
    CHECK(evs[0].velocity == 0.0f);
    CHECK(evs[0].note == 60);
    CHECK(r.held() == 0 && r.sounding() == 0);
}

void one_key_of_a_chord_lifted_leaves_the_others_repeating()
{
    auto r = holding({60, 64});
    run(r, 0.05, 0.1);
    r.noteOff(60);
    const auto evs = run(r, 0.06, 0.1);
    // 60's copy is released at once; 64 keeps its clock and is struck again on the step.
    CHECK(evs[0].note == 60 && evs[0].velocity == 0.0f);
    CHECK(strikes(evs) == std::vector<int>({64}));
    CHECK(r.held() == 1);
}

void the_clock_carries_across_blocks()
{
    auto r = holding({60});
    const auto first = run(r, 0.05, 0.1);
    const auto second = run(r, 0.06, 0.1);
    CHECK(strikes(first) == std::vector<int>({60}));
    // The second strike is 100 ms after the first, which is 50 ms into the second block.
    CHECK(strikes(second) == std::vector<int>({60}));
    for (const auto& e : second)
        if (e.velocity > 0.0f) CHECK(std::fabs(e.at - 0.05) < 1e-9);
}

void a_key_pressed_mid_block_starts_where_the_finger_did()
{
    NoteClock r;
    r.noteOn(60, 0.8f, 1, 0.03);
    const auto evs = run(r, 0.05, 0.1);
    CHECK(evs.size() == 1);
    CHECK(std::fabs(evs[0].at - 0.03) < 1e-9);
}

void an_impossible_rate_does_not_spin()
{
    auto r = holding({60});
    // A step of zero is clamped to the floor, so a block writes a bounded number of events.
    const auto evs = run(r, 1.0, 0.0);
    CHECK(evs.size() > 0 && evs.size() <= 128);
}

void more_keys_than_the_array_are_dropped_rather_than_written_past_it()
{
    NoteClock r;
    for (int n = 40; n < 40 + NoteClock::maxHeld + 8; ++n) r.noteOn(n, 0.8f, 1, 0.0);
    CHECK(r.held() == NoteClock::maxHeld);
    // A key it dropped still lifts cleanly, and one it kept leaves the count right.
    r.noteOff(120);
    CHECK(r.held() == NoteClock::maxHeld);
    r.noteOff(40);
    CHECK(r.held() == NoteClock::maxHeld - 1);
}

void a_key_held_down_twice_is_held_once()
{
    auto r = holding({60, 60, 64});
    CHECK(r.held() == 2);
    CHECK(strikes(run(r, 0.05, 0.1)) == std::vector<int>({60, 64}));
}

void a_full_buffer_stops_between_steps_rather_than_inside_one()
{
    auto r = holding({60, 64, 67});
    NoteEvent buf[8];
    // Room for two strikes of three and no more; a third would need six and is not begun.
    const int n = r.advance(1.0, 0.01, 1.0, buf, 8);
    int sounding = 0;
    for (int i = 0; i < n; ++i) sounding += buf[i].velocity > 0.0f ? 1 : -1;
    CHECK(sounding == 3);  // a whole chord left sounding, never a partial one
}

/** The steps of one cycle that play, as a string of x and . — how a rhythm is read on paper. */
std::string picture(const NoteSteps& s)
{
    std::string out;
    for (int i = 0; i < s.cycle(); ++i) out += s.hit(i) ? 'x' : '.';
    return out;
}

/** …and a run with a rule, the velocities of what was struck. */
std::vector<float> levels(NoteClock& r, double seconds, const NoteSteps& rule)
{
    NoteEvent buf[128];
    const int n = r.advance(seconds, 0.1, 0.5, buf, 128, &rule);
    std::vector<float> out;
    for (int i = 0; i < n; ++i)
        if (buf[i].velocity > 0.0f) out.push_back(buf[i].velocity);
    return out;
}

}  // namespace

void a_euclid_spreads_its_pulses_and_rotate_turns_them()
{
    NoteSteps s;
    s.mode = StepMode::euclid;
    s.length = 8;
    s.density = 3.0f / 8.0f;
    CHECK(picture(s) == "x..x..x.");
    // A turn of one step moves every pulse one later, wrapping round the cycle.
    s.rotate = 1.0f / 8.0f;
    CHECK(picture(s) == ".x..x..x");
}

void a_burst_plays_the_first_pulses_and_rests_the_rest()
{
    NoteSteps s;
    s.mode = StepMode::burst;
    s.length = 6;
    s.density = 0.5f;
    CHECK(picture(s) == "xxx...");
    // No pattern is every step, whatever the density says.
    s.mode = StepMode::all;
    CHECK(picture(s) == "xxxxxx");
}

void a_rest_takes_its_step_on_the_clock()
{
    // x.x. at 100 ms: strikes at 0 and 200 ms, nothing at 100 — the clock moved anyway.
    auto r = holding({60});
    NoteSteps s;
    s.mode = StepMode::euclid;
    s.length = 4;
    s.density = 0.5f;
    NoteEvent buf[32];
    const int n = r.advance(0.35, 0.1, 0.5, buf, 32, &s);
    std::vector<double> ons;
    for (int i = 0; i < n; ++i)
        if (buf[i].velocity > 0.0f) ons.push_back(buf[i].at);
    CHECK(ons.size() == 2);
    CHECK(std::fabs(ons[1] - 0.2) < 1e-9);
}

void accents_play_as_played_and_the_rest_drop_to_low()
{
    // Every step, half accented: as played (0.8), then 0.8 × 0.5, alternating.
    auto r = holding({60});
    NoteSteps s;
    s.length = 4;
    s.accents = 0.5f;
    s.low = 0.5f;
    const auto v = levels(r, 0.35, s);
    CHECK(v.size() == 4);
    CHECK(std::fabs(v[0] - 0.8f) < 1e-6f && std::fabs(v[1] - 0.4f) < 1e-6f);
    CHECK(std::fabs(v[2] - 0.8f) < 1e-6f && std::fabs(v[3] - 0.4f) < 1e-6f);
    // Opposite swaps which ones.
    auto o = holding({60});
    s.opposite = true;
    const auto w = levels(o, 0.15, s);
    CHECK(std::fabs(w[0] - 0.4f) < 1e-6f && std::fabs(w[1] - 0.8f) < 1e-6f);
}

void kept_accents_stay_on_their_steps_when_the_density_moves()
{
    NoteSteps s;
    s.mode = StepMode::euclid;
    s.length = 8;
    s.accents = 0.25f;
    s.keep = true;
    s.density = 1.0f;
    const bool a0 = s.accented(0), a4 = s.accented(4);
    s.density = 0.5f;
    CHECK(s.accented(0) == a0 && s.accented(4) == a4);
    CHECK(a0 && a4 && !s.accented(2));
}

void the_decay_takes_a_share_of_each_repeat()
{
    auto r = holding({60});
    NoteSteps s;
    s.decay = 0.5f;
    const auto v = levels(r, 0.25, s);
    CHECK(v.size() == 3);
    CHECK(std::fabs(v[1] - 0.4f) < 1e-6f && std::fabs(v[2] - 0.2f) < 1e-6f);
    // …and never reaches zero, which MIDI would read as a note-off.
    auto deep = holding({60});
    s.decay = 1.0f;
    for (const auto x : levels(deep, 0.55, s)) CHECK(x >= NoteSteps::minVelocity);
}

void chance_plays_some_steps_and_none_at_zero()
{
    auto r = holding({60});
    NoteSteps s;
    s.chance = 0.5f;
    NoteEvent buf[128];
    const int n = r.advance(9.95, 0.1, 0.5, buf, 128, &s);
    int ons = 0;
    for (int i = 0; i < n; ++i) ons += buf[i].velocity > 0.0f ? 1 : 0;
    // A hundred steps at a half: well inside 30..70 for this generator's fixed seed.
    CHECK(ons > 30 && ons < 70);
    auto none = holding({60});
    s.chance = 0.0f;
    CHECK(levels(none, 0.55, s).empty());
}

int main()
{
    RUN(repeats_the_held_note_on_the_step);
    RUN(a_whole_chord_is_struck_together_on_one_clock);
    RUN(the_gate_says_when_the_repeat_is_released);
    RUN(a_gate_of_one_releases_at_the_next_strike_and_not_after_it);
    RUN(a_strike_releases_before_it_takes);
    RUN(lifting_the_key_stops_it_and_releases_what_is_sounding);
    RUN(one_key_of_a_chord_lifted_leaves_the_others_repeating);
    RUN(the_clock_carries_across_blocks);
    RUN(a_key_pressed_mid_block_starts_where_the_finger_did);
    RUN(an_impossible_rate_does_not_spin);
    RUN(more_keys_than_the_array_are_dropped_rather_than_written_past_it);
    RUN(a_key_held_down_twice_is_held_once);
    RUN(a_full_buffer_stops_between_steps_rather_than_inside_one);
    RUN(a_euclid_spreads_its_pulses_and_rotate_turns_them);
    RUN(a_burst_plays_the_first_pulses_and_rests_the_rest);
    RUN(a_rest_takes_its_step_on_the_clock);
    RUN(accents_play_as_played_and_the_rest_drop_to_low);
    RUN(kept_accents_stay_on_their_steps_when_the_density_moves);
    RUN(the_decay_takes_a_share_of_each_repeat);
    RUN(chance_plays_some_steps_and_none_at_zero);
    TEST_MAIN_END();
}
