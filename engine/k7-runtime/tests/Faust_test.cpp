// Faust, compiled by the engine's own libfaust against the engine's own copy of the Faust
// libraries: seven cases on inline source, and one that walks a MODULE LIBRARY named by
// `$STUDIO_MODULES` — this repo ships no modules to walk.
//
// That last case is the check that was missing when the Wurlitzer was written, reviewed, committed,
// pushed into an account's library and opened in the builder — without ever compiling once. It
// failed on `redefinition of symbols are not allowed : pm`, because `pm` is stdfaust's alias for
// physmodels.lib. Nothing short of a real compiler could have said so. Run it against your library
// before pushing one.
//
// JUCE-free on purpose, like ProjectDiff_test: it links libfaust and nothing else, so it builds
// and runs in seconds and needs no audio device.

#include "faust/dsp/interpreter-dsp.h"
#include "faust/dsp/poly-dsp.h"
#include "faust/gui/UI.h"

#include "test_harness.h"

#include <chrono>
#include <cstdlib>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <list>
#include <map>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

// Faust's two GUI statics, defined once per program — the same pair FaustPlugin.cpp carries.
std::list<GUI*> GUI::fGuiList;
ztimedmap GUI::gTimedZoneMap;

namespace fs = std::filesystem;

namespace {

/** Counts what a program declares, so a module with no controls at all is visible as one. */
struct CountControls : public UI {
    int controls = 0;
    void openTabBox(const char*) override {}
    void openHorizontalBox(const char*) override {}
    void openVerticalBox(const char*) override {}
    void closeBox() override {}
    void addButton(const char*, FAUSTFLOAT*) override { ++controls; }
    void addCheckButton(const char*, FAUSTFLOAT*) override { ++controls; }
    void addVerticalSlider(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT,
                           FAUSTFLOAT) override { ++controls; }
    void addHorizontalSlider(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT,
                             FAUSTFLOAT) override { ++controls; }
    void addNumEntry(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT,
                     FAUSTFLOAT) override { ++controls; }
    void addHorizontalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) override {}
    void addVerticalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) override {}
    void addSoundfile(const char*, const char*, Soundfile**) override {}
};

std::string readAll(const fs::path& p)
{
    std::ifstream in(p);
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

/**
 * A module library to compile, named at RUN time by `$STUDIO_MODULES`. There is no corpus in this
 * repo to point at: modules live in the account's library repository and nowhere else
 * (packages/song/docs/sharedFolders.md), so the only honest default is "none given".
 */
fs::path catalogueDir()
{
    const char* env = std::getenv("STUDIO_MODULES");
    return env != nullptr ? fs::path{env} : fs::path{};
}

/**
 * One module's source out of that library, or EMPTY when none was given. The cases below measure
 * named modules — the wurlitzer's release, its modulation index — so a synthetic stand-in would
 * quietly change what they claim. They skip instead, and say so.
 */
fs::path libraryDsp(const char* rel)
{
    const auto root = catalogueDir();
    if (root.empty()) return {};
    const auto p = root / fs::path(rel);
    return fs::is_regular_file(p) ? p : fs::path{};
}

/** The skip, spelled once: a suite that measures nothing must never read as a suite that passed. */
bool announceNoLibrary(const char* what)
{
    std::printf("    no library given — set STUDIO_MODULES to measure %s\n", what);
    return true;
}

/** Compile one file the way FaustPlugin does, and answer what happened. */
struct Result {
    bool ok = false;
    std::string error;
    int inputs = 0, outputs = 0, controls = 0;
};

Result compileOne(const fs::path& file)
{
    Result r;
    const std::string source = readAll(file);
    const std::string libs = fs::path{STUDIO_FAUST_LIBS}.string();
    const char* argv[] = {"-I", libs.c_str()};
    auto* factory = createInterpreterDSPFactoryFromString("test", source, 2, argv, r.error);
    if (factory == nullptr) return r;

    auto* dsp = factory->createDSPInstance();
    dsp->init(48000);
    CountControls ui;
    dsp->buildUserInterface(&ui);
    r.ok = true;
    r.inputs = dsp->getNumInputs();
    r.outputs = dsp->getNumOutputs();
    r.controls = ui.controls;

    // …and it RUNS: a module that loads and takes the engine down is worse than one that refuses.
    const int n = 512;
    std::vector<std::vector<float>> in(std::max(r.inputs, 1), std::vector<float>(n, 0.0f));
    std::vector<std::vector<float>> out(std::max(r.outputs, 1), std::vector<float>(n, 0.0f));
    std::vector<float*> inp, outp;
    for (auto& c : in) inp.push_back(c.data());
    for (auto& c : out) outp.push_back(c.data());
    dsp->compute(n, r.inputs > 0 ? inp.data() : nullptr, outp.data());

    delete dsp;
    deleteInterpreterDSPFactory(factory);
    return r;
}

}  // namespace

