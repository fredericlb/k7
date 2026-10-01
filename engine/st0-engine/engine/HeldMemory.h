// HeldMemory.h — what one of OUR plugins says it holds: the big buffers it owns or maps, in bytes.
// The engine's plugins share one heap, so this is the only per-node RAM figure that can be honest;
// an external plugin reports none (docs/load.md).
// The one thing a reader would get wrong: this is a floor, the plugin's own buffers, not its footprint.

#pragma once

#include <cstdint>

namespace studio {

struct HeldMemory {
    virtual ~HeldMemory() = default;
    /** Bytes held in the plugin's big buffers. MESSAGE thread; may take the plugin's own lock briefly. */
    virtual int64_t heldBytes() const noexcept = 0;
};

}  // namespace studio
