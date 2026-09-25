// AudioPolicy.h — which interface the engine should be on: the user's list in THEIR order, best
// first, and the first entry actually plugged in wins. No default and no fallback — a fallback was
// only ever the second line of this list. Pure, so the rules are tested without an engine.

#pragma once

#include "HostProtocol.h"

#include <optional>
#include <string>
#include <vector>

namespace st0::audio {

using protocol::AudioDevice;

/** The set of visible interfaces, as one string: a switch that did not take is retried when it moves. */
std::string signature(const std::vector<AudioDevice>& devices);

/** Everything the audio rows depend on, `current` and the ranking included. */
std::string menuSignature(const std::vector<AudioDevice>& devices, const std::vector<std::string>& priority);

/** The best-ranked interface that is actually there. */
std::optional<std::string> bestPresent(const std::vector<AudioDevice>& devices, const std::vector<std::string>& priority);

/** The device to switch to, or nothing when the engine is where it belongs or nothing ranked is there. */
std::optional<std::string> desiredSwitch(const std::vector<AudioDevice>& devices, const std::vector<std::string>& priority);

}  // namespace st0::audio
