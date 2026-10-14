// Which interior warp markers reach Tracktion. JUCE-free, so it runs in the fast binary.
//
// What would be wrong SILENTLY: a marker kept whose segment plays many times off the clip's speed. The map
// still reaches the engine and plays through correctly, and only a start inside that segment lands the clip
// a beat off. See ../docs/warp.md.

#include "WarpMarkers.h"

#include "test_harness.h"

#include <utility>
#include <vector>

using Map = std::vector<std::pair<double, double>>;

// 05.paradoxe's arpege_1_9: its second marker squeezes 71 ms of the file into 4 ms, seventeen times the clip's speed.
void a_near_empty_first_segment_is_dropped()
{
    const Map m{{0, 0}, {0.005957, 0.071482}, {1, 0.73444}, {8, 5.632449}, {12, 8.492381},
                {14, 9.898708}, {15.75, 11.077638}, {16.056693, 11.294127}};
    const auto kept = studio::keptWarpMarkers(m);
    CHECK(kept.size() == 5);
    CHECK(!kept.empty() && kept.front() == 2);
}

void markers_near_the_clip_speed_are_all_kept()
{
    const Map m{{0, 0}, {1, 0.5}, {2, 1.1}, {3, 1.45}, {4, 2.0}};
    CHECK(studio::keptWarpMarkers(m).size() == 3);
}

void a_marker_that_makes_the_LAST_segment_extreme_goes_too()
{
    const Map m{{0, 0}, {1, 0.5}, {3.99, 1.995}, {4, 2.2}};
    const auto kept = studio::keptWarpMarkers(m);
    CHECK(kept.size() == 1);
    CHECK(!kept.empty() && kept.front() == 1);
}

void a_backward_marker_is_no_segment()
{
    const Map m{{0, 0}, {1, 0.5}, {2, 0.4}, {3, 1.5}, {4, 2.0}};
    const auto kept = studio::keptWarpMarkers(m);
    CHECK(kept.size() == 2);
    CHECK(kept.size() == 2 && kept[0] == 1 && kept[1] == 3);
}

void two_markers_have_no_interior()
{
    CHECK(studio::keptWarpMarkers(Map{{0, 0}, {4, 2}}).empty());
}

int main()
{
    RUN(a_near_empty_first_segment_is_dropped);
    RUN(markers_near_the_clip_speed_are_all_kept);
    RUN(a_marker_that_makes_the_LAST_segment_extreme_goes_too);
    RUN(a_backward_marker_is_no_segment);
    RUN(two_markers_have_no_interior);
    std::printf("%d checks, %d failures\n", tdtest::g_checks, tdtest::g_failures);
    return tdtest::g_failures == 0 ? 0 : 1;
}
