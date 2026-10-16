#include "DspGraph.h"

#include <algorithm>
#include <cstdint>
#include <cmath>
#include <limits>

namespace studio {

namespace {

// A one-pole coefficient for a time constant in ms: the fraction of the gap left after one sample.
float coeffFor(float ms, double sampleRate) {
    const double t = juce::jmax(0.1, (double)ms) * 0.001;
    return (float)std::exp(-1.0 / (t * sampleRate));
}

// What one block of a strike node may write. Past it a STEP is skipped, and never a note-off.
constexpr int maxNoteEvents = 256;

// A wire's value, or `fallback` when it is NaN or infinite: jlimit lets a NaN through, and a NaN reaching a filter or an index never leaves.
inline float finiteOr(float v, float fallback) { return std::isfinite(v) ? v : fallback; }

// The longest delay line a graph may ask for: a minute, which bounds its allocation at any rate a device opens.
constexpr float kMaxDelayMs = 60000.0f;

// A graph is a few hundred bytes a few levels deep; these only stop a hostile text before the parser meets it.
constexpr int kMaxSourceBytes = 1 << 20;
constexpr int kMaxSourceDepth = 32;

// The slowest tempo a musical step is read at: at zero, one step would last forever.
constexpr double minSecondsPerBeat = 60.0 / 300.0;
constexpr double maxSecondsPerBeat = 60.0 / 20.0;

}  // namespace

int DspGraph::reg(const juce::String& name)
{
    for (int i = 0; i < (int)regNames_.size(); ++i)
        if (regNames_[(size_t)i] == name)
            return i;
    regNames_.push_back(name);
    return (int)regNames_.size() - 1;
}

// An input is a register name or a literal. A literal gets its own register, preloaded once at build.
int DspGraph::ref(const juce::var& v)
{
    if (v.isVoid() || (v.isString() && v.toString().isEmpty())) return -1;
    if (v.isDouble() || v.isInt() || v.isInt64()) {
        const float k = (float)(double)v;
        const int i = reg("#k" + juce::String(regNames_.size()));
        constants_.emplace_back(i, k);
        return i;
    }
    return reg(v.toString());
}

// An audio wire, in its OWN name space: one name meaning either a stereo frame or a scalar is a silent type error.
int DspGraph::awire(const juce::var& v)
{
    if (v.isVoid()) return -1;
    const auto name = v.toString();
    if (name.isEmpty()) return -1;
    for (int i = 0; i < (int)aNames_.size(); ++i)
        if (aNames_[(size_t)i] == name)
            return i;
    aNames_.push_back(name);
    return (int)aNames_.size() - 1;
}

std::unique_ptr<DspGraph> DspGraph::fromJson(const juce::String& json, juce::String& error)
{
    const char* text = json.toRawUTF8();
    const size_t size = json.getNumBytesAsUTF8();
    if (size > (size_t)kMaxSourceBytes) {
        error = "graph description is over 1 MiB";
        return nullptr;
    }
    int depth = 0;
    bool inString = false, escaped = false;
    for (size_t i = 0; i < size; ++i) {
        const char c = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (c == '\\') escaped = true;
            else if (c == '"') inString = false;
        } else if (c == '"') {
            inString = true;
        } else if ((c == '[' || c == '{') && ++depth > kMaxSourceDepth) {
            error = "graph description nests deeper than " + juce::String(kMaxSourceDepth) + " levels";
            return nullptr;
        } else if (c == ']' || c == '}') {
            --depth;
        }
    }
    return build(juce::JSON::parse(json), error);
}

