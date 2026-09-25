// Unit tests for the diff engine — the JUCE-free core deciding whether a change applies incrementally or
// forces a full rebuild. No audio device, no Tracktion: ProjectDoc.cpp + ProjectDiff.cpp compile straight in.
// Not exhaustive by design; each test pins a property that would silently break playback if it regressed.

#include "ProjectDiff.h"
#include "Warnings.h"       // the sink, so a test can read what index() reports
#include "test_harness.h"

#include <string>
#include <vector>

using namespace studio;

namespace {

// --- small builders / queries ------------------------------------------------

TrackDoc mkTrack(std::string id, std::string name) {
    TrackDoc t;
    t.id = std::move(id);
    t.name = std::move(name);
    return t;
}

PluginDoc mkPlugin(std::string id, std::string type, std::string name) {
    PluginDoc p;
    p.id = std::move(id);
    p.type = std::move(type);
    p.name = std::move(name);
    return p;
}

ClipDoc mkClip(std::string id, double start) {
    ClipDoc c;
    c.id = std::move(id);
    c.type = ClipType::Audio;
    c.source = "take.wav";
    c.start = start;
    return c;
}

int countKind(const ProjectDiff& d, ChangeKind k) {
    int n = 0;
    for (const auto& c : d)
        if (c.kind == k) ++n;
    return n;
}

bool hasKind(const ProjectDiff& d, ChangeKind k) { return countKind(d, k) > 0; }

int firstIndexOf(const ProjectDiff& d, ChangeKind k) {
    for (int i = 0; i < static_cast<int>(d.size()); ++i)
        if (d[i].kind == k) return i;
    return -1;
}

// --- tests -------------------------------------------------------------------

// The foundational guarantee: diffing a doc against itself changes nothing.
void diff_identical_is_empty() {
    ProjectDoc a;
    auto t = mkTrack("t1", "Drums");
    t.plugins.push_back(mkPlugin("t1:b1", "4osc", "4OSC"));
    t.clips.push_back(mkClip("c1", 0.0));
    a.tracks.push_back(t);

    const ProjectDoc b = a;
    const auto d = diff(a, b);
    CHECK(d.empty());
    CHECK(!needsFullRebuild(d));
}

// A tempo change is a single global scalar change carrying the new value.
void diff_tempo_change() {
    ProjectDoc a;
    ProjectDoc b = a;
    b.tempo = 140.0;

    const auto d = diff(a, b);
    CHECK(d.size() == 1);
    CHECK(hasKind(d, ChangeKind::TempoChanged));
    if (!d.empty()) CHECK(d[0].doubleValue == 140.0);
    CHECK(!needsFullRebuild(d));
}

// A sample-rate change cannot be applied live — the device must reopen — so it must force a full rebuild.
void diff_samplerate_forces_rebuild() {
    ProjectDoc a;
    ProjectDoc b = a;
    b.sampleRate = 44100;

    const auto d = diff(a, b);
    CHECK(hasKind(d, ChangeKind::SampleRateChanged));
    CHECK(needsFullRebuild(d));
}

// Rename is "same id, new name", a cheap in-place TrackRenamed: a regression here rebuilds the track's whole graph on every rename.
void diff_track_rename_is_not_readd() {
    ProjectDoc a;
    a.tracks.push_back(mkTrack("t1", "Drums"));
    ProjectDoc b;
    b.tracks.push_back(mkTrack("t1", "Bass"));

    const auto d = diff(a, b);
    CHECK(d.size() == 1);
    CHECK(hasKind(d, ChangeKind::TrackRenamed));
    CHECK(!hasKind(d, ChangeKind::TrackAdded));
    CHECK(!hasKind(d, ChangeKind::TrackRemoved));
}

// Mute/solo/input-gain apply in place via TrackParamsChanged — never `volume`, which is a MIXER MODULE and no field here, so a test naming one stops compiling unseen (AGENTS.md).
void diff_track_params_in_place() {
    ProjectDoc a;
    a.tracks.push_back(mkTrack("t1", "Drums"));
    ProjectDoc b = a;
    b.tracks[0].mute = true;

    const auto d = diff(a, b);
    CHECK(d.size() == 1);
    CHECK(hasKind(d, ChangeKind::TrackParamsChanged));
    CHECK(!needsFullRebuild(d));
}

// A param drifting on the SAME plugin is a live PluginParamChanged and must NOT rebuild: this is the fader-drag path, and rebuilding makes a control undraggable.
void diff_plugin_param_drift_is_incremental() {
    ProjectDoc a;
    {
        auto t = mkTrack("t1", "Synth");
        auto p = mkPlugin("t1:b1", "4osc", "4OSC");
        p.params["cutoff"] = 0.5;
        t.plugins.push_back(p);
        a.tracks.push_back(t);
    }
    ProjectDoc b = a;
    b.tracks[0].plugins[0].params["cutoff"] = 0.8;

    const auto d = diff(a, b);
    CHECK(d.size() == 1);
    CHECK(hasKind(d, ChangeKind::PluginParamChanged));
    if (!d.empty()) {
        CHECK(d[0].paramName == "cutoff");
        CHECK(d[0].paramValue == 0.8);
    }
    CHECK(!needsFullRebuild(d));
}

// Swapping the plugin (same id, different name/type) is a REPLACE: remove + add, in that order, and no rebuild — the pair does the job in place.
void diff_plugin_swap_is_replace_and_rebuild() {
    ProjectDoc a;
    {
        auto t = mkTrack("t1", "FX");
        t.plugins.push_back(mkPlugin("t1:b1", "vst3", "Reverb A"));
        a.tracks.push_back(t);
    }
    ProjectDoc b = a;
    b.tracks[0].plugins[0].name = "Reverb B";   // same id, different plugin

    const auto d = diff(a, b);
    CHECK(hasKind(d, ChangeKind::PluginRemoved));
    CHECK(hasKind(d, ChangeKind::PluginAdded));
    CHECK(!needsFullRebuild(d));
    // The order is what makes the pair safe in place, and it is asserted by diff_removals_before_adds too.
    CHECK(d.front().kind == ChangeKind::PluginRemoved);
}

ProjectDoc patternLane(const std::string& source, const std::string& label) {
    ProjectDoc d;
    auto t = mkTrack("pad", "pad");
    auto p = mkPlugin("pad:pattern", "studio_pattern", "Pattern");
    p.patternSource = source;
    p.patternLabel = label;
    t.plugins.push_back(p);
    d.tracks.push_back(t);
    return d;
}

// A save of the pattern file is the live-coding loop: it must reach the plugin IN PLACE, or every save restarts the lane.
void diff_pattern_edit_is_in_place() {
    const auto d = diff(patternLane("s(\"bd sn\")", "pad"), patternLane("s(\"bd*2 sn\")", "pad"));
    CHECK(d.size() == 1);
    CHECK(hasKind(d, ChangeKind::PatternChanged));
    CHECK(!hasKind(d, ChangeKind::PluginRemoved));
    CHECK(!needsFullRebuild(d));
    if (!d.empty() && d[0].plugin) CHECK(d[0].plugin->patternSource == "s(\"bd*2 sn\")");
}

// The label is fixed for the plugin's life (it picks the events), so a new one is a new plugin.
void diff_pattern_label_is_identity() {
    const auto d = diff(patternLane("s(\"bd\")", "pad"), patternLane("s(\"bd\")", "kit"));
    CHECK(hasKind(d, ChangeKind::PluginRemoved));
    CHECK(hasKind(d, ChangeKind::PluginAdded));
    CHECK(!hasKind(d, ChangeKind::PatternChanged));
}

// Adding a plugin must NOT rebuild: a full rebuild re-instantiates every plugin in the song, measured at 4.4 s on a 32-plugin project against 6 ms for the incremental insert.
void diff_plugin_add_is_incremental() {
    ProjectDoc a;
    {
        auto t = mkTrack("t1", "FX");
        t.plugins.push_back(mkPlugin("t1:b1", "vst3", "Reverb"));
        a.tracks.push_back(t);
    }
    ProjectDoc b = a;
    b.tracks[0].plugins.push_back(mkPlugin("t1:b2", "4osc", "4OSC"));

    const auto d = diff(a, b);
    CHECK(hasKind(d, ChangeKind::PluginAdded));
    CHECK(!hasKind(d, ChangeKind::PluginRemoved));
    CHECK(!needsFullRebuild(d));
}

// Removing one does not rebuild either, and not for speed: a rebuild replaces the Edit and the transport with it, so unlinking a module would stop the song.
void diff_plugin_remove_is_incremental() {
    ProjectDoc a;
    {
        auto t = mkTrack("t1", "FX");
        t.plugins.push_back(mkPlugin("t1:b1", "vst3", "Reverb"));
        t.plugins.push_back(mkPlugin("t1:b2", "4osc", "4OSC"));
        a.tracks.push_back(t);
    }
    ProjectDoc b = a;
    b.tracks[0].plugins.pop_back();

    const auto d = diff(a, b);
    CHECK(hasKind(d, ChangeKind::PluginRemoved));
    CHECK(!needsFullRebuild(d));
}

// …with two exceptions the incremental insert cannot place: a SIDECHAINED plugin, wired once every track exists, and a track added in the same diff, which shifts trackById's index.
void diff_plugin_add_rebuilds_when_it_must() {
    ProjectDoc base;
    {
        auto t = mkTrack("t1", "FX");
        t.plugins.push_back(mkPlugin("t1:b1", "vst3", "Reverb"));
        base.tracks.push_back(t);
    }

    ProjectDoc sidechained = base;
    {
        auto p = mkPlugin("t1:b2", "4osc", "4OSC");
        p.sidechainFrom = "t2";
        sidechained.tracks[0].plugins.push_back(p);
    }
    CHECK(needsFullRebuild(diff(base, sidechained)));

    ProjectDoc alsoNewTrack = base;
    alsoNewTrack.tracks[0].plugins.push_back(mkPlugin("t1:b2", "4osc", "4OSC"));
    alsoNewTrack.tracks.push_back(mkTrack("t2", "Bass"));
    const auto d = diff(base, alsoNewTrack);
    CHECK(hasKind(d, ChangeKind::TrackAdded));
    CHECK(needsFullRebuild(d));
}

// Moving a clip (same id, new start) is a ClipMoved, not remove+add.
void diff_clip_moved() {
    ProjectDoc a;
    {
        auto t = mkTrack("t1", "Drums");
        t.clips.push_back(mkClip("c1", 0.0));
        a.tracks.push_back(t);
    }
    ProjectDoc b = a;
    b.tracks[0].clips[0].start = 4.0;

    const auto d = diff(a, b);
    CHECK(d.size() == 1);
    CHECK(hasKind(d, ChangeKind::ClipMoved));
}

// Two placements of ONE material must not share an engine clip name, since that is how a clip is found again — docs/clipIdentity.md.
void clip_name_is_the_placement_not_the_material() {
    ClipDoc a = mkClip("riff@0", 0.0);
    ClipDoc b = mkClip("riff@16", 16.0);
    a.name = "riff";  // the MATERIAL — deliberately the same on both
    b.name = "riff";

    CHECK(clipNameFor(a) != clipNameFor(b));
    CHECK(clipNameFor(a) == "riff@0");
    CHECK(clipNameFor(b) == "riff@16");

    // The fallback, for a document with no id at all — which the compiler never emits.
    ClipDoc noId = a;
    noId.id.clear();
    CHECK(clipNameFor(noId) == "riff");
}

// Everything read at INSERT time has to make the clip move, or the edit is silently dropped — `from` and `offset` both had that hole.
void diff_clip_retimed_by_every_field() {
    ProjectDoc a;
    {
        auto t = mkTrack("t1", "Drums");
        t.clips.push_back(mkClip("c1", 0.0));
        a.tracks.push_back(t);
    }
    const auto moves = [&](auto mutate) {
        ProjectDoc b = a;
        mutate(b.tracks[0].clips[0]);
        const auto d = diff(a, b);
        return d.size() == 1 && hasKind(d, ChangeKind::ClipMoved);
    };

    CHECK(moves([](ClipDoc& c) { c.start = 4.0; }));
    CHECK(moves([](ClipDoc& c) { c.length = 8.0; }));
    CHECK(moves([](ClipDoc& c) { c.offset = 2.0; }));
    CHECK(moves([](ClipDoc& c) { c.sourceFrom = 1.5; }));   // the clip file's window…
    CHECK(moves([](ClipDoc& c) { c.sourceTo = 3.0; }));     // …both edges of it
    CHECK(moves([](ClipDoc& c) { c.loopStart = 1.0; }));
    CHECK(moves([](ClipDoc& c) { c.loopEnd = 4.0; }));
    CHECK(moves([](ClipDoc& c) { c.warp.algorithm = "slice"; }));
    CHECK(moves([](ClipDoc& c) { c.warp.markers = {{0.0, 0.0}, {4.0, 2.0}}; }));

    // The NOTES, every way one can change: they are written into the edit at INSERT time and nowhere else, so a clip whose notes moved has to be re-inserted.
    const NoteDoc n1{0.0, 0.5, 36, 1.0, 0, 1.0};
    const NoteDoc n2{1.0, 0.5, 38, 0.8, 0, 1.0};
    ProjectDoc withNote = a;
    withNote.tracks[0].clips[0].notes = {n1};
    CHECK(diff(a, withNote).size() == 1 && hasKind(diff(a, withNote), ChangeKind::ClipMoved));
    const auto notesMove = [&](std::vector<NoteDoc> to) {
        ProjectDoc b = withNote;
        b.tracks[0].clips[0].notes = std::move(to);
        const auto d = diff(withNote, b);
        return d.size() == 1 && hasKind(d, ChangeKind::ClipMoved);
    };
    CHECK(notesMove({n1, n2}));                                    // one added
    CHECK(notesMove({}));                                          // the last one removed
    CHECK(notesMove({{0.0, 0.5, 36, 0.4, 0, 1.0}}));               // its velocity
    CHECK(notesMove({{2.0, 0.5, 36, 1.0, 0, 1.0}}));               // moved in time
    CHECK(notesMove({{0.0, 0.5, 38, 1.0, 0, 1.0}}));               // moved to another key
    // …and the same notes are still nothing to do.
    ProjectDoc sameNotes = withNote;
    CHECK(diff(withNote, sameNotes).empty());

    // …and a change to none of them is still nothing to do.
    ProjectDoc same = a;
    CHECK(diff(a, same).empty());
}

// apply() references tracks by id, so every removal must be ordered before every add.
void diff_removals_before_adds() {
    ProjectDoc a;
    a.tracks.push_back(mkTrack("t1", "Old"));
    ProjectDoc b;
    b.tracks.push_back(mkTrack("t2", "New"));

    const auto d = diff(a, b);
    CHECK(hasKind(d, ChangeKind::TrackRemoved));
    CHECK(hasKind(d, ChangeKind::TrackAdded));
    const int rem = firstIndexOf(d, ChangeKind::TrackRemoved);
    const int add = firstIndexOf(d, ChangeKind::TrackAdded);
    CHECK(rem >= 0 && add >= 0 && rem < add);
}

// A track GOING forces a rebuild: trackById maps a doc INDEX onto a lane, so a lane left standing under a
// shortened document silently moves every later track's clips, mute and input onto its neighbour.
void diff_track_removed_forces_rebuild() {
    ProjectDoc a;
    a.tracks.push_back(mkTrack("t1", "Drums"));
    a.tracks.push_back(mkTrack("t2", "Bass"));
    a.tracks.push_back(mkTrack("t3", "Keys"));
    ProjectDoc b;
    b.tracks.push_back(mkTrack("t2", "Bass"));   // t1 deleted — t2 and t3 both shift down a lane
    b.tracks.push_back(mkTrack("t3", "Keys"));

    const auto d = diff(a, b);
    CHECK(hasKind(d, ChangeKind::TrackRemoved));
    CHECK(needsFullRebuild(d));
}

// …and the LAST track going too, where no index shifts: the lane would otherwise play on with nothing naming it.
void diff_last_track_removed_forces_rebuild() {
    ProjectDoc a;
    a.tracks.push_back(mkTrack("t1", "Drums"));
    a.tracks.push_back(mkTrack("t2", "Bass"));
    ProjectDoc b;
    b.tracks.push_back(mkTrack("t1", "Drums"));

    CHECK(needsFullRebuild(diff(a, b)));
}

// A duplicate id is DIFFED AS ONE and SAID SO: index() keeps the first and drops the rest, so without the warning the second track is built and then invisible to every later diff.
void diff_duplicate_id_is_reported() {
    std::vector<Warning> seen;
    setWarningSink([&](const Warning& w) { seen.push_back(w); });

    ProjectDoc a;
    a.tracks.push_back(mkTrack("t1", "One"));
    a.tracks.push_back(mkTrack("t1", "Two"));   // same id — a compiler bug, or a hand-edited file
    ProjectDoc b = a;

    const auto d = diff(a, b);
    CHECK(d.empty());          // identical documents still diff to nothing…
    CHECK(!seen.empty());      // …but the collision is on the record rather than swallowed

    bool namesTheId = false;
    for (const auto& w : seen)
        if (w.message.find("track:t1") != std::string::npos) namesTheId = true;
    CHECK(namesTheId);

    setWarningSink(nullptr);
}

// --- the master chain (the song's MIX -> OUT run) -----------------------------

// A doc with no master chain is the ordinary case, and must diff clean against itself.
void diff_master_chain_absent_is_empty() {
    ProjectDoc a;
    a.tracks.push_back(mkTrack("t1", "Drums"));
    const ProjectDoc b = a;
    const auto d = diff(a, b);
    CHECK(!hasKind(d, ChangeKind::MasterChainChanged));
    CHECK(!needsFullRebuild(d));
}

// Adding one forces a rebuild: the master list is not on the incremental path.
void diff_master_chain_added_rebuilds() {
    ProjectDoc a;
    a.tracks.push_back(mkTrack("t1", "Drums"));
    ProjectDoc b = a;
    b.masterPlugins.push_back(mkPlugin("m1", "4osc", "Comp"));

    const auto d = diff(a, b);
    CHECK(hasKind(d, ChangeKind::MasterChainChanged));
    CHECK(needsFullRebuild(d));
}

// …and removing one, the case that must not be missed: a chain deleted from the song has to come OFF the bus, and an empty list is what says so.
void diff_master_chain_removed_rebuilds() {
    ProjectDoc a;
    a.masterPlugins.push_back(mkPlugin("m1", "4osc", "Comp"));
    ProjectDoc b = a;
    b.masterPlugins.clear();

    const auto d = diff(a, b);
    CHECK(hasKind(d, ChangeKind::MasterChainChanged));
    CHECK(needsFullRebuild(d));
}

// An unchanged chain is silent — otherwise every apply would rebuild and stop playback.
void diff_master_chain_unchanged_is_silent() {
    ProjectDoc a;
    auto p = mkPlugin("m1", "4osc", "Comp");
    p.params["Threshold"] = -12.0;
    a.masterPlugins.push_back(p);

    const ProjectDoc b = a;
    const auto d = diff(a, b);
    CHECK(!hasKind(d, ChangeKind::MasterChainChanged));
}

// A parameter on a master plugin is part of the comparison — identity alone would miss it.
void diff_master_chain_param_change_is_seen() {
    ProjectDoc a;
    auto p = mkPlugin("m1", "4osc", "Comp");
    p.params["Threshold"] = -12.0;
    a.masterPlugins.push_back(p);

    ProjectDoc b = a;
    b.masterPlugins[0].params["Threshold"] = -6.0;

    CHECK(hasKind(diff(a, b), ChangeKind::MasterChainChanged));
}

// ORDER is the sound: both plugins are still there, so a comparison by key alone calls this unchanged — and an EQ before a compressor is not an EQ after one.
void diff_master_chain_reorder_is_seen() {
    ProjectDoc a;
    a.masterPlugins.push_back(mkPlugin("m1", "4osc", "Comp"));
    a.masterPlugins.push_back(mkPlugin("m2", "4osc", "EQ"));

    ProjectDoc b;
    b.masterPlugins.push_back(mkPlugin("m2", "4osc", "EQ"));
    b.masterPlugins.push_back(mkPlugin("m1", "4osc", "Comp"));

    CHECK(hasKind(diff(a, b), ChangeKind::MasterChainChanged));
}

// Bypassing one is a change you can hear, and it is not part of the identity key.
void diff_master_chain_bypass_is_seen() {
    ProjectDoc a;
    a.masterPlugins.push_back(mkPlugin("m1", "4osc", "Comp"));
    ProjectDoc b = a;
    b.masterPlugins[0].enabled = false;

    CHECK(hasKind(diff(a, b), ChangeKind::MasterChainChanged));
}

}  // namespace

