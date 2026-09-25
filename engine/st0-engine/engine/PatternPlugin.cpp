#include "PatternPlugin.h"

#include "StrudelHost.h"
#include "Warnings.h"

#include <limits>

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the type the song compile names for an engine-clocked lane — @studio/song nodeProject.ts.
const char* PatternPlugin::xmlTypeName = "studio_pattern";

namespace {

const juce::Identifier kPattern{"pattern"};
const juce::Identifier kLabel{"label"};
const juce::Identifier kDocId{"docId"};

// How often the worker looks at the playhead: well inside the late tolerance, so a seek costs the first note nothing.
constexpr int workerPeriodMs = 10;

// A warning raised off the message thread, delivered on it — warn()'s sink is not ours to call from a worker.
void warnLater(std::string message, std::string subject) {
    juce::MessageManager::callAsync([message = std::move(message), subject = std::move(subject)] {
        warn(message, subject);
    });
}

}  // namespace

// The look-ahead: keeps the ring filled a quarter second past the playhead, live only.
class PatternPlugin::Worker : public juce::Thread {
public:
    explicit Worker(PatternPlugin& p) : juce::Thread("st0 pattern"), plugin_(p) {}

    void run() override {
        PatternCursor cursor;
        while (!threadShouldExit()) {
            // An offline render queries for itself; anything this pushed then would be discarded anyway.
            if (!plugin_.rendering_.load()) {
                plugin_.ensureLoaded();
                const PatternTempo tempo = plugin_.schedule_.tempo();
                double from = 0, to = 0;
                if (cursor.window(plugin_.schedule_, tempo, lookaheadSeconds, from, to))
                    plugin_.feed(cursor, from, to, tempo, true);
            }
            wait(workerPeriodMs);
        }
    }

private:
    PatternPlugin& plugin_;
};

PatternPlugin::PatternPlugin(te::PluginCreationInfo info)
    : Plugin(std::move(info))
{
    // No lock: the worker that reads these is started below.
    source_ = state.getProperty(kPattern).toString().toStdString();
    label_ = state.getProperty(kLabel).toString().toStdString();
    subject_ = state.getProperty(kDocId).toString().toStdString();
    sourceVersion_ = source_.empty() ? 0 : 1;
    worker_ = std::make_unique<Worker>(*this);
    worker_->startThread(juce::Thread::Priority::normal);
}

PatternPlugin::~PatternPlugin()
{
    notifyListenersOfDeletion();
    worker_->stopThread(2000);
}

void PatternPlugin::initialise(const te::PluginInitialisationInfo&) {}

void PatternPlugin::deinitialise() {}

void PatternPlugin::reset()
{
    // No buffer to put the offs in here: the next block sends them.
    panic_ = true;
}

void PatternPlugin::midiPanic()
{
    // The notes are SCHEDULED here, not downstream: a panic that only reached the instrument would be replayed at once.
    panic_ = true;
}

void PatternPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    if (v.hasProperty(kPattern)) setSource(v.getProperty(kPattern).toString());
}

void PatternPlugin::valueTreePropertyChanged(juce::ValueTree& v, const juce::Identifier& id)
{
    // The live edit of a pattern: the source arrives in place (ProjectDiff's PatternChanged), never as a new plugin.
    if (v == state && id == kPattern) setSource(v.getProperty(kPattern).toString());
    Plugin::valueTreePropertyChanged(v, id);
}

void PatternPlugin::setSource(const juce::String& source)
{
    std::lock_guard<std::mutex> g(sourceLock_);
    const std::string s = source.toStdString();
    if (s == source_) return;
    source_ = s;
    ++sourceVersion_;
}

void PatternPlugin::ensureLoaded()
{
    std::lock_guard<std::mutex> g(hostLock_);
    // Booted here rather than in the constructor: tens of ms, and the constructor runs on the message thread.
    if (host_ == nullptr) {
        host_ = std::make_unique<StrudelHost>();
        if (!host_->ready()) warnLater("pattern engine failed to start: " + host_->bootError(), subject_);
    }
    std::string source;
    uint64_t version = 0;
    {
        std::lock_guard<std::mutex> s(sourceLock_);
        source = source_;
        version = sourceVersion_;
    }
    if (!host_->ready() || loadedVersion_ == version) return;
    std::string error;
    if (host_->loadPattern(source, error)) {
        lastError_.clear();
    } else if (error != lastError_) {
        // The previous pattern keeps playing; the message is only repeated when it changes.
        lastError_ = error;
        warnLater("pattern '" + label_ + "' did not evaluate — still playing the previous one: " +
                      error.substr(0, error.find('\n')),
                  subject_);
    }
    loadedVersion_ = version;
}

