// Registry_test.cpp — what a heartbeat reports when it does not land, and the identity it sends:
// a tunnel secret minted once, kept beside the id in a file only its owner reads. No registry is
// needed: a closed loopback port refuses at once, which is all these cases ask of the network.

#include "Registry.h"

#include "Paths.h"
#include "test_harness.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>

using namespace k7;

namespace {

/** Port 1 on loopback: nothing listens there, so every call is a prompt refusal. */
const std::string kNobody = "http://127.0.0.1:1";

const EngineIdentity kId{"11111111-2222-4333-8444-555555555555", "abc123", ""};

void aRefusalIsAnOutcomeWithItsReason()
{
    const auto r = registry::heartbeat({kNobody}, kId, {{"hostname", "studio"}});
    CHECK(r.outcomes.size() == 1);
    CHECK(!r.ok());
    CHECK(r.outcomes[0].url == kNobody);
    CHECK(r.outcomes[0].status == 0);
    CHECK(r.outcomes[0].detail.rfind("no answer", 0) == 0);
}

void aHostnameThatIsNotUtf8IsSentAnyway()
{
    // "PC-FRÉDÉRIC" as Windows' ANSI code page spells it: the É is one byte, 0xC9, invalid in UTF-8.
    // The strict dump threw on it, and the heartbeat never left; it must reach the wire and fail THERE.
    const auto r = registry::heartbeat({kNobody}, kId, {{"hostname", std::string("PC-FR\xC9" "D\xC9RIC")}});
    CHECK(r.outcomes.size() == 1);
    CHECK(r.outcomes[0].detail.rfind("no answer", 0) == 0);
}

void noRegistryIsNotOk()
{
    // An engine listed nowhere is not "all registries answered".
    CHECK(!registry::heartbeat({}, kId, {}).ok());
}

/** Point the state dir at a fresh temporary folder for one test, and back after it. */
struct TempHome {
    std::filesystem::path dir;
    TempHome()
    {
        dir = std::filesystem::temp_directory_path() / ("k7-identity-test-" + randomHex(6));
        set(dir.string().c_str());
    }
    ~TempHome()
    {
        std::error_code ec;
        std::filesystem::remove_all(dir, ec);
        set(nullptr);
    }
    static void set(const char* v)
    {
#ifdef _WIN32
        _putenv_s("STUDIO_HOME", v ? v : "");
#else
        if (v) setenv("STUDIO_HOME", v, 1);
        else unsetenv("STUDIO_HOME");
#endif
    }
};

void anIdentityIsMintedWithASecretAndKept()
{
    TempHome home;
    const auto a = ensureEngineIdentity();
    CHECK(a.tunnelSecret.size() == 64);
    CHECK(a.tunnelSecret != a.token);
    const auto b = ensureEngineIdentity();
    CHECK(b.id == a.id);
    CHECK(b.token == a.token);
    CHECK(b.tunnelSecret == a.tunnelSecret);
#ifndef _WIN32
    namespace fs = std::filesystem;
    const auto others = fs::perms::group_all | fs::perms::others_all;
    CHECK((fs::status(paths::engineId()).permissions() & others) == fs::perms::none);
    CHECK((fs::status(home.dir).permissions() & others) == fs::perms::none);
#endif
}

void anOlderIdentityGainsASecretAndKeepsItsId()
{
    TempHome home;
    std::filesystem::create_directories(home.dir);
    {
        std::ofstream out(paths::engineId());
        out << R"({"id":"old-id","token":"old-token","createdAt":"2025-01-01T00:00:00.000Z"})";
    }
    const auto a = ensureEngineIdentity();
    CHECK(a.id == "old-id");
    CHECK(a.token == "old-token");
    CHECK(a.tunnelSecret.size() == 64);
    CHECK(ensureEngineIdentity().tunnelSecret == a.tunnelSecret);
}

}  // namespace

void runRegistryTests()
{
    RUN(anIdentityIsMintedWithASecretAndKept);
    RUN(anOlderIdentityGainsASecretAndKeepsItsId);
    RUN(aRefusalIsAnOutcomeWithItsReason);
    RUN(aHostnameThatIsNotUtf8IsSentAnyway);
    RUN(noRegistryIsNotOk);
}
