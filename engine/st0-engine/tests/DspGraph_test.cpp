// Unit tests for DspGraph's AUDIO path — specifically `mix`, the one node whose meaning spans every phase.
//
// `mix` blends the graph's output with what came in, and runs after every phase. Inside the audio phase it is
// correct for a graph made only of audio nodes (auto-wah: biquad, gain, mix) and a complete no-op for one with
// a sample-rate stage (the flanger): the blend runs on a buffer no node has written yet, so it mixes the dry
// signal with an identical copy of itself, and `aout` then overwrites the result — a Mix knob that does nothing
// at any setting. These tests are on the ARITHMETIC — a mix is a weighted sum, and a weighted sum is checkable.

#include "DspGraph.h"
#include "test_harness.h"

#include <cmath>
#include <initializer_list>

using namespace studio;

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 256;

// The flanger's SHAPE with the delay taken out: doubling makes the wet signal a number you can write down.
const char* kSampleGraph = R"({
  "params": [ { "name": "Mix", "min": 0, "max": 1, "default": 0.5 } ],
  "nodes": [
    { "type": "ain", "out": "n0" },
    { "type": "amul", "out": "n1", "in": ["n0"], "k": [2] },
    { "type": "aout", "in": ["n1"] },
    { "type": "mix", "in": ["Mix"] }
  ]
})";

// The same with `mix` declared FIRST: it is a terminal operation, not a step, so its position must not matter.
const char* kMixFirstGraph = R"({
  "params": [ { "name": "Mix", "min": 0, "max": 1, "default": 0.5 } ],
  "nodes": [
    { "type": "mix", "in": ["Mix"] },
    { "type": "ain", "out": "n0" },
    { "type": "amul", "out": "n1", "in": ["n0"], "k": [2] },
    { "type": "aout", "in": ["n1"] }
  ]
})";

// The same blend with no sample-rate stage at all — the shape that always worked, kept honest.
const char* kAudioGraph = R"({
  "params": [ { "name": "Mix", "min": 0, "max": 1, "default": 0.5 },
              { "name": "Gain", "min": 0, "max": 4, "default": 2 } ],
  "nodes": [
    { "type": "gain", "in": ["Gain"] },
    { "type": "mix", "in": ["Mix"] }
  ]
})";

// A two-input module reduced to a sum: `ain` port 1 reads the SECOND pair, where a sidechain source lands.
const char* kTwoInputGraph = R"({
  "params": [],
  "nodes": [
    { "type": "ain", "out": "a" },
    { "type": "ain", "port": 1, "out": "b" },
    { "type": "aadd", "in": ["a", "b"], "out": "sum" },
    { "type": "aout", "in": ["sum"] }
  ]
})";

std::unique_ptr<DspGraph> buildGraph(const char* json) {
    juce::String error;
    auto g = DspGraph::build(juce::JSON::parse(json), error);
    CHECK(g != nullptr);
    if (g == nullptr) std::printf("    build error: %s\n", error.toRawUTF8());
    return g;
}

// A constant block — a DC level makes every sample its own assertion, with no phase to reason about.
juce::AudioBuffer<float> dc(float level, int n = kBlock) {
    juce::AudioBuffer<float> b(2, n);
    for (int ch = 0; ch < 2; ++ch)
        for (int i = 0; i < n; ++i) b.getWritePointer(ch)[i] = level;
    return b;
}

// The block's average, which for DC is the level — and for anything else, still a number that moved or didn't.
float mean(const juce::AudioBuffer<float>& b) {
    double sum = 0.0;
    for (int i = 0; i < b.getNumSamples(); ++i) sum += b.getReadPointer(0)[i];
    return (float)(sum / b.getNumSamples());
}

float runOnce(const char* json, float mixValue, float level = 0.25f) {
    auto g = buildGraph(json);
    if (!g) return 0.0f;
    g->prepare(kRate, kBlock);
    auto buf = dc(level);
    const float params[2] = {mixValue, 2.0f};
    g->process(buf, 0, kBlock, params, 2);
    return mean(buf);
}

void mix_moves_the_output_of_a_sample_rate_graph() {
    // The bug, stated as a number: Mix=0 and Mix=1 produced the same block.
    const float wet = runOnce(kSampleGraph, 1.0f);
    const float dry = runOnce(kSampleGraph, 0.0f);
    CHECK(std::abs(wet - dry) > 1.0e-4f);
}