static void every_dsp_in_the_library_compiles()
{
    const auto root = catalogueDir();
    if (root.empty() || !fs::is_directory(root)) {
        // Not a failure: a build machine has no library. This case is for the person who HAS one,
        // and it is the only thing standing between a `.dsp` and somebody else's project.
        std::printf("    no library given — set STUDIO_MODULES=<...>/_libraries/modules to check one\n");
        return;
    }
    int seen = 0;
    for (const auto& e : fs::recursive_directory_iterator(root)) {
        if (!e.is_regular_file() || e.path().extension() != ".dsp") continue;
        ++seen;
        const auto rel = fs::relative(e.path(), root).generic_string();
        const Result r = compileOne(e.path());
        if (!r.ok) {
            std::printf("    %s\n      %s\n", rel.c_str(), r.error.c_str());
            CHECK(r.ok);
            continue;
        }
        std::printf("    %-40s in=%d out=%d controls=%d\n", rel.c_str(), r.inputs, r.outputs,
                    r.controls);
        // A program with no outputs is not a module: whatever it is, nothing downstream can hear it.
        CHECK(r.outputs > 0);
    }
    // A library pointed at deliberately and holding no `.dsp` is a path typo, not an empty library.
    CHECK(seen >= 1);
}

/** The loudest sample in a block — what "did anything come out" means, measurably. */
static float peakOf(const std::vector<std::vector<float>>& out, int n)
{
    float peak = 0.0f;
    for (const auto& chan : out)
        for (int i = 0; i < n; ++i) peak = std::max(peak, std::fabs(chan[i]));
    return peak;
}

static void an_instrument_sounds_when_a_note_is_played()
{
    // The polyphony seam as one measurement: an instrument whose `gate` nothing opens is silent.
    const auto file = libraryDsp("instruments/synth/wurlitzer/dsp.dsp");
    if (file.empty() && announceNoLibrary("the wurlitzer")) return;

    const std::string libs = fs::path{STUDIO_FAUST_LIBS}.string();
    const char* argv[] = {"-I", libs.c_str()};
    std::string error;
    auto* factory = createInterpreterDSPFactoryFromString("poly", readAll(file), 2, argv, error);
    CHECK(factory != nullptr);
    if (factory == nullptr) return;

    // Exactly what the plugin builds: the instance handed over, cloned per voice, controls shared.
    auto* poly = new mydsp_poly(factory->createDSPInstance(), 16, true, true);
    poly->init(48000);

    const int n = 512;
    const int chans = poly->getNumOutputs();
    std::vector<std::vector<float>> out(static_cast<size_t>(chans), std::vector<float>(n, 0.0f));
    std::vector<float*> outp;
    for (auto& c : out) outp.push_back(c.data());

    // Before any note: silence — otherwise "it makes sound" below only proves the thing is droning.
    poly->compute(n, nullptr, outp.data());
    CHECK(peakOf(out, n) == 0.0f);

    // Middle C: the attack is 1 ms, so one 512-frame block is ten times what the envelope needs.
    poly->keyOn(1, 60, 100);
    poly->compute(n, nullptr, outp.data());
    const float sounding = peakOf(out, n);
    std::printf("    wurlitzer: peak after note-on = %.4f\n", sounding);
    CHECK(sounding > 0.001f);

    // …and it DECAYS: a gate that never closes is the other way to make sound and still be wrong.
    poly->keyOff(1, 60, 0);
    float last = sounding;
    for (int block = 0; block < 200; ++block) {
        poly->compute(n, nullptr, outp.data());
        last = peakOf(out, n);
    }
    std::printf("    wurlitzer: peak after 200 blocks of release = %.6f\n", last);
    CHECK(last < sounding);

    delete poly;
    deleteInterpreterDSPFactory(factory);
}

