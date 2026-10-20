// The startup scan's two decisions and its progress: which cached file is reused, which entry is
// gone, and when a client hears where the scan stands. JUCE-free, so it runs in a fast binary.
//
// What would be wrong SILENTLY: a scan that never says it ended, which holds every project naming an
// external plugin at its gate until the timeout. See ../docs/plugins.md.

#include "ScanProgress.h"

#include "test_harness.h"

#include <chrono>
#include <set>
#include <string>
#include <vector>

using studio::CachedScanEntry;
using studio::PluginScanStatus;
using studio::ScanProgressBoard;
using namespace std::chrono_literals;

void an_unchanged_complete_entry_is_reused()
{
    const CachedScanEntry e{1000, true};
    CHECK(studio::reuseCachedEntry(&e, 1000));
}

void a_touched_file_is_loaded_again()
{
    const CachedScanEntry e{1000, true};
    CHECK(!studio::reuseCachedEntry(&e, 1001));
}

void an_entry_without_its_description_is_loaded_again()
{
    const CachedScanEntry e{1000, false};
    CHECK(!studio::reuseCachedEntry(&e, 1000));
}

void a_new_file_is_loaded()
{
    CHECK(!studio::reuseCachedEntry(nullptr, 1000));
}

void a_removed_file_is_gone_and_a_builtin_never_is()
{
    const std::vector<std::string> cached{"C:/vst/a.vst3", "C:/vst/b.vst3", "builtin:4osc"};
    const std::set<std::string> present{"C:/vst/a.vst3"};
    const auto gone = studio::droppedEntries(cached, present);
    CHECK(gone.size() == 1);
    CHECK(!gone.empty() && gone.front() == "C:/vst/b.vst3");
}

void the_board_says_a_scan_started_with_no_total_yet()
{
    ScanProgressBoard b(250ms);
    const auto s = b.begin(ScanProgressBoard::Clock::now());
    CHECK(s.scanning);
    CHECK(s.total == 0 && s.done == 0);
}

void stat_only_steps_are_rate_limited()
{
    ScanProgressBoard b(250ms);
    const auto t0 = ScanProgressBoard::Clock::now();
    b.begin(t0);
    PluginScanStatus out;
    CHECK(!b.step(1, 100, "", t0 + 10ms, out));
    CHECK(!b.step(2, 100, "", t0 + 100ms, out));
    CHECK(b.step(3, 100, "", t0 + 260ms, out));
    CHECK(out.done == 3 && out.total == 100);
    CHECK(!b.step(4, 100, "", t0 + 300ms, out));
}

void a_load_starting_is_said_at_once_and_once()
{
    ScanProgressBoard b(250ms);
    const auto t0 = ScanProgressBoard::Clock::now();
    b.begin(t0);
    PluginScanStatus out;
    CHECK(b.step(5, 100, "Serum.vst3", t0 + 5ms, out));
    CHECK(out.current == "Serum.vst3");
    CHECK(!b.step(5, 100, "Serum.vst3", t0 + 10ms, out));
    CHECK(b.step(6, 100, "Diva.vst3", t0 + 20ms, out));
}

void finishing_ends_the_scan_and_counts_it()
{
    ScanProgressBoard b(250ms);
    const auto t0 = ScanProgressBoard::Clock::now();
    b.begin(t0);
    PluginScanStatus out;
    b.step(7, 9, "x.vst3", t0, out);
    const auto end = b.finish();
    CHECK(!end.scanning);
    CHECK(end.done == 9 && end.current.empty());
    CHECK(end.version == 1);
    b.begin(t0);
    CHECK(b.finish().version == 2);
    CHECK(!b.snapshot().scanning);
}

int main()
{
    RUN(an_unchanged_complete_entry_is_reused);
    RUN(a_touched_file_is_loaded_again);
    RUN(an_entry_without_its_description_is_loaded_again);
    RUN(a_new_file_is_loaded);
    RUN(a_removed_file_is_gone_and_a_builtin_never_is);
    RUN(the_board_says_a_scan_started_with_no_total_yet);
    RUN(stat_only_steps_are_rate_limited);
    RUN(a_load_starting_is_said_at_once_and_once);
    RUN(finishing_ends_the_scan_and_counts_it);
    TEST_MAIN_END();
}
