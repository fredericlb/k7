// AudioPolicy.cpp — see AudioPolicy.h. The separators are control characters, so a device name can
// never forge one.

#include "AudioPolicy.h"

#include <algorithm>

namespace st0::audio {

namespace {

const std::string kUs = "\x1f";
const std::string kRs = "\x1e";

std::string joined(const std::vector<std::string>& parts)
{
    std::string out;
    for (size_t i = 0; i < parts.size(); ++i) {
        if (i) out += kUs;
        out += parts[i];
    }
    return out;
}

}  // namespace

std::string signature(const std::vector<AudioDevice>& devices)
{
    std::vector<std::string> names;
    for (const auto& d : devices) names.push_back(d.name);
    std::sort(names.begin(), names.end());
    return joined(names);
}

std::string menuSignature(const std::vector<AudioDevice>& devices, const std::vector<std::string>& priority)
{
    std::vector<std::string> rows;
    for (const auto& d : devices) rows.push_back(d.name + "|" + d.deviceType + "|" + (d.current ? "true" : "false") + "|" + (d.currentInput ? "true" : "false"));
    std::sort(rows.begin(), rows.end());
    // The ranking IN ORDER, unsorted: a reorder that moved no membership is the whole point of it.
    return joined(rows) + kRs + joined(priority);
}

std::optional<std::string> bestPresent(const std::vector<AudioDevice>& devices, const std::vector<std::string>& priority)
{
    for (const auto& n : priority)
        if (std::any_of(devices.begin(), devices.end(), [&](const AudioDevice& d) { return d.name == n; })) return n;
    return std::nullopt;
}

std::optional<std::string> desiredSwitch(const std::vector<AudioDevice>& devices, const std::vector<std::string>& priority)
{
    // The engine answered with nothing — don't thrash.
    if (devices.empty()) return std::nullopt;
    auto want = bestPresent(devices, priority);
    // Nothing ranked is plugged in: a device we did not choose beats none.
    if (!want) return std::nullopt;
    for (const auto& d : devices)
        if (d.current) return d.name == *want ? std::nullopt : want;
    return want;
}

}  // namespace st0::audio