void mix_at_zero_gives_back_exactly_what_came_in() {
    // Not "close to" the input — the blend at 0 is the identity, and anything else is the graph leaking through.
    CHECK(std::abs(runOnce(kSampleGraph, 0.0f, 0.25f) - 0.25f) < 1.0e-6f);
}

void mix_at_one_gives_the_graph_untouched() {
    // The sample stage doubles, and at fully wet nothing dilutes it.
    CHECK(std::abs(runOnce(kSampleGraph, 1.0f, 0.25f) - 0.5f) < 1.0e-6f);
}

void mix_interpolates_between_the_two() {
    // A weighted sum, checked at its midpoint: wet·out + (1-wet)·dry = 0.5·0.5 + 0.5·0.25.
    CHECK(std::abs(runOnce(kSampleGraph, 0.5f, 0.25f) - 0.375f) < 1.0e-6f);
}

void where_mix_sits_in_the_list_does_not_matter() {
    CHECK(std::abs(runOnce(kMixFirstGraph, 0.0f, 0.25f) - 0.25f) < 1.0e-6f);
    CHECK(std::abs(runOnce(kMixFirstGraph, 0.5f, 0.25f) - 0.375f) < 1.0e-6f);
    CHECK(std::abs(runOnce(kMixFirstGraph, 1.0f, 0.25f) - 0.5f) < 1.0e-6f);
}

void an_audio_only_graph_is_unchanged_by_the_move() {
    // Deferring `mix` past a phase this graph does not have must be invisible to it.
    CHECK(std::abs(runOnce(kAudioGraph, 1.0f, 0.1f) - 0.2f) < 1.0e-6f);
    CHECK(std::abs(runOnce(kAudioGraph, 0.0f, 0.1f) - 0.1f) < 1.0e-6f);
}

void the_dry_snapshot_is_the_input_not_a_later_stage() {
    // Blending against what came IN gives 0.5·(2x) + 0.5·x = 1.5x; against the gained signal it would give 2x.
    CHECK(std::abs(runOnce(kAudioGraph, 0.5f, 0.2f) - 0.3f) < 1.0e-6f);
}

void a_graph_with_no_mix_node_is_left_alone() {
    auto g = buildGraph(R"({
      "params": [ { "name": "Gain", "min": 0, "max": 4, "default": 2 } ],
      "nodes": [ { "type": "gain", "in": ["Gain"] } ]
    })");
    if (!g) return;
    g->prepare(kRate, kBlock);
    auto buf = dc(0.25f);
    const float p = 2.0f;
    g->process(buf, 0, kBlock, &p, 1);
    CHECK(std::abs(mean(buf) - 0.5f) < 1.0e-6f);
}

// A block whose channels hold different DC levels, so which one a node read is readable off the answer.
juce::AudioBuffer<float> dcChannels(int chans, std::initializer_list<float> levels, int n = kBlock) {
    juce::AudioBuffer<float> b(chans, n);
    b.clear();
    int ch = 0;
    for (float level : levels) {
        if (ch >= chans) break;
        for (int i = 0; i < n; ++i) b.getWritePointer(ch)[i] = level;
        ++ch;
    }
    return b;
}

void a_graph_declares_as_many_inputs_as_its_ports() {
    auto one = buildGraph(kSampleGraph);
    auto two = buildGraph(kTwoInputGraph);
    if (!one || !two) return;
    // What GraphDspPlugin asks Tracktion for, and what decides whether the module can be sidechained at all.
    CHECK(one->inputs() == 1);
    CHECK(two->inputs() == 2);
}

void a_second_port_reads_the_second_pair_of_the_buffer() {
    auto g = buildGraph(kTwoInputGraph);
    if (!g) return;
    g->prepare(kRate, kBlock);
    // 0/1 is the flow, 2/3 the side input; 0.25 + 0.5 is the sum, and reading the wrong pair cannot produce it.
    auto buf = dcChannels(4, {0.25f, 0.25f, 0.5f, 0.5f});
    g->process(buf, 0, kBlock, nullptr, 0);
    CHECK(std::abs(mean(buf) - 0.75f) < 1.0e-6f);
}

