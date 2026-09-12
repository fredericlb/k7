// Unit tests for the MIDI phase of DspGraph — the note transforms a `transformers` module runs.
//
// A SEPARATE binary from studio_engine_tests, which deliberately links no JUCE so it builds in seconds. This
// one needs Tracktion's MidiMessageArray, so it pays for the link; keeping the two apart is what stops the fast
// tests from becoming slow ones.
//
// These exist because the first attempt to verify this feature went through a synth and a pitch detector, and
// measured nothing but my own bugs: a 4OSC that played a 250 ms transient and an autocorrelation locking onto
// sub-harmonics. A note number is an integer. Assert on the integer.

#include "DspGraph.h"
#include "test_harness.h"

#include <cmath>
#include <string>

using namespace studio;
namespace te = tracktion::engine;

namespace {

// The graph @studio/dsp emits for the pitch-shift module, verbatim.
const char* kTransposeGraph = R"({
  "params": [ { "name": "Semitones", "min": -24, "max": 24, "default": 0 } ],
  "nodes":  [ { "type": "transpose", "in": ["Semitones"] } ]
})";

std::unique_ptr<DspGraph> buildGraph(const char* json) {
    juce::String error;
    auto g = DspGraph::build(juce::JSON::parse(json), error);
    CHECK(g != nullptr);
    if (g == nullptr) std::printf("    build error: %s\n", error.toRawUTF8());
    return g;
}

// One note-on + its note-off, which is the pair every transform has to keep together.
te::MidiMessageArray notePair(int note, float velocity = 1.0f) {
    te::MidiMessageArray a;
    a.addMidiMessage(juce::MidiMessage::noteOn(1, note, velocity), 0.0, te::MidiMessageArray::notMPE);
    a.addMidiMessage(juce::MidiMessage::noteOff(1, note), 0.5, te::MidiMessageArray::notMPE);
    return a;
}

int noteAt(const te::MidiMessageArray& a, int i) { return a[i].getNoteNumber(); }

// The note repeater, verbatim: hold the keys, strike them every `Count x Division` beats.
const char* kRepeatGraph = R"({
  "params": [ { "name": "Count", "min": 1, "max": 8, "default": 1 },
              { "name": "Division", "min": 0.125, "max": 4, "default": 0.5 },
              { "name": "Gate", "min": 0.05, "max": 1, "default": 0.5 } ],
  "nodes":  [ { "type": "mhold" },
              { "type": "mul", "in": ["Count", "Division"], "out": "step" },
              { "type": "mstrike", "in": ["step", "Gate"] } ]
})";

/** One press, held: the note-off is what a repeater waits for, so a pair would stop it at once. */
te::MidiMessageArray keyDown(int note, double at = 0.0) {
    te::MidiMessageArray a;
    a.addMidiMessage(juce::MidiMessage::noteOn(1, note, 1.0f), at, te::MidiMessageArray::notMPE);
    return a;
}

int noteOns(const te::MidiMessageArray& a) {
    int n = 0;
    for (auto& m : a)
        if (m.isNoteOn()) ++n;
    return n;
}

void transposes_by_whole_semitones() {
    auto g = buildGraph(kTransposeGraph);
    if (!g) return;
    g->prepare(48000.0, 512);
    CHECK(g->hasMidi());

    for (const auto semis : {0, 12, -12, 7, -5}) {
        auto midi = notePair(60);
        const float p = (float)semis;
        g->processMidi(midi, &p, 1);
        // Both ends move together, or the voice hangs.
        CHECK(noteAt(midi, 0) == 60 + semis);
        CHECK(noteAt(midi, 1) == 60 + semis);
    }
}

void rounds_a_fractional_parameter() {
    auto g = buildGraph(kTransposeGraph);
    if (!g) return;
    g->prepare(48000.0, 512);
    // A knob is continuous and automation is smooth, but there is no such thing as note 60.4.
    for (const auto [value, expected] : {std::pair{2.4f, 62}, std::pair{2.6f, 63}, std::pair{-2.6f, 57}}) {
        auto midi = notePair(60);
        g->processMidi(midi, &value, 1);
        CHECK(noteAt(midi, 0) == expected);
    }
}

