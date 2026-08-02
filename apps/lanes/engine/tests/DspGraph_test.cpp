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

using namespace lanes;

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

}  // namespace

int main() {
    RUN(mix_moves_the_output_of_a_sample_rate_graph);
    RUN(mix_at_zero_gives_back_exactly_what_came_in);
    RUN(mix_at_one_gives_the_graph_untouched);
    RUN(mix_interpolates_between_the_two);
    RUN(where_mix_sits_in_the_list_does_not_matter);
    RUN(an_audio_only_graph_is_unchanged_by_the_move);
    RUN(the_dry_snapshot_is_the_input_not_a_later_stage);
    RUN(a_graph_with_no_mix_node_is_left_alone);
    TEST_MAIN_END();
}
