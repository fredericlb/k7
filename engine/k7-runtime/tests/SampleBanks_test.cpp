// A sound name → the file a pattern lane plays, by the rule the Node clock used: banks in order, the Dirt layout
// `<name>/*.wav` sorted and taken modulo, else a flat `<name>.wav`. JUCE-free, so it runs in the FAST binary.
//
// What would be wrong SILENTLY: a different file for the same `n` than before (the kit changes under the song), and a
// later bank winning over an earlier one (the project's own sample loses to the library's).

#include "SampleBanks.h"

#include "test_harness.h"

#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;
using studio::SampleBanks;

namespace {

fs::path g_root;

void touch(const fs::path& p) {
    fs::create_directories(p.parent_path());
    std::ofstream(p) << "x";
}

void theDirtLayoutIsSortedAndTakenModulo() {
    const auto bank = g_root / "dirt";
    touch(bank / "bd" / "BT0A0D0.wav");
    touch(bank / "bd" / "BT0A0A7.wav");
    touch(bank / "bd" / "readme.txt");
    SampleBanks b({bank.string()});
    CHECK(b.resolve("bd", 0) == (bank / "bd" / "BT0A0A7.wav").string());
    CHECK(b.resolve("bd", 1) == (bank / "bd" / "BT0A0D0.wav").string());
    CHECK(b.resolve("bd", 2) == (bank / "bd" / "BT0A0A7.wav").string());
    CHECK(b.resolve("bd", -1) == (bank / "bd" / "BT0A0D0.wav").string());
}

void aFlatFileIsFoundToo() {
    const auto bank = g_root / "flat";
    touch(bank / "cp.wav");
    SampleBanks b({bank.string()});
    CHECK(b.resolve("cp", 3) == (bank / "cp.wav").string());
}

void theFirstBankWins() {
    const auto project = g_root / "project";
    const auto library = g_root / "library";
    touch(project / "hh" / "mine.wav");
    touch(library / "hh" / "theirs.wav");
    SampleBanks b({project.string(), library.string()});
    CHECK(b.resolve("hh", 0) == (project / "hh" / "mine.wav").string());
}

void anUnknownNameIsANote() {
    SampleBanks b({(g_root / "dirt").string(), (g_root / "missing").string()});
    CHECK(b.resolve("sawtooth", 0).empty());
    CHECK(b.resolve("", 0).empty());
}

}  // namespace

int main() {
    g_root = fs::temp_directory_path() / "k7-samplebanks-test";
    fs::remove_all(g_root);
    RUN(theDirtLayoutIsSortedAndTakenModulo);
    RUN(aFlatFileIsFoundToo);
    RUN(theFirstBankWins);
    RUN(anUnknownNameIsANote);
    fs::remove_all(g_root);
    TEST_MAIN_END();
}
