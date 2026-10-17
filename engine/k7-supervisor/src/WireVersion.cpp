// WireVersion.cpp — the one source the release stamp is compiled into, so a new stamp recompiles one file.

#include "WireVersion.h"

#ifndef K7_BUILD
#define K7_BUILD "dev"
#endif

namespace k7::wire {

std::string build() { return K7_BUILD; }

}  // namespace k7::wire
