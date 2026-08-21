// Every `.dsp` this repo ships, compiled by the engine's own libfaust against the engine's own
// copy of the Faust libraries.
//
// This is the test that was missing when the Wurlitzer was written, reviewed, committed, pushed
// into an account's library and opened in the builder — without ever compiling once. It failed on
// `redefinition of symbols are not allowed : pm`, because `pm` is stdfaust's alias for
// physmodels.lib. Nothing short of a real compiler could have said so.
//
// JUCE-free on purpose, like ProjectDiff_test: it links libfaust and nothing else, so it builds
// and runs in seconds and needs no audio device.

#include "faust/dsp/interpreter-dsp.h"
#include "faust/gui/UI.h"

#include "test_harness.h"

#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

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

/** The shipped catalogue — the same folder `seedIfEmpty` fills a new library from. */
fs::path catalogueDir() { return fs::path{STUDIO_DSP_MODULES}; }

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

    // …and it RUNS. A program that compiles and then divides by zero on its first block is a
    // module that loads and takes the engine down, which is worse than one that refuses.
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

static void every_shipped_dsp_compiles()
{
    int seen = 0;
    for (const auto& e : fs::recursive_directory_iterator(catalogueDir())) {
        if (!e.is_regular_file() || e.path().extension() != ".dsp") continue;
        ++seen;
        const auto rel = fs::relative(e.path(), catalogueDir()).generic_string();
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
    // The catalogue holding no `.dsp` at all would make every check above vacuous — the shape of
    // green run that says nothing. There are two today.
    CHECK(seen >= 2);
}

static void a_broken_program_is_refused_with_its_reason()
{
    // The other half: a failure has to come back with Faust's own message, because that message
    // names the line and the symbol. FaustPlugin passes it through verbatim for that reason.
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
    // The trap that fails at RUNTIME and not at build time: `libraries/` is a submodule, and a
    // checkout that did not initialise it leaves an empty folder. Every module then fails to
    // compile on a build that reported nothing.
    CHECK(fs::is_directory(fs::path{STUDIO_FAUST_LIBS}));
    CHECK(fs::is_regular_file(fs::path{STUDIO_FAUST_LIBS} / "stdfaust.lib"));
}

int main()
{
    RUN(every_shipped_dsp_compiles);
    RUN(a_broken_program_is_refused_with_its_reason);
    RUN(the_faust_libraries_are_where_the_build_says);
    TEST_MAIN_END();
}
