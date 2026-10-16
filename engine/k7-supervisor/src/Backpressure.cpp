// Backpressure.cpp — see Backpressure.h. The JSON is only parsed when the peer is already behind, so
// a fast link pays nothing for the check.

#include "Backpressure.h"

#include <nlohmann/json.hpp>

namespace k7 {

namespace {

// The audio stream's magic, "LSTR" as a little-endian u32 (engine/k7-runtime/server/AudioSender.cpp).
constexpr char kStreamMagic[4] = {'R', 'T', 'S', 'L'};

}  // namespace

bool droppableEngineFrame(const std::string& data, bool binary)
{
    if (binary) return data.size() >= 4 && data.compare(0, 4, kStreamMagic, 4) == 0;
    // Cheap first: a frame that does not even spell the word is not one.
    if (data.find("\"state\"") == std::string::npos) return false;
    const auto j = nlohmann::json::parse(data, nullptr, false);
    if (!j.is_object()) return false;
    const auto it = j.find("type");
    return it != j.end() && it->is_string() && it->get<std::string>() == "state";
}

bool FrameShedder::admit(const std::string& data, bool binary, size_t buffered)
{
    caughtUp_ = buffered <= kDropAboveBytes;
    if (!caughtUp_ && droppableEngineFrame(data, binary)) {
        ++shed_;
        return false;
    }
    return true;
}

std::uint64_t FrameShedder::takeShed()
{
    if (shed_ == 0 || (!caughtUp_ && shed_ < kShedReportEvery)) return 0;
    const auto n = shed_;
    shed_ = 0;
    return n;
}

}  // namespace k7
