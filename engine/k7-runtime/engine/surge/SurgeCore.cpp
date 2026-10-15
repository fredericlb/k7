#include "SurgeCore.h"

#include "SurgeSynthesizer.h"

#include <cmath>
#include <regex>
#include <set>

namespace studio::surge {

namespace {

// Played from notes, which the engine routes itself: a split or channel scene layout, and the bend's range.
const std::set<std::string> MIDI_PARAMS = {"scene_active", "scenemode", "splitkey", "fx_disable",
                                           "a_pbrange_up", "a_pbrange_dn", "b_pbrange_up", "b_pbrange_dn"};

// A slot whose meaning follows a type: an oscillator's seven, an effect's twelve — always 0..1, named generically.
const std::regex OSC_SLOT("^([ab])_osc(\\d)_param(\\d)$");
const std::regex FX_SLOT("^fx\\d+_p\\d+$");
const std::regex FX_TYPE("^fx\\d+_type$");

/** Where a ParamInfo's value lives: a Surge parameter (its synth-side index), or a macro. */
struct Slot {
    int surge = -1;   // index into param_ptr, or -1 for a macro
    int macro = -1;
    bool normalized = true;
};

std::vector<Slot>& slots()
{
    static std::vector<Slot> s;
    return s;
}

std::string named(const Parameter& p)
{
    const std::string sid = p.get_storage_name();
    std::smatch m;
    std::string name;
    if (std::regex_match(sid, m, OSC_SLOT))
        name = "Osc " + m[2].str() + " Param " + std::to_string(std::stoi(m[3].str()) + 1);
    else if (std::regex_match(sid, FX_TYPE)) {
        name = p.get_full_name();
        const auto at = name.find(" FX Type");
        if (at != std::string::npos) name = name.substr(0, at) + " Type";
    } else
        name = p.get_full_name();
    if (p.scene == 1) return "A " + name;
    if (p.scene == 2) return "B " + name;
    return name;
}

}  // namespace

// Surge reports to a host through this layer; the engine reads parameters off the synth instead, so both are no-ops.
struct SurgeCore::Impl : SurgeSynthesizer::PluginLayer {
    void surgeParameterUpdated(const SurgeSynthesizer::ID&, float) override {}
    void surgeMacroUpdated(long, float) override {}