void an_unfed_second_port_is_silence_rather_than_a_read_past_the_end() {
    auto g = buildGraph(kTwoInputGraph);
    if (!g) return;
    g->prepare(kRate, kBlock);
    // Tracktion hands a plugin with no sidechain source a two-channel buffer: that is the shape under test.
    auto buf = dcChannels(2, {0.25f, 0.25f});
    g->process(buf, 0, kBlock, nullptr, 0);
    CHECK(std::abs(mean(buf) - 0.25f) < 1.0e-6f);
}

}  // namespace

// --- what the audit of 2026-08-08 fixed, pinned here so it cannot come back -----------------

// linmap with an EMPTY range is 0, not the NaN that poisons a biquad for good (docs/dspGraph.md).
void linmap_with_an_empty_range_is_zero_not_nan() {
    // gain(linmap(x, lo, hi)) with lo == hi == 1: an honest 0 mutes the block; a NaN makes it non-finite.
    const char* json = R"({
      "params": [ { "name": "X", "min": 0, "max": 2, "default": 1 } ],
      "nodes": [
        { "type": "linmap", "out": "g", "in": ["X", 1, 1] },
        { "type": "gain", "in": ["g"] }
      ]
    })";
    auto g = buildGraph(json);
    if (!g) return;
    g->prepare(kRate, kBlock);
    auto buf = dc(0.5f);
    const float params[1] = {1.0f};
    g->process(buf, 0, kBlock, params, 1);
    for (int i = 0; i < kBlock; ++i) CHECK(std::isfinite(buf.getReadPointer(0)[i]));
}

// A block LARGER than prepare() was told about is split rather than grown, so the arithmetic must not move.
void a_block_bigger_than_prepared_is_chunked_not_grown() {
    auto g = buildGraph(kSampleGraph);
    if (!g) return;
    g->prepare(kRate, kBlock);              // prepared for kBlock…
    const int big = kBlock * 3 + 7;         // …handed an odd multiple of it, as a render would
    auto buf = dc(0.25f, big);
    const float params[2] = {1.0f, 2.0f};   // Mix fully wet: the graph doubles, so every sample is 0.5
    g->process(buf, 0, big, params, 2);
    for (int i = 0; i < big; ++i) CHECK(std::abs(buf.getReadPointer(0)[i] - 0.5f) < 1e-5f);
}

// The ANALYSIS phase: an envelope peaks ACROSS the pair, so reading channel 0 twice follows the quiet side.
void an_envelope_follows_the_louder_channel() {
    auto g = buildGraph(R"({
      "params": [ { "name": "Attack", "min": 0.1, "max": 200, "default": 0.1 },
                  { "name": "Release", "min": 1, "max": 1000, "default": 1000 } ],
      "nodes": [ { "type": "envelope", "in": ["Attack", "Release"], "out": "env" },
                 { "type": "gain", "in": ["env"] } ]
    })");
    if (!g) return;
    g->prepare(kRate, kBlock);
    auto buf = dcChannels(2, {0.1f, 0.8f});
    const float params[2] = {0.1f, 1000.0f};
    g->process(buf, 0, kBlock, params, 2);
    // env -> 0.8 (the loud channel), so each channel comes out scaled by 0.8.
    for (int i = 0; i < kBlock; ++i) {
        CHECK(std::abs(buf.getReadPointer(0)[i] - 0.1f * 0.8f) < 1e-3f);
        CHECK(std::abs(buf.getReadPointer(1)[i] - 0.8f * 0.8f) < 1e-3f);
    }
}

// …and the mirror, so neither channel is the one that happens to be read: loud LEFT, quiet right.
void an_envelope_follows_it_on_either_side() {
    auto g = buildGraph(R"({
      "params": [ { "name": "Attack", "min": 0.1, "max": 200, "default": 0.1 },
                  { "name": "Release", "min": 1, "max": 1000, "default": 1000 } ],
      "nodes": [ { "type": "envelope", "in": ["Attack", "Release"], "out": "env" },
                 { "type": "gain", "in": ["env"] } ]
    })");
    if (!g) return;
    g->prepare(kRate, kBlock);
    auto buf = dcChannels(2, {0.8f, 0.1f});
    const float params[2] = {0.1f, 1000.0f};
    g->process(buf, 0, kBlock, params, 2);
    for (int i = 0; i < kBlock; ++i) {
        CHECK(std::abs(buf.getReadPointer(0)[i] - 0.8f * 0.8f) < 1e-3f);
        CHECK(std::abs(buf.getReadPointer(1)[i] - 0.1f * 0.8f) < 1e-3f);
    }
}

