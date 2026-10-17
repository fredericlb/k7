// WireVersion.h — what this engine says it speaks on its wire: kEngineProtocol, mirrored in
// packages/engine-protocol/version.ts and kept equal by that package's test, and the release stamp
// it was built from. A local build is stamped "dev", so two local builds always read as the same.

#pragma once

#include <string>

namespace studio {

// The engine wire's version; what bumps it is packages/engine-protocol/docs/version.md.
constexpr int kEngineProtocol = 1;

// `$STUDIO_RELEASE_STAMP` when the build was configured, else "dev".
std::string buildStamp();

}  // namespace studio