void clamps_rather_than_drops_at_the_keyboard_ends() {
    auto g = buildGraph(kTransposeGraph);
    if (!g) return;
    g->prepare(48000.0, 512);

    // Both clamp, and land on the SAME number, which is what keeps a note-on and its note-off a pair.
    auto low = notePair(3);
    const float down = -24.0f;
    g->processMidi(low, &down, 1);
    CHECK(noteAt(low, 0) == 0);
    CHECK(noteAt(low, 1) == 0);
    CHECK(low.size() == 2);

    auto high = notePair(120);
    const float up = 24.0f;
    g->processMidi(high, &up, 1);
    CHECK(noteAt(high, 0) == 127);
    CHECK(noteAt(high, 1) == 127);
    CHECK(high.size() == 2);
}

void leaves_non_note_messages_alone() {
    auto g = buildGraph(kTransposeGraph);
    if (!g) return;
    g->prepare(48000.0, 512);

    te::MidiMessageArray a;
    a.addMidiMessage(juce::MidiMessage::controllerEvent(1, 74, 100), 0.0, te::MidiMessageArray::notMPE);
    a.addMidiMessage(juce::MidiMessage::pitchWheel(1, 8192), 0.0, te::MidiMessageArray::notMPE);
    const float p = 12.0f;
    g->processMidi(a, &p, 1);
    // A CC's number is not a pitch: transposing it would turn a filter sweep into something else entirely.
    CHECK(a[0].getControllerNumber() == 74);
    CHECK(a[0].getControllerValue() == 100);
    CHECK(a[1].isPitchWheel());
}

void velocity_scales_but_never_to_a_note_off() {
    auto g = buildGraph(R"({
      "params": [ { "name": "Scale", "min": 0, "max": 2, "default": 1 } ],
      "nodes":  [ { "type": "velocity", "in": ["Scale"] } ]
    })");
    if (!g) return;
    g->prepare(48000.0, 512);

    auto half = notePair(60, 0.8f);
    const float p = 0.5f;
    g->processMidi(half, &p, 1);
    CHECK(std::abs(half[0].getFloatVelocity() - 0.4f) < 0.02f);

    // Velocity 0 IS a note-off in MIDI, so the floor is one step above zero.
    auto quiet = notePair(60, 0.02f);
    const float zero = 0.0f;
    g->processMidi(quiet, &zero, 1);
    CHECK(quiet[0].getVelocity() >= 1);
    CHECK(quiet[0].isNoteOn());
}

void a_graph_without_midi_nodes_leaves_the_buffer_alone() {
    // The audio auto-wah, run through the MIDI entry point: it declares no MIDI node, so nothing must move.
    auto g = buildGraph(R"({
      "params": [ { "name": "Gain", "min": 0, "max": 2, "default": 1 } ],
      "nodes":  [ { "type": "todb", "in": ["Gain"], "out": "db" } ]
    })");
    if (!g) return;
    g->prepare(48000.0, 512);
    CHECK(!g->hasMidi());

    auto midi = notePair(60);
    const float p = 1.0f;
    g->processMidi(midi, &p, 1);
    CHECK(noteAt(midi, 0) == 60);
    CHECK(midi.size() == 2);
}

// --- the two nodes that give the phase a memory and a clock (../docs/midiGraph.md) -------------

// Count 1, Division 0.5 (an eighth), Gate 0.5 — the module's own defaults.
const float kRepeatDefaults[3] = {1.0f, 0.5f, 0.5f};

void a_held_key_is_struck_again_on_the_step() {
    auto g = buildGraph(kRepeatGraph);
    if (!g) return;
    g->prepare(48000.0, 512);
    CHECK(g->hasMidi());

    // At 120 BPM a beat is 0.5 s, so an eighth is 0.25 s: one block of 0.6 s holds three strikes.
    auto midi = keyDown(60);
    g->processMidi(midi, kRepeatDefaults, 3, 0.6, 0.5);
    CHECK(noteOns(midi) == 3);
    // The FIRST is where the finger fell, not on the next step: a key pressed is heard.
    CHECK(midi[0].isNoteOn() && std::fabs(midi[0].getTimeStamp()) < 1e-9);
}

