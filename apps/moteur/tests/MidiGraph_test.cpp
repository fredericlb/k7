// Unit tests for the MIDI phase of DspGraph — the note transforms a `transformers` module runs.
//
// A SEPARATE binary from lanes_engine_tests, which deliberately links no JUCE so it builds in seconds. This
// one needs Tracktion's MidiMessageArray, so it pays for the link; keeping the two apart is what stops the fast
// tests from becoming slow ones.
//
// These exist because the first attempt to verify this feature went through a synth and a pitch detector, and
// measured nothing but my own bugs: a 4OSC that played a 250 ms transient and an autocorrelation locking onto
// sub-harmonics. A note number is an integer. Assert on the integer.

#include "DspGraph.h"
#include "test_harness.h"

#include <string>

using namespace lanes;
namespace te = tracktion::engine;

namespace {

// The graph @lanes/dsp emits for the pitch-shift module, verbatim.
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

    // Dropping a note-on would strand its note-off and hang the voice for good, so both clamp instead — and
    // land on the SAME number, which is what keeps them a pair.
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

    // Velocity 0 IS a note-off in MIDI: scaling a quiet note to nothing would silence the voice and strand its
    // real note-off. The floor is one step above zero.
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

}  // namespace

int main() {
    RUN(transposes_by_whole_semitones);
    RUN(rounds_a_fractional_parameter);
    RUN(clamps_rather_than_drops_at_the_keyboard_ends);
    RUN(leaves_non_note_messages_alone);
    RUN(velocity_scales_but_never_to_a_note_off);
    RUN(a_graph_without_midi_nodes_leaves_the_buffer_alone);
    TEST_MAIN_END();
}
