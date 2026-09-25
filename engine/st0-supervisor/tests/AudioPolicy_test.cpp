// AudioPolicy_test.cpp — the rules stated in the test names: there is one list,
// and the first entry present wins.

#include "AudioPolicy.h"

#include "test_harness.h"

using namespace st0::audio;

namespace {

AudioDevice dev(const std::string& name, bool current) { return {name, "CoreAudio", current}; }

void staysPutOnTheBestPresent()
{
    CHECK(!desiredSwitch({dev("Scarlett", true), dev("Built-in", false)}, {"Scarlett", "Built-in"}));
}

void returnsWhenTheBetterOneReappears()
{
    CHECK(desiredSwitch({dev("Scarlett", false), dev("Built-in", true)}, {"Scarlett", "Built-in"}) ==
          std::optional<std::string>("Scarlett"));
}

void goesDownTheListWhenOneIsUnplugged()
{
    CHECK(desiredSwitch({dev("Built-in", false), dev("HDMI", true)}, {"Scarlett", "Built-in"}) ==
          std::optional<std::string>("Built-in"));
}

void takesTheFirstPresentEntry()
{
    CHECK(desiredSwitch({dev("Scarlett", false), dev("Built-in", false), dev("HDMI", true)},
                        {"Scarlett", "Built-in", "HDMI"}) == std::optional<std::string>("Scarlett"));
}

void leavesAnUnrankedDeviceAlone()
{
    CHECK(!desiredSwitch({dev("HDMI", true)}, {"Scarlett", "Built-in"}));
    CHECK(!desiredSwitch({dev("HDMI", false)}, {}));
}

void ranksOneEvenWhenNothingIsCurrent()
{
    CHECK(desiredSwitch({dev("Built-in", false), dev("HDMI", false)}, {"Built-in"}) ==
          std::optional<std::string>("Built-in"));
}

void neverActsOnAnEmptyList() { CHECK(!desiredSwitch({}, {"Scarlett"})); }

void aReorderMovesTheMenuSignatureButNotTheSetOne()
{
    const std::vector<AudioDevice> d{dev("A", true), dev("B", false)};
    CHECK(menuSignature(d, {"A", "B"}) != menuSignature(d, {"B", "A"}));
    CHECK(signature(d) == signature({dev("B", true), dev("A", false)}));
}

}  // namespace

void runAudioPolicyTests()
{
    RUN(staysPutOnTheBestPresent);
    RUN(returnsWhenTheBetterOneReappears);
    RUN(goesDownTheListWhenOneIsUnplugged);
    RUN(takesTheFirstPresentEntry);
    RUN(leavesAnUnrankedDeviceAlone);
    RUN(ranksOneEvenWhenNothingIsCurrent);
    RUN(neverActsOnAnEmptyList);
    RUN(aReorderMovesTheMenuSignatureButNotTheSetOne);
}
