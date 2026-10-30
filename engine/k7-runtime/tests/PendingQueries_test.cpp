// Unit tests for PendingQueries.h — an identical query waiting is joined, and a running one is not.
// Header-only and JUCE-free, so it builds in seconds (../docs/supersede.md).

#include "PendingQueries.h"
#include "test_harness.h"

using studio::PendingQueries;

namespace {

void a_waiting_query_is_joined() {
    PendingQueries p;
    CHECK(p.admit("list-audio-devices"));
    CHECK(!p.admit("list-audio-devices"));
    CHECK(!p.admit("list-audio-devices"));
    CHECK(p.admit("get-plugin-params\ns\nfx"));   // another key waits on its own
    CHECK(p.size() == 2);
}

void a_query_asked_while_one_runs_is_queued_again() {
    PendingQueries p;
    CHECK(p.admit("list-sessions"));
    p.started("list-sessions");
    CHECK(p.admit("list-sessions"));
    p.started("list-sessions");
    CHECK(p.size() == 0);
}

}  // namespace

int main() {
    RUN(a_waiting_query_is_joined);
    RUN(a_query_asked_while_one_runs_is_queued_again);
    TEST_MAIN_END();
}
