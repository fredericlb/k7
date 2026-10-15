// InstrumentStatus.h — whether a sampled instrument a project names is on this machine, in std types only, so
// the server answers `instrument-status` without seeing JUCE or Tracktion. Implemented beside SfzPlugin, which
// owns where `@instruments/` lives (docs/sfzPlugin.md).
#pragma once

#include <string>

namespace studio {

/** True when `ref` can load here: an `@instruments/…` one needs its file and its install marker, any other its file. */
bool instrumentInstalled(const std::string& ref);

}  // namespace studio
