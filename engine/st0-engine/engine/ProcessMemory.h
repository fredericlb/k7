// ProcessMemory.h — the engine process's own memory, as the system counts it: what the header shows
// beside the per-node figures, which cannot add up to it (docs/load.md).
// The one thing a reader would get wrong: on macOS this is the FOOTPRINT, what Activity Monitor shows, not RSS.

#pragma once

#include <cstdint>

namespace studio {

/** The process's memory in bytes, or -1 where the platform will not say. Any thread; one system call. */
int64_t processMemoryBytes() noexcept;

}  // namespace studio