std::unique_ptr<DspGraph> DspGraph::build(const juce::var& description, juce::String& error)
{
    auto* root = description.getDynamicObject();
    if (root == nullptr) {
        error = "graph is not an object";
        return nullptr;
    }
    auto g = std::unique_ptr<DspGraph>(new DspGraph());

    // `sr` first, so a description can read the sample rate (a Nyquist clamp needs it and no literal can say it).
    g->srReg_ = g->reg("sr");

    const auto& paramsVar = root->getProperty("params");
    if (auto* arr = paramsVar.getArray())
        for (const auto& p : *arr) {
            auto* o = p.getDynamicObject();
            if (o == nullptr) continue;
            DspGraphParam dp;
            dp.name = o->getProperty("name").toString().toStdString();
            if (dp.name.empty()) {
                error = "a param has no name";
                return nullptr;
            }
            if (juce::String(dp.name) == "sr") {
                error = "a param may not be called `sr`, which is the sample rate";
                return nullptr;
            }
            dp.min = (float)(double)o->getProperty("min");
            dp.max = (float)(double)o->getProperty("max");
            dp.def = (float)(double)o->getProperty("default");
            if (auto* labels = o->getProperty("labels").getArray())
                for (const auto& l : *labels)
                    dp.labels.push_back(l.toString().toStdString());
            // The nth param IS register n+1, by POSITION and never by name, so a name that already has one shifts every later param onto somebody else's register — docs/dspGraph.md.
            if (g->reg(juce::String(dp.name)) != (int)g->params_.size() + 1) {
                error = "a param is declared twice: " + juce::String(dp.name);
                return nullptr;
            }
            g->params_.push_back(std::move(dp));
        }

    const auto& nodesVar = root->getProperty("nodes");
    auto* nodes = nodesVar.getArray();
    if (nodes == nullptr) {
        error = "graph has no `nodes` array";
        return nullptr;
    }

    for (const auto& n : *nodes) {
        auto* o = n.getDynamicObject();
        if (o == nullptr) continue;
        const juce::String type = o->getProperty("type").toString();
        Node node;
        // Inputs are positional in `in`, so the description reads like a call: {type, in: [...], out}.
        if (auto* ins = o->getProperty("in").getArray())
            for (int i = 0; i < juce::jmin(MAX_IN, ins->size()); ++i)
                node.in[i] = g->ref((*ins)[i]);
        node.out = g->ref(o->getProperty("out"));

        if (type == "envelope")      { node.kind = Kind::envelope; node.phase = Phase::analysis; }
        else if (type == "todb")     { node.kind = Kind::todb;     node.phase = Phase::control; }
        else if (type == "fromdb")   { node.kind = Kind::fromdb;   node.phase = Phase::control; }
        else if (type == "lerp")     { node.kind = Kind::lerp;     node.phase = Phase::control; }
        else if (type == "linmap")   { node.kind = Kind::linmap;   node.phase = Phase::control; }
        else if (type == "geolerp")  { node.kind = Kind::geolerp;  node.phase = Phase::control; }
        else if (type == "clamp")    { node.kind = Kind::clamp;    node.phase = Phase::control; }
        else if (type == "select")   { node.kind = Kind::select;   node.phase = Phase::control; }
        else if (type == "add")      { node.kind = Kind::add;      node.phase = Phase::control; }
        else if (type == "sub")      { node.kind = Kind::sub;      node.phase = Phase::control; }
        else if (type == "mul")      { node.kind = Kind::mul;      node.phase = Phase::control; }
        else if (type == "glide")    { node.kind = Kind::glide;    node.phase = Phase::control; }
        else if (type == "gain")     { node.kind = Kind::gain;     node.phase = Phase::audio; }
        else if (type == "mix")      { node.kind = Kind::mix;      node.phase = Phase::audio;
                                       g->hasMix_ = true; }   // process() needs the dry snapshot
        // MIDI: block-rate rewrites of the message list, with scalar inputs and no `out` — the buffer IS the output.
        else if (type == "transpose" || type == "velocity" || type == "mchannel"
                 || type == "mhold" || type == "mstrike" || type == "mpattern"
                 || type == "maccent" || type == "mchance" || type == "mdecay") {
            node.kind = type == "transpose" ? Kind::transpose
                      : type == "velocity"  ? Kind::velocity
                      : type == "mchannel"  ? Kind::mchannel
                      : type == "mhold"     ? Kind::mhold
                      : type == "mpattern"  ? Kind::mpattern
                      : type == "maccent"   ? Kind::maccent
                      : type == "mchance"   ? Kind::mchance
                      : type == "mdecay"    ? Kind::mdecay
                                            : Kind::mstrike;
            node.phase = Phase::midi;
            g->hasMidiPhase_ = true;
        }
        else if (type == "ain" || type == "aout" || type == "adelay" || type == "amul" ||
                 type == "aadd" || type == "atanh" || type == "alfo" || type == "aallpass") {
            // Audio wires in `in`/`out`, scalars in `k` — the two never share a name space.
            node.phase = Phase::sample;
            g->hasSamplePhase_ = true;
            for (int i = 0; i < MAX_IN; ++i) node.in[i] = -1;
            if (auto* ins = o->getProperty("in").getArray())
                for (int i = 0; i < juce::jmin(MAX_IN, ins->size()); ++i)
                    node.in[i] = g->awire((*ins)[i]);
            node.out = g->awire(o->getProperty("out"));
            if (auto* ks = o->getProperty("k").getArray())
                for (int i = 0; i < juce::jmin(MAX_IN, ks->size()); ++i)
                    node.k[i] = g->ref((*ks)[i]);
            node.kind = type == "ain"    ? Kind::ain
                      : type == "aout"   ? Kind::aout
                      : type == "adelay" ? Kind::adelay
                      : type == "amul"   ? Kind::amul
                      : type == "aadd"   ? Kind::aadd
                      : type == "alfo"   ? Kind::alfo
                      : type == "aallpass" ? Kind::aallpass
                                         : Kind::atanh;
            if (node.kind == Kind::ain) {
                // Which of the MODULE's input ports this reads; absent is the first, the chain's own flow.
                const double port = o->getProperty("port");
                node.mode = (int)juce::jlimit(0.0, (double)(MAX_CHANS / 2 - 1), std::isfinite(port) ? port : 0.0);
                g->numInputs_ = juce::jmax(g->numInputs_, node.mode + 1);
            }
            if (node.kind == Kind::alfo) {
                const auto sh = o->getProperty("shape").toString();
                node.mode = sh == "triangle" ? 1 : sh == "saw" ? 2 : sh == "square" ? 3 : 0;
            }
            if (node.kind == Kind::adelay) {
                node.maxMs = juce::jlimit(1.0f, kMaxDelayMs, finiteOr((float)(double)o->getProperty("maxMs"), 1.0f));
                node.delayLine = (int)g->delayLines_.size();
                g->delayLines_.emplace_back();
                g->delayWrite_.push_back(0);
            }
        }
        else if (type == "biquad") {
            node.kind = Kind::biquad;
            node.phase = Phase::audio;
            const auto m = o->getProperty("mode").toString();
            node.mode = m == "lowpass"     ? 1
                      : m == "highpass"    ? 2
                      : m == "notch"       ? 3
                      : m == "peak"        ? 4
                      : m == "lowshelf"    ? 5
                      : m == "highshelf"   ? 6
                                           : 0;
        } else {
            error = "unknown node type: " + type;
            return nullptr;
        }
        g->nodes_.push_back(std::move(node));
    }
    if (g->nodes_.empty()) {
        error = "graph has no nodes";
        return nullptr;
    }

    g->regs_.assign(g->regNames_.size(), 0.0f);
    for (const auto& [i, k] : g->constants_)
        g->regs_[(size_t)i] = k;

    // The sample-phase nodes in DECLARED order, so the per-sample loop iterates only these (docs/dspGraph.md).
    for (size_t i = 0; i < g->nodes_.size(); ++i)
        if (g->nodes_[i].phase == Phase::sample) g->sampleNodes_.push_back((int)i);
    // The event scratch, sized ONCE: a strike node writes at most a chord released and a chord
    // taken per step, and processMidi stops between steps rather than inside one (docs/midiGraph.md).
    g->noteEvents_.resize(maxNoteEvents);
    return g;
}

