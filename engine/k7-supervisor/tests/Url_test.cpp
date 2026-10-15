// Url_test.cpp — the cases of packages/web-protocol/services.test.ts, replayed: the supervisor and
// the web apps must derive the same registry from the same text.

#include "EngineProcess.h"
#include "Url.h"

#include "test_harness.h"

#include <cstdlib>

using namespace k7::url;

namespace {

void registryIsTheFamilyRootWhicheverServiceWasNamed()
{
    CHECK(engineRegistryUrl("https://st0.app") == "https://st0.app");
    CHECK(engineRegistryUrl("https://st0.app/band/winter.k7") == "https://st0.app");
    CHECK(engineRegistryUrl("https://play.st0.app") == "https://st0.app");
    CHECK(engineRegistryUrl("https://k7.st0.app") == "https://st0.app");
}

void registryOnLoopbackIsK7sPort()
{
    CHECK(engineRegistryUrl("http://localhost:8080") == "http://localhost:8789");
    CHECK(engineRegistryUrl("http://127.0.0.1:5223") == "http://127.0.0.1:8789");
}

void pl8AndK7ResolveToK7sOrigin()
{
    CHECK(serviceUrl("https://st0.app", "pl8") == "https://st0.app");
    CHECK(serviceUrl("https://play.priv.st0.app/songs/a", "pl8") == "https://priv.st0.app");
    CHECK(serviceUrl("https://st0.app", "k7") == "https://st0.app");
    CHECK(serviceUrl("https://k7.priv.st0.app", "k7") == "https://priv.st0.app");
    CHECK(serviceUrl("https://k7.st0.app/session/1", "k7") == "https://st0.app");
    CHECK(serviceUrl("https://k7.priv.st0.app", "z0") == "https://priv.st0.app/z0");
    CHECK(serviceUrl("http://localhost:5223", "k7") == "http://localhost:5223");
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
    setPorts("k7=18789,pl8=18795");
    CHECK(engineRegistryUrl("http://127.0.0.1:5223") == "http://127.0.0.1:18789");
    CHECK(engineRegistryUrl("http://localhost:18789") == "http://localhost:18789");
    setPorts("k7=nope");
    CHECK(engineRegistryUrl("http://127.0.0.1:18789") == "http://127.0.0.1:8789");
    setPorts("");
}

void registryOfNonUrlIsEmpty()
{
    CHECK(engineRegistryUrl("not a url").empty());
    CHECK(engineRegistryUrl("ftp://st0.app").empty());
}

void familyIsK7sOrigin()
{
    CHECK(studioFamily("https://play.st0.app/library") == "https://st0.app");
    CHECK(studioFamily("https://st0.app") == "https://st0.app");
    CHECK(studioFamily("http://localhost:8080") == "http://localhost");
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

// The engine lets in the pages of the studios it is listed at: their origins, once each, nothing else.
void engineOriginsAreTheStudios()
{
    CHECK(k7::engine::allowedOrigins({"https://studio.example.org/", "http://studio.lan:8080", "https://studio.example.org",
                                      "not a url", "ftp://x.example"}) == "https://studio.example.org,http://studio.lan:8080");
    CHECK(k7::engine::allowedOrigins({}).empty());
}

}  // namespace

void runUrlTests()
{
    RUN(registryIsTheFamilyRootWhicheverServiceWasNamed);
    RUN(registryOnLoopbackIsK7sPort);
    RUN(pl8AndK7ResolveToK7sOrigin);
    RUN(registryOnLoopbackFollowsMovedPorts);
    RUN(registryOfNonUrlIsEmpty);
    RUN(familyIsK7sOrigin);
    RUN(userOriginIsStrict);
    RUN(cacheKeyIsTheHost);
    RUN(loopbackHosts);
    RUN(engineOriginsAreTheStudios);
}
