// Unit tests for DspGraph's AUDIO path — specifically `mix`, the one node whose meaning spans every phase.
//
// `mix` blends the graph's output with what came in. It used to run inside the audio phase, which is correct
// for a graph made only of audio nodes (auto-wah: biquad, gain, mix) and a complete no-op for one with a
// sample-rate stage (the flanger): the blend ran on a buffer no node had written yet, so it mixed the dry
// signal with an identical copy of itself, and `aout` then overwrote the result. The Mix knob did nothing at
// any setting. These tests are on the ARITHMETIC — a mix is a weighted sum, and a weighted sum is checkable.

#include "DspGraph.h"
#include "test_harness.h"

#include <cmath>
#include <initializer_list>

using namespace studio;

namespace {

constexpr double kRate = 48000.0;
constexpr int kBlock = 256;

// The flanger's SHAPE — a sample-rate stage feeding `aout`, then a mix — with the delay and the feedback taken
// out. Doubling is not a flanger, but it is what makes the wet signal a number you can write down: the point
// under test is the phase ORDER, not the DSP.
const char* kSampleGraph = R"({
  "params": [ { "name": "Mix", "min": 0, "max": 1, "default": 0.5 } ],
  "nodes": [
    { "type": "ain", "out": "n0" },
    { "type": "amul", "out": "n1", "in": ["n0"], "k": [2] },
    { "type": "aout", "in": ["n1"] },
    { "type": "mix", "in": ["Mix"] }
  ]
})";

// The same, with `mix` declared FIRST. Its position in the list must not matter: it is a terminal operation,
// not a step. The flanger writes it last, which is exactly the case that would hide an ordering assumption.
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

// A two-input module — the crossfade of packages/song/docs/ports.md, reduced to a sum. `ain` port 1 reads the
// SECOND pair of the render buffer, which is where Tracktion's sidechain routing puts the other track.
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
    // The shape that already worked has to keep working: deferring `mix` past a phase this graph doesn't have
    // must be invisible to it.
    CHECK(std::abs(runOnce(kAudioGraph, 1.0f, 0.1f) - 0.2f) < 1.0e-6f);
    CHECK(std::abs(runOnce(kAudioGraph, 0.0f, 0.1f) - 0.1f) < 1.0e-6f);
}

void the_dry_snapshot_is_the_input_not_a_later_stage() {
    // `mix` blends against what came IN, never against whatever the node before it produced. With gain=2 and
    // mix=0.5 the answer is 0.5·(2x) + 0.5·x = 1.5x; blending against the gained signal would give 2x.
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

// A block of `chans` channels, each holding its own DC level — so which channel a node read is readable off
// the answer rather than inferred.
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
    // `mandatory: false` says wiring one side and leaving the other quiet is legitimate — and Tracktion hands
    // a plugin with no sidechain source a two-channel buffer, so this is the shape that state arrives in.
    auto buf = dcChannels(2, {0.25f, 0.25f});
    g->process(buf, 0, kBlock, nullptr, 0);
    CHECK(std::abs(mean(buf) - 0.25f) < 1.0e-6f);
}

}  // namespace

// --- what the audit of 2026-08-08 fixed, pinned here so it cannot come back -----------------

// linmap with an EMPTY range is 0, not NaN. `jlimit` does not filter NaN — both its comparisons are false, so
// 0/0 came straight out — and a NaN reaching juce::IIRCoefficients::makeBandPass poisons that filter's state
// permanently: the module goes silent and stays silent until the graph is rebuilt. The shipped auto-wah
// computes its `lo` from a lerp, so an empty range was reachable and not hypothetical.
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

// A block LARGER than prepare() was told about is processed, not grown into. process() used to setSize the dry
// snapshot on the audio thread; it now splits the block, so the arithmetic must come out the same.
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

// The ANALYSIS phase — the one phase no graph in this file exercised, which is how a change to its
// per-sample loop could land uncovered. An envelope follows the LOUDER channel: it takes the peak
// across the pair per sample, so a loop that read channel 0 twice, or that lost the second read
// while its pointers were hoisted, would follow the quiet side and be silently wrong on every
// stereo source. Attack 0.1 ms at 48 kHz settles in ~5 samples, so after a block the envelope IS
// the peak, and `gain` then multiplies the buffer by it — a number that can be written down.
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

// A MONO buffer through the same graph: the hoisted read pointers keep a null second entry, and
// `numChans` is what must stop the loop reaching it. One channel, no crash, envelope on that one.
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

int main() {
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
    TEST_MAIN_END();
}
