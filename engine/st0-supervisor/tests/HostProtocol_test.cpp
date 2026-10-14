// HostProtocol_test.cpp — the frames an app parses: keys it reads are present, the optional ones
// are absent rather than empty, and a command line survives only when it is a command.

#include "HostProtocol.h"

#include "test_harness.h"

using namespace st0::protocol;

namespace {

void aStateFrameCarriesWhatAnAppReads()
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
    // The Downloads tab's rows are always there, an empty list included, unlike the transient `downloads`.
    CHECK(f["instruments"].is_array() && f["instruments"].empty());
    CHECK(!f.contains("downloads"));
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

void anInstrumentRowCarriesWhatTheTabDraws()
{
    Snapshot s;
    s.instruments = {{"nbo-wurt", "Wurlitzer", 7947927, true, false}};
    s.downloads = {{"nbo-wurt", "Wurlitzer", 0, 7947927, "queued", ""}};
    const auto f = stateFrame(s);
    const auto& row = f["instruments"][0];
    CHECK(row["name"] == "nbo-wurt");
    CHECK(row["bytes"] == 7947927);
    CHECK(row["wanted"] == true);
    CHECK(row["installed"] == false);
    CHECK(f["downloads"][0]["phase"] == "queued");
}

void aPairingRowCarriesWhatTheTabDraws()
{
    Snapshot s;
    s.pairRequests = {{"r1", "iPhone · Safari", "192.168.1.20", "482913", 1760000000000}};
    s.pairedDevices = {{"d1", "iPad", 1760000000000, 1760000600000}};
    const auto f = stateFrame(s);
    CHECK(f["pairRequests"][0]["requestId"] == "r1");
    CHECK(f["pairRequests"][0]["code"] == "482913");
    CHECK(f["pairRequests"][0]["since"] == 1760000000000);
    CHECK(f["pairedDevices"][0]["deviceId"] == "d1");
    CHECK(f["pairedDevices"][0]["lastSeen"] == 1760000600000);
    CHECK(stateFrame(Snapshot{})["pairRequests"].empty());
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
    RUN(aStateFrameCarriesWhatAnAppReads);
    RUN(anErrorAndACountAppearWhenSet);
    RUN(anInstrumentRowCarriesWhatTheTabDraws);
    RUN(aPairingRowCarriesWhatTheTabDraws);
    RUN(aCommandIsParsedAndAnythingElseIsNot);
    RUN(aResultEchoesItsId);
    RUN(anEmptyRankingSplitsToNothing);
}
