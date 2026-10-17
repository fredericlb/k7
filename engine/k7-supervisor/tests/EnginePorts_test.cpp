// EnginePorts_test.cpp — the ports a start tries: the settings' port first, then the next ones, and
// only that one when `--port` fixes it. What holds a port is asked of the OS, so it is tried by hand.

#include "EngineProcess.h"

#include "test_harness.h"

using k7::engine::candidatePorts;
using k7::engine::kPortSpan;

namespace {

void theFirstPortLeadsAndTheNextOnesFollow()
{
    const auto ports = candidatePorts(8766, false);
    CHECK(static_cast<int>(ports.size()) == kPortSpan);
    CHECK(ports.front() == 8766);
    CHECK(ports.back() == 8766 + kPortSpan - 1);
}

void aFixedPortIsTheOnlyOne()
{
    CHECK((candidatePorts(8766, true) == std::vector<int>{8766}));
}

void theRangeStopsAtTheLastPort()
{
    CHECK((candidatePorts(65534, false) == std::vector<int>{65534, 65535}));
    CHECK(candidatePorts(0, false).empty());
}

}  // namespace

void runEnginePortsTests()
{
    RUN(theFirstPortLeadsAndTheNextOnesFollow);
    RUN(aFixedPortIsTheOnlyOne);
    RUN(theRangeStopsAtTheLastPort);
}
