// RtcFrames_test.cpp — the cases of packages/web-protocol/rtcFrames.test.ts: a frame cut into
// fragments comes back byte for byte, text or binary, at every size around the fragment boundary.

#include "RtcFrames.h"

#include "test_harness.h"

using namespace st0::rtcframes;

namespace {

std::optional<Frame> roundTrip(const std::string& data, bool binary, size_t* count = nullptr)
{
    Joiner j;
    const auto frags = toFragments(data, binary);
    std::optional<Frame> last;
    for (size_t i = 0; i < frags.size(); ++i) {
        CHECK(frags[i].size() <= kFragmentBytes);
        last = j.push(frags[i]);
        if (i + 1 < frags.size()) CHECK(!last);
    }
    if (count) *count = frags.size();
    return last;
}

void carriesEmptyFrames()
{
    auto t = roundTrip("", false);
    CHECK(t && t->data.empty() && !t->binary);
    auto b = roundTrip("", true);
    CHECK(b && b->data.empty() && b->binary);
}

void roundTripsAroundTheBoundary()
{
    for (size_t n : {size_t(1), kFragmentBytes - 2, kFragmentBytes - 1, kFragmentBytes, 3 * kFragmentBytes + 7}) {
        std::string s;
        while (s.size() < n) s += "\xc3\xa9";
        s.resize(n);
        auto f = roundTrip(s, false);
        CHECK(f && f->data == s && !f->binary);
    }
}

void roundTripsALargeBinary()
{
    std::string b(100000, '\0');
    for (size_t i = 0; i < b.size(); ++i) b[i] = static_cast<char>(i % 251);
    size_t frames = 0;
    auto f = roundTrip(b, true, &frames);
    CHECK(frames > 5);
    CHECK(f && f->data == b && f->binary);
}

void keepsConsecutiveFramesApart()
{
    Joiner j;
    std::vector<Frame> out;
    auto frags = toFragments("a", false);
    auto more = toFragments(std::string(40000, 'b'), false);
    frags.insert(frags.end(), more.begin(), more.end());
    for (const auto& f : frags)
        if (auto got = j.push(f)) out.push_back(*got);
    CHECK(out.size() == 2);
    CHECK(out[0].data == "a");
    CHECK(out[1].data == std::string(40000, 'b'));
}

}  // namespace

void runRtcFramesTests()
{
    RUN(carriesEmptyFrames);
    RUN(roundTripsAroundTheBoundary);
    RUN(roundTripsALargeBinary);
    RUN(keepsConsecutiveFramesApart);
}
