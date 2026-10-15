// Which paths a document may make the engine read or write. JUCE-free, so it runs in a FAST binary.
//
// What would be wrong SILENTLY: a sibling folder sharing a root's prefix passing as inside it, a link
// inside a root aimed out of it passing, and a sound name climbing out of its bank.

#include "PathRoots.h"

#include "test_harness.h"

#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;
using namespace studio;

namespace {

fs::path g_root;

std::string s(const fs::path& p) { return p.string(); }

void touch(const fs::path& p) {
    fs::create_directories(p.parent_path());
    std::ofstream(p) << "x";
}

void aFileUnderARootIsInside() {
    const auto root = g_root / "home";
    touch(root / "remote" / "a.wav");
    CHECK(pathUnderRoots(s(root / "remote" / "a.wav"), {s(root)}));
    CHECK(pathUnderRoots(s(root), {s(root)}));
    // Not there yet is still inside: a preset or a take is written where nothing was.
    CHECK(pathUnderRoots(s(root / "new" / "take.wav"), {s(root)}));
    CHECK(pathUnderRoots(s(root / "x.vstpreset"), {s(root) + "/"}));
}

void aSiblingSharingThePrefixIsNot() {
    const auto root = g_root / "home";
    touch(g_root / "home-other" / "b.wav");
    CHECK(!pathUnderRoots(s(g_root / "home-other" / "b.wav"), {s(root)}));
}

void dotDotClimbsOut() {
    const auto root = g_root / "home";
    fs::create_directories(root);
    CHECK(!pathUnderRoots(s(root) + "/../outside.wav", {s(root)}));
    CHECK(!pathUnderRoots(s(root) + "/missing/../../outside.wav", {s(root)}));
    CHECK(pathUnderRoots(s(root) + "/missing/../inside.wav", {s(root)}));
}

void aLinkOutOfARootIsOutside() {
    const auto root = g_root / "home";
    const auto elsewhere = g_root / "elsewhere";
    touch(elsewhere / "secret.wav");
    std::error_code ec;
    fs::create_directory_symlink(elsewhere, root / "link", ec);
    // A platform that refuses to make the link (Windows without the privilege) has nothing to test here.
    if (ec) return;
    CHECK(!pathUnderRoots(s(root / "link" / "secret.wav"), {s(root)}));
    CHECK(pathUnderRoots(s(root / "link" / "secret.wav"), {s(root), s(elsewhere)}));
}

void uncAndEmptyAreRefused() {
    CHECK(isUncPath("\\\\host\\share\\a.wav"));
    CHECK(isUncPath("//host/share/a.wav"));
    CHECK(isUncPath("\\\\?\\C:\\a.wav"));
    CHECK(!isUncPath("/a/b.wav"));
    CHECK(!isUncPath("C:\\a\\b.wav"));
    CHECK(!pathUnderRoots("//host/share/a.wav", {"/"}));
    CHECK(!pathUnderRoots("", {s(g_root)}));
    CHECK(!pathUnderRoots(s(g_root / "a.wav"), {}));
}

void theExtensionIgnoresCase() {
    CHECK(hasExtensionCi("/a/b.vstpreset", ".vstpreset"));
    CHECK(hasExtensionCi("/a/b.VSTPreset", ".vstpreset"));
    CHECK(!hasExtensionCi("/a/b.vstpreset.sh", ".vstpreset"));
    CHECK(!hasExtensionCi(".vstpreset", ".vstpreset"));
    CHECK(!hasExtensionCi("/a/b", ".vstpreset"));
}

void soundNamesStayInTheirBank() {
    CHECK(safeSoundName("bd"));
    CHECK(safeSoundName("RolandTR808_bd"));
    CHECK(!safeSoundName(""));
    CHECK(!safeSoundName("."));
    CHECK(!safeSoundName(".."));
    CHECK(!safeSoundName("../etc"));
    CHECK(!safeSoundName("/etc/passwd"));
    CHECK(!safeSoundName("a\\b"));
}

void aRootListSplitsOnThePlatformSeparator() {
#ifdef _WIN32
    const auto parts = splitRootList("C:\\a;;D:\\b");
    CHECK(parts.size() == 2 && parts[0] == "C:\\a" && parts[1] == "D:\\b");
#else
    const auto parts = splitRootList("/a::/b:");
    CHECK(parts.size() == 2 && parts[0] == "/a" && parts[1] == "/b");
#endif
    CHECK(splitRootList("").empty());
}

void theProcessRootsGateReadsAndWrites() {
    const auto root = g_root / "home";
    // Unset, as in the CLI's one-shot modes: anything but a UNC path passes.
    CHECK(readAllowed(s(g_root / "anywhere.wav")));
    CHECK(!readAllowed("//host/share/a.wav"));
    setPathRoots({{s(root), s(g_root / "tmp")}, {s(root)}});
    CHECK(readAllowed(s(root / "a.wav")));
    CHECK(readAllowed(s(g_root / "tmp" / "b.wav")));
    CHECK(!writeAllowed(s(g_root / "tmp" / "b.wav")));
    CHECK(writeAllowed(s(root / "clips")));
    CHECK(!readAllowed(s(g_root / "elsewhere" / "secret.wav")));
}

}  // namespace

int main() {
    g_root = fs::weakly_canonical(fs::temp_directory_path()) / "k7-pathroots-test";
    fs::remove_all(g_root);
    RUN(aFileUnderARootIsInside);
    RUN(aSiblingSharingThePrefixIsNot);
    RUN(dotDotClimbsOut);
    RUN(aLinkOutOfARootIsOutside);
    RUN(uncAndEmptyAreRefused);
    RUN(theExtensionIgnoresCase);
    RUN(soundNamesStayInTheirBank);
    RUN(aRootListSplitsOnThePlatformSeparator);
    RUN(theProcessRootsGateReadsAndWrites);
    fs::remove_all(g_root);
    TEST_MAIN_END();
}