    std::unique_ptr<SurgeSynthesizer> synth;
};

SurgeCore::SurgeCore(double sampleRate)
    : impl_(std::make_unique<Impl>())
{
    // No data path: a patch carries its wavetables, and the factory library is never scanned (patches/surge.cmake).
    impl_->synth = std::make_unique<SurgeSynthesizer>(impl_.get(), "");
    impl_->synth->setSamplerate((float)sampleRate);
    impl_->synth->time_data.tempo = 120;
}

SurgeCore::~SurgeCore() = default;

int SurgeCore::block() { return BLOCK_SIZE; }

const std::vector<ParamInfo>& SurgeCore::params()
{
    // Built once, off a fresh synth: the list and its order are the code's, the same for every patch.
    static const std::vector<ParamInfo> list = [] {
        std::vector<ParamInfo> out;
        SurgeCore ref(48000.0);
        auto& patch = ref.impl_->synth->storage.getPatch();
        for (size_t k = 0; k < patch.param_ptr.size(); ++k) {
            const Parameter& p = *patch.param_ptr[k];
            const std::string sid = p.get_storage_name();
            if (MIDI_PARAMS.count(sid)) continue;
            ParamInfo info;
            info.id = "sx_" + sid;
            info.name = named(p);
            Slot slot{(int)k, -1, true};
            const bool typed = std::regex_match(sid, OSC_SLOT) || std::regex_match(sid, FX_SLOT);
            if (!typed && (p.valtype == vt_int || p.valtype == vt_bool)) {
                slot.normalized = false;
                info.discrete = true;
                info.min = p.valtype == vt_bool ? 0.f : (float)p.val_min.i;
                info.max = p.valtype == vt_bool ? 1.f : (float)p.val_max.i;
                if (info.max - info.min < 64)
                    for (int v = (int)info.min; v <= (int)info.max; ++v) {
                        Parameter tmp = p;
                        if (p.valtype == vt_bool) tmp.val.b = v != 0;
                        else tmp.val.i = v;
                        info.choices.push_back(tmp.get_display());
                    }
            }
            slots().push_back(slot);
            out.push_back(std::move(info));
            out.back().def = ref.get((int)out.size() - 1);
        }
        for (int i = 0; i < MACROS; ++i) {
            ParamInfo info;
            info.id = "macro" + std::to_string(i + 1);
            info.name = "Macro " + std::to_string(i + 1);
            slots().push_back(Slot{-1, i, true});
            out.push_back(std::move(info));
            out.back().def = ref.get((int)out.size() - 1);
        }
        return out;
    }();
    return list;
}

namespace {

std::string quoted(const std::string& text)
{
    std::string out = "\"";
    for (char c : text) {
        if (c == '"' || c == '\\') out += '\\';
        if ((unsigned char)c < 0x20) continue;
        out += c;
    }
    return out + "\"";
}

std::string quotedList(const std::vector<std::string>& items)
{
    std::string out = "[";
    for (size_t i = 0; i < items.size(); ++i) out += (i ? "," : "") + quoted(items[i]);
    return out + "]";
}

// What a slot is called once its owner's type is set, without the owner's own prefix ("Osc 1 ", "FX A1 ").
std::string slotName(const Parameter& p, const std::string& prefix)
{
    if (p.ctrltype == ct_none) return {};
    std::string name = p.get_full_name();
    return name.rfind(prefix, 0) == 0 ? name.substr(prefix.size()) : name;
}

}  // namespace

std::string SurgeCore::layoutJson()
{
    const auto& list = params();
    std::string out = "{\"params\":[";
    for (size_t i = 0; i < list.size(); ++i) {
        const auto& p = list[i];
        out += (i ? "," : "");
        out += "{\"id\":" + quoted(p.id) + ",\"name\":" + quoted(p.name) + ",\"min\":" + std::to_string(p.min)
               + ",\"max\":" + std::to_string(p.max) + ",\"def\":" + std::to_string(p.def)
               + ",\"discrete\":" + (p.discrete ? "true" : "false") + ",\"choices\":" + quotedList(p.choices) + "}";
    }
    // Each type set on a reference synth, and its slots read once Surge has applied it (the next process()).
    SurgeCore ref(48000.0);
    auto& synth = *ref.impl_->synth;
    auto& patch = synth.storage.getPatch();
    out += "],\"oscTypes\":[";
    for (int t = 0; t < n_osc_types; ++t) {
        auto& osc = patch.scene[0].osc[0];
        synth.setParameter01(synth.idForParameter(&osc.type), Parameter::intScaledToFloat(t, osc.type.val_max.i, osc.type.val_min.i), false, true);
        synth.process();
        std::vector<std::string> slots;
        for (int k = 0; k < n_osc_params; ++k) slots.push_back(slotName(osc.p[k], "Osc 1 "));
        out += std::string(t ? "," : "") + "{\"name\":" + quoted(osc_type_names[t]) + ",\"slots\":" + quotedList(slots) + "}";
    }
    out += "],\"fxTypes\":[";
    for (int t = 0; t < n_fx_types; ++t) {
        auto& fx = patch.fx[0];
        synth.setParameter01(synth.idForParameter(&fx.type), Parameter::intScaledToFloat(t, fx.type.val_max.i, fx.type.val_min.i), false, true);
        for (int r = 0; r < 4; ++r) synth.process();
        std::vector<std::string> slots;
        for (int k = 0; k < n_fx_params; ++k) slots.push_back(slotName(fx.p[k], "FX A1 "));
        out += std::string(t ? "," : "") + "{\"name\":" + quoted(fx_type_names[t]) + ",\"slots\":" + quotedList(slots) + "}";
    }
    return out + "]}";
}

bool SurgeCore::loadPatch(const std::string& path, std::string& error)
{
    if (!impl_->synth->loadPatchByPath(path.c_str(), -1, "")) {
        error = "surge patch did not load: " + path;
        return false;
    }
    // A load is settled by the next process(): run it here, so the first block heard is already the new patch.
    impl_->synth->process();
    return true;
}

std::string SurgeCore::patchName() const { return impl_->synth->storage.getPatch().name; }

float SurgeCore::get(int i) const
{
    const auto& s = slots()[(size_t)i];
    auto& synth = *impl_->synth;
    if (s.macro >= 0) return synth.getMacroParameter01(s.macro);
    const Parameter& p = *synth.storage.getPatch().param_ptr[(size_t)s.surge];
    if (s.normalized) return p.get_value_f01();
    return p.valtype == vt_bool ? (p.val.b ? 1.f : 0.f) : (float)p.val.i;
}

std::string SurgeCore::display(int i, float value) const
{
    const auto& s = slots()[(size_t)i];
    if (s.macro >= 0) return std::to_string((int)std::lround(value * 100)) + " %";
    Parameter tmp = *impl_->synth->storage.getPatch().param_ptr[(size_t)s.surge];
    if (s.normalized) tmp.set_value_f01(value);
    else if (tmp.valtype == vt_bool) tmp.val.b = value >= 0.5f;
    else tmp.val.i = (int)std::lround(value);
    return tmp.get_display();
}

void SurgeCore::set(int i, float value)
{
    const auto& s = slots()[(size_t)i];
    auto& synth = *impl_->synth;
    if (s.macro >= 0) {
        synth.setMacroParameter01(s.macro, value);
        return;
    }
    const Parameter& p = *synth.storage.getPatch().param_ptr[(size_t)s.surge];
    float v01 = value;
    if (!s.normalized)
        v01 = p.valtype == vt_bool ? (value >= 0.5f ? 1.f : 0.f)
                                   : Parameter::intScaledToFloat((int)std::lround(value), p.val_max.i, p.val_min.i);
    // Through Surge's host entry, which is what applies a type change: an oscillator's, a filter's, an effect's.
    synth.setParameter01(synth.idForParameter(&p), v01, false, !s.normalized);
}

void SurgeCore::setSampleRate(double sampleRate) { impl_->synth->setSamplerate((float)sampleRate); }

void SurgeCore::noteOn(int channel, int key, int velocity)
{
    impl_->synth->playNote((char)channel, (char)key, (char)velocity, 0);
}

void SurgeCore::noteOff(int channel, int key, int velocity)
{
    impl_->synth->releaseNote((char)channel, (char)key, (char)velocity);
}

void SurgeCore::pitchBend(int channel, int centred) { impl_->synth->pitchBend((char)channel, centred); }

void SurgeCore::controller(int channel, int cc, int value)
{
    impl_->synth->channelController((char)channel, cc, value);
}

void SurgeCore::channelPressure(int channel, int value) { impl_->synth->channelAftertouch((char)channel, value); }

void SurgeCore::polyPressure(int channel, int key, int value)
{
    impl_->synth->polyAftertouch((char)channel, key, value);
}

void SurgeCore::allSoundOff() { impl_->synth->allSoundOff(); }

void SurgeCore::render() { impl_->synth->process(); }

const float* SurgeCore::left() const { return impl_->synth->output[0]; }

const float* SurgeCore::right() const { return impl_->synth->output[1]; }

}  // namespace studio::surge
