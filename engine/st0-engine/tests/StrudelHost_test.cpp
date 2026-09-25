// The embedded Strudel bundle, run in QuickJS: the same lane notes packages/song-strudel/src/engineEntry.test.ts asserts
// under Node, so the two runtimes are held to one answer. JUCE-free, linked against studio_strudel only.
//
// What would be wrong SILENTLY: a bad save that silences the lane (the previous pattern must keep playing), and a
// pattern that never returns and freezes the worker with it. See ../docs/patternPlugin.md.

#include "StrudelHost.h"

#include "test_harness.h"

#include <thread>
#include <vector>

using studio::LaneNote;
using studio::StrudelHost;

namespace {

const char* kDemo = R"(stack(
  note("c e g c5").s("sawtooth").slow(2).label("Pad"),
  sound("bd hh sn hh").label("Kit"),
))";

std::vector<int> keys(const std::vector<LaneNote>& notes) {
    std::vector<int> k;
    for (const auto& n : notes) k.push_back(n.key);
    return k;
}

void theBundleBoots() {
    StrudelHost h;
    CHECK(h.ready());
    if (!h.ready()) std::printf("  boot: %s\n", h.bootError().c_str());
}

void aLaneGetsItsOwnLabelAsNotes() {
    StrudelHost h;
    std::string err;
    CHECK(h.loadPattern(kDemo, err));
    const auto pad = h.laneNotes(0, 1, "pad", err);
    CHECK((keys(pad) == std::vector<int>{48, 52}));
    CHECK(pad.size() == 2 && pad[0].cycle == 0.0 && pad[0].dur == 0.5);
    CHECK((keys(h.laneNotes(0, 1, "Kit", err)) == std::vector<int>{36, 42, 38, 42}));
    CHECK(h.laneNotes(0, 1, "", err).size() == 6);
}

void aBadSaveKeepsThePreviousPattern() {
    StrudelHost h;
    std::string err;
    CHECK(h.loadPattern("s(\"bd sn hh\")", err));
    CHECK(!h.loadPattern("s(\"bd\"", err));
    CHECK(!err.empty());
    CHECK(h.laneNotes(0, 1, "", err).size() == 3);
}

void aRunawayPatternIsCutOff() {
    StrudelHost h;
    h.setDeadlineMs(100);
    std::string err;
    CHECK(!h.loadPattern("while (true) {}\ns(\"bd\")", err));
    CHECK(err.find("interrupted") != std::string::npos);
    CHECK(h.loadPattern("s(\"bd sn\")", err));
    CHECK(h.laneNotes(0, 1, "", err).size() == 2);
}

void anotherThreadCanQueryIt() {
    StrudelHost h;
    std::string err;
    CHECK(h.loadPattern(kDemo, err));
    size_t got = 0;
    std::thread t([&] {
        std::string e;
        for (int i = 0; i < 200; ++i) got += h.laneNotes(i * 0.1, (i + 1) * 0.1, "Kit", e).size();
    });
    t.join();
    CHECK(got == 80);  // 20 cycles of four hits
}

}  // namespace

int main() {
    RUN(theBundleBoots);
    RUN(aLaneGetsItsOwnLabelAsNotes);
    RUN(aBadSaveKeepsThePreviousPattern);
    RUN(aRunawayPatternIsCutOff);
    RUN(anotherThreadCanQueryIt);
    TEST_MAIN_END();
}