int main() {
    RUN(diff_identical_is_empty);
    RUN(diff_master_chain_absent_is_empty);
    RUN(diff_master_chain_added_rebuilds);
    RUN(diff_master_chain_removed_rebuilds);
    RUN(diff_master_chain_unchanged_is_silent);
    RUN(diff_master_chain_param_change_is_seen);
    RUN(diff_master_chain_reorder_is_seen);
    RUN(diff_master_chain_bypass_is_seen);
    RUN(diff_tempo_change);
    RUN(diff_samplerate_forces_rebuild);
    RUN(diff_track_rename_is_not_readd);
    RUN(diff_track_params_in_place);
    RUN(diff_plugin_param_drift_is_incremental);
    RUN(diff_plugin_swap_is_replace_and_rebuild);
    RUN(diff_plugin_add_is_incremental);
    RUN(diff_plugin_remove_is_incremental);
    RUN(diff_plugin_add_rebuilds_when_it_must);
    RUN(diff_pattern_edit_is_in_place);
    RUN(diff_pattern_label_is_identity);
    RUN(diff_clip_moved);
    RUN(clip_name_is_the_placement_not_the_material);
    RUN(diff_clip_retimed_by_every_field);
    RUN(diff_removals_before_adds);
    RUN(diff_track_removed_forces_rebuild);
    RUN(diff_last_track_removed_forces_rebuild);
    RUN(diff_duplicate_id_is_reported);
    TEST_MAIN_END();
}
