#include "PatternPlugin.h"

#include "StrudelHost.h"
#include "Warnings.h"

#include <limits>

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the type the song compile names for a pattern lane — @studio/song enginePattern.ts.
const char* PatternPlugin::xmlTypeName = "studio_pattern";

namespace {

const juce::Identifier kPattern{"pattern"};
const juce::Identifier kLabel{"label"};
const juce::Identifier kDocId{"docId"};
const juce::Identifier kCatchAll{"catchAll"};
const juce::Identifier kClaimed{"claimed"};
const juce::Identifier kPlays{"plays"};
const juce::Identifier kOnly{"only"};
const juce::Identifier kBanks{"banks"};

// How often the worker looks at the playhead: well inside the late tolerance, so a seek costs the first note nothing.
constexpr int workerPeriodMs = 10;

// How far into a pattern a lane looks for its own label before saying the pattern has none.
constexpr double labelProbeCycles = 8.0;

// A list property, one entry per line — how EditBuilder writes `claimed` and `banks`.
std::vector<std::string> lines(const juce::var& v) {
    std::vector<std::string> out;
    for (const auto& l : juce::StringArray::fromLines(v.toString()))
        if (l.isNotEmpty()) out.push_back(l.toStdString());
    return out;
}

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
    // Its own stack, sized: QuickJS recurses on it, and the OS default (512 KiB on macOS) is less than it would assume.
    explicit Worker(PatternPlugin& p) : juce::Thread("k7 pattern", kStackBytes), plugin_(p) {}

    void run() override {
        StrudelHost::setThreadStackBudget(kStackBytes / 2);
        PatternCursor cursor;
        while (!threadShouldExit()) {
            // An offline render queries for itself; anything this pushed then would be discarded anyway.
            if (!plugin_.rendering_.load()) {
                plugin_.ensureLoaded();
                const PatternTempo tempo = plugin_.schedule_.tempo();
                double from = 0, to = 0;
                // Caught HERE: an exception leaving juce::Thread::run is std::terminate, and a pattern is user content.
                try {
                    if (cursor.window(plugin_.schedule_, tempo, lookaheadSeconds, from, to))
                        plugin_.feed(cursor, from, to, tempo, true);
                } catch (const std::exception& e) {
                    plugin_.warnOnce(std::string("threw:") + e.what(),
                                     "pattern lane '" + plugin_.label_ + "' failed: " + e.what());
                }
            }
            wait(workerPeriodMs);
        }
    }

private:
    static constexpr std::size_t kStackBytes = 8 * 1024 * 1024;
    PatternPlugin& plugin_;
};

PatternPlugin::PatternPlugin(te::PluginCreationInfo info)
    : Plugin(std::move(info))
{
    // No lock: the worker that reads these is started below.
    source_ = state.getProperty(kPattern).toString().toStdString();
    label_ = state.getProperty(kLabel).toString().toStdString();
    subject_ = state.getProperty(kDocId).toString().toStdString();
    catchAll_ = (bool)state.getProperty(kCatchAll, false);
    claimed_ = lines(state.getProperty(kClaimed));
    const juce::String plays = state.getProperty(kPlays, "both").toString();
    playsNotes_ = plays != "samples";
    playsSamples_ = plays != "notes";
    onlyInstance_ = (bool)state.getProperty(kOnly, true);
    banks_.setDirs(lines(state.getProperty(kBanks)));
    sourceVersion_ = source_.empty() ? 0 : 1;
    for (auto& s : slots_) s.store(nullptr);
    // Sized HERE, on the message thread: a MidiMessageArray grows on add, and the adds happen on the audio thread.
    passThrough_.reserve(maxPassThrough);
    worker_ = std::make_unique<Worker>(*this);
    worker_->startThread(juce::Thread::Priority::normal);
}

PatternPlugin::~PatternPlugin()
{
    notifyListenersOfDeletion();
    // Waited for, never killed: a thread killed inside hostLock_ leaves it locked for good, and its work is bounded — a 250 ms JS deadline, capped sample decodes.
    worker_->signalThreadShouldExit();
    worker_->notify();
    worker_->waitForThreadToExit(-1);
}

