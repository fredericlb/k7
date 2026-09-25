// RtcFrames.cpp — see RtcFrames.h. The kind bytes are the TypeScript ones: 0 text-last, 1
// binary-last, 2 text-more, 3 binary-more.

#include "RtcFrames.h"

namespace st0::rtcframes {

namespace {
constexpr char kTextLast = 0;
constexpr char kBinaryLast = 1;
constexpr char kTextMore = 2;
constexpr char kBinaryMore = 3;
}  // namespace

std::vector<std::string> toFragments(const std::string& data, bool binary)
{
    const size_t room = kFragmentBytes - 1;
    std::vector<std::string> out;
    for (size_t at = 0; at == 0 || at < data.size(); at += room) {
        const bool last = at + room >= data.size();
        std::string frag(1, binary ? (last ? kBinaryLast : kBinaryMore) : (last ? kTextLast : kTextMore));
        frag += data.substr(at, room);
        out.push_back(std::move(frag));
    }
    return out;
}

std::optional<Frame> Joiner::push(const std::string& fragment)
{
    if (fragment.empty()) return std::nullopt;
    const char kind = fragment[0];
    parts_.append(fragment, 1, std::string::npos);
    if (kind == kTextMore || kind == kBinaryMore) return std::nullopt;
    Frame f{std::move(parts_), kind == kBinaryLast};
    parts_.clear();
    return f;
}

}  // namespace st0::rtcframes