void DspGraph::prepare(double sampleRate, int maxBlockSize)
{
    sampleRate_ = sampleRate;
    notes_.reset();
    // Reserved HERE for the reason a delay line is allocated here: a message list that grows on the
    // audio thread allocates on it.
    notePassThrough_.reserve(maxNoteEvents);
    dry_.setSize(2, juce::jmax(1, maxBlockSize), false, true, false);
    awires_.assign(aNames_.size(), {0.0f, 0.0f});
    // Allocated HERE and never in process(): a delay line is the one thing here big enough to be heard growing.
    for (auto& n : nodes_)
        if (n.kind == Kind::adelay && n.delayLine >= 0
            && (size_t)n.delayLine < delayLines_.size()) {
            // Rounded UP to a power of two so the wrap is a mask rather than four integer divisions per sample.
            const auto need = std::max<std::int64_t>(2, (std::int64_t)std::ceil(n.maxMs * 0.001 * sampleRate) + 2);
            std::int64_t len = 2;
            while (len < need) len <<= 1;
            for (auto& ch : delayLines_[(size_t)n.delayLine])
                ch.assign((size_t)len, 0.0f);
        }
    reset();
}

void DspGraph::reset()
{
    for (auto& n : nodes_) {
        n.s0 = 0.0f;
        n.primed = false;
        for (int ch = 0; ch < 2; ++ch) n.x1[ch] = n.y1[ch] = 0.0f;
        // Forget the cached coefficients too: prepare() may have moved the sample rate under them.
        n.lastFreq_ = -1.0f;
        n.lastQ_ = -1.0f;
        n.lastGainDb_ = -1000.0f;
        for (auto& f : n.filters)
            f.reset();
    }
    for (auto& w : awires_) w = {0.0f, 0.0f};
    // A reset lets go of every key: nothing here has a buffer to put the owed note-offs in, and the
    // host sends all-notes-off — the same answer the compiled arpeggiator gives.
    notes_.reset();
    for (auto& line : delayLines_)
        for (auto& ch : line)
            std::fill(ch.begin(), ch.end(), 0.0f);
    std::fill(delayWrite_.begin(), delayWrite_.end(), 0);
    // Registers go back to zero EXCEPT the literals, which are part of the description, not state.
    std::fill(regs_.begin(), regs_.end(), 0.0f);
    for (const auto& [i, k] : constants_)
        regs_[(size_t)i] = k;
}

