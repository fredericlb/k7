// PathMap_test.cpp — the map's two directions held to their roots: a server path never resolves
// outside the local copy whatever its segments hold, and a local path is only ever sent up when
// it lies, element by element, under a root. No hub: neither direction asks the server anything.

#include "PathMap.h"
#include "Paths.h"

#include "test_harness.h"

#include <filesystem>

namespace fs = std::filesystem;
using k7::tunnel::joinUnder;
using k7::tunnel::relativeUnder;
using k7::tunnel::safeSegment;

namespace {

const std::string kRoot = k7::paths::utf8(fs::temp_directory_path() / "k7-pathmap" / "ws");

std::string under(const std::string& rel) { return k7::paths::utf8(k7::paths::fromUtf8(kRoot) / k7::paths::fromUtf8(rel)); }

void segmentsThatCouldClimbAreRefused()
{
    CHECK(safeSegment("clip.wav"));
    CHECK(safeSegment(".hidden"));
    for (const char* bad : {"", ".", "..", "...", ".. ", "..\\..\\x", "C:", "C:\\x", "\\Windows", "a/b", "a\tb"})
        CHECK(!safeSegment(bad));
    CHECK(!safeSegment(std::string("a\0b", 3)));
}

void windowsDeviceNamesAreRefusedEverywhere()
{
    for (const char* bad : {"CON", "con", "Prn.txt", "aux.wav", "NUL", "nul.tar.gz", "COM1", "com9.log", "LPT3", "lpt0", "CONIN$", "COM\xC2\xB9", "AUX .wav"})
        CHECK(!safeSegment(bad));
    for (const char* ok : {"CONSOLE", "console.wav", "COM10", "LPT", "comic.wav", "nullable", "aux1.wav", "my-con.wav"})
        CHECK(safeSegment(ok));
    CHECK(!joinUnder(kRoot, "songs/nul.wav"));
}

void aServerPathStaysUnderItsRoot()
{
    CHECK(joinUnder(kRoot, "songs/clip.wav") == under("songs/clip.wav"));
    for (const char* bad : {"../x", "a/../../x", "a/./b", "a//b", "", "a/", "..\\..\\x", "C:\\x", "\\Windows\\x", "C:x"})
        CHECK(!joinUnder(kRoot, bad));
}

void aLocalPathIsSentOnlyFromUnderItsRoot()
{
    CHECK(relativeUnder(kRoot, kRoot) == std::string());
    CHECK(relativeUnder(kRoot, under("songs/clip.wav")) == std::string("songs/clip.wav"));
    const char sep = static_cast<char>(fs::path::preferred_separator);
    for (const std::string& bad : {kRoot + sep + "." + sep + ".." + sep + ".." + sep + "etc", kRoot + sep + "a" + sep + ".." + sep + ".." + sep + "x",
                                   kRoot + "x" + sep + "y", kRoot + sep + sep + "a", kRoot + sep})
        CHECK(!relativeUnder(kRoot, bad));
}

void theMapRefusesBothWays()
{
    k7::tunnel::SyncLedger ledger;
    k7::tunnel::PathMap map({{"/srv/ws", kRoot, true}}, {}, ledger, [](const std::string&) {});
    CHECK(map.toLocal("/srv/ws/a/b.wav") == under("a/b.wav"));
    CHECK(!map.toLocal("/srv/ws/a/../../x"));
    CHECK(!map.toLocal("/srv/ws/..\\..\\x"));
    const auto up = map.toRemote(under("a/b.wav"));
    CHECK(up && up->first == "/srv/ws/a/b.wav");
    const char sep = static_cast<char>(fs::path::preferred_separator);
    CHECK(!map.toRemote(kRoot + sep + "." + sep + ".." + sep + ".." + sep + "home"));
}

}  // namespace

void runPathMapTests()
{
    RUN(segmentsThatCouldClimbAreRefused);
    RUN(windowsDeviceNamesAreRefusedEverywhere);
    RUN(aServerPathStaysUnderItsRoot);
    RUN(aLocalPathIsSentOnlyFromUnderItsRoot);
    RUN(theMapRefusesBothWays);
}
