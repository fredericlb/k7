// Url_test.cpp — the cases of packages/web-protocol/services.test.ts, replayed: the supervisor and
// the web apps must derive the same registry from the same text.

#include "Url.h"

#include "test_harness.h"

#include <cstdlib>

using namespace st0::url;

namespace {

void registryIsPl8sWhicheverServiceWasNamed()
{
    CHECK(engineRegistryUrl("https://st0.app") == "https://play.st0.app");
    CHECK(engineRegistryUrl("https://st0.app/band/winter.st0") == "https://play.st0.app");
    CHECK(engineRegistryUrl("https://play.st0.app") == "https://play.st0.app");
    CHECK(engineRegistryUrl("https://k7.st0.app") == "https://play.st0.app");
}

void registryOnLoopbackIsPl8sPort()
{
    CHECK(engineRegistryUrl("http://localhost:8789") == "http://localhost:8795");
    CHECK(engineRegistryUrl("http://127.0.0.1:5223") == "http://127.0.0.1:8795");
}

void setPorts(const char* spec)
{
#ifdef _WIN32
    _putenv_s("STUDIO_PORTS", spec);
#else
    if (*spec) setenv("STUDIO_PORTS", spec, 1);
    else unsetenv("STUDIO_PORTS");
#endif
}

void registryOnLoopbackFollowsMovedPorts()
{
    setPorts("st0=18789,pl8=18795");
    CHECK(engineRegistryUrl("http://127.0.0.1:18795") == "http://127.0.0.1:18795");
    CHECK(engineRegistryUrl("http://localhost:18789") == "http://localhost:18795");
    setPorts("pl8=nope");
    CHECK(engineRegistryUrl("http://127.0.0.1:18795") == "http://127.0.0.1:8795");
    setPorts("");
}

void registryOfNonUrlIsEmpty()
{
    CHECK(engineRegistryUrl("not a url").empty());
    CHECK(engineRegistryUrl("ftp://st0.app").empty());
}

void familyIsSt0sOrigin()
{
    CHECK(studioFamily("https://play.st0.app/library") == "https://st0.app");
    CHECK(studioFamily("https://st0.app") == "https://st0.app");
    CHECK(studioFamily("http://localhost:8795") == "http://localhost");
    CHECK(studioFamily("http://localhost:8789") == "http://localhost");
    CHECK(studioFamily("not a url").empty());
}

void userOriginIsStrict()
{
    CHECK(normaliseUserOrigin("st0.app") == std::optional<std::string>("https://st0.app"));
    CHECK(normaliseUserOrigin("  https://Daw.Test:443/path?q=1 ") == std::optional<std::string>("https://daw.test"));
    CHECK(normaliseUserOrigin("http://localhost:8789/x") == std::optional<std::string>("http://localhost:8789"));
    CHECK(!normaliseUserOrigin("ftp://daw.test"));
    CHECK(!normaliseUserOrigin("https://user:pw@daw.test"));
    CHECK(!normaliseUserOrigin("https://*.daw.test"));
    CHECK(!normaliseUserOrigin("   "));
    CHECK(!normaliseUserOrigin("https://bad host"));
}

void cacheKeyIsTheHost()
{
    CHECK(cacheKey("https://pl8.priv.frediver.se:8443/api") == "pl8.priv.frediver.se_8443");
    CHECK(cacheKey("https://play.st0.app") == "play.st0.app");
    CHECK(cacheKey("http://[::1]:8795") == "___1__8795");
}

void loopbackHosts()
{
    CHECK(isLoopbackHost("localhost"));
    CHECK(isLoopbackHost("127.0.0.1"));
    CHECK(isLoopbackHost("127.10.2.3"));
    CHECK(isLoopbackHost("[::1]"));
    CHECK(!isLoopbackHost("127.0.0"));
    CHECK(!isLoopbackHost("128.0.0.1"));
}

}  // namespace

void runUrlTests()
{
    RUN(registryIsPl8sWhicheverServiceWasNamed);
    RUN(registryOnLoopbackIsPl8sPort);
    RUN(registryOnLoopbackFollowsMovedPorts);
    RUN(registryOfNonUrlIsEmpty);
    RUN(familyIsSt0sOrigin);
    RUN(userOriginIsStrict);
    RUN(cacheKeyIsTheHost);
    RUN(loopbackHosts);
}
