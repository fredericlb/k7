// WireVersion.cpp — the one source the release stamp is compiled into, so a new stamp recompiles one file.

#include "WireVersion.h"

#ifndef K7_BUILD
#define K7_BUILD "dev"
#endif

namespace studio {

std::string buildStamp() { return K7_BUILD; }

}  // namespace studio
