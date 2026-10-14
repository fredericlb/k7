// Unit tests for DocJson — the wire is where a number Tracktion divides by or loops over is bounded.
// JUCE-free: DocJson.cpp, ProjectDoc.cpp and Warnings.cpp compile straight in, like the diff suite.

#include "../server/DocJson.h"
#include "Warnings.h"
#include "test_harness.h"

#include <vector>

using namespace studio;
using json = nlohmann::json;

namespace {

// A denominator of 0 is 240/(bpm*0) inside Tracktion; it is read as 4/4 and said so.
void timesig_zero_denominator_is_refused() {
    std::vector<Warning> seen;
    setWarningSink([&](const Warning& w) { seen.push_back(w); });
    const auto doc = docFromJson(json{{"timeSigNumerator", 0}, {"timeSigDenominator", 0}});
    setWarningSink(nullptr);
    CHECK(doc.timeSigNumerator == 4);
    CHECK(doc.timeSigDenominator == 4);
    CHECK(!seen.empty());
}

// A playable signature passes untouched, and silently.
void timesig_valid_is_kept() {
    std::vector<Warning> seen;
    setWarningSink([&](const Warning& w) { seen.push_back(w); });
    const auto doc = docFromJson(json{{"timeSigNumerator", 7}, {"timeSigDenominator", 8}});
    setWarningSink(nullptr);
    CHECK(doc.timeSigNumerator == 7);
    CHECK(doc.timeSigDenominator == 8);
    CHECK(seen.empty());
}

// Loop counts and MIDI numbers come off the wire bounded.
void note_fields_are_bounded() {
    const json note{{"key", 900}, {"repeat", 1000000000}, {"skip", -5}};
    const json clip{{"type", "midi"}, {"notes", json::array({note})}};
    const json track{{"id", "t1"}, {"clips", json::array({clip})}};
    const auto doc = docFromJson(json{{"tracks", json::array({track})}, {"sampleRate", 0}, {"tempo", -3.0}});
    const auto& n = doc.tracks.at(0).clips.at(0).notes.at(0);
    CHECK(n.key == 127);
    CHECK(n.repeat == 64);
    CHECK(n.skip == 0);
    CHECK(doc.sampleRate == 48000);
    CHECK(doc.tempo == 120.0);
}

// A repeated id is renamed in document order, and said: every map downstream is keyed by it.
void duplicate_ids_are_renamed() {
    std::vector<Warning> seen;
    setWarningSink([&](const Warning& w) { seen.push_back(w); });
    const json plug{{"id", "fx"}, {"type", "4osc"}};
    const json clip{{"id", "c"}, {"type", "midi"}};
    const json t1{{"id", "t"}, {"plugins", json::array({plug})}, {"clips", json::array({clip, clip})}};
    const json t2{{"id", "t"}, {"plugins", json::array({plug})}};
    const auto doc = docFromJson(json{{"tracks", json::array({t1, t2})}});
    setWarningSink(nullptr);
    CHECK(doc.tracks.at(0).id == "t");
    CHECK(doc.tracks.at(1).id == "t#2");
    CHECK(doc.tracks.at(0).plugins.at(0).id == "fx");
    CHECK(doc.tracks.at(1).plugins.at(0).id == "fx#2");
    CHECK(doc.tracks.at(0).clips.at(1).id == "c#2");
    CHECK(seen.size() == 3);
}

}  // namespace

int main() {
    RUN(timesig_zero_denominator_is_refused);
    RUN(timesig_valid_is_kept);
    RUN(note_fields_are_bounded);
    RUN(duplicate_ids_are_renamed);
    TEST_MAIN_END();
}
