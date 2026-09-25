// HostProtocol_test.cpp — the frames the tray parses: keys it reads are present, the optional ones
// are absent rather than empty, and a command line survives only when it is a command.

#include "HostProtocol.h"

#include "test_harness.h"

using namespace st0::protocol;

namespace {

void aStateFrameCarriesWhatTheTrayReads()
{
    Snapshot s;
    s.engineId = "e1";
    s.instanceCheck = InstanceCheck{"https://play.st0.app", "checking", ""};
    const auto f = stateFrame(s);
    CHECK(f["t"] == "state");
    CHECK(f["owns"]["engine"] == true);
    CHECK(f["pluginCount"].is_null());
    CHECK(!f.contains("error"));
    CHECK(f["instanceCheck"]["state"] == "checking");
    CHECK(!f["instanceCheck"].contains("message"));
    CHECK(f["paths"].contains("mergedLog"));
    // A frame is ONE line: a newline inside it would end it early.
    CHECK(f.dump().find('\n') == std::string::npos);
}

void anErrorAndACountAppearWhenSet()
{
    Snapshot s;
    s.status = "error";
    s.error = "engine binary not found (build it)";
    s.pluginCount = 3;
    const auto f = stateFrame(s);
    CHECK(f["error"] == "engine binary not found (build it)");
    CHECK(f["pluginCount"] == 3);
}

void aCommandIsParsedAndAnythingElseIsNot()
{
    auto c = parseCommand(R"({"t":"cmd","id":4,"cmd":"audio.priority","arg":"A\u001fB"})");
    CHECK(c.has_value());
    CHECK(c->id == 4);
    CHECK(c->cmd == "audio.priority");
    CHECK((splitUnits(c->arg) == std::vector<std::string>{"A", "B"}));
    CHECK(!parseCommand(""));
    CHECK(!parseCommand("   "));
    CHECK(!parseCommand(R"({"t":"state"})"));
    CHECK(!parseCommand("{not json"));
}

void aResultEchoesItsId()
{
    const auto f = resultFrame(9, false, "no");
    CHECK(f["id"] == 9);
    CHECK(f["ok"] == false);
    CHECK(f["message"] == "no");
    CHECK(!resultFrame(1, true).contains("message"));
}

void anEmptyRankingSplitsToNothing() { CHECK(splitUnits("").empty()); }

}  // namespace

void runHostProtocolTests()
{
    RUN(aStateFrameCarriesWhatTheTrayReads);
    RUN(anErrorAndACountAppearWhenSet);
    RUN(aCommandIsParsedAndAnythingElseIsNot);
    RUN(aResultEchoesItsId);
    RUN(anEmptyRankingSplitsToNothing);
}
