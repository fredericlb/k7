// Unit tests for DocJson — the wire is where a number Tracktion divides by or loops over is bounded.
// JUCE-free: DocJson.cpp, ProjectDoc.cpp and Warnings.cpp compile straight in, like the diff suite.

#include "../server/DocJson.h"
#include "PathRoots.h"
#include "Warnings.h"
#include "test_harness.h"

#include <filesystem>
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

// An output pair is a rack grown to that many outputs; 0..31 is the sampler's own range.
void pairs_are_bounded() {
    const json plugin{{"id", "kit"}, {"tapOuts", json::array({json{{"note", 400}, {"pair", 1000000}}})}};
    const json track{{"id", "t"}, {"plugins", json::array({plugin})}, {"inputFrom", {{"plugin", "kit"}, {"pair", -7}}}};
    const auto doc = docFromJson(json{{"tracks", json::array({track})}});
    CHECK(doc.tracks.at(0).plugins.at(0).tapOuts.at(0).pair == 31);
    CHECK(doc.tracks.at(0).plugins.at(0).tapOuts.at(0).note == 127);
    CHECK(doc.tracks.at(0).inputFromPair == 0);
}

// The engine deletes or overwrites a preset save path on every autosave, so it is a .vstpreset or nothing.
void preset_save_must_be_a_vstpreset() {
    std::vector<Warning> seen;
    setWarningSink([&](const Warning& w) { seen.push_back(w); });
    const auto kept = pluginFromJson(json{{"id", "a"}, {"presetSave", "/x/Amp.VSTPRESET"}});
    const auto dropped = pluginFromJson(json{{"id", "b"}, {"presetSave", "/x/.bashrc"}});
    const auto unc = pluginFromJson(json{{"id", "c"}, {"presetSave", "\\\\host\\share\\a.vstpreset"}});
    setWarningSink(nullptr);
    CHECK(kept.presetSave == "/x/Amp.VSTPRESET");
    CHECK(dropped.presetSave.empty());
    CHECK(unc.presetSave.empty());
    CHECK(seen.size() == 2);
}

// Once serve() set the roots, a path outside them is dropped where it arrives; this runs LAST, the roots being process-wide.
void paths_outside_the_roots_are_dropped() {
    namespace fs = std::filesystem;
    const auto root = fs::weakly_canonical(fs::temp_directory_path()) / "k7-docjson-roots";
    fs::create_directories(root);
    setPathRoots({{root.string()}, {root.string()}});
    std::vector<Warning> seen;
    setWarningSink([&](const Warning& w) { seen.push_back(w); });
    const json clip{{"id", "c"}, {"source", (root / "a.wav").string()}};
    const json stray{{"id", "d"}, {"source", (root / ".." / "b.wav").string()}};
    const json plugin{{"id", "p"}, {"namFile", "/etc/passwd"}, {"presetSave", (root / "p.vstpreset").string()}};
    const json track{{"id", "t"}, {"clips", json::array({clip, stray})}, {"plugins", json::array({plugin})}};
    const auto doc = docFromJson(json{{"recordDir", "/"}, {"tracks", json::array({track})}});
    setWarningSink(nullptr);
    CHECK(doc.tracks.at(0).clips.at(0).source == (root / "a.wav").string());
    CHECK(doc.tracks.at(0).clips.at(1).source.empty());
    CHECK(doc.tracks.at(0).plugins.at(0).namFile.empty());
    CHECK(!doc.tracks.at(0).plugins.at(0).presetSave.empty());
    CHECK(doc.recordDir.empty());
    CHECK(seen.size() == 3);
    fs::remove_all(root);
}

}  // namespace

int main() {
    RUN(timesig_zero_denominator_is_refused);
    RUN(timesig_valid_is_kept);
    RUN(note_fields_are_bounded);
    RUN(duplicate_ids_are_renamed);
    RUN(pairs_are_bounded);
    RUN(preset_save_must_be_a_vstpreset);
    RUN(paths_outside_the_roots_are_dropped);
    TEST_MAIN_END();
}