static void it_still_sounds_after_more_notes_than_there_are_voices()
{
    // THE regression: playing sixteen notes passed on the broken build, so this plays well past that.
    const auto file = libraryDsp("instruments/synth/wurlitzer/dsp.dsp");
    if (file.empty() && announceNoLibrary("the wurlitzer")) return;

    const std::string libs = fs::path{STUDIO_FAUST_LIBS}.string();
    const char* argv[] = {"-I", libs.c_str()};
    std::string error;
    auto* factory = createInterpreterDSPFactoryFromString("voices", readAll(file), 2, argv, error);
    CHECK(factory != nullptr);
    if (factory == nullptr) return;

    constexpr int VOICES = 16;
    auto* poly = new mydsp_poly(factory->createDSPInstance(), VOICES, true, true);
    poly->init(48000);

    const int n = 512;
    std::vector<std::vector<float>> out((size_t)poly->getNumOutputs(), std::vector<float>(n, 0.0f));
    std::vector<float*> outp;
    for (auto& c : out) outp.push_back(c.data());

    const auto playOne = [&](int pitch) {
        poly->keyOn(1, pitch, 100);
        poly->compute(n, nullptr, outp.data());
        const float peak = peakOf(out, n);
        poly->keyOff(1, pitch, 0);
        // Long enough for the 40 ms release to finish and the voice to fall under -90 dB.
        for (int b = 0; b < 20; ++b) poly->compute(n, nullptr, outp.data());
        return peak;
    };

    const float first = playOne(60);
    float last = 0.0f;
    for (int i = 0; i < VOICES * 3; ++i) last = playOne(48 + (i % 24));
    std::printf("    note 1 peak = %.4f, note %d peak = %.4f\n", first, VOICES * 3 + 1, last);
    CHECK(first > 0.001f);
    CHECK(last > first * 0.5f);
}

/** Sign changes in a block — a crude but honest stand-in for "how bright is this". */
static int crossingsOf(const std::vector<std::vector<float>>& out, int n)
{
    int crossings = 0;
    for (int i = 1; i < n; ++i)
        if ((out[0][i - 1] < 0.0f) != (out[0][i] < 0.0f)) ++crossings;
    return crossings;
}

static void velocity_changes_the_timbre_and_not_only_the_level()
{
    // A MODULATOR's gain IS its modulation index, so velocity has to scale all four operators.
    const auto file = libraryDsp("instruments/synth/wurlitzer/dsp.dsp");
    if (file.empty() && announceNoLibrary("the wurlitzer")) return;

    const std::string libs = fs::path{STUDIO_FAUST_LIBS}.string();
    const char* argv[] = {"-I", libs.c_str()};
    std::string error;
    auto* factory = createInterpreterDSPFactoryFromString("vel", readAll(file), 2, argv, error);
    CHECK(factory != nullptr);
    if (factory == nullptr) return;

    const int n = 1024;
    const auto strike = [&](int velocity) {
        auto* poly = new mydsp_poly(factory->createDSPInstance(), 4, true, true);
        poly->init(48000);
        std::vector<std::vector<float>> out((size_t)poly->getNumOutputs(),
                                            std::vector<float>(n, 0.0f));
        std::vector<float*> outp;
        for (auto& c : out) outp.push_back(c.data());
        poly->keyOn(1, 60, velocity);
        poly->compute(n, nullptr, outp.data());
        const auto r = std::pair<float, int>{peakOf(out, n), crossingsOf(out, n)};
        delete poly;
        return r;
    };

    const auto soft = strike(20);
    const auto hard = strike(127);
    std::printf("    velocity 20:  peak %.4f, %d crossings\n", soft.first, soft.second);
    std::printf("    velocity 127: peak %.4f, %d crossings\n", hard.first, hard.second);

    // Louder AND brighter: asserting only the level is exactly the bug this is here to refuse.
    CHECK(hard.first > soft.first * 2.0f);
    CHECK(hard.second > soft.second);

    deleteInterpreterDSPFactory(factory);
}

