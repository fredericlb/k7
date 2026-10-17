// Platform.h — the two phone platforms named once. On both the engine is a library inside the app's
// process rather than a program this supervisor spawns; on iOS no program of the app's own may run
// at all, so the supervisor itself is a library there too (engine/k7-runtime/docs/ios.md).

#pragma once

#ifdef __APPLE__
#include <TargetConditionals.h>
#endif

#if defined(__APPLE__) && TARGET_OS_IPHONE
#define K7_IOS 1
#endif

#if defined(__ANDROID__) || defined(K7_IOS)
#define K7_ENGINE_IN_APP 1
#endif
