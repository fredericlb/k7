// Warnings: what a build complained of is KEPT per session, so a client that connects after the build
// still learns it — the build says each one once, usually before the page's socket is up (../docs/sessions.md).

#include "Warnings.h"
#include "test_harness.h"

#include <string>

using namespace studio;

namespace {

void a_build_keeps_its_warnings_for_its_session() {
    clearStandingWarnings("k7:a");
    {
        WarningScope scope{"k7:a"};
        BuildScope build{"k7:a", true};
        warn("could not create Diva", "lead:synth");
    }
    const auto kept = standingWarnings("k7:a");
    CHECK(kept.size() == 1);
    if (!kept.empty()) {
        CHECK(kept[0].subject == "lead:synth");
        CHECK(kept[0].message == "could not create Diva");
    }
    CHECK(standingWarnings("k7:b").empty());
}

void a_warning_outside_a_build_is_not_kept() {
    clearStandingWarnings("k7:a");
    {
        WarningScope scope{"k7:a"};
        warn("the editor could not open", "lead:synth");
    }
    {
        BuildScope build{"k7:a", false};
        warn("no session named, nobody's project");
    }
    CHECK(standingWarnings("k7:a").empty());
}

void a_full_build_replaces_an_incremental_one_adds() {
    clearStandingWarnings("k7:a");
    {
        WarningScope scope{"k7:a"};
        BuildScope build{"k7:a", true};
        warn("could not create Diva", "lead:synth");
    }
    {
        WarningScope scope{"k7:a"};
        BuildScope build{"k7:a", false};
        warn("model refused", "amp:nam");
        warn("could not create Diva, again", "lead:synth");
    }
    auto kept = standingWarnings("k7:a");
    CHECK(kept.size() == 2);
    {
        WarningScope scope{"k7:a"};
        BuildScope build{"k7:a", true};
    }
    CHECK(standingWarnings("k7:a").empty());
}

void forgetting_a_session_drops_its_warnings() {
    {
        WarningScope scope{"k7:a"};
        BuildScope build{"k7:a", true};
        warn("could not create Diva", "lead:synth");
    }
    clearStandingWarnings("k7:a");
    CHECK(standingWarnings("k7:a").empty());
}

}  // namespace

int main() {
    RUN(a_build_keeps_its_warnings_for_its_session);
    RUN(a_warning_outside_a_build_is_not_kept);
    RUN(a_full_build_replaces_an_incremental_one_adds);
    RUN(forgetting_a_session_drops_its_warnings);
    TEST_MAIN_END();
}