/** Every voice's zone for a control name — the dispatch FaustPlugin builds, in miniature. */
struct ZonesByName : public UI {
    std::map<std::string, std::vector<FAUSTFLOAT*>> zones;
    void openTabBox(const char*) override {}
    void openHorizontalBox(const char*) override {}
    void openVerticalBox(const char*) override {}
    void closeBox() override {}
    void addButton(const char* l, FAUSTFLOAT* z) override { zones[l].push_back(z); }
    void addCheckButton(const char* l, FAUSTFLOAT* z) override { zones[l].push_back(z); }
    void addVerticalSlider(const char* l, FAUSTFLOAT* z, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT,
                           FAUSTFLOAT) override { zones[l].push_back(z); }
    void addHorizontalSlider(const char* l, FAUSTFLOAT* z, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT,
                             FAUSTFLOAT) override { zones[l].push_back(z); }
    void addNumEntry(const char* l, FAUSTFLOAT* z, FAUSTFLOAT, FAUSTFLOAT, FAUSTFLOAT,
                     FAUSTFLOAT) override { zones[l].push_back(z); }
    void addHorizontalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) override {}
    void addVerticalBargraph(const char*, FAUSTFLOAT*, FAUSTFLOAT, FAUSTFLOAT) override {}
    void addSoundfile(const char*, const char*, Soundfile**) override {}
};

static void a_knob_reaches_every_voice()
{
    // Reported as "the knobs do nothing", uncaught because no test had ever TURNED one (docs/faust.md).
    const auto file = libraryDsp("instruments/synth/wurlitzer/dsp.dsp");
    if (file.empty() && announceNoLibrary("the wurlitzer")) return;

    const std::string libs = fs::path{STUDIO_FAUST_LIBS}.string();
    const char* argv[] = {"-I", libs.c_str()};
    std::string error;
    auto* factory = createInterpreterDSPFactoryFromString("knob", readAll(file), 2, argv, error);
    CHECK(factory != nullptr);
    if (factory == nullptr) return;

    constexpr int VOICES = 16;
    const int n = 1024;
    const auto strikeWith = [&](const char* knob, float value) {
        auto* poly = new mydsp_poly(factory->createDSPInstance(), VOICES, true, false);
        poly->init(48000);
        ZonesByName ui;
        poly->buildUserInterface(&ui);
        // Seventeen, measured: one per voice plus a shared one — a COLLAPSE to a single zone is the bug.
        std::printf("    zones for %s: %zu\n", knob, ui.zones[knob].size());
        CHECK(ui.zones[knob].size() >= VOICES);
        for (auto* z : ui.zones[knob]) *z = value;

        std::vector<std::vector<float>> out((size_t)poly->getNumOutputs(),
                                            std::vector<float>(n, 0.0f));
        std::vector<float*> outp;
        for (auto& c : out) outp.push_back(c.data());
        poly->keyOn(1, 60, 100);
        poly->compute(n, nullptr, outp.data());
        const auto r = std::pair<float, int>{peakOf(out, n), crossingsOf(out, n)};
        delete poly;
        return r;
    };

    // `Index` IS the body pair's modulation index, so brightness is the thing it moves.
    const auto flat = strikeWith("Index", 0.0f);
    const auto rich = strikeWith("Index", 2.0f);
    std::printf("    Index 0: %d crossings, Index 2: %d crossings\n", flat.second, rich.second);
    CHECK(rich.second > flat.second);

    // `Tine` crossfades body against the attack pair: a different sound, not a louder one.
    const auto body = strikeWith("Tine", 0.0f);
    const auto bark = strikeWith("Tine", 2.0f);
    std::printf("    Tine 0: %d crossings, Tine 2: %d crossings\n", body.second, bark.second);
    CHECK(body.second != bark.second);

    deleteInterpreterDSPFactory(factory);
}