void the_step_is_in_BEATS_so_the_same_graph_follows_the_tempo() {
    auto g = buildGraph(kRepeatGraph);
    if (!g) return;
    g->prepare(48000.0, 512);
    auto fast = keyDown(60);
    g->processMidi(fast, kRepeatDefaults, 3, 0.6, 0.25);  // 240 BPM
    g->reset();
    auto slow = keyDown(60);
    g->processMidi(slow, kRepeatDefaults, 3, 0.6, 1.0);  // 60 BPM
    // Twice the tempo, twice the strikes in the same wall-clock second. Nothing in the graph moved.
    CHECK(noteOns(fast) > noteOns(slow));
}

void the_keys_are_EATEN_and_only_the_clock_writes_notes() {
    auto g = buildGraph(R"({
      "params": [],
      "nodes":  [ { "type": "mhold" } ]
    })");
    if (!g) return;
    g->prepare(48000.0, 512);
    auto midi = notePair(60);
    // `mhold` alone is a note swallower: the pair goes into the held set and nothing comes out.
    g->processMidi(midi, nullptr, 0, 0.1, 0.5);
    CHECK(midi.size() == 0);
}

void a_control_change_still_passes_through_a_repeater() {
    auto g = buildGraph(kRepeatGraph);
    if (!g) return;
    g->prepare(48000.0, 512);
    auto midi = keyDown(60);
    midi.addMidiMessage(juce::MidiMessage::controllerEvent(1, 74, 100), 0.3,
                        te::MidiMessageArray::notMPE);
    g->processMidi(midi, kRepeatDefaults, 3, 0.6, 0.5);
    bool sawCc = false;
    for (auto& m : midi)
        if (m.isController()) sawCc = true;
    CHECK(sawCc);
    // …and in its place: the list leaves in timestamp order or something downstream drops it.
    for (int i = 1; i < midi.size(); ++i)
        CHECK(midi[i].getTimeStamp() >= midi[i - 1].getTimeStamp());
}

void letting_the_key_go_stops_it_and_pays_the_note_off() {
    auto g = buildGraph(kRepeatGraph);
    if (!g) return;
    g->prepare(48000.0, 512);
    auto first = keyDown(60);
    g->processMidi(first, kRepeatDefaults, 3, 0.1, 0.5);  // struck, still sounding
    CHECK(noteOns(first) == 1);

    te::MidiMessageArray up;
    up.addMidiMessage(juce::MidiMessage::noteOff(1, 60), 0.0, te::MidiMessageArray::notMPE);
    g->processMidi(up, kRepeatDefaults, 3, 0.6, 0.5);
    // One message: the note-off it owed. Nothing struck after the finger left.
    CHECK(up.size() == 1);
    CHECK(!up[0].isNoteOn() && up[0].getNoteNumber() == 60);
}

void a_reset_lets_go_of_everything() {
    auto g = buildGraph(kRepeatGraph);
    if (!g) return;
    g->prepare(48000.0, 512);
    auto midi = keyDown(60);
    g->processMidi(midi, kRepeatDefaults, 3, 0.1, 0.5);
    g->reset();
    auto after = te::MidiMessageArray{};
    g->processMidi(after, kRepeatDefaults, 3, 0.6, 0.5);
    // A stop leaves nothing playing: the host sends all-notes-off, and this must not fight it.
    CHECK(after.size() == 0);
}

}  // namespace

int main() {
    RUN(transposes_by_whole_semitones);
    RUN(rounds_a_fractional_parameter);
    RUN(clamps_rather_than_drops_at_the_keyboard_ends);
    RUN(leaves_non_note_messages_alone);
    RUN(velocity_scales_but_never_to_a_note_off);
    RUN(a_graph_without_midi_nodes_leaves_the_buffer_alone);
    RUN(a_held_key_is_struck_again_on_the_step);
    RUN(the_step_is_in_BEATS_so_the_same_graph_follows_the_tempo);
    RUN(the_keys_are_EATEN_and_only_the_clock_writes_notes);
    RUN(a_control_change_still_passes_through_a_repeater);
    RUN(letting_the_key_go_stops_it_and_pays_the_note_off);
    RUN(a_reset_lets_go_of_everything);
    TEST_MAIN_END();
}
