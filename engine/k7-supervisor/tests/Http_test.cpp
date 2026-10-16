// Http_test.cpp — reading where a resumed download's answer starts: only a `bytes A-B/T` range
// continues a `.part`, and anything else is a reason to start over.

#include "Http.h"

#include "test_harness.h"

namespace {

void aRangeSaysWhereItStarts()
{
    CHECK(k7::http::contentRangeStart("bytes 1000-1999/2000") == std::uint64_t{1000});
    CHECK(k7::http::contentRangeStart("Bytes 0-9/*") == std::uint64_t{0});
    CHECK(k7::http::contentRangeStart("bytes 1373741824-1373741999/1373742000") == std::uint64_t{1373741824});
    // The answer a 416 carries, another unit, and nonsense all start nowhere.
    CHECK(!k7::http::contentRangeStart("bytes */2000"));
    CHECK(!k7::http::contentRangeStart("items 0-9/10"));
    CHECK(!k7::http::contentRangeStart("bytes 12"));
    CHECK(!k7::http::contentRangeStart(""));
}

}  // namespace

void runHttpTests()
{
    RUN(aRangeSaysWhereItStarts);
}
