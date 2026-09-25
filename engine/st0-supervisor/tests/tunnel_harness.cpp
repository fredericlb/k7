// tunnel_harness.cpp — the native tunnel agent alone, for packages/engine-tunnel's suites to drive
// against the real TypeScript hub: `tunnel_harness <registryUrl> <id> <token> <enginePort> <cacheDir>`.
// It answers the same two test jobs the TypeScript suite gives its own agent, and exits when stdin
// closes — the test's way of stopping it.

#include "Paths.h"
#include "Rtc.h"
#include "TunnelAgent.h"

#include <cctype>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

namespace fs = std::filesystem;
using namespace st0::tunnel;

int main(int argc, char** argv)
{
    if (argc != 6) {
        std::fprintf(stderr, "usage: tunnel_harness <registryUrl> <id> <token> <enginePort> <cacheDir>\n");
        return 2;
    }
    AgentOptions o;
    o.registryUrl = argv[1];
    o.id = argv[2];
    o.token = argv[3];
    o.enginePort = std::atoi(argv[4]);
    o.cacheDir = st0::paths::fromUtf8(argv[5]);
    o.log = [](const std::string& m) { std::fprintf(stderr, "tunnel | %s\n", m.c_str()); };
    // Answers the same path twice: once mapped back to the server's, once under `raw` as the machine's.
    o.jobs["where"] = [](const nlohmann::json& req, const Emit& emit, JobContext&) {
        const std::string source = req.value("source", "");
        emit({{"type", "where"}, {"path", source}, {"raw", {{"path", source}}}});
    };
    // Reads the source it was handed, writes one "stem" beside it, reporting progress first.
    o.jobs["upper"] = [](const nlohmann::json& req, const Emit& emit, JobContext&) {
        const fs::path source = st0::paths::fromUtf8(req.value("source", ""));
        const fs::path outDir = st0::paths::fromUtf8(req.value("outDir", ""));
        std::ifstream in(source, std::ios::binary);
        std::stringstream buf;
        buf << in.rdbuf();
        std::string text = buf.str();
        for (char& c : text) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        emit({{"type", "progress"}, {"percent", 50}});
        fs::create_directories(outDir);
        const fs::path out = outDir / (source.filename().string() + ".up");
        std::ofstream(out, std::ios::binary) << text;
        emit({{"type", "done"}, {"files", {st0::paths::utf8(out)}}});
    };
    const int port = o.enginePort;
    o.answerOffer = [port](const std::string& offer) {
        st0::rtc::Options r;
        r.enginePort = port;
        return st0::rtc::answerOffer(offer, r);
    };
    auto agent = TunnelAgent::create(o);
    agent->start();
    std::string line;
    while (std::getline(std::cin, line)) {}
    agent->stop();
    std::_Exit(0);
}
