#include "ArpeggiatorPlugin.h"

#include <limits>

namespace studio {

namespace te = tracktion::engine;

// Renaming this renames the id a module.yaml may name the built-in by — see resolveBuiltInType in EditBuilder.cpp.
const char* ArpeggiatorPlugin::xmlTypeName = "studio_arpeggiator";

namespace {

// The divisions `Rate` selects, index for index with ArpeggiatorPlugin::rateBeats.
juce::StringArray rateLabels()
{
    return {"1/1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/32"};
}

// What a block may need at the fastest step; past it a step is skipped, and never a note-off (docs/arpeggiator.md).
constexpr int maxEventsPerBlock = 256;

// The one tempo a ProjectDoc carries, and the floor under it — a tempo of zero would be a step of forever.
constexpr double minBpm = 20.0;

// The order the parameters are CREATED in below, which is the order they are read back in: `Step 1` is kFirstStep.
enum ParamIndex {
    kRate = 0,
    kOctaves = 1,
    kDirection = 2,
    kSteps = 3,
    kFirstStep = 4,
    kFirstVelocity = kFirstStep + Arpeggiator::maxSteps,
    kFirstGate = kFirstVelocity + Arpeggiator::maxSteps,
};

// A drawn step's settings: a rest, then the slot it plays, 1 the lowest held note.
juce::StringArray stepLabels()
{
    juce::StringArray labels{"-"};
    for (int i = 1; i <= Arpeggiator::maxSteps; ++i) labels.add(juce::String(i));
    return labels;
}

// What a fresh pattern holds: `up` over eight slots, so Custom chosen before anything is drawn still plays.
float stepDefault(int step)
{
    return (float)(((step - 1) % 8) + 1);
}

}  // namespace

ArpeggiatorPlugin::ArpeggiatorPlugin(te::PluginCreationInfo info)
    : Plugin(std::move(info))
{
    auto* um = getUndoManager();
    // Created HERE, because Tracktion creates AutomatableParameters nowhere else — MidiGraphPlugin's rule.
    const auto choice = [&](const juce::String& name, float min, float max, float def,
                            const juce::StringArray& labels) {
        auto value = std::make_unique<juce::CachedValue<float>>();
        // Spaces dropped from the state id only: an Identifier may not hold one, and `Step 1` is the name a panel binds.
        value->referTo(state, juce::Identifier("p_" + name.removeCharacters(" ")), um, def);
        te::AutomatableParameter::Ptr param = new te::DiscreteLabelledParameter(
            name.toLowerCase(), name, *this, {min, max}, labels.size(), labels);
        addAutomatableParameter(param);
        param->attachToCurrentValue(*value);
        params_.push_back(param);
        values_.push_back(std::move(value));
    };
    // All three are CHOICES rather than knobs: an eighth and a half of a quarter are the same setting.
    choice("Rate", 0.0f, (float)rateBeats.size() - 1.0f, (float)rateDefault, rateLabels());
    choice("Octaves", 1.0f, (float)Arpeggiator::maxOctaves, 1.0f, {"1", "2", "3", "4"});
    choice("Direction", 0.0f, 4.0f, 0.0f, {"Up", "Down", "Up-down", "Random", "Custom"});
    // The drawn pattern Custom plays — a length and one choice per step, set by the panel's screen (docs/arpeggiator.md).
    juce::StringArray lengths;
    for (int i = 1; i <= Arpeggiator::maxSteps; ++i) lengths.add(juce::String(i));
    choice("Steps", 1.0f, (float)Arpeggiator::maxSteps, 8.0f, lengths);
    for (int i = 1; i <= Arpeggiator::maxSteps; ++i)
        choice("Step " + juce::String(i), 0.0f, (float)Arpeggiator::maxSteps, stepDefault(i), stepLabels());
    // Per step, how loud and how long — continuous, so these are plain parameters rather than choices.
    const auto level = [&](const juce::String& name, float min, float max, float def) {
        auto value = std::make_unique<juce::CachedValue<float>>();
        value->referTo(state, juce::Identifier("p_" + name.removeCharacters(" ")), um, def);
        auto param = addParam(name.toLowerCase().removeCharacters(" "), name, {min, max});
        param->attachToCurrentValue(*value);
        params_.push_back(param);
        values_.push_back(std::move(value));
    };
    for (int i = 1; i <= Arpeggiator::maxSteps; ++i) level("Velocity " + juce::String(i), 0.0f, 1.0f, 1.0f);
    for (int i = 1; i <= Arpeggiator::maxSteps; ++i)
        level("Gate " + juce::String(i), (float)Arpeggiator::minGate, (float)Arpeggiator::maxGate,
              (float)Arpeggiator::gate);
    events_.resize(maxEventsPerBlock);
    // Sized HERE, on the message thread: a MidiMessageArray grows on add, and the adds happen on the audio thread.
    passThrough_.reserve(maxEventsPerBlock);
}

ArpeggiatorPlugin::~ArpeggiatorPlugin()
{
    notifyListenersOfDeletion();
    for (auto& p : params_) p->detachFromCurrentValue();
}

void ArpeggiatorPlugin::initialise(const te::PluginInitialisationInfo& info)
{
    sampleRate_ = info.sampleRate > 0.0 ? info.sampleRate : 44100.0;
    arp_.reset();
}

void ArpeggiatorPlugin::deinitialise()
{
    arp_.reset();
}

void ArpeggiatorPlugin::midiPanic()
{
    // The chord is HELD here, not downstream: a panic that only reached the instrument would leave
    // this playing the same notes at it again on the next block. See docs/panic.md.
    resetPending_ = true;
}

void ArpeggiatorPlugin::reset()
{
    // Nothing is emitted here: a reset has no buffer to put a note-off in, and the host sends all-notes-off.
    resetPending_ = true;
}

void ArpeggiatorPlugin::restorePluginStateFromValueTree(const juce::ValueTree& v)
{
    for (auto& value : values_)
        if (auto* p = v.getPropertyPointer(value->getPropertyID()))
            *value = static_cast<float>(*p);
        else
            value->resetToDefault();
    for (auto p : getAutomatableParameters())
        p->updateFromAttachedValue();
}

float ArpeggiatorPlugin::paramValue(int index) const
{
    if (index < 0 || index >= (int)params_.size()) return 0.0f;
    return params_[(size_t)index]->getCurrentValue();
}

double ArpeggiatorPlugin::stepSeconds()
{
    const int i = juce::jlimit(0, (int)rateBeats.size() - 1, juce::roundToInt(paramValue(kRate)));
    // Read on the audio thread, once a block, through the sequence Tracktion makes safe there — the TempoSetting objects are the message thread's.
    const double bpm = edit.tempoSequence.getInternalSequence().getBpmAt(tracktion::TimePosition());
    return rateBeats[(size_t)i] * 60.0 / juce::jmax(minBpm, bpm);
}

void ArpeggiatorPlugin::applyToBuffer(const te::PluginRenderContext& fc)
{
    // First, before any note of this block is taken in: a stop's reset must not eat the chord that follows it.
    if (resetPending_.exchange(false)) arp_.reset();
    if (fc.bufferForMidiMessages == nullptr) return;
    auto& midi = *fc.bufferForMidiMessages;

    // The chord is CONSUMED: what leaves here is what the arpeggiator plays, plus everything that is not a note.
    passThrough_.clear();
    for (auto& m : midi) {
        if (m.isNoteOn())
            arp_.noteOn(m.getNoteNumber(), m.getFloatVelocity(), m.getChannel(), m.getTimeStamp());
        else if (m.isNoteOff())
            arp_.noteOff(m.getNoteNumber());
        else
            passThrough_.addMidiMessage(m, m.getTimeStamp(), te::MidiMessageArray::notMPE);
    }

    const double seconds = sampleRate_ > 0.0 ? fc.bufferNumSamples / sampleRate_ : 0.0;
    // The drawn pattern, read into a member each block: no allocation, and a step edited live is heard on the next one.
    for (int i = 0; i < Arpeggiator::maxSteps; ++i) {
        pattern_[(size_t)i] = juce::roundToInt(paramValue(kFirstStep + i));
        velocity_[(size_t)i] = paramValue(kFirstVelocity + i);
        gate_[(size_t)i] = paramValue(kFirstGate + i);
    }
    const ArpPattern pattern{pattern_.data(),
                             juce::jlimit(1, Arpeggiator::maxSteps, juce::roundToInt(paramValue(kSteps))),
                             velocity_.data(), gate_.data()};
    const int n = arp_.advance(seconds, stepSeconds(), juce::roundToInt(paramValue(kOctaves)),
                               arpDirection(paramValue(kDirection)), events_.data(), (int)events_.size(),
                               pattern);

    midi.clear();
    // Merged by timestamp rather than appended: a list out of order is a list something downstream will drop.
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
        const auto msg = e.velocity > 0.0f
                             ? juce::MidiMessage::noteOn(e.channel, e.note, e.velocity)
                             : juce::MidiMessage::noteOff(e.channel, e.note);
        midi.addMidiMessage(msg, e.at, te::MidiMessageArray::notMPE);
    }
    passUntil(std::numeric_limits<double>::max());
}

}  // namespace studio