// The control phase on its own: scalar -> scalar, once per block, shared by the audio and MIDI entry points.
void DspGraph::runControlNodes()
{
    // --- control --------------------------------------------------------------
    for (auto& n : nodes_) {
        if (n.phase != Phase::control) continue;
        const float a = r(n.in[0]), b = r(n.in[1]), c = r(n.in[2]);
        float out = a;
        switch (n.kind) {
            case Kind::todb:   out = juce::Decibels::gainToDecibels(a, -100.0f); break;
            case Kind::fromdb: out = juce::Decibels::decibelsToGain(a, -100.0f); break;
            case Kind::lerp:  out = a + c * (b - a); break;                 // lerp(a, b, t)
            case Kind::linmap: {                                            // linmap(x, lo, hi) -> 0..1 clamped
                // An empty range is 0, not a division: `jlimit` does NOT filter the NaN out (docs/dspGraph.md).
                const float span = c - b;
                out = span == 0.0f ? 0.0f : juce::jlimit(0.0f, 1.0f, (a - b) / span);
                break;
            }
            case Kind::geolerp: {                                           // geolerp(lo, hi, t), order-free
                const float lo = juce::jmin(a, b), hi = juce::jmax(a, b);
                out = lo > 0.0f ? lo * std::pow(hi / lo, c) : lo + c * (hi - lo);
                break;
            }
            case Kind::clamp:  out = juce::jlimit(juce::jmin(b, c), juce::jmax(b, c), a); break;
            case Kind::select: out = c >= 0.5f ? b : a; break;              // select(a, b, pick)
            case Kind::add:    out = a + b; break;
            case Kind::sub:    out = a - b; break;
            case Kind::mul:    out = a * b; break;
            case Kind::glide:                                               // half way from the last block
                out = n.primed ? 0.5f * (n.s0 + a) : a;
                n.s0 = out;
                n.primed = true;
                break;
            default: break;
        }
        if (n.out >= 0) regs_[(size_t)n.out] = out;
    }

}

// Parameters into registers, then the control phase — split out so processMidi() cannot drift from process().
void DspGraph::runControl(const float* paramValues, int numParams)
{
    if (srReg_ >= 0) regs_[(size_t)srReg_] = (float)sampleRate_;
    for (int i = 0; i < numParams && (size_t)(i + 1) < regs_.size(); ++i)
        regs_[(size_t)(i + 1)] = paramValues[i];
    runControlNodes();
}

