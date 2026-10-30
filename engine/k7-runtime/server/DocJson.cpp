// DocJson.cpp — see DocJson.h. The field names are @studio/engine-protocol's ProjectDoc, and a field
// this file does not read is a field the engine silently plays without.

#include "DocJson.h"

#include "../engine/PathRoots.h"
#include "../engine/Warnings.h"

#include <algorithm>
#include <cmath>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using json = nlohmann::json;

namespace studio {

namespace {

// The wire is a trust boundary — the engine binds 0.0.0.0 under the supervisor — so a number Tracktion divides by or loops over is bounded HERE (docs/protocol.md).
constexpr int kMaxPadRepeat = 64;

int clampInt(int v, int lo, int hi) { return std::min(std::max(v, lo), hi); }

// The output pairs a sampler or a routed tap can address: 0..31, the sampler's own bound.
constexpr int kMaxPair = 31;

// A file the document names for READING, kept only when the engine may open it, else "" and a warning (docs/pathRoots.md).
std::string readable(std::string path, const char* what) {
    if (path.empty() || readAllowed(path)) return path;
    warn(std::string(what) + " '" + path + "' is outside the folders this engine reads — ignored");
    return {};
}

// …and the one it WRITES a plugin's state to: a `.vstpreset` under the write roots, nothing else.
std::string presetTarget(std::string path) {
    if (path.empty() || (hasExtensionCi(path, ".vstpreset") && writeAllowed(path))) return path;
    warn("preset save path '" + path + "' is not a .vstpreset under the folders this engine writes — not saved");
    return {};
}

// An `@instruments/` reference resolves under the state directory, so no segment of it may be `..`.
std::string instrumentRef(std::string ref) {
    static const std::string kRef = "@instruments/";
    if (ref.rfind(kRef, 0) != 0) return readable(std::move(ref), "sfz instrument");
    size_t from = kRef.size();
    while (true) {
        const size_t to = ref.find_first_of("/\\", from);
        const std::string seg = ref.substr(from, to == std::string::npos ? std::string::npos : to - from);
        if (seg == "..") {
            warn("sfz instrument '" + ref + "' climbs out of the instruments folder — ignored");
            return {};
        }
        if (to == std::string::npos) return ref;
        from = to + 1;
    }
}

// A time signature Tracktion can divide by: a numerator of 1..64 over a power of two up to 32, else 4/4 and a warning.
void sanitiseTimeSig(ProjectDoc& doc) {
    const int den = doc.timeSigDenominator;
    const bool denOk = den >= 1 && den <= 32 && (den & (den - 1)) == 0;
    const bool numOk = doc.timeSigNumerator >= 1 && doc.timeSigNumerator <= 64;
    if (denOk && numOk) return;
    warn("time signature " + std::to_string(doc.timeSigNumerator) + "/" + std::to_string(den) +
         " cannot be played — using 4/4");
    doc.timeSigNumerator = 4;
    doc.timeSigDenominator = 4;
}

// Ids that repeat get `#2`, `#3`… in document order, and a warning: every map downstream is keyed by id, and a second entry would be diffed, routed and metered as the first (docs/protocol.md).
template <typename T, typename Id>
void disambiguate(std::vector<T>& items, std::set<std::string>& seen, Id id, const char* what) {
    for (auto& item : items) {
        std::string& key = id(item);
        if (key.empty() || seen.insert(key).second) continue;
        int n = 2;
        while (seen.count(key + "#" + std::to_string(n))) ++n;
        const std::string renamed = key + "#" + std::to_string(n);
        warn(std::string("two ") + what + " share the id '" + key + "' — the second is '" + renamed + "'");
        key = renamed;
        seen.insert(key);
    }
}

void disambiguateIds(ProjectDoc& doc) {
    std::set<std::string> tracks, plugins;
    disambiguate(doc.tracks, tracks, [](TrackDoc& t) -> std::string& { return t.id; }, "tracks");
    // Plugins are ONE map per session, the master chain's included.
    disambiguate(doc.masterPlugins, plugins, [](PluginDoc& p) -> std::string& { return p.id; }, "modules");
    for (auto& t : doc.tracks) {
        disambiguate(t.plugins, plugins, [](PluginDoc& p) -> std::string& { return p.id; }, "modules");
        std::set<std::string> clips;
        disambiguate(t.clips, clips, [](ClipDoc& c) -> std::string& { return c.id; }, "clips");
    }
}

}  // namespace


// One plugin off the wire, shared by a TRACK's list and the MASTER chain's so the two cannot drift.
studio::PluginDoc pluginFromJson(const json& p) {
    studio::PluginDoc pl;
    pl.id = p.value("id", std::string{});
    pl.type = p.value("type", std::string{});
    pl.name = p.value("name", std::string{});
    pl.path = readable(p.value("path", std::string{}), "preset");
    pl.presetSave = presetTarget(p.value("presetSave", std::string{}));
    pl.role = p.value("role", std::string{});
    pl.enabled = p.value("enabled", true);
    pl.namFile = readable(p.value("namFile", std::string{}), "amp model");
    pl.irFile = readable(p.value("irFile", std::string{}), "impulse response");
    pl.deckFile = readable(p.value("deckFile", std::string{}), "record");
    pl.sfzFile = instrumentRef(p.value("sfzFile", std::string{}));
    pl.surgePatch = readable(p.value("surgePatch", std::string{}), "surge patch");
    pl.dspGraph = p.value("dspGraph", std::string{});
    pl.faustDsp = p.value("faustDsp", std::string{});
    // A Faust sound file travels as one `label<TAB>path` line, so neither half may hold a tab or a newline.
    for (auto& [label, path] : p.value("faustFiles", std::map<std::string, std::string>{}))
        if (label.find_first_of("\t\r\n") == std::string::npos && path.find_first_of("\t\r\n") == std::string::npos)
            if (auto file = readable(path, "faust sound file"); !file.empty()) pl.faustFiles[label] = std::move(file);
    pl.patternSource = p.value("patternSource", std::string{});
    pl.patternLabel = p.value("patternLabel", std::string{});
    pl.patternCatchAll = p.value("patternCatchAll", false);
    pl.patternClaimed = p.value("patternClaimed", std::vector<std::string>{});
    pl.patternPlays = p.value("patternPlays", std::string{});
    pl.patternOnly = p.value("patternOnly", true);
    for (auto& bank : p.value("patternBanks", std::vector<std::string>{}))
        if (auto dir = readable(bank, "sample bank"); !dir.empty()) pl.patternBanks.push_back(std::move(dir));
    pl.sidechainFrom = p.value("sidechainFrom", std::string{});
    if (p.contains("tapOuts") && p.at("tapOuts").is_array())
        for (const auto& o : p.at("tapOuts"))
            pl.tapOuts.push_back({clampInt(o.value("note", 0), 0, 127), clampInt(o.value("pair", 0), 0, kMaxPair)});
    if (p.contains("params"))
        for (const auto& [k, v] : p.at("params").items())
            pl.params[k] = v.get<double>();
    // A rack instrument's sounds: {symbol, note, clip} already absolute, turned into SamplerPlugin sounds in EditBuilder::addPlugin.
    if (p.contains("rack") && p.at("rack").is_array())
        for (const auto& e : p.at("rack")) {
            studio::RackEntry re;
            re.symbol = e.value("symbol", std::string{});
            re.note = clampInt(e.value("note", 0), 0, 127);
            re.clip = readable(e.value("clip", std::string{}), "rack sample");
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
    sanitiseTimeSig(doc);
    if (!std::isfinite(doc.tempo) || doc.tempo <= 0.0) doc.tempo = 120.0;
    // A rate no interface opens is a rebuild that opens nothing; the default rather than a guess.
    if (doc.sampleRate < 8000 || doc.sampleRate > 768000) doc.sampleRate = 48000;
    // Unity for a doc that does not carry the field.
    doc.masterVolume = j.value("masterVolume", 0.0f);
    // The master chain; absent means the mixer's sum reaches the interface unprocessed.
    if (j.contains("masterPlugins") && j.at("masterPlugins").is_array())
        for (const auto& p : j.at("masterPlugins"))
            doc.masterPlugins.push_back(pluginFromJson(p));
    // The folder takes are WRITTEN to: outside the write roots it is dropped, and the project cannot record.
    doc.recordDir = j.value("recordDir", std::string{});
    if (!doc.recordDir.empty() && !writeAllowed(doc.recordDir)) {
        warn("record folder '" + doc.recordDir + "' is outside the folders this engine writes — recording is off");
        doc.recordDir.clear();
    }
    doc.recordMute = j.value("recordMute", true);
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
    disambiguateIds(doc);
    return doc;
}

studio::TrackDoc trackFromJson(const json& t) {
    studio::TrackDoc tr;
    tr.id = t.value("id", std::string{});
    tr.name = t.value("name", tr.id);
    tr.role = t.value("role", std::string{"regular"});
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
            cl.source = readable(c.value("source", std::string{}), "clip");  // absolute path from Node
            cl.start = c.value("start", 0.0);
            cl.length = c.value("length", 0.0);
            cl.offset = c.value("offset", 0.0);
            cl.sourceFrom = c.value("sourceFrom", 0.0);
            cl.sourceTo = c.value("sourceTo", 0.0);
            cl.fadeIn = c.value("fadeIn", 0.0);
            cl.fadeOut = c.value("fadeOut", 0.0);
            cl.gainDb = c.value("gainDb", 0.0f);
            if (c.contains("crossfade")) {
                const auto& x = c.at("crossfade");
                cl.crossfadeIn = x.value("in", false);
                cl.crossfadeOut = x.value("out", false);
            }
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
                    nd.key = clampInt(n.value("key", 0), 0, 127);
                    nd.vel = n.value("vel", 1.0);
                    nd.channel = n.value("channel", 0);
                    nd.rel = n.value("rel", 1.0);
                    // A pad's effects; absent == none, and bounded since `repeat` is a loop count EditBuilder writes notes for.
                    nd.repeat = clampInt(n.value("repeat", 0), 0, kMaxPadRepeat);
                    nd.skip = clampInt(n.value("skip", 0), 0, kMaxPadRepeat);
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

    if (t.contains("inputFrom") && t.at("inputFrom").is_object()) {
        tr.inputFromPlugin = t.at("inputFrom").value("plugin", std::string{});
        tr.inputFromPair = clampInt(t.at("inputFrom").value("pair", 0), 0, kMaxPair);
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

json parseMessage(const std::string& text) {
    // Refused while parsing, before the nesting exists: a copy or a walk of a few thousand levels overflows a connection thread's stack.
    const json::parser_callback_t bound = [](int depth, json::parse_event_t event, json&) {
        if ((event == json::parse_event_t::object_start || event == json::parse_event_t::array_start) &&
            depth >= kMaxMessageDepth)
            throw std::runtime_error("message nested deeper than " + std::to_string(kMaxMessageDepth) + " levels");
        return true;
    };
    return json::parse(text, bound);
}

}  // namespace studio
