// k7-Bridging-Header.h — the C entries of the two frameworks this app builds from the engine's own sources,
// which ship no module of their own: k7runtime.framework and k7supervisor.framework (engine/k7-runtime/docs/ios.md).

#include "../../k7-runtime/server/ios/EngineEmbed.h"
#include "../../k7-supervisor/src/Embedded.h"