void DspGraph::processMidi(tracktion::engine::MidiMessageArray& midi, const float* paramValues,
                           int numParams, double blockSeconds, double secondsPerBeat)
{
    namespace te = tracktion::engine;
    runControl(paramValues, numParams);

    // A step is written in BEATS, so a graph says "every eighth" and means it at any tempo; the
    // plugin is the only side that can read a tempo, and hands it in — see docs/midiGraph.md.
    const double perBeat = juce::jlimit(minSecondsPerBeat, maxSecondsPerBeat, secondsPerBeat);

    for (auto& n : nodes_) {
        if (n.phase != Phase::midi) continue;
        const float a = r(n.in[0]);
        switch (n.kind) {
            case Kind::mhold: {
                // The keys are EATEN: what is left is everything that is not a note, and a strike
                // node downstream is what puts notes back. Alone, this is a note swallower.
                notePassThrough_.clear();
                for (auto& m : midi) {
                    if (m.isNoteOn())
                        notes_.noteOn(m.getNoteNumber(), m.getFloatVelocity(), m.getChannel(),
                                      m.getTimeStamp());
                    else if (m.isNoteOff())
                        notes_.noteOff(m.getNoteNumber());
                    else
                        notePassThrough_.addMidiMessage(m, m.getTimeStamp(), te::MidiMessageArray::notMPE);
                }
                // COPIED back, not swapped: a swap would hand this graph's reserve to Tracktion's buffer and take its capacity in return.
                midi.clear();
                for (auto& m : notePassThrough_)
                    midi.addMidiMessage(m, m.getTimeStamp(), te::MidiMessageArray::notMPE);
                break;
            }
            // The step rule's four setters: fields written once a block, read per strike by the clock (NoteSteps.h).
            case Kind::mpattern: {
                const int mode = juce::roundToInt(a);
                steps_.mode = mode == 1 ? StepMode::burst : mode == 2 ? StepMode::euclid : StepMode::all;
                steps_.length = juce::roundToInt(r(n.in[1]));
                steps_.density = r(n.in[2]);
                steps_.rotate = r(n.in[3]);
                break;
            }
            case Kind::maccent:
                steps_.accents = a;
                steps_.low = r(n.in[1]);
                steps_.opposite = r(n.in[2]) >= 0.5f;
                steps_.keep = r(n.in[3]) >= 0.5f;
                break;
            case Kind::mchance:
                steps_.chance = a;
                break;
            case Kind::mdecay:
                steps_.decay = a;
                break;
            case Kind::mstrike: {
                // `a` is the step in beats and `r(n.in[1])` the gate; both go through the clock's
                // own clamps, which is where a nonsense value is answered (NoteClock.h).
                const int count = notes_.advance(blockSeconds, (double)a * perBeat,
                                                 (double)r(n.in[1]), noteEvents_.data(),
                                                 (int)noteEvents_.size(), &steps_);
                if (count <= 0) break;
                // Merged by timestamp rather than appended: a list out of order is a list
                // something downstream will drop.
                notePassThrough_.clear();
                // Copied for the same reason as `mhold`'s, the other way round.
                for (auto& m : midi)
                    notePassThrough_.addMidiMessage(m, m.getTimeStamp(), te::MidiMessageArray::notMPE);
                midi.clear();
                int keep = 0;
                const auto passUntil = [&](double at) {
                    while (keep < notePassThrough_.size()
                           && notePassThrough_[keep].getTimeStamp() <= at) {
                        midi.addMidiMessage(notePassThrough_[keep],
                                            notePassThrough_[keep].getTimeStamp(),
                                            te::MidiMessageArray::notMPE);
                        ++keep;
                    }
                };
                for (int i = 0; i < count; ++i) {
                    const auto& e = noteEvents_[(size_t)i];
                    passUntil(e.at);
                    const auto msg = e.velocity > 0.0f
                                         ? juce::MidiMessage::noteOn(e.channel, e.note, e.velocity)
                                         : juce::MidiMessage::noteOff(e.channel, e.note);
                    midi.addMidiMessage(msg, e.at, te::MidiMessageArray::notMPE);
                }
                passUntil(std::numeric_limits<double>::max());
                break;
            }
            case Kind::transpose: {
                // Whole semitones, rounded HERE rather than at the parameter, which stays continuous.
                const int by = juce::roundToInt(a);
                if (by == 0) break;
                for (auto& m : midi) {
                    if (!m.isNoteOnOrOff()) continue;
                    // Clamp rather than drop: a dropped note leaves its note-off behind and hangs the voice.
                    m.setNoteNumber(juce::jlimit(0, 127, m.getNoteNumber() + by));
                }
                break;
            }
            case Kind::velocity: {
                if (a == 1.0f) break;
                for (auto& m : midi) {
                    if (!m.isNoteOn()) continue;
                    // Never to zero: velocity 0 IS a note-off in MIDI, which would strand the real one.
                    m.setVelocity(juce::jlimit(1.0f / 127.0f, 1.0f, m.getFloatVelocity() * a));
                }
                break;
            }
            case Kind::mchannel: {
                const int ch = juce::jlimit(1, 16, juce::roundToInt(a));
                for (auto& m : midi)
                    if (m.getChannel() > 0) m.setChannel(ch);
                break;
            }
            default: break;
        }
    }
}