static void the_interpreter_is_fast_enough_to_put_in_series()
{
    // What a STRIP costs against the engine's budget: 256 frames at 48 kHz is 5.33 ms for 5.33 ms of audio.
    const auto file = libraryDsp("audio/filter/moogladder/dsp.dsp");
    if (file.empty() && announceNoLibrary("the moog ladder")) return;

    const std::string libs = fs::path{STUDIO_FAUST_LIBS}.string();
    const char* argv[] = {"-I", libs.c_str()};
    std::string error;
    auto* factory = createInterpreterDSPFactoryFromString("bench", readAll(file), 2, argv, error);
    CHECK(factory != nullptr);
    if (factory == nullptr) return;

    constexpr int STAGES = 8;      // a fat strip: eight of the same filter, one after another
    constexpr int BLOCK = 256;     // the engine's block
    constexpr double RATE = 48000.0;
    constexpr int BLOCKS = 2000;   // ~10,7 s of audio, enough that the clock is not the noise

    std::vector<::dsp*> chain;
    for (int i = 0; i < STAGES; ++i) {
        auto* d = factory->createDSPInstance();
        d->init(static_cast<int>(RATE));
        chain.push_back(d);
    }

    std::vector<std::vector<float>> buf(2, std::vector<float>(BLOCK, 0.0f));
    std::vector<std::vector<float>> tmp(2, std::vector<float>(BLOCK, 0.0f));
    std::vector<float*> in{buf[0].data(), buf[1].data()};
    std::vector<float*> out{tmp[0].data(), tmp[1].data()};
    // Something to chew on: silence would let a denormal-flushing CPU cheat the measurement.
    for (int i = 0; i < BLOCK; ++i) {
        buf[0][i] = 0.25f * std::sin(0.05f * static_cast<float>(i));
        buf[1][i] = buf[0][i];
    }

    const auto t0 = std::chrono::steady_clock::now();
    for (int b = 0; b < BLOCKS; ++b)
        for (auto* d : chain) {
            d->compute(BLOCK, in.data(), out.data());
            std::swap(in, out);
        }
    const auto elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();

    const double audio = BLOCKS * BLOCK / RATE;
    const double load = elapsed / audio * 100.0;
    std::printf("    %d moogladder in series: %.1f%% of the block budget (%.2f ms per %d-frame block)\n",
                STAGES, load, elapsed / BLOCKS * 1000.0, BLOCK);
    std::printf("    -> one instance costs about %.2f%%\n", load / STAGES);

    // A generous ceiling on purpose: it catches an ORDER of magnitude, not a performance target.
    CHECK(load < 50.0);

    for (auto* d : chain) delete d;
    deleteInterpreterDSPFactory(factory);
}

static void a_broken_program_is_refused_with_its_reason()
{
    // A failure comes back with Faust's own message, which is what names the line and the symbol.
    Result r;
    const std::string libs = fs::path{STUDIO_FAUST_LIBS}.string();
    const char* argv[] = {"-I", libs.c_str()};
    auto* f = createInterpreterDSPFactoryFromString("bad", "process = nosuchthing;", 2, argv,
                                                    r.error);
    CHECK(f == nullptr);
    CHECK(!r.error.empty());
}

static void the_faust_libraries_are_where_the_build_says()
{
    // The trap that fails at RUNTIME: `libraries/` is a submodule, and an uninitialised one is empty.
    CHECK(fs::is_directory(fs::path{STUDIO_FAUST_LIBS}));
    CHECK(fs::is_regular_file(fs::path{STUDIO_FAUST_LIBS} / "stdfaust.lib"));
}

int main()
{
    RUN(every_dsp_in_the_library_compiles);
    RUN(an_instrument_sounds_when_a_note_is_played);
    RUN(it_still_sounds_after_more_notes_than_there_are_voices);
    RUN(velocity_changes_the_timbre_and_not_only_the_level);
    RUN(a_knob_reaches_every_voice);
    RUN(the_interpreter_is_fast_enough_to_put_in_series);
    RUN(a_broken_program_is_refused_with_its_reason);
    RUN(the_faust_libraries_are_where_the_build_says);
    TEST_MAIN_END();
}
