// Backpressure_test.cpp — which engine frames a slow peer may lose: the `state` frame and the audio
// stream's, and only once the backlog is past the mark; a reply always goes. Drops are counted and
// reported once the peer catches up.

#include "Backpressure.h"

#include "test_harness.h"

#include <nlohmann/json.hpp>

namespace {

const std::string kState = nlohmann::json{{"type", "state"}, {"playing", true}, {"levels", {-6.0}}}.dump();
const std::string kReply = nlohmann::json{{"type", "applied"}, {"note", "state"}}.dump();
const std::string kAudio = std::string("RTSL") + std::string(28, '\0');

void onlySupersededFramesAreDroppable()
{
    CHECK(k7::droppableEngineFrame(kState, false));
    CHECK(k7::droppableEngineFrame(kAudio, true));
    // A reply that merely says the word, a nested `type`, and a binary frame of another kind all go.
    CHECK(!k7::droppableEngineFrame(kReply, false));
    CHECK(!k7::droppableEngineFrame(R"({"type":"sessions","list":[{"type":"state"}]})", false));
    CHECK(!k7::droppableEngineFrame("not json \"state\"", false));
    CHECK(!k7::droppableEngineFrame("PK\x03\x04", true));
    CHECK(!k7::droppableEngineFrame("RT", true));
}

void dropsOnlyPastTheMark()
{
    k7::FrameShedder shed;
    CHECK(shed.admit(kState, false, k7::kDropAboveBytes));
    CHECK(shed.takeShed() == 0);
    CHECK(!shed.admit(kState, false, k7::kDropAboveBytes + 1));
    CHECK(!shed.admit(kAudio, true, k7::kDropAboveBytes + 1));
    // A reply is never dropped, and the count waits for the peer to catch up.
    CHECK(shed.admit(kReply, false, k7::kDropAboveBytes + 1));
    CHECK(shed.takeShed() == 0);
    CHECK(shed.admit(kState, false, 0));
    CHECK(shed.takeShed() == 2);
    CHECK(shed.takeShed() == 0);
}

void aBacklogThatNeverClearsIsStillReported()
{
    k7::FrameShedder shed;
    std::uint64_t refused = 0;
    for (std::uint64_t i = 0; i < k7::kShedReportEvery; ++i) refused += shed.admit(kState, false, 10 * k7::kDropAboveBytes) ? 0 : 1;
    CHECK(refused == k7::kShedReportEvery);
    CHECK(shed.takeShed() == k7::kShedReportEvery);
}

}  // namespace

void runBackpressureTests()
{
    RUN(onlySupersededFramesAreDroppable);
    RUN(dropsOnlyPastTheMark);
    RUN(aBacklogThatNeverClearsIsStillReported);
}
