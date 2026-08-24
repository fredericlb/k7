#include "ProjectDoc.h"

// Intentionally minimal for now: validation and diffing live here as the project grows, next to the model and
// away from the engine, which keeps each layer testable in isolation.

namespace studio {

/**
 * The Tracktion clip name a ClipDoc gets — its PLACEMENT id, and never the material's name.
 *
 * Here, in the JUCE-free layer, rather than beside the code that inserts clips: it is a rule about
 * the document's identity, and it has to hold across THREE call sites that cannot see each other —
 * the wave insert, the MIDI insert and `removeClipFor`. Spelled out at each of them as
 * `name.empty() ? id : name`, it is wrong in a way none of them can notice alone.
 *
 * `ClipDoc::name` is the MATERIAL (`name: ref` in the compiler), shared by every placement of one
 * clip, and it is never empty — so that spelling never reaches the id and two placements of one
 * sample both answer to "riff". `removeClipFor` matches by name and stops at the FIRST hit, so it
 * removes whichever placement comes first rather than the one the diff named.
 *
 * Not theoretical: a PASTE makes a second placement of one material by definition. Moving either
 * one then takes the OTHER out of the edit and leaves the moved one behind, so the lane plays a clip
 * the document does not hold, under the clip that just moved — heard as one event doubled from a
 * certain point, and gone after a reload, because a full rebuild puts back what the document
 * says. See docs/clipIdentity.md.
 *
 * `id` is `placementId(ref, start)` and is unique by construction; the fallback is for a document
 * with no id at all, which the compiler never emits.
 */
std::string clipNameFor(const ClipDoc& c) {
    return c.id.empty() ? c.name : c.id;
}

}  // namespace studio
