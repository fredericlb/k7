// Performance_test.cpp — the scoring cases of packages/web-protocol/performance.test.ts: the
// reference machine is 1000, every metric moves it the right way, an unmeasured one is left out.

#include "Performance.h"

#include "test_harness.h"

using st0::performance::Metrics;
using st0::performance::score;

namespace {

Metrics reference()
{
    Metrics m;
    m.cores = 8;
    m.singleThread = 60;
    m.diskWriteMBps = 500;
    m.fsyncPerSec = 200;
    m.memoryGB = 16;
    return m;
}

void theReferenceIsAThousand() { CHECK(score(reference()) == 1000); }

void everyMetricMovesItTheRightWay()
{
    auto better = reference(), worse = reference();
    better.cores = 16;
    worse.cores = 4;
    CHECK(score(better) > 1000);
    CHECK(score(worse) < 1000);
    better = reference();
    worse = reference();
    better.diskWriteMBps = 1000;
    worse.diskWriteMBps = 250;
    CHECK(score(better) > 1000);
    CHECK(score(worse) < 1000);
}

void anUnmeasuredDiskIsLeftOutNotZero()
{
    auto m = reference();
    m.diskWriteMBps.reset();
    m.fsyncPerSec.reset();
    CHECK(score(m) == 1000);
}

void theJsonCarriesItsScore()
{
    const auto j = st0::performance::toJson(reference());
    CHECK(j["score"] == 1000);
    CHECK(j["cores"] == 8);
}

}  // namespace

void runPerformanceTests()
{
    RUN(theReferenceIsAThousand);
    RUN(everyMetricMovesItTheRightWay);
    RUN(anUnmeasuredDiskIsLeftOutNotZero);
    RUN(theJsonCarriesItsScore);
}