// A MONO buffer: the hoisted read pointers keep a null second entry, and `numChans` must stop the loop there.
void an_envelope_on_a_mono_buffer_reads_one_channel() {
    auto g = buildGraph(R"({
      "params": [ { "name": "Attack", "min": 0.1, "max": 200, "default": 0.1 },
                  { "name": "Release", "min": 1, "max": 1000, "default": 1000 } ],
      "nodes": [ { "type": "envelope", "in": ["Attack", "Release"], "out": "env" },
                 { "type": "gain", "in": ["env"] } ]
    })");
    if (!g) return;
    g->prepare(kRate, kBlock);
    auto buf = dcChannels(1, {0.5f});
    const float params[2] = {0.1f, 1000.0f};
    g->process(buf, 0, kBlock, params, 2);
    for (int i = 0; i < kBlock; ++i)
        CHECK(std::abs(buf.getReadPointer(0)[i] - 0.5f * 0.5f) < 1e-3f);
}

// A param name that resolves to an EXISTING register is refused while it is still a description: process()
// writes the nth param into register n+1 by position, so the shift would land a later one on a literal.
void a_duplicate_param_name_is_refused() {
    juce::String error;
    auto g = DspGraph::build(juce::JSON::parse(R"({
      "params": [ { "name": "Amount", "min": 0, "max": 1, "default": 0.5 },
                  { "name": "Amount", "min": 0, "max": 1, "default": 0.25 } ],
      "nodes":  [ { "type": "gain", "in": ["Amount"] } ]
    })"), error);
    CHECK(g == nullptr);
    CHECK(error.contains("declared twice"));
}

// …and `sr`, which the graph reserves for the sample rate: taking it would put a param on register 0.
void a_param_called_sr_is_refused() {
    juce::String error;
    auto g = DspGraph::build(juce::JSON::parse(R"({
      "params": [ { "name": "sr", "min": 0, "max": 1, "default": 0.5 } ],
      "nodes":  [ { "type": "gain", "in": ["sr"] } ]
    })"), error);
    CHECK(g == nullptr);
    CHECK(error.contains("sr"));
}

// The RMS gain in dB a one-node biquad graph gives a sine at `hz`, measured after it has settled.
float biquadGainDb(const char* mode, float freq, float q, float gainDb, float hz) {
    const auto json = juce::String(R"({ "params": [ { "name": "F", "min": 20, "max": 20000, "default": 1000 },
      { "name": "Q", "min": 0.1, "max": 10, "default": 1 }, { "name": "G", "min": -24, "max": 24, "default": 0 } ],
      "nodes": [ { "type": "biquad", "in": ["F", "Q", "G"], "mode": ")") + mode + "\" } ] }";
    auto g = buildGraph(json.toRawUTF8());
    if (!g) return 0.0f;
    g->prepare(kRate, kBlock);
    const float params[3] = {freq, q, gainDb};
    double in = 0.0, out = 0.0;
    int t = 0;
    for (int block = 0; block < 40; ++block) {
        juce::AudioBuffer<float> buf(2, kBlock);
        for (int i = 0; i < kBlock; ++i, ++t) {
            const float v = 0.5f * std::sin(juce::MathConstants<float>::twoPi * hz * (float)t / (float)kRate);
            buf.getWritePointer(0)[i] = buf.getWritePointer(1)[i] = v;
            if (block >= 20) in += (double)v * v;
        }
        g->process(buf, 0, kBlock, params, 3);
        if (block >= 20)
            for (int i = 0; i < kBlock; ++i) out += (double)buf.getReadPointer(0)[i] * buf.getReadPointer(0)[i];
    }
    return (float)(10.0 * std::log10(out / in));
}

void a_peak_boosts_its_own_frequency_by_its_gain_and_leaves_the_rest() {
    CHECK(std::abs(biquadGainDb("peak", 1000.0f, 1.0f, 12.0f, 1000.0f) - 12.0f) < 0.5f);
    CHECK(std::abs(biquadGainDb("peak", 1000.0f, 1.0f, -9.0f, 1000.0f) + 9.0f) < 0.5f);
    CHECK(std::abs(biquadGainDb("peak", 1000.0f, 4.0f, 12.0f, 8000.0f)) < 0.5f);
}

void a_shelf_moves_its_side_and_not_the_other() {
    CHECK(std::abs(biquadGainDb("lowshelf", 300.0f, 0.707f, -12.0f, 40.0f) + 12.0f) < 0.7f);
    CHECK(std::abs(biquadGainDb("lowshelf", 300.0f, 0.707f, -12.0f, 8000.0f)) < 0.5f);
    CHECK(std::abs(biquadGainDb("highshelf", 3000.0f, 0.707f, 6.0f, 15000.0f) - 6.0f) < 0.7f);
    CHECK(std::abs(biquadGainDb("highshelf", 3000.0f, 0.707f, 6.0f, 100.0f)) < 0.5f);
}

// At 0 dB a peak is the identity: a band left flat colours nothing.
void a_peak_at_zero_db_is_transparent() {
    CHECK(std::abs(biquadGainDb("peak", 1000.0f, 1.0f, 0.0f, 1000.0f)) < 0.05f);
}

// An all-pass keeps every level and turns DC upside down: H(1) = -1 for a first-order one, whatever its corner.
void an_allpass_passes_dc_at_full_level_inverted() {
    auto g = buildGraph(R"({
      "params": [],
      "nodes": [
        { "type": "ain", "out": "x" },
        { "type": "aallpass", "in": ["x"], "k": [800], "out": "y" },
        { "type": "aout", "in": ["y"] }
      ]
    })");
    if (!g) return;
    g->prepare(kRate, kBlock);
    // Several blocks, so the one-sample memory has settled and the last block is steady state.
    juce::AudioBuffer<float> buf;
    for (int i = 0; i < 20; ++i) {
        buf = dc(0.25f);
        g->process(buf, 0, kBlock, nullptr, 0);
    }
    CHECK(std::abs(buf.getReadPointer(0)[kBlock - 1] + 0.25f) < 1.0e-3f);
    CHECK(std::abs(buf.getReadPointer(1)[kBlock - 1] + 0.25f) < 1.0e-3f);
}

