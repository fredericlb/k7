#include "ProjectDoc.h"

// Intentionally minimal: validation and diffing live here, next to the model and away from the engine.

namespace studio {

// The Tracktion clip name a ClipDoc gets — its PLACEMENT id, never the material's name (docs/clipIdentity.md).
std::string clipNameFor(const ClipDoc& c) {
    return c.id.empty() ? c.name : c.id;
}

}  // namespace studio
