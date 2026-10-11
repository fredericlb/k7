// WarpMarkers.h — which INTERIOR markers of a clip's warp map are handed to Tracktion. JUCE-free and header-only,
// so tests/ has it in the FAST binary. What a reader would get wrong: a marker left out is not a fault of the map.
// It bounds a segment playing many times faster or slower than the clip, which the stretcher cannot start inside:
// it primes at that speed and lands the whole clip a beat off. See docs/warp.md.

#pragma once

#include <cstddef>
#include <utility>
#include <vector>

namespace studio {

// How far a segment's speed may stray from the clip's overall speed, either way, and its marker still be kept.
constexpr double kMaxWarpDeviation = 4.0;

/** The interior markers to keep, as indices into `markers` ([timeline beat, source second]), in order. */
inline std::vector<std::size_t> keptWarpMarkers(const std::vector<std::pair<double, double>>& markers,
                                                double maxDeviation = kMaxWarpDeviation)
{
    std::vector<std::size_t> kept;
    if (markers.size() < 3) return kept;
    const double beatSpan = markers.back().first - markers.front().first;
    const double srcSpan = markers.back().second - markers.front().second;
    if (beatSpan <= 0.0 || srcSpan <= 0.0) return kept;
    const double overall = srcSpan / beatSpan;
    // A segment plays forward at a speed within the bound — a backward or empty one is no segment at all.
    auto playable = [&](std::size_t a, std::size_t b) {
        const double beats = markers[b].first - markers[a].first;
        const double secs = markers[b].second - markers[a].second;
        if (beats <= 0.0 || secs <= 0.0) return false;
        const double r = (secs / beats) / overall;
        return r <= maxDeviation && r >= 1.0 / maxDeviation;
    };
    std::size_t from = 0;
    for (std::size_t i = 1; i + 1 < markers.size(); ++i)
        if (playable(from, i)) {
            kept.push_back(i);
            from = i;
        }
    // …and the stretch from the last one kept to the clip's end must be playable too.
    while (!kept.empty() && !playable(kept.back(), markers.size() - 1)) kept.pop_back();
    return kept;
}

}  // namespace studio
