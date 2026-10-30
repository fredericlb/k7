// The render pool's settings: the default cap, and what the environment may change. JUCE-free, so it runs in a fast binary.
// What would be wrong SILENTLY: a typo in the variable that changes the pool anyway, or a thread
// count above the machine's cores. See ../docs/renderPool.md.

#include "RenderPool.h"

#include "test_harness.h"

using studio::RenderPool;

namespace {

void a_desktop_is_capped_and_a_small_machine_keeps_its_cores()
{
    CHECK(RenderPool::defaults(12).threads == RenderPool::kCappedThreads);
    CHECK(RenderPool::defaults(2).threads == 2);
    CHECK(RenderPool::defaults(RenderPool::kCappedThreads).threads == RenderPool::kCappedThreads);
}

void a_phone_is_capped_and_does_not_spin()
{
    CHECK(RenderPool::defaults(8, RenderPool::phone).threads == RenderPool::kPhoneThreads);
    CHECK(RenderPool::defaults(2, RenderPool::phone).threads == 2);
    CHECK(RenderPool::defaults(8, RenderPool::phone).strategy == RenderPool::semaphore);
    CHECK(RenderPool::defaults(12).strategy == RenderPool::lightweightSemHybrid);
}

void a_phone_still_takes_the_overrides()
{
    const auto p = RenderPool::fromEnv(8, RenderPool::phone, "8", "lightweightSemHybrid");
    CHECK(p.threads == 8);
    CHECK(p.strategy == RenderPool::lightweightSemHybrid);
    CHECK(RenderPool::fromEnv(8, RenderPool::phone, nullptr, nullptr).strategy == RenderPool::semaphore);
}

void nothing_set_is_the_default()
{
    const auto d = RenderPool::defaults(12);
    const auto p = RenderPool::fromEnv(12, RenderPool::desktop, nullptr, nullptr);
    CHECK(p.threads == d.threads);
    CHECK(p.strategy == d.strategy);
    CHECK(p.strategy == RenderPool::lightweightSemHybrid);
}

void a_thread_count_is_taken_and_capped_at_the_cores()
{
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, "6", nullptr).threads == 6);
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, "12", nullptr).threads == 12);
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, "64", nullptr).threads == 12);
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, "1", nullptr).threads == 1);
}

void a_bad_thread_count_changes_nothing()
{
    const int d = RenderPool::defaults(12).threads;
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, "0", nullptr).threads == d);
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, "-3", nullptr).threads == d);
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, "4x", nullptr).threads == d);
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, "", nullptr).threads == d);
}

void a_strategy_is_taken_by_its_tracktion_name()
{
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, nullptr, "semaphore").strategy == RenderPool::semaphore);
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, nullptr, "conditionVariable").strategy == RenderPool::conditionVariable);
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, nullptr, "hybrid").strategy == RenderPool::hybrid);
}

void an_unknown_strategy_changes_nothing()
{
    const int d = RenderPool::defaults(12).strategy;
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, nullptr, "Semaphore").strategy == d);
    CHECK(RenderPool::fromEnv(12, RenderPool::desktop, nullptr, "fast").strategy == d);
}

void a_machine_reporting_no_cores_still_renders()
{
    CHECK(RenderPool::defaults(0).threads >= 1);
    CHECK(RenderPool::defaults(0, RenderPool::phone).threads >= 1);
}

}  // namespace

int main()
{
    RUN(a_desktop_is_capped_and_a_small_machine_keeps_its_cores);
    RUN(a_phone_is_capped_and_does_not_spin);
    RUN(a_phone_still_takes_the_overrides);
    RUN(nothing_set_is_the_default);
    RUN(a_thread_count_is_taken_and_capped_at_the_cores);
    RUN(a_bad_thread_count_changes_nothing);
    RUN(a_strategy_is_taken_by_its_tracktion_name);
    RUN(an_unknown_strategy_changes_nothing);
    RUN(a_machine_reporting_no_cores_still_renders);
    TEST_MAIN_END();
}
