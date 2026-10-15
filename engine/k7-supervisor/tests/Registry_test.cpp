// Registry_test.cpp — what a heartbeat reports when it does not land. No registry is needed: a
// closed loopback port refuses at once, which is all these cases ask of the network.

#include "Registry.h"

#include "test_harness.h"

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

}  // namespace

void runRegistryTests()
{
    RUN(aRefusalIsAnOutcomeWithItsReason);
    RUN(aHostnameThatIsNotUtf8IsSentAnyway);
    RUN(noRegistryIsNotOk);
}