void PatternPlugin::initialise(const te::PluginInitialisationInfo& info)
{
    sampleRate_ = info.sampleRate > 0.0 ? info.sampleRate : 48000.0;
}

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

void PatternPlugin::warnOnce(const std::string& key, const std::string& message)
{
    // hostLock_ is held by every caller, which is what makes `warned_` safe.
    if (warned_.insert(key).second) warnLater(message, subject_);
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
    loadedVersion_ = version;
    std::string error;
    if (!host_->loadPattern(source, error)) {
        // The previous pattern keeps playing; the message is only repeated when it changes.
        if (error != lastError_)
            warnLater("pattern '" + label_ + "' did not evaluate — still playing the previous one: " +
                          error.substr(0, error.find('\n')),
                      subject_);
        lastError_ = error;
        return;
    }
    lastError_.clear();
    // A lane whose label the pattern never plays is silent with a graph that looks right, so it is said — per version.
    if (!catchAll_ && host_->laneEvents(0.0, labelProbeCycles, label_, false, {}, error).empty()) {
        juce::StringArray have;
        for (const auto& l : host_->labels(0.0, labelProbeCycles)) have.add(l);
        warnLater("pattern lane '" + label_ + "' finds no event labelled '" + label_ + "' in its first " +
                      std::to_string((int)labelProbeCycles) + " cycles (labels: " +
                      (have.isEmpty() ? juce::String("none") : have.joinIntoString(", ")).toStdString() + ")",
                  subject_);
    }
}

int PatternPlugin::sampleSlot(const std::string& path)
{
    if (auto it = slotOf_.find(path); it != slotOf_.end()) return it->second;
    int slot = -1;
    if ((int)owned_.size() < maxSamples) {
        juce::AudioFormatManager formats;
        formats.registerBasicFormats();
        std::unique_ptr<juce::AudioFormatReader> r{formats.createReaderFor(juce::File(juce::String(path)))};
        // A header claiming no frames or more than a one-shot can be is refused before it sizes a buffer: this is the worker, with no net above it.
        if (r != nullptr && (r->lengthInSamples <= 0 || r->lengthInSamples > maxSampleFrames)) {
            warnOnce("size:" + path, "pattern lane '" + label_ + "': sample " + path + " is empty or too long to load");
        } else if (r != nullptr) {
            auto data = std::make_unique<SampleData>();
            const int ch = (int)std::min<unsigned>(2u, r->numChannels);
            data->audio.setSize(std::max(1, ch), (int)r->lengthInSamples);
            r->read(&data->audio, 0, (int)r->lengthInSamples, 0, true, ch > 1);
            data->rate = r->sampleRate > 0.0 ? r->sampleRate : 44100.0;
            slot = (int)owned_.size();
            // Published AFTER it is whole: the audio thread only ever sees a finished sample.
            slots_[(size_t)slot].store(data.get(), std::memory_order_release);
            owned_.push_back(std::move(data));
        } else {
            warnOnce("unreadable:" + path, "pattern lane '" + label_ + "': cannot read sample " + path);
        }
    } else {
        warnOnce("full", "pattern lane '" + label_ + "' holds " + std::to_string(maxSamples) +
                             " samples already — new ones are skipped");
    }
    slotOf_[path] = slot;
    return slot;
}

void PatternPlugin::feed(PatternCursor& cursor, double from, double to, const PatternTempo& tempo, bool live)
{
    std::lock_guard<std::mutex> g(hostLock_);
    if (host_ == nullptr || !host_->ready()) return;
    std::string error;
    const auto events = host_->laneEvents(from, to, label_, catchAll_, claimed_, error);
    for (const auto& e : events) {
        // A name that resolves in the banks IS a sample; anything else is a note — the rule the lane's two halves share.
        const std::string path = banks_.resolve(e.s, e.n);
        int sample = -1;
        if (!path.empty()) {
            if (!playsSamples_) {
                if (onlyInstance_)
                    warnOnce("sample:" + e.s, "pattern lane '" + label_ + "' has no audio output wired — sample '" +
                                                  e.s + "' skipped; add a '" + label_ + "#audio:' key");
                continue;
            }
            sample = sampleSlot(path);
            if (sample < 0) continue;
        } else if (!playsNotes_) {
            if (onlyInstance_)
                warnOnce("notes", "pattern lane '" + label_ + "' has no midi output wired — its notes are skipped; add a '" +
                                      label_ + "#midi:' key");
            continue;
        }
        const TimedNote t = cursor.timed(e.cycle, e.dur, e.key, e.vel, tempo, sample);
        if (live)
            schedule_.ring.push(t);
        else
            schedule_.insert(t);
    }
}

