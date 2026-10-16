// Settings_test.cpp — the settings file is hand-edited, so each field stands alone and the older
// spellings are read as the new ones; a round trip gives back exactly what went in.

#include "Settings.h"

#include "test_harness.h"

using nlohmann::json;
using k7::Settings;
using k7::settingsFrom;

namespace {

void oneBadKeyLosesNothingElse()
{
    const Settings s = settingsFrom(json::parse(R"({"port":"nope","audioPriority":["Scarlett"],"registryUrls":7})"));
    CHECK(s.port == 8765);
    CHECK(s.audioPriority == std::vector<std::string>{"Scarlett"});
    CHECK(s.registryUrls.empty());
}

void olderSpellingsAreMigratedInTheReader()
{
    const Settings s = settingsFrom(json::parse(R"({"registryUrl":"https://app.k7.rocks","audioDevice":"A","audioFallback":"B"})"));
    CHECK(s.registryUrls == std::vector<std::string>{"https://app.k7.rocks"});
    CHECK((s.audioPriority == std::vector<std::string>{"A", "B"}));
}

void providersAreLowercasedAndDeduplicated()
{
    const Settings s = settingsFrom(json::parse(R"({"onnxProviders":[" DML ","cpu","dml",""]})"));
    CHECK((s.onnxProviders == std::vector<std::string>{"dml", "cpu"}));
}

void aRoundTripIsExact()
{
    Settings in;
    in.registryUrls = {"https://play.st0.app"};
    in.port = 9001;
    in.audioPriority = {"Scarlett", "Built-in"};
    in.onnxProviders = {"coreml", "cpu"};
    const Settings out = settingsFrom(k7::settingsJson(in));
    CHECK(out.registryUrls == in.registryUrls);
    CHECK(out.port == 9001);
    CHECK(out.audioPriority == in.audioPriority);
    CHECK(out.onnxProviders == in.onnxProviders);
    CHECK(!out.instruments.has_value());
}

// Absent is "never chosen", which a boot settles; an empty list is a choice to keep nothing, and stays one.
void theInstrumentsKeptTellAbsentFromEmpty()
{
    CHECK(!settingsFrom(json::parse(R"({"port":9001})")).instruments.has_value());
    CHECK(!settingsFrom(json::parse(R"({"instruments":"nbo-wurt"})")).instruments.has_value());
    const auto none = settingsFrom(json::parse(R"({"instruments":[]})"));
    CHECK(none.instruments.has_value() && none.instruments->empty());
    Settings in;
    in.instruments = std::vector<std::string>{"nbo-wurt", "naked-drums"};
    CHECK(settingsFrom(k7::settingsJson(in)).instruments == in.instruments);
    CHECK(!k7::settingsJson(Settings{}).contains("instruments"));
}

void aPortOutOfRangeIsTheDefault()
{
    CHECK(settingsFrom(json::parse(R"({"port":70000})")).port == 8765);
    CHECK(settingsFrom(json::parse(R"({"port":0})")).port == 8765);
}

void aConfigFileSetsWhatTheEnvironmentOtherwiseCarries()
{
    const auto env = k7::configEnvironment(
        json::parse(R"({"machineName":" rehearsal-pc ","renderKey":"","extraCaCerts":"/ca.pem","instruments":["all"]})"));
    CHECK((env == std::vector<std::pair<std::string, std::string>>{
                      {"STUDIO_MACHINE_NAME", "rehearsal-pc"},
                      {"STUDIO_EXTRA_CA_CERTS", "/ca.pem"},
                      {"STUDIO_INSTRUMENTS", "all"}}));
    CHECK(k7::configEnvironment(json::parse(R"({"instruments":["surge"]})")).empty());
}

void deviceTokensAreKeptByStudio()
{
    const Settings s = settingsFrom(json::parse(
        R"({"registryUrls":["https://st0.app"],"deviceTokens":{"https://st0.app":" t1 ","https://x.example":7}})"));
    CHECK(s.deviceTokens.size() == 1);
    CHECK(s.deviceTokens.at("https://st0.app") == "t1");
    // And back: a supervisor saving its settings must not drop the token a phone wrote.
    CHECK(settingsFrom(k7::settingsJson(s)).deviceTokens == s.deviceTokens);
}

void aConfigFilesOneTokenIsItsOwnStudios()
{
    const Settings s = settingsFrom(json::parse(
        R"({"registryUrls":["https://st0.app","https://b.example"],"deviceToken":"cli","deviceTokens":{"https://b.example":"own"}})"));
    CHECK(s.deviceTokens.at("https://st0.app") == "cli");
    // A studio with a token of its own keeps it.
    CHECK(s.deviceTokens.at("https://b.example") == "own");
}

}  // namespace

void runSettingsTests()
{
    RUN(oneBadKeyLosesNothingElse);
    RUN(olderSpellingsAreMigratedInTheReader);
    RUN(providersAreLowercasedAndDeduplicated);
    RUN(aRoundTripIsExact);
    RUN(aPortOutOfRangeIsTheDefault);
    RUN(theInstrumentsKeptTellAbsentFromEmpty);
    RUN(aConfigFileSetsWhatTheEnvironmentOtherwiseCarries);
    RUN(deviceTokensAreKeptByStudio);
    RUN(aConfigFilesOneTokenIsItsOwnStudios);
}
