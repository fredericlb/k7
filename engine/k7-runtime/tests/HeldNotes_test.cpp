// Unit tests for HeldNotes.h — what a socket that drops mid-note leaves to release, and nothing more.
// Header-only and JUCE-free, so it builds in seconds (../docs/protocol.md).

#include "HeldNotes.h"
#include "test_harness.h"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

using studio::HeldNotes;
using Bytes = std::vector<std::uint8_t>;

namespace {

int kA = 0;
int kB = 0;
const void* const sockA = &kA;
const void* const sockB = &kB;

void a_note_released_by_the_client_is_not_released_again() {
    HeldNotes h;
    h.sent(sockA, "s", "keys", {0x90, 60, 100});
    h.sent(sockA, "s", "keys", {0x80, 60, 0});
    h.sent(sockA, "s", "keys", {0x91, 62, 90});
    h.sent(sockA, "s", "keys", {0x90, 62, 0});   // velocity 0 is a note-off
    CHECK(h.closed(sockA).empty());
}

void what_is_held_is_released_on_close() {
    HeldNotes h;
    h.sent(sockA, "s", "keys", {0x90, 60, 100});
    h.sent(sockA, "s", "keys", {0x90, 64, 100});
    h.sent(sockA, "s", "keys", {0xB0, 64, 127});
    h.sent(sockA, "s", "bass", {0x90, 40, 100});
    h.sent(sockB, "s", "keys", {0x90, 67, 100});
    const auto out = h.closed(sockA);
    CHECK(out.size() == 2);
    for (const auto& r : out) {
        if (r.track == "keys") {
            CHECK(r.messages.size() == 3);
            CHECK(r.messages[0] == (Bytes{0x80, 60, 0}));
            CHECK(r.messages[1] == (Bytes{0x80, 64, 0}));
            CHECK(r.messages[2] == (Bytes{0xB0, 64, 0}));
        } else {
            CHECK(r.track == "bass");
            CHECK(r.messages.size() == 1);
        }
    }
    // Forgotten once released, and the other socket's note is its own.
    CHECK(h.closed(sockA).empty());
    CHECK(h.closed(sockB).size() == 1);
}

void all_notes_off_and_pedal_up_leave_nothing() {
    HeldNotes h;
    h.sent(sockA, "s", "keys", {0x90, 60, 100});
    h.sent(sockA, "s", "keys", {0xB0, 64, 127});
    h.sent(sockA, "s", "keys", {0xB0, 123, 0});
    h.sent(sockA, "s", "keys", {0xB0, 64, 0});
    CHECK(h.closed(sockA).empty());
}

void the_tracks_followed_are_bounded() {
    HeldNotes h;
    for (std::size_t i = 0; i < HeldNotes::kMaxTracksPerSocket + 10; ++i)
        h.sent(sockA, "s", "t" + std::to_string(i), {0x90, 60, 100});
    CHECK(h.closed(sockA).size() == HeldNotes::kMaxTracksPerSocket);
}

}  // namespace

int main() {
    RUN(a_note_released_by_the_client_is_not_released_again);
    RUN(what_is_held_is_released_on_close);
    RUN(all_notes_off_and_pedal_up_leave_nothing);
    RUN(the_tracks_followed_are_bounded);
    TEST_MAIN_END();
}