void DspGraph::process(juce::AudioBuffer<float>& buffer, int startSample, int numSamples,
                       const float* paramValues, int numParams)
{
    const int numChans = juce::jmin(buffer.getNumChannels(), 2);
    if (numSamples <= 0 || numChans <= 0) return;

    // A block bigger than prepare() was told about is SPLIT, never grown: growing allocates on the audio thread.
    const int maxBlock = dry_.getNumSamples();
    if (maxBlock > 0 && numSamples > maxBlock) {
        for (int done = 0; done < numSamples; done += maxBlock)
            process(buffer, startSample + done, juce::jmin(maxBlock, numSamples - done),
                    paramValues, numParams);
        return;
    }

    if (srReg_ >= 0) regs_[(size_t)srReg_] = (float)sampleRate_;
    // Parameters occupy the registers right after `sr`, in declared order — see build().
    for (int i = 0; i < numParams && (size_t)(i + 1) < regs_.size(); ++i)
        regs_[(size_t)(i + 1)] = paramValues[i];

    // --- analysis -------------------------------------------------------------
    for (auto& n : nodes_) {
        if (n.phase != Phase::analysis) continue;
        // envelope(attack_ms, release_ms) -> peak level, followed per sample
        const float atk = coeffFor(r(n.in[0]), sampleRate_);
        const float rel = coeffFor(r(n.in[1]), sampleRate_);
        // Read pointers taken ONCE: the compiler hoists none of it, and it measures ~3% of this loop.
        const float* rd[2] = {buffer.getReadPointer(0, startSample),
                              numChans > 1 ? buffer.getReadPointer(1, startSample) : nullptr};
        float env = n.s0;
        for (int i = 0; i < numSamples; ++i) {
            float peak = 0.0f;
            for (int ch = 0; ch < numChans; ++ch)
                peak = juce::jmax(peak, std::abs(rd[ch][i]));
            env = peak + (peak > env ? atk : rel) * (env - peak);
        }
        n.s0 = env;
        if (n.out >= 0) regs_[(size_t)n.out] = env;
    }

    runControlNodes();
    // --- audio --- the dry snapshot is taken BEFORE any audio node runs, since `mix` blends against what came IN
    if (hasMix_) {
        for (int ch = 0; ch < numChans; ++ch)
            juce::FloatVectorOperations::copy(dry_.getWritePointer(ch),
                                              buffer.getReadPointer(ch, startSample), numSamples);
    }

    for (auto& n : nodes_) {
        if (n.phase != Phase::audio) continue;
        if (n.kind == Kind::biquad) {
            // Clamped to a real, stable band: at or past Nyquist the coefficients blow up.
            const float freq = juce::jlimit(20.0f, (float)(sampleRate_ * 0.45), finiteOr(r(n.in[0]), 1000.0f));
            // A peak or a shelf may be narrower or gentler than the pass filters: its Q floor is lower.
            const float q = juce::jmax(n.mode >= 4 ? 0.1f : 0.5f, finiteOr(r(n.in[1]), 0.707f));
            // Peak and shelves only: the third input, in dB, bounded so the coefficients stay sane.
            const float gainDb = n.mode >= 4 ? juce::jlimit(-24.0f, 24.0f, finiteOr(r(n.in[2]), 0.0f)) : 0.0f;
            // Only when the knob actually moved — see lastFreq_ in the header, and MixerPlugin's same condition.
            if (freq != n.lastFreq_ || q != n.lastQ_ || gainDb != n.lastGainDb_) {
                const float g = juce::Decibels::decibelsToGain(gainDb);
                const auto coeffs = n.mode == 1 ? juce::IIRCoefficients::makeLowPass(sampleRate_, freq, q)
                                  : n.mode == 2 ? juce::IIRCoefficients::makeHighPass(sampleRate_, freq, q)
                                  : n.mode == 3 ? juce::IIRCoefficients::makeNotchFilter(sampleRate_, freq, q)
                                  : n.mode == 4 ? juce::IIRCoefficients::makePeakFilter(sampleRate_, freq, q, g)
                                  : n.mode == 5 ? juce::IIRCoefficients::makeLowShelf(sampleRate_, freq, q, g)
                                  : n.mode == 6 ? juce::IIRCoefficients::makeHighShelf(sampleRate_, freq, q, g)
                                                : juce::IIRCoefficients::makeBandPass(sampleRate_, freq, q);
                for (int ch = 0; ch < 2; ++ch) n.filters[ch].setCoefficients(coeffs);
                n.lastFreq_ = freq;
                n.lastQ_ = q;
                n.lastGainDb_ = gainDb;
            }
            for (int ch = 0; ch < numChans; ++ch)
                n.filters[ch].processSamples(buffer.getWritePointer(ch, startSample), numSamples);
        } else if (n.kind == Kind::gain) {
            buffer.applyGain(startSample, numSamples, r(n.in[0]));
        }
        // Kind::mix is NOT applied here — see below.
    }

    // --- sample rate --- one loop, nodes in declared order: reading a wire written LATER is the unit delay
    if (hasSamplePhase_) {
        // Read pointers for EVERY channel the buffer carries, since a second input port arrives past channel 1.
        const int avail = juce::jmin(MAX_CHANS, buffer.getNumChannels());
        const float* rd[MAX_CHANS] = {};
        for (int ch = 0; ch < avail; ++ch) rd[ch] = buffer.getReadPointer(ch, startSample);
        float* wr[2] = {buffer.getWritePointer(0, startSample),
                        numChans > 1 ? buffer.getWritePointer(1, startSample) : nullptr};
        for (int i = 0; i < numSamples; ++i) {
            for (const int nodeIndex : sampleNodes_) {
                auto& n = nodes_[(size_t)nodeIndex];
                switch (n.kind) {
                    case Kind::ain: {
                        // Port n is the pair at channels 2n / 2n+1; past what the buffer carries it reads silence.
                        const int base = n.mode * 2;
                        if (n.out >= 0)
                            for (int ch = 0; ch < numChans; ++ch)
                                awires_[(size_t)n.out][(size_t)ch] =
                                    base + ch < avail ? rd[base + ch][i] : 0.0f;
                        break;
                    }
                    case Kind::aout:
                        for (int ch = 0; ch < numChans; ++ch)
                            wr[ch][i] = n.in[0] >= 0 ? awires_[(size_t)n.in[0]][(size_t)ch] : 0.0f;
                        break;
                    case Kind::amul:
                    case Kind::aadd: {
                        for (int ch = 0; ch < numChans; ++ch) {
                            const float a = n.in[0] >= 0 ? awires_[(size_t)n.in[0]][(size_t)ch] : 0.0f;
                            // A second AUDIO input if given, else a scalar — `x * Feedback` is as common as `x * y`.
                            const float b = n.in[1] >= 0 ? awires_[(size_t)n.in[1]][(size_t)ch] : r(n.k[0]);
                            if (n.out >= 0)
                                awires_[(size_t)n.out][(size_t)ch] = n.kind == Kind::amul ? a * b : a + b;
                        }
                        break;
                    }
                    case Kind::atanh:
                        // Saturation: what keeps a feedback loop from running away, and what makes it a machine.
                        for (int ch = 0; ch < numChans; ++ch) {
                            const float a = n.in[0] >= 0 ? awires_[(size_t)n.in[0]][(size_t)ch] : 0.0f;
                            const float drive = n.k[0] >= 0 ? r(n.k[0]) : 1.0f;
                            if (n.out >= 0)
                                awires_[(size_t)n.out][(size_t)ch] = std::tanh(a * drive);
                        }
                        break;
                    case Kind::alfo: {
                        // Phase advances per sample, so -1..1 comes out smooth rather than stepped once a block.
                        const float rate = juce::jmax(0.0f, r(n.k[0]));
                        n.s0 += rate / (float)sampleRate_;
                        if (n.s0 >= 1.0f) n.s0 -= std::floor(n.s0);
                        // The right channel runs `k[1]` of a cycle ahead: what a chorus's stereo width is (docs/dspGraph.md).
                        const float spread = n.k[1] >= 0 ? finiteOr(r(n.k[1]), 0.0f) : 0.0f;
                        if (n.out >= 0)
                            for (int ch = 0; ch < numChans; ++ch) {
                                float ph = n.s0 + (ch == 1 ? spread : 0.0f);
                                ph -= std::floor(ph);
                                const float v = n.mode == 1 ? 4.0f * std::abs(ph - 0.5f) - 1.0f
                                              : n.mode == 2 ? 2.0f * ph - 1.0f
                                              : n.mode == 3 ? (ph < 0.5f ? 1.0f : -1.0f)
                                                            : std::sin(ph * juce::MathConstants<float>::twoPi);
                                awires_[(size_t)n.out][(size_t)ch] = v;
                            }
                        break;
                    }
                    case Kind::aallpass: {
                        // First order, its corner at k[0] Hz shifted by in[1] OCTAVES, so an LFO sweeps it evenly in pitch.
                        const float base = juce::jmax(1.0f, finiteOr(r(n.k[0]), 100.0f));
                        for (int ch = 0; ch < numChans; ++ch) {
                            const float x = n.in[0] >= 0 ? awires_[(size_t)n.in[0]][(size_t)ch] : 0.0f;
                            const float oct = n.in[1] >= 0 ? juce::jlimit(-12.0f, 12.0f, finiteOr(awires_[(size_t)n.in[1]][(size_t)ch], 0.0f)) : 0.0f;
                            // π·f/sr with no tan prewarp, as Tracktion's phaser computes it; the coefficient stays in (-1, 1] for any corner.
                            const float w = juce::MathConstants<float>::pi * base * std::exp2(oct) / (float)sampleRate_;
                            const float c = (1.0f - w) / (1.0f + w);
                            float y = c * (x + n.y1[ch]) - n.x1[ch];
                            JUCE_UNDENORMALISE(y);
                            n.x1[ch] = x;
                            n.y1[ch] = y;
                            if (n.out >= 0) awires_[(size_t)n.out][(size_t)ch] = y;
                        }
                        break;
                    }
                    case Kind::adelay: {
                        // build() always sets delayLine, so a -1 is a bug elsewhere that delayLines_[SIZE_MAX] hides.
                        if (n.delayLine < 0 || (size_t)n.delayLine >= delayLines_.size()) break;
                        auto& line = delayLines_[(size_t)n.delayLine];
                        int& w = delayWrite_[(size_t)n.delayLine];
                        const int len = (int)line[0].size();
                        if (len < 2) break;
                        const int mask = len - 1;   // a power of two — see prepare()
                        // Time from a WIRE if given, else a scalar; the read is interpolated so moving it cannot zipper.
                        for (int ch = 0; ch < numChans; ++ch) {
                            const float msRaw = n.in[1] >= 0 ? awires_[(size_t)n.in[1]][(size_t)ch] : r(n.k[0]);
                            const float ms = juce::jlimit(0.0f, n.maxMs, finiteOr(msRaw, 0.0f));
                            const float d = juce::jlimit(1.0f, (float)(len - 2),
                                                         ms * 0.001f * (float)sampleRate_);
                            const int di = (int)d;
                            const float frac = d - (float)di;
                            line[(size_t)ch][(size_t)w] =
                                n.in[0] >= 0 ? awires_[(size_t)n.in[0]][(size_t)ch] : 0.0f;
                            const int r0 = (w - di + len) & mask;
                            const int r1 = (r0 - 1 + len) & mask;
                            const float v = line[(size_t)ch][(size_t)r0] * (1.0f - frac)
                                          + line[(size_t)ch][(size_t)r1] * frac;
                            if (n.out >= 0) awires_[(size_t)n.out][(size_t)ch] = v;
                        }
                        w = (w + 1) & mask;
                        break;
                    }
                    default: break;
                }
            }
        }
    }

    // --- mix --- LAST, since the GRAPH's output does not exist until every phase has run (docs/dspGraph.md)
    for (auto& n : nodes_) {
        if (n.kind != Kind::mix) continue;
        const float wet = juce::jlimit(0.0f, 1.0f, r(n.in[0]));
        if (wet >= 1.0f) continue;
        for (int ch = 0; ch < numChans; ++ch) {
            auto* out = buffer.getWritePointer(ch, startSample);
            const auto* d = dry_.getReadPointer(ch);
            for (int i = 0; i < numSamples; ++i)
                out[i] = wet * out[i] + (1.0f - wet) * d[i];
        }
    }

    tracktion::engine::sanitiseValues(buffer, startSample, numSamples, 3.0f);
}

}  // namespace studio