PatternTempo PatternPlugin::editTempo()
{
    // Read on the audio thread, once a block, through the sequence Tracktion makes safe there: one snapshot, so the two halves of a signature cannot tear.
    PatternTempo t;
    const auto& seq = edit.tempoSequence.getInternalSequence();
    t.bpm = seq.getBpmAt(tracktion::TimePosition());
    const auto sig = seq.getTimeSignatureAt(tracktion::TimePosition());
    if (sig.numerator > 0 && sig.denominator > 0) t.beatsPerCycle = sig.numerator * 4.0 / sig.denominator;
    return t;
}

void PatternPlugin::renderVoices(const te::PluginRenderContext& fc)
{
    if (fc.destBuffer == nullptr || fc.bufferNumSamples <= 0) return;
    auto& dest = *fc.destBuffer;
    const int outCh = std::min(2, dest.getNumChannels());
    for (auto& v : voices_) {
        if (v.sample == nullptr) continue;
        const auto& src = v.sample->audio;
        const int len = src.getNumSamples();
        const int srcCh = src.getNumChannels();
        const double step = v.sample->rate / sampleRate_;
        for (int i = v.startOffset; i < fc.bufferNumSamples; ++i) {
            const int idx = (int)v.pos;
            if (idx + 1 >= len) {
                v.sample = nullptr;
                break;
            }
            const float frac = (float)(v.pos - idx);
            for (int c = 0; c < outCh; ++c) {
                const float* s = src.getReadPointer(std::min(c, srcCh - 1));
                dest.addSample(c, fc.bufferStartSample + i, (s[idx] + (s[idx + 1] - s[idx]) * frac) * v.gain);
            }
            v.pos += step;
        }
        v.startOffset = 0;
    }
}

void PatternPlugin::applyToBuffer(const te::PluginRenderContext& fc)
{
    const double start = fc.editTime.getStart().inSeconds();
    const double end = fc.editTime.getEnd().inSeconds();
    const PatternTempo tempo = editTempo();
    const int cap = (int)events_.size();
    const uint32_t epochBefore = schedule_.epoch();
    int n = 0;
    int numHits = 0;

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
        n = schedule_.emit(start, end, fc.isPlaying, events_.data(), n, cap, false, hits_.data(), &numHits,
                           (int)hits_.size());
    } else {
        if (rendering_.exchange(false)) n += schedule_.restartAt(start, events_.data() + n, cap - n);
        n += schedule_.begin(start, end, fc.isPlaying, tempo, events_.data() + n, cap - n);
        n = schedule_.emit(start, end, fc.isPlaying, events_.data(), n, cap, true, hits_.data(), &numHits,
                           (int)hits_.size());
    }

    // A new epoch is a jump or a stop: what rings from the old timeline is cut, like the notes it released.
    if (schedule_.epoch() != epochBefore)
        for (auto& v : voices_) v.sample = nullptr;
    for (int i = 0; i < numHits; ++i) {
        const auto* sample = slots_[(size_t)hits_[(size_t)i].slot].load(std::memory_order_acquire);
        if (sample == nullptr) continue;
        // A free voice, else the one furthest through its sample — the least audible to steal.
        Voice* pick = &voices_[0];
        for (auto& v : voices_) {
            if (v.sample == nullptr) {
                pick = &v;
                break;
            }
            if (v.pos > pick->pos) pick = &v;
        }
        *pick = {sample, 0.0, hits_[(size_t)i].gain,
                 std::clamp((int)std::lround(hits_[(size_t)i].at * sampleRate_), 0,
                            std::max(0, fc.bufferNumSamples - 1))};
    }
    renderVoices(fc);

    if (fc.bufferForMidiMessages == nullptr) return;
    auto& midi = *fc.bufferForMidiMessages;
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
