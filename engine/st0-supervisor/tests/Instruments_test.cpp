// Instruments_test.cpp — what an instrument download does once the bytes are here: a zip unpacked whole into
// its folder with GitHub's one top folder dropped, a name climbing out of it refused, and the hash it is pinned by.

#include "Instruments.h"

#include "test_harness.h"

#include <miniz.h>

#include <filesystem>
#include <fstream>
#include <string>

namespace fs = std::filesystem;
using namespace st0::instruments;

namespace {

fs::path scratch(const std::string& name)
{
    const auto dir = fs::temp_directory_path() / ("st0-instruments-test-" + name);
    fs::remove_all(dir);
    fs::create_directories(dir);
    return dir;
}

// A zip on disk holding `files`, name to content.
fs::path zipOf(const fs::path& dir, std::initializer_list<std::pair<std::string, std::string>> files)
{
    const auto at = dir / "a.zip";
    mz_zip_archive zip{};
    mz_zip_writer_init_file(&zip, at.string().c_str(), 0);
    for (const auto& [name, body] : files)
        mz_zip_writer_add_mem(&zip, name.c_str(), body.data(), body.size(), MZ_DEFAULT_COMPRESSION);
    mz_zip_writer_finalize_archive(&zip);
    mz_zip_writer_end(&zip);
    return at;
}

std::string read(const fs::path& p)
{
    std::ifstream in(p);
    return std::string(std::istreambuf_iterator<char>(in), {});
}

void aGitHubArchiveIsUnpackedWithoutItsTopFolder()
{
    const auto dir = scratch("github");
    const auto zip = zipOf(dir, {{"Piano-abc/Piano.sfz", "<region> sample=Samples/A0.flac"},
                                 {"Piano-abc/Samples/A0.flac", "flac"}});
    std::string error;
    CHECK(unpackZip(zip, dir / "piano", error));
    CHECK(read(dir / "piano" / "Piano.sfz").find("A0.flac") != std::string::npos);
    CHECK(read(dir / "piano" / "Samples" / "A0.flac") == "flac");
    CHECK(!fs::exists(dir / "piano.unpack"));
}

void aFlatArchiveKeepsItsLayout()
{
    const auto dir = scratch("flat");
    const auto zip = zipOf(dir, {{"Piano.sfz", "x"}, {"Samples/A0.flac", "y"}});
    std::string error;
    CHECK(unpackZip(zip, dir / "piano", error));
    CHECK(fs::exists(dir / "piano" / "Piano.sfz"));
    CHECK(fs::exists(dir / "piano" / "Samples" / "A0.flac"));
}

void aNameOutsideTheFolderIsRefusedAndNothingIsLeft()
{
    const auto dir = scratch("escape");
    const auto zip = zipOf(dir, {{"ok.sfz", "x"}, {"../evil.txt", "y"}});
    std::string error;
    CHECK(!unpackZip(zip, dir / "piano", error));
    CHECK(error.find("outside") != std::string::npos);
    CHECK(!fs::exists(dir / "evil.txt"));
    CHECK(!fs::exists(dir / "piano"));
}

void theHashIsTheFilesSha256()
{
    const auto dir = scratch("hash");
    std::ofstream(dir / "abc") << "abc";
    CHECK(sha256Of(dir / "abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    CHECK(sha256Of(dir / "missing").empty());
}

void everyInstrumentIsPinned()
{
    for (const auto& i : all()) {
        CHECK(i.sha256.size() == 64);
        CHECK(i.url.rfind("https://", 0) == 0);
        CHECK(i.bytes > 0);
    }
}

}  // namespace

void runInstrumentsTests()
{
    RUN(aGitHubArchiveIsUnpackedWithoutItsTopFolder);
    RUN(aFlatArchiveKeepsItsLayout);
    RUN(aNameOutsideTheFolderIsRefusedAndNothingIsLeft);
    RUN(theHashIsTheFilesSha256);
    RUN(everyInstrumentIsPinned);
}
