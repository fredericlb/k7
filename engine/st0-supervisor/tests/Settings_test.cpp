// Settings_test.cpp — the settings file is hand-edited, so each field stands alone and the older
// spellings are read as the new ones; a round trip gives back exactly what went in.

#include "Settings.h"

#include "test_harness.h"

using nlohmann::json;
using st0::Settings;
using st0::settingsFrom;

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
    const Settings s = settingsFrom(json::parse(R"({"registryUrl":"https://st0.app","audioDevice":"A","audioFallback":"B"})"));
    CHECK(s.registryUrls == std::vector<std::string>{"https://st0.app"});
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
    const Settings out = settingsFrom(st0::settingsJson(in));
    CHECK(out.registryUrls == in.registryUrls);
    CHECK(out.port == 9001);
    CHECK(out.audioPriority == in.audioPriority);
    CHECK(out.onnxProviders == in.onnxProviders);
}

void aPortOutOfRangeIsTheDefault()
{
    CHECK(settingsFrom(json::parse(R"({"port":70000})")).port == 8765);
    CHECK(settingsFrom(json::parse(R"({"port":0})")).port == 8765);
}

}  // namespace

void runSettingsTests()
{
    RUN(oneBadKeyLosesNothingElse);
    RUN(olderSpellingsAreMigratedInTheReader);
    RUN(providersAreLowercasedAndDeduplicated);
    RUN(aRoundTripIsExact);
    RUN(aPortOutOfRangeIsTheDefault);
}
