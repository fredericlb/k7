// The recorder's ring, and the one property it does NOT share with the broadcast tap beside it:
// an overrun is COUNTED and reported, never silently forgiven. A take that loses its first bars
// and says nothing is a file you would trust — see ../docs/recorder.md.

#include "RecorderTap.h"
#include "test_harness.h"

#include <atomic>
#include <chrono>
#include <thread>
#include <vector>

using studio::RecorderTap;

namespace {

/** `frames` frames of a ramp starting at `from`, pushed as one block. */
void pushRamp(RecorderTap& tap, int frames, float from = 0.0f) {
    std::vector<float> l((size_t)frames), r((size_t)frames);
    for (int i = 0; i < frames; ++i) {
        l[(size_t)i] = from + (float)i;
        r[(size_t)i] = -(from + (float)i);
    }
    const float* chans[2] = { l.data(), r.data() };
    tap.pushBlock(chans, 2, frames);
}

void carries_every_frame_in_order() {
    RecorderTap tap;
    tap.skipToLive();
    pushRamp(tap, 1000);

    std::vector<float> out;
    const auto d = tap.drain(out, 4096);
    CHECK(d.frames == 1000);
    CHECK(d.lostFrames == 0);
    CHECK(out.size() == 2000);
    // In order, and the two sides kept apart: an interleave bug reads as a channel swap.
    CHECK(out[0] == 0.0f);
    CHECK(out[1] == -0.0f);
    CHECK(out[1998] == 999.0f);
    CHECK(out[1999] == -999.0f);
}

void a_drain_resumes_where_it_stopped() {
    RecorderTap tap;
    tap.skipToLive();
    pushRamp(tap, 100);

    std::vector<float> out;
    tap.drain(out, 40);
    CHECK(out.size() == 80);
    CHECK(out[0] == 0.0f);

    const auto d = tap.drain(out, 4096);
    CHECK(d.frames == 60);
    CHECK(out[0] == 40.0f);   // …not back at the start, and not skipped forward either
}

void a_slow_drain_catches_up_rather_than_skipping() {
    // The broadcast tap resumes SAFE frames behind the writer, because a listener wants NOW. A
    // recording wants the backlog: everything still in the ring belongs to the take.
    RecorderTap tap;
    tap.skipToLive();
    pushRamp(tap, 20000);

    std::vector<float> out;
    size_t got = 0;
    for (int i = 0; i < 10; ++i) {
        const auto d = tap.drain(out, 4096);
        CHECK(d.lostFrames == 0);
        got += d.frames;
    }
    CHECK(got == 20000);
}

void an_overrun_is_COUNTED() {
    RecorderTap tap;
    tap.skipToLive();
    // One frame more than the ring holds. The reader resumes a MARGIN behind the writer rather
    // than exactly a lap back, so it loses that margin too — and says so. The claim is that the
    // count is honest, never that it is minimal: what the margin buys is that everything the
    // drain DOES return was finished being written.
    pushRamp(tap, (int)RecorderTap::CAPACITY);
    pushRamp(tap, 1, (float)RecorderTap::CAPACITY);

    std::vector<float> out;
    const auto d = tap.drain(out, RecorderTap::CAPACITY * 2);
    const size_t expected = RecorderTap::CAPACITY + 1 - RecorderTap::SAFE;
    CHECK(d.lostFrames == expected);
    CHECK(tap.lostFrames() == expected);
    CHECK(d.frames == RecorderTap::SAFE);
    // …and the hole is at the HEAD: what came back starts where the count says it does.
    CHECK(out[0] == (float)expected);
}

void a_take_starts_clean() {
    RecorderTap tap;
    pushRamp(tap, (int)RecorderTap::CAPACITY + 100);   // lap it before anybody is listening
    std::vector<float> out;
    tap.drain(out, RecorderTap::CAPACITY * 2);
    CHECK(tap.lostFrames() > 0);

    // Pressing record starts a NEW take: what was lost before it belongs to nothing.
    tap.skipToLive();
    CHECK(tap.lostFrames() == 0);
    pushRamp(tap, 10, 7.0f);
    const auto d = tap.drain(out, 4096);
    CHECK(d.frames == 10);
    CHECK(d.lostFrames == 0);
    CHECK(out[0] == 7.0f);
}

void the_two_threads_do_not_tear() {
    // The real shape: an audio thread pushing blocks while the state tick drains them. The writer
    // is PACED, and that is the claim rather than a convenience — an audio thread delivers 256
    // frames every ~5 ms, so a reader keeping up is never within MARGIN of the write head. An
    // unpaced writer laps the reader mid-copy however large the margin is, and there is no ring
    // arithmetic that survives it; what covers that case is `an_overrun_is_COUNTED` below, which
    // claims the loss is reported and does NOT claim the audio came back whole.
    RecorderTap tap;
    tap.skipToLive();
    constexpr int kBlocks = 400;
    constexpr int kBlock = 256;

    std::atomic<bool> done{false};
    std::thread audio([&] {
        for (int b = 0; b < kBlocks; ++b) {
            pushRamp(tap, kBlock, (float)(b * kBlock));
            std::this_thread::sleep_for(std::chrono::microseconds(200));
        }
        done.store(true, std::memory_order_release);
    });

    size_t got = 0, lost = 0;
    std::vector<float> out;
    while (got + lost < (size_t)kBlocks * kBlock) {
        const auto d = tap.drain(out, 4096);
        got += d.frames;
        lost += d.lostFrames;
        // Every frame that DID arrive has its two sides from the same moment: the ramp is written
        // as +v on the left and -v on the right, so a torn frame does not sum to zero.
        for (size_t i = 0; i < d.frames; ++i)
            if (out[i * 2] != -out[i * 2 + 1]) {
                CHECK(false);   // the two sides came from different frames: a torn read
                break;
            }
        if (d.frames == 0 && !done.load(std::memory_order_acquire))
            std::this_thread::sleep_for(std::chrono::microseconds(100));
    }
    audio.join();
    CHECK(got + lost == (size_t)kBlocks * kBlock);
    // A reader that keeps up loses NOTHING — the ring holds seconds and this is 2 ms of audio.
    CHECK(lost == 0);
    CHECK(tap.lostFrames() == 0);
}

}  // namespace

int main() {
    RUN(carries_every_frame_in_order);
    RUN(a_drain_resumes_where_it_stopped);
    RUN(a_slow_drain_catches_up_rather_than_skipping);
    RUN(an_overrun_is_COUNTED);
    RUN(a_take_starts_clean);
    RUN(the_two_threads_do_not_tear);
    TEST_MAIN_END();
}
