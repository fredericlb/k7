// JobSlots_test.cpp — the cap holds however many threads ask, a slot comes back when its holder ends,
// and the waiters are served in the order they asked.

#include "JobSlots.h"

#include "test_harness.h"

#include <atomic>
#include <chrono>
#include <mutex>
#include <thread>
#include <vector>

using k7::JobSlots;

namespace {

void neverMoreThanTheCapRun()
{
    JobSlots slots(2);
    std::atomic<int> now{0};
    std::atomic<int> most{0};
    std::vector<std::thread> threads;
    for (int i = 0; i < 8; ++i)
        threads.emplace_back([&] {
            const auto held = slots.hold();
            const int n = ++now;
            for (int seen = most.load(); n > seen && !most.compare_exchange_weak(seen, n);) {}
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
            --now;
        });
    for (auto& t : threads) t.join();
    CHECK(most.load() == 2);
    CHECK(slots.running() == 0);
}

void aZeroCapStillRunsOne()
{
    JobSlots slots(0);
    const auto held = slots.hold();
    CHECK(slots.running() == 1);
}

void waitersAreServedInOrderAndHearWhatIsAhead()
{
    JobSlots slots(1);
    std::mutex m;
    std::vector<int> order;
    std::vector<std::size_t> firstAhead(3, 99);
    std::vector<std::thread> waiters;
    {
        const auto held = slots.hold();
        for (int i = 0; i < 3; ++i) {
            waiters.emplace_back([&, i] {
                const auto mine = slots.hold([&](std::size_t ahead) {
                    std::lock_guard lock(m);
                    if (firstAhead[static_cast<size_t>(i)] == 99) firstAhead[static_cast<size_t>(i)] = ahead;
                });
                std::lock_guard lock(m);
                order.push_back(i);
            });
            // Each waiter takes its ticket before the next one starts.
            for (;;) {
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
                std::lock_guard lock(m);
                if (firstAhead[static_cast<size_t>(i)] != 99) break;
            }
        }
    }
    for (auto& t : waiters) t.join();
    CHECK((order == std::vector<int>{0, 1, 2}));
    CHECK((firstAhead == std::vector<std::size_t>{0, 1, 2}));
}

}  // namespace

void runJobSlotsTests()
{
    RUN(neverMoreThanTheCapRun);
    RUN(aZeroCapStillRunsOne);
    RUN(waitersAreServedInOrderAndHearWhatIsAhead);
}
