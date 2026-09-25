// DocJson.cpp — see DocJson.h. The field names are @studio/engine-protocol's ProjectDoc, and a field
// this file does not read is a field the engine silently plays without.

#include "DocJson.h"

#include <string>
#include <utility>
#include <vector>

using json = nlohmann::json;

namespace studio {


// One plugin off the wire, shared by a TRACK's list and the MASTER chain's so the two cannot drift.
studio::PluginDoc pluginFromJson(const json& p) {
    studio::PluginDoc pl;
    pl.id = p.value("id", std::string{});
    pl.type = p.value("type", std::string{});
    pl.name = p.value("name", std::string{});
    pl.path = p.value("path", std::string{});
    pl.presetSave = p.value("presetSave", std::string{});
    pl.role = p.value("role", std::string{});
    pl.enabled = p.value("enabled", true);
    pl.namFile = p.value("namFile", std::string{});
    pl.deckFile = p.value("deckFile", std::string{});
    pl.dspGraph = p.value("dspGraph", std::string{});
    pl.faustDsp = p.value("faustDsp", std::string{});
    pl.sidechainFrom = p.value("sidechainFrom", std::string{});
    if (p.contains("params"))
        for (const auto& [k, v] : p.at("params").items())
            pl.params[k] = v.get<double>();
    // A rack instrument's sounds: {symbol, note, clip} already absolute, turned into SamplerPlugin sounds in EditBuilder::addPlugin.
    if (p.contains("rack") && p.at("rack").is_array())
        for (const auto& e : p.at("rack")) {
            studio::RackEntry re;
            re.symbol = e.value("symbol", std::string{});
            re.note = e.value("note", 0);
            re.clip = e.value("clip", std::string{});
            re.start = e.value("start", 0.0);
            re.length = e.value("length", 0.0);
            pl.rack.push_back(std::move(re));
        }
    return pl;
}

studio::ProjectDoc docFromJson(const json& j) {
    studio::ProjectDoc doc;
    doc.name = j.value("name", std::string{"untitled"});
    doc.tempo = j.value("tempo", 120.0);
    doc.sampleRate = j.value("sampleRate", 48000);
    doc.timeSigNumerator = j.value("timeSigNumerator", 4);
    doc.timeSigDenominator = j.value("timeSigDenominator", 4);
    // Unity for a doc that does not carry the field.
    doc.masterVolume = j.value("masterVolume", 0.0f);
    // The master chain; absent means the mixer's sum reaches the interface unprocessed.
    if (j.contains("masterPlugins") && j.at("masterPlugins").is_array())
        for (const auto& p : j.at("masterPlugins"))
            doc.masterPlugins.push_back(pluginFromJson(p));
    doc.recordDir = j.value("recordDir", std::string{});
    // Project settings ride in a nested `settings` object; the engine reads only what it plays, and absent means the defaults.
    if (j.contains("settings") && j.at("settings").is_object()) {
        const auto& s = j.at("settings");
        doc.metronome = s.value("metronome", false);
        // 0.6 for a document that does not carry the field — Tracktion's own default.
        doc.metronomeLevel = s.value("metronomeLevel", 0.6);
        doc.countIn = s.value("countIn", 0);
    }

    if (j.contains("tracks"))
        for (const auto& t : j.at("tracks")) doc.tracks.push_back(trackFromJson(t));
    return doc;
}

studio::TrackDoc trackFromJson(const json& t) {
    studio::TrackDoc tr;
    tr.id = t.value("id", std::string{});
    tr.name = t.value("name", tr.id);
    tr.role = t.value("role", std::string{"regular"});
    tr.contentType = t.value("contentType", std::string{"audio"});
    tr.color = t.value("color", std::string{});
    tr.mute = t.value("mute", false);
    tr.solo = t.value("solo", false);
    tr.disabled = t.value("disabled", false);
    tr.monitor = t.value("monitor", std::string{"auto"});
    tr.inputGain = t.value("inputGain", 0.0);
    if (t.contains("inputChannels"))
        for (const auto& ch : t.at("inputChannels"))
            if (ch.is_number_integer() && ch.get<int>() > 0)
                tr.inputChannels.push_back(ch.get<int>());
    // Where it LEAVES by; absent and empty both mean the mixer's sum, which is what every track but a cue bus wants.
    if (t.contains("outputChannels"))
        for (const auto& ch : t.at("outputChannels"))
            if (ch.is_number_integer() && ch.get<int>() > 0)
                tr.outputChannels.push_back(ch.get<int>());

    if (t.contains("clips"))
        for (const auto& c : t.at("clips")) {
            studio::ClipDoc cl;
            cl.id = c.value("id", std::string{});
            cl.type = c.value("type", std::string{"audio"}) == "midi"
                          ? studio::ClipType::Midi
                          : studio::ClipType::Audio;
            cl.name = c.value("name", std::string{});
            cl.source = c.value("source", std::string{});  // absolute path from Node
            cl.start = c.value("start", 0.0);
            cl.length = c.value("length", 0.0);
            cl.offset = c.value("offset", 0.0);
            cl.sourceFrom = c.value("sourceFrom", 0.0);
            cl.sourceTo = c.value("sourceTo", 0.0);
            cl.fadeIn = c.value("fadeIn", 0.0);
            cl.fadeOut = c.value("fadeOut", 0.0);
            cl.loopStart = c.value("loopStart", 0.0);
            cl.loopEnd = c.value("loopEnd", 0.0);
            cl.disabled = c.value("disabled", false);
            if (c.contains("warp")) {
                const auto& w = c.at("warp");
                cl.warp.algorithm = w.value("algorithm", std::string{});
                if (w.contains("markers"))
                    for (const auto& m : w.at("markers"))
                        cl.warp.markers.emplace_back(m.at(0).get<double>(),
                                                     m.at(1).get<double>());
            }
            if (c.contains("notes"))
                for (const auto& n : c.at("notes")) {
                    studio::NoteDoc nd;
                    nd.time = n.value("time", 0.0);
                    nd.duration = n.value("duration", 0.0);
                    nd.key = n.value("key", 0);
                    nd.vel = n.value("vel", 1.0);
                    nd.channel = n.value("channel", 0);
                    nd.rel = n.value("rel", 1.0);
                    // A pad's effects; absent == none, and not clamped since everything downstream tests for >= 2.
                    nd.repeat = n.value("repeat", 0);
                    nd.skip = n.value("skip", 0);
                    cl.notes.push_back(nd);
                }
            tr.clips.push_back(std::move(cl));
        }

    if (t.contains("plugins"))
        for (const auto& p : t.at("plugins")) tr.plugins.push_back(pluginFromJson(p));

    if (t.contains("sends"))
        for (const auto& s : t.at("sends")) {
            studio::SendDoc sd;
            sd.to = s.value("to", std::string{});
            sd.level = s.value("level", 0.0);
            sd.enabled = s.value("enabled", false);
            tr.sends.push_back(std::move(sd));
        }

    if (t.contains("automation"))
        for (const auto& a : t.at("automation")) {
            studio::AutomationDoc au;
            au.param = a.value("param", std::string{});
            au.pluginId = a.value("pluginId", std::string{});
            au.bipolar = a.value("bipolar", false);
            if (a.contains("points"))
                for (const auto& pt : a.at("points"))
                    au.points.emplace_back(pt.at(0).get<double>(), pt.at(1).get<double>());
            tr.automation.push_back(std::move(au));
        }

    return tr;
}

}  // namespace studio
