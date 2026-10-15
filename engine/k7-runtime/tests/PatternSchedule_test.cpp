// A pattern lane's schedule: notes land at their edit time, block after block, and a seek, a stop or a tempo change
// drops what was queued for the old timeline instead of playing it. JUCE-free, so it runs in the FAST binary.
//
// What would be wrong SILENTLY: a note-off owed across a seek (a note that never ends), and notes from before a jump
// played after it (a beat in the wrong place, with the graph looking right). See ../docs/patternPlugin.md.

#include "PatternSchedule.h"

#include "test_harness.h"

#include <cmath>
#include <vector>

using studio::NoteEvent;
using studio::PatternCursor;
using studio::PatternSchedule;
using studio::PatternTempo;
using studio::TimedNote;

namespace {

const PatternTempo k120{120.0, 4.0};  // one cycle = one 4/4 bar = 2 s

bool near(double a, double b) { return std::abs(a - b) < 1e-9; }

std::vector<NoteEvent> block(PatternSchedule& s, double from, double to, bool playing = true,
                             PatternTempo tempo = k120) {
    NoteEvent buf[64];
    const int n = s.process(from, to, playing, tempo, buf, 64);
    return {buf, buf + n};
}

// Primes the schedule at `at`, stopped, the way a transport sits before play.
void primeAt(PatternSchedule& s, double at) { block(s, at, at, false); }

void push(PatternSchedule& s, double start, double end, int key) {
    s.ring.push(TimedNote{start, end, key, 0.8f, s.epoch()});
}

void notesLandAtTheirTimeAcrossBlocks() {
    PatternSchedule s;
    primeAt(s, 0.0);
    push(s, 0.010, 0.030, 60);
    push(s, 0.050, 0.200, 62);
    const auto a = block(s, 0.0, 0.040);  // 60 on and off, inside one block
    CHECK(a.size() == 2);
    CHECK(a[0].note == 60 && a[0].velocity > 0 && near(a[0].at, 0.010));
    CHECK(a[1].note == 60 && a[1].velocity == 0 && near(a[1].at, 0.030));
    const auto b = block(s, 0.040, 0.080);  // 62 on
    CHECK(b.size() == 1 && b[0].note == 62 && b[0].velocity > 0 && near(b[0].at, 0.010));
    CHECK(block(s, 0.080, 0.120).empty());
    const auto c = block(s, 0.180, 0.220, true);  // a jump — but 62's off must still be sent
    CHECK(!c.empty() && c[0].note == 62 && c[0].velocity == 0);
}

void aSeekDropsTheOldTimelineAndReleases() {
    PatternSchedule s;
    primeAt(s, 0.0);
    push(s, 0.0, 1.0, 60);
    push(s, 0.5, 0.6, 64);
    const uint32_t before = s.epoch();
    CHECK(block(s, 0.0, 0.01).size() == 1);  // 60 sounding
    const auto jump = block(s, 4.0, 4.01);   // seek while playing
    CHECK(s.epoch() != before);
    CHECK(jump.size() == 1 && jump[0].note == 60 && jump[0].velocity == 0);
    // A note from the old epoch that reaches the ring late is never played.
    s.ring.push(TimedNote{4.02, 4.1, 67, 0.8f, before});
    CHECK(block(s, 4.01, 4.05).empty());
}

void stopReleasesAndPlayFromTheSamePlaceKeepsTheQueue() {
    PatternSchedule s;
    primeAt(s, 0.0);
    push(s, 0.0, 1.0, 60);
    CHECK(block(s, 0.0, 0.01).size() == 1);
    const auto stop = block(s, 0.01, 0.01, false);
    CHECK(stop.size() == 1 && stop[0].velocity == 0);
    // Stopped at 0.01: the worker queues from there, and pressing play there keeps it.
    push(s, 0.02, 0.03, 72);
    CHECK(block(s, 0.01, 0.01, false).empty());
    const auto play = block(s, 0.01, 0.05);
    CHECK(play.size() == 2 && play[0].note == 72);
}

void aLateNotePlaysAtTheTopOnlyWithinTolerance() {
    PatternSchedule s;
    primeAt(s, 0.0);
    CHECK(block(s, 0.0, 0.1).empty());
    push(s, 0.09, 0.2, 60);   // 10 ms late: played at the top of the block
    push(s, 0.01, 0.02, 61);  // 90 ms late: dropped and counted
    const auto b = block(s, 0.1, 0.12);
    CHECK(b.size() == 1 && b[0].note == 60 && near(b[0].at, 0.0));
    CHECK(s.lateCount() == 1);
}

void aTempoChangeStartsANewEpoch() {
    PatternSchedule s;
    primeAt(s, 0.0);
    const uint32_t before = s.epoch();
    block(s, 0.0, 0.01);
    block(s, 0.01, 0.02, true, PatternTempo{90.0, 4.0});
    CHECK(s.epoch() != before);
    CHECK(near(s.tempo().bpm, 90.0));
}

void aRepeatedKeyIsReleasedBeforeItIsStruckAgain() {
    PatternSchedule s;
    primeAt(s, 0.0);
    push(s, 0.0, 0.5, 60);
    push(s, 0.02, 0.5, 60);
    const auto b = block(s, 0.0, 0.04);
    CHECK(b.size() == 3);
    CHECK(b[0].velocity > 0 && b[1].velocity == 0 && b[2].velocity > 0);
    CHECK(near(b[1].at, 0.02) && near(b[2].at, 0.02));
}

void anOverlappingNoteOfTheSameKeyIsNotCutByTheFirstOnesEnd() {
    PatternSchedule s;
    primeAt(s, 0.0);
    push(s, 0.02, 0.5, 60);  // queued out of order on purpose
    push(s, 0.0, 0.03, 60);
    const auto b = block(s, 0.0, 0.04);
    CHECK(b.size() == 3);
    CHECK(b[0].velocity > 0 && near(b[0].at, 0.0));
    CHECK(b[1].velocity == 0 && near(b[1].at, 0.02));
    CHECK(b[2].velocity > 0 && near(b[2].at, 0.02));
    CHECK(block(s, 0.04, 0.1).empty());  // the second note is still sounding
}

void aSampleIsAHitNotANote() {
    PatternSchedule s;
    primeAt(s, 0.0);
    s.ring.push(TimedNote{0.01, 0.2, 36, 0.5f, s.epoch(), 3});
    push(s, 0.02, 0.03, 60);
    NoteEvent notes[16];
    studio::SampleHit hits[4];
    int numHits = 0;
    const int n = s.process(0.0, 0.04, true, k120, notes, 16, hits, &numHits, 4);
    CHECK(n == 2);  // the note's on and off, nothing for the sample
    CHECK(numHits == 1 && hits[0].slot == 3 && near(hits[0].at, 0.01) && hits[0].gain == 0.5f);
    // …and it owes no note-off: nothing is left sounding.
    CHECK(block(s, 0.3, 0.3, false).empty());
}

void theCursorCoversTheLookAheadWithoutOverlap() {
    PatternSchedule s;
    primeAt(s, 1.0);  // stopped at 1 s = cycle 0.5
    PatternCursor c;
    double from = 0, to = 0;
    CHECK(c.window(s, k120, 0.25, from, to));
    CHECK(near(from, 0.5) && near(to, 0.625));
    CHECK(!c.window(s, k120, 0.25, from, to));  // nothing new until the playhead moves
    block(s, 1.0, 1.1);
    CHECK(c.window(s, k120, 0.25, from, to));
    CHECK(near(from, 0.625) && near(to, 0.675));
    // A seek restarts the cursor at the new anchor.
    block(s, 10.0, 10.01);
    CHECK(c.window(s, k120, 0.25, from, to));
    CHECK(near(from, 5.0));
    const TimedNote t = c.timed(5.25, 0.25, 60, 0.9f, k120);
    CHECK(near(t.start, 10.5) && near(t.end, 11.0) && t.epoch == s.epoch());
}

}  // namespace

int main() {
    RUN(notesLandAtTheirTimeAcrossBlocks);
    RUN(aSeekDropsTheOldTimelineAndReleases);
    RUN(stopReleasesAndPlayFromTheSamePlaceKeepsTheQueue);
    RUN(aLateNotePlaysAtTheTopOnlyWithinTolerance);
    RUN(aTempoChangeStartsANewEpoch);
    RUN(aRepeatedKeyIsReleasedBeforeItIsStruckAgain);
    RUN(anOverlappingNoteOfTheSameKeyIsNotCutByTheFirstOnesEnd);
    RUN(aSampleIsAHitNotANote);
    RUN(theCursorCoversTheLookAheadWithoutOverlap);
    TEST_MAIN_END();
}