// The spread runs the right channel ahead: half a cycle of a still triangle is its top on one side, its floor on the other.
void an_lfo_spread_puts_the_right_channel_ahead() {
    auto g = buildGraph(R"({
      "params": [],
      "nodes": [
        { "type": "alfo", "k": [0, 0.5], "shape": "triangle", "out": "l" },
        { "type": "aout", "in": ["l"] }
      ]
    })");
    if (!g) return;
    g->prepare(kRate, kBlock);
    auto buf = dc(0.0f);
    g->process(buf, 0, kBlock, nullptr, 0);
    CHECK(std::abs(buf.getReadPointer(0)[10] - 1.0f) < 1.0e-5f);
    CHECK(std::abs(buf.getReadPointer(1)[10] + 1.0f) < 1.0e-5f);
}

int main() {
    RUN(a_duplicate_param_name_is_refused);
    RUN(a_param_called_sr_is_refused);
    RUN(an_envelope_follows_the_louder_channel);
    RUN(an_envelope_follows_it_on_either_side);
    RUN(an_envelope_on_a_mono_buffer_reads_one_channel);
    RUN(mix_moves_the_output_of_a_sample_rate_graph);
    RUN(mix_at_zero_gives_back_exactly_what_came_in);
    RUN(mix_at_one_gives_the_graph_untouched);
    RUN(mix_interpolates_between_the_two);
    RUN(where_mix_sits_in_the_list_does_not_matter);
    RUN(an_audio_only_graph_is_unchanged_by_the_move);
    RUN(the_dry_snapshot_is_the_input_not_a_later_stage);
    RUN(a_graph_with_no_mix_node_is_left_alone);
    RUN(a_graph_declares_as_many_inputs_as_its_ports);
    RUN(a_second_port_reads_the_second_pair_of_the_buffer);
    RUN(an_unfed_second_port_is_silence_rather_than_a_read_past_the_end);
    RUN(linmap_with_an_empty_range_is_zero_not_nan);
    RUN(a_block_bigger_than_prepared_is_chunked_not_grown);
    RUN(a_peak_boosts_its_own_frequency_by_its_gain_and_leaves_the_rest);
    RUN(a_shelf_moves_its_side_and_not_the_other);
    RUN(a_peak_at_zero_db_is_transparent);
    RUN(an_allpass_passes_dc_at_full_level_inverted);
    RUN(an_lfo_spread_puts_the_right_channel_ahead);
    TEST_MAIN_END();
}
