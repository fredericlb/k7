// Log_test.cpp — the merged log's rotation: a file past the limit is moved to `.1`, replacing the
// one there, and a file within it is left where it is.

#include "Log.h"

#include "test_harness.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>

namespace fs = std::filesystem;

namespace {

fs::path folder()
{
    const auto dir = fs::temp_directory_path() / ("k7-log-" + std::to_string(std::rand()));
    fs::remove_all(dir);
    fs::create_directories(dir);
    return dir;
}

std::string read(const fs::path& p)
{
    std::ifstream in(p, std::ios::binary);
    return {std::istreambuf_iterator<char>(in), {}};
}

void aLargeLogIsSetAside()
{
    const auto dir = folder();
    const auto log = dir / ".studio.log";
    const auto aside = dir / ".studio.log.1";
    std::ofstream(aside, std::ios::binary) << "older";
    std::ofstream(log, std::ios::binary) << "0123456789";
    CHECK(k7::log::rotate(log, 4));
    CHECK(!fs::exists(log));
    CHECK(read(aside) == "0123456789");
    fs::remove_all(dir);
}

void aSmallLogStays()
{
    const auto dir = folder();
    const auto log = dir / ".studio.log";
    std::ofstream(log, std::ios::binary) << "0123";
    CHECK(!k7::log::rotate(log, 4));
    CHECK(read(log) == "0123");
    CHECK(!fs::exists(dir / ".studio.log.1"));
    // An absent file is nothing to move.
    CHECK(!k7::log::rotate(dir / "absent.log", 0));
    fs::remove_all(dir);
}

}  // namespace

void runLogTests()
{
    RUN(aLargeLogIsSetAside);
    RUN(aSmallLogStays);
}