void PatternPlugin::feed(PatternCursor& cursor, double from, double to, const PatternTempo& tempo, bool live)
{
    std::vector<LaneNote> notes;
    {
        std::lock_guard<std::mutex> g(hostLock_);
        if (host_ == nullptr || !host_->ready()) return;
        std::string error;
        notes = host_->laneNotes(from, to, label_, error);
    }
    for (const auto& n : notes) {
        const TimedNote t = cursor.timed(n.cycle, n.dur, n.key, n.vel, tempo);
        if (live)
            schedule_.ring.push(t);
        else
            schedule_.insert(t);
    }
}

PatternTempo PatternPlugin::editTempo()
{
    // Read on the audio thread, once a block, as the arpeggiator reads it: plain numbers off CachedValues.
    PatternTempo t;
    if (auto* tempo = edit.tempoSequence.getTempo(0)) t.bpm = tempo->getBpm();
    if (auto* sig = edit.tempoSequence.getTimeSig(0)) {
        const int num = sig->numerator.get();
        const int den = sig->denominator.get();
        if (num > 0 && den > 0) t.beatsPerCycle = num * 4.0 / den;
    }
    return t;
}

void PatternPlugin::applyToBuffer(const te::PluginRenderContext& fc)
{
    if (fc.bufferForMidiMessages == nullptr) return;
    auto& midi = *fc.bufferForMidiMessages;

    const double start = fc.editTime.getStart().inSeconds();
    const double end = fc.editTime.getEnd().inSeconds();
    const PatternTempo tempo = editTempo();
    const int cap = (int)events_.size();
    int n = 0;

    if (panic_.exchange(false)) n = schedule_.restartAt(start, events_.data(), cap);

    if (fc.isRendering) {
        // Offline, time is not real, so the look-ahead would fall behind: this block is queried here, synchronously.
        if (!rendering_.exchange(true)) {
            n += schedule_.restartAt(start, events_.data() + n, cap - n);
            renderCursor_ = {};
        }
        n += schedule_.begin(start, end, fc.isPlaying, tempo, events_.data() + n, cap - n);
        ensureLoaded();
        double from = 0, to = 0;
        if (fc.isPlaying && renderCursor_.window(schedule_, tempo, 0.0, from, to))
            feed(renderCursor_, from, to, tempo, false);
        n = schedule_.emit(start, end, fc.isPlaying, events_.data(), n, cap, false);
    } else {
        if (rendering_.exchange(false)) n += schedule_.restartAt(start, events_.data() + n, cap - n);
        n += schedule_.begin(start, end, fc.isPlaying, tempo, events_.data() + n, cap - n);
        n = schedule_.emit(start, end, fc.isPlaying, events_.data(), n, cap);
    }

    // What came in (a clip on the same lane, a keyboard) plays too, merged by time: out of order is dropped downstream.
    passThrough_.clear();
    for (auto& m : midi) passThrough_.addMidiMessage(m, m.getTimeStamp(), te::MidiMessageArray::notMPE);
    midi.clear();
    int keep = 0;
    const auto passUntil = [&](double at) {
        while (keep < passThrough_.size() && passThrough_[keep].getTimeStamp() <= at) {
            midi.addMidiMessage(passThrough_[keep], passThrough_[keep].getTimeStamp(),
                                te::MidiMessageArray::notMPE);
            ++keep;
        }
    };
    for (int i = 0; i < n; ++i) {
        const auto& e = events_[(size_t)i];
        passUntil(e.at);
        const auto msg = e.velocity > 0.0f ? juce::MidiMessage::noteOn(e.channel, e.note, e.velocity)
                                           : juce::MidiMessage::noteOff(e.channel, e.note);
        midi.addMidiMessage(msg, e.at, te::MidiMessageArray::notMPE);
    }
    passUntil(std::numeric_limits<double>::max());
}

}  // namespace studio
