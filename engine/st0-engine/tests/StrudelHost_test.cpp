// The embedded Strudel bundle, run in QuickJS: the same lane events packages/song-strudel/src/engineEntry.test.ts asserts
// under Node, so the two runtimes are held to one answer. JUCE-free, linked against studio_strudel only.
//
// What would be wrong SILENTLY: a bad save that silences the lane (the previous pattern must keep playing), and a
// pattern that never returns and freezes the worker with it. See ../docs/patternPlugin.md.

#include "StrudelHost.h"

#include "test_harness.h"

#include <algorithm>
#include <thread>
#include <vector>

using studio::LaneEvent;
using studio::StrudelHost;

namespace {

const char* kDemo = R"(stack(
  note("c e g c5").s("sawtooth").slow(2).label("Pad"),
  sound("bd hh sn hh").label("Kit"),
  note("a4 b4"),
  s("cp").label("Stray"),
))";

const std::vector<std::string> kClaimed{"pad", "kit"};

std::vector<int> keys(const std::vector<LaneEvent>& ev) {
    std::vector<int> k;
    for (const auto& e : ev) k.push_back(e.key);
    return k;
}

void theBundleBoots() {
    StrudelHost h;
    CHECK(h.ready());
    if (!h.ready()) std::printf("  boot: %s\n", h.bootError().c_str());
}

void aLaneGetsItsOwnLabel() {
    StrudelHost h;
    std::string err;
    CHECK(h.loadPattern(kDemo, err));
    const auto pad = h.laneEvents(0, 1, "pad", false, kClaimed, err);
    CHECK((keys(pad) == std::vector<int>{48, 52}));
    CHECK(pad.size() == 2 && pad[0].cycle == 0.0 && pad[0].dur == 0.5 && pad[0].s == "sawtooth");
    const auto kit = h.laneEvents(0, 1, "Kit", false, kClaimed, err);
    CHECK((keys(kit) == std::vector<int>{36, 42, 38, 42}));
    CHECK(kit.size() == 4 && kit[0].s == "bd");
}

void theCatchAllLaneTakesWhatNoLaneClaims() {
    StrudelHost h;
    std::string err;
    CHECK(h.loadPattern(kDemo, err));
    // Its own two, the two unlabelled notes, and the one labelled for no lane.
    const auto all = h.laneEvents(0, 1, "pad", true, kClaimed, err);
    CHECK(all.size() == 5);
    CHECK(std::count_if(all.begin(), all.end(), [](const LaneEvent& e) { return e.s == "cp"; }) == 1);
    CHECK(std::count_if(all.begin(), all.end(), [](const LaneEvent& e) { return e.s.empty(); }) == 2);
}

void theLabelsAreListed() {
    StrudelHost h;
    std::string err;
    CHECK(h.loadPattern(kDemo, err));
    auto l = h.labels(0, 2);
    std::sort(l.begin(), l.end());
    CHECK((l == std::vector<std::string>{"Kit", "Pad", "Stray"}));
}

void aBadSaveKeepsThePreviousPattern() {
    StrudelHost h;
    std::string err;
    CHECK(h.loadPattern("s(\"bd sn hh\")", err));
    CHECK(!h.loadPattern("s(\"bd\"", err));
    CHECK(!err.empty());
    CHECK(h.laneEvents(0, 1, "x", true, {}, err).size() == 3);
}

void aRunawayPatternIsCutOff() {
    StrudelHost h;
    h.setDeadlineMs(100);
    std::string err;
    CHECK(!h.loadPattern("while (true) {}\ns(\"bd\")", err));
    CHECK(err.find("interrupted") != std::string::npos);
    CHECK(h.loadPattern("s(\"bd sn\")", err));
    CHECK(h.laneEvents(0, 1, "x", true, {}, err).size() == 2);
}

// On a thread whose stack nobody sized, a recursion must come back as an error: past the stack's real end it is a SIGSEGV.
void aRecursivePatternIsAnErrorNotACrash() {
    StrudelHost h;
    std::string err;
    bool loaded = true;
    std::thread t([&] { loaded = h.loadPattern("const f = (n) => f(n + 1) + 1; f(0)\ns(\"bd\")", err); });
    t.join();
    CHECK(!loaded);
    CHECK(!err.empty());
    CHECK(h.loadPattern("s(\"bd sn\")", err));
    CHECK(h.laneEvents(0, 1, "x", true, {}, err).size() == 2);
}

void anotherThreadCanQueryIt() {
    StrudelHost h;
    std::string err;
    CHECK(h.loadPattern(kDemo, err));
    size_t got = 0;
    std::thread t([&] {
        std::string e;
        for (int i = 0; i < 200; ++i) got += h.laneEvents(i * 0.1, (i + 1) * 0.1, "Kit", false, kClaimed, e).size();
    });
    t.join();
    CHECK(got == 80);  // 20 cycles of four hits
}

}  // namespace

int main() {
    RUN(theBundleBoots);
    RUN(aLaneGetsItsOwnLabel);
    RUN(theCatchAllLaneTakesWhatNoLaneClaims);
    RUN(theLabelsAreListed);
    RUN(aBadSaveKeepsThePreviousPattern);
    RUN(aRunawayPatternIsCutOff);
    RUN(aRecursivePatternIsAnErrorNotACrash);
    RUN(anotherThreadCanQueryIt);
    TEST_MAIN_END();
}
