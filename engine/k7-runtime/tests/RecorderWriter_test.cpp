// The recorder's writer thread, and the one rule a take's integrity rests on: a job is the
// writer's while registered and its owner's once remove() returns — never both at once.
// Linked into studio_recorder_tests beside RecorderTap_test.cpp. See ../docs/recorder.md.

#include "RecorderTap.h"
#include "RecorderWriter.h"
#include "test_harness.h"

#include <atomic>
#include <chrono>
#include <memory>
#include <thread>
#include <vector>

using studio::RecorderTap;
using studio::RecorderWriter;

namespace {

using namespace std::chrono_literals;

/** A job that counts its pumps and notices a second thread inside it. */
struct CountingJob : RecorderWriter::Job {
    std::atomic<int> pumps{0};
    std::atomic<int> inside{0};
    std::atomic<bool> overlapped{false};
    std::chrono::microseconds busy{0};
    void pump() override {
        if (inside.fetch_add(1) != 0) overlapped = true;
        if (busy.count() > 0) std::this_thread::sleep_for(busy);
        pumps.fetch_add(1);
        inside.fetch_sub(1);
    }
};

/** The real shape: a ring the writer drains, as a recorder node does, into a plain vector. */
struct RingJob : RecorderWriter::Job {
    RecorderTap ring;
    std::vector<float> scratch;
    std::vector<float> taken;
    size_t lost = 0;
    void pump() override {
        for (;;) {
            const auto d = ring.drain(scratch, 4096);
            lost += d.lostFrames;
            taken.insert(taken.end(), scratch.begin(), scratch.end());
            if (d.frames < 4096) return;
        }
    }
};

void waitPasses(const RecorderWriter& w, size_t n) {
    const auto until = std::chrono::steady_clock::now() + 5s;
    const size_t from = w.passes();
    while (w.passes() < from + n && std::chrono::steady_clock::now() < until)
        std::this_thread::sleep_for(1ms);
}

void a_registered_job_is_pumped() {
    RecorderWriter w(1ms);
    auto job = std::make_shared<CountingJob>();
    w.add(job);
    CHECK(w.holds(job.get()));
    waitPasses(w, 3);
    CHECK(job->pumps.load() >= 2);
}

void after_remove_the_job_is_never_entered_again() {
    RecorderWriter w(0ms);
    auto job = std::make_shared<CountingJob>();
    job->busy = 300us;   // long enough that remove() usually lands mid-pump
    for (int round = 0; round < 50; ++round) {
        w.add(job);
        std::this_thread::sleep_for(200us);
        w.remove(job.get());
        // The owner has it now: nobody is inside, and nobody comes in while the owner works.
        CHECK(job->inside.load() == 0);
        const int before = job->pumps.load();
        std::this_thread::sleep_for(1ms);
        CHECK(job->pumps.load() == before);
        CHECK(!w.holds(job.get()));
    }
    CHECK(!job->overlapped.load());
}

void the_writer_holds_the_job_alive() {
    // The session may drop its node while the writer still holds it: memory, never a dangling pointer.
    RecorderWriter w(1ms);
    std::weak_ptr<CountingJob> seen;
    {
        auto job = std::make_shared<CountingJob>();
        seen = job;
        w.add(job);
    }
    waitPasses(w, 2);
    CHECK(!seen.expired());
    w.remove(seen.lock().get());
    waitPasses(w, 2);
    CHECK(seen.expired());
}

void stop_joins_and_drops_the_jobs() {
    auto job = std::make_shared<CountingJob>();
    {
        RecorderWriter w(1ms);
        w.add(job);
        waitPasses(w, 2);
        w.stop();
        CHECK(w.size() == 0);
        const int after = job->pumps.load();
        std::this_thread::sleep_for(5ms);
        CHECK(job->pumps.load() == after);
        w.add(job);   // a stopped writer refuses rather than restarting behind the owner's back
        CHECK(w.size() == 0);
    }
    CHECK(job.use_count() == 1);
}

void a_take_drained_by_the_writer_is_whole() {
    // A paced audio thread, the writer draining, then the owner taking it back to drain the rest as a stop does: every frame, in order.
    RecorderWriter w(5ms);
    auto job = std::make_shared<RingJob>();
    job->ring.skipToLive();
    w.add(job);
    constexpr int kBlocks = 300;
    constexpr int kBlock = 256;
    std::thread audio([&] {
        std::vector<float> l(kBlock), r(kBlock);
        for (int b = 0; b < kBlocks; ++b) {
            for (int i = 0; i < kBlock; ++i) {
                l[(size_t)i] = (float)(b * kBlock + i);
                r[(size_t)i] = -l[(size_t)i];
            }
            const float* chans[2] = { l.data(), r.data() };
            job->ring.pushBlock(chans, 2, kBlock);
            std::this_thread::sleep_for(100us);
        }
    });
    audio.join();
    w.remove(job.get());
    job->pump();
    CHECK(job->lost == 0);
    CHECK(job->taken.size() == (size_t)kBlocks * kBlock * 2);
    bool ordered = true;
    for (size_t i = 0; i + 1 < job->taken.size() / 2; ++i)
        if (job->taken[i * 2] != (float)i || job->taken[i * 2 + 1] != -(float)i) ordered = false;
    CHECK(ordered);
}

/** A job whose pump stalls like a slow disk, and which counts its finishes. */
struct SlowJob : CountingJob {
    std::atomic<int> finishes{0};
    std::atomic<int> pumpsAtFinish{-1};
    void finish() override {
        pumpsAtFinish = pumps.load();
        finishes.fetch_add(1);
    }
};

void finish_never_waits_on_a_slow_pump() {
    RecorderWriter w(0ms);
    auto job = std::make_shared<SlowJob>();
    job->busy = 50ms;
    w.add(job);
    while (job->inside.load() == 0) std::this_thread::sleep_for(100us);
    const auto asked = std::chrono::steady_clock::now();
    w.finish(job.get());
    // A stop on the message thread: back long before the stalled pump is.
    CHECK(std::chrono::steady_clock::now() - asked < 20ms);
    CHECK(w.holds(job.get()));
    const int pumpsWhenAsked = job->pumps.load();
    const auto until = std::chrono::steady_clock::now() + 5s;
    while (w.holds(job.get()) && std::chrono::steady_clock::now() < until) std::this_thread::sleep_for(1ms);
    CHECK(!w.holds(job.get()));
    CHECK(job->finishes.load() == 1);
    // At least one whole pump began after the ask, so the ring's tail reaches the take.
    CHECK(job->pumpsAtFinish.load() >= pumpsWhenAsked + 1);
    const int after = job->pumps.load();
    std::this_thread::sleep_for(60ms);
    CHECK(job->pumps.load() == after);
}

void stop_finishes_a_job_being_finished() {
    auto finishing = std::make_shared<SlowJob>();
    auto running = std::make_shared<SlowJob>();
    {
        RecorderWriter w(1h);   // the thread never gets a pass in: only stop() can finish it
        w.add(finishing);
        w.add(running);
        w.finish(finishing.get());
        w.stop();
        CHECK(w.size() == 0);
    }
    CHECK(finishing->finishes.load() == 1);
    CHECK(finishing->pumps.load() == 1);
    CHECK(running->finishes.load() == 0);
}

}  // namespace

void runRecorderWriterTests() {
    RUN(finish_never_waits_on_a_slow_pump);
    RUN(stop_finishes_a_job_being_finished);
    RUN(a_registered_job_is_pumped);
    RUN(after_remove_the_job_is_never_entered_again);
    RUN(the_writer_holds_the_job_alive);
    RUN(stop_joins_and_drops_the_jobs);
    RUN(a_take_drained_by_the_writer_is_whole);
}
