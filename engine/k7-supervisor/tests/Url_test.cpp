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
    CHECK(engineRegistryUrl("https://app.k7.rocks") == "https://app.k7.rocks");
    CHECK(engineRegistryUrl("https://app.k7.rocks/band/winter.k7") == "https://app.k7.rocks");
    CHECK(engineRegistryUrl("https://docs.k7.rocks") == "https://app.k7.rocks");
}

// A supervisor saved one of these before the move; each must still heartbeat the current origin.
void formerHostsAreTheCurrentOrigin()
{
    CHECK(engineRegistryUrl("https://st0.app") == "https://app.k7.rocks");
    CHECK(engineRegistryUrl("https://play.st0.app") == "https://app.k7.rocks");
    CHECK(engineRegistryUrl("https://k7.st0.app") == "https://app.k7.rocks");
    CHECK(serviceUrl("https://play.priv.st0.app/songs/a", "pl8") == "https://app.priv.k7.rocks");
    CHECK(serviceUrl("https://k7.rocks", "k7") == "https://k7.rocks");
}

void registryOnLoopbackIsK7sPort()
{
    CHECK(engineRegistryUrl("http://localhost:8080") == "http://localhost:8789");
    CHECK(engineRegistryUrl("http://127.0.0.1:5223") == "http://127.0.0.1:8789");
}

void pl8AndK7ResolveToK7sOrigin()
{
    CHECK(serviceUrl("https://app.k7.rocks", "pl8") == "https://app.k7.rocks");
    CHECK(serviceUrl("https://app.priv.k7.rocks/songs/a", "pl8") == "https://app.priv.k7.rocks");
    CHECK(serviceUrl("https://app.k7.rocks", "k7") == "https://app.k7.rocks");
    CHECK(serviceUrl("https://docs.priv.k7.rocks", "k7") == "https://app.priv.k7.rocks");
    CHECK(serviceUrl("https://k7.st0.app/session/1", "k7") == "https://app.k7.rocks");
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
    CHECK(engineRegistryUrl("ftp://app.k7.rocks").empty());
}

void familyIsK7sOrigin()
{
    CHECK(studioFamily("https://play.st0.app/library") == "https://app.k7.rocks");
    CHECK(studioFamily("https://app.k7.rocks") == "https://app.k7.rocks");
    CHECK(studioFamily("http://localhost:8080") == "http://localhost");
    CHECK(studioFamily("http://localhost:8789") == "http://localhost");
    CHECK(studioFamily("not a url").empty());
}

void userOriginIsStrict()
{
    CHECK(normaliseUserOrigin("app.k7.rocks") == std::optional<std::string>("https://app.k7.rocks"));
    CHECK(normaliseUserOrigin("  https://Daw.Test:443/path?q=1 ") == std::optional<std::string>("https://daw.test"));
    CHECK(normaliseUserOrigin("http://localhost:8789/x") == std::optional<std::string>("http://localhost:8789"));
    CHECK(!normaliseUserOrigin("ftp://daw.test"));
    CHECK(!normaliseUserOrigin("https://user:pw@daw.test"));
    CHECK(!normaliseUserOrigin("https://*.daw.test"));
    CHECK(!normaliseUserOrigin("   "));
    CHECK(!normaliseUserOrigin("https://bad host"));
}

// A heartbeat carries the token and the tunnel secret, so plain http goes only where nobody can listen.
void plaintextOnlyToLoopbackOrTheAllowlist()
{
    CHECK(plaintextRefusal("https://app.k7.rocks", "").empty());
    CHECK(plaintextRefusal("wss://app.k7.rocks/api/tunnel", "").empty());
    CHECK(plaintextRefusal("http://localhost:8789", "").empty());
    CHECK(plaintextRefusal("ws://127.0.0.1:8789/x", "").empty());
    CHECK(plaintextRefusal("http://[::1]:8789", "").empty());
    CHECK(!plaintextRefusal("http://app.k7.rocks", "").empty());
    CHECK(!plaintextRefusal("ws://studio.lan:8080", "").empty());
    CHECK(!plaintextRefusal("http://192.168.1.2:8789", "").empty());
    CHECK(!plaintextRefusal("ftp://app.k7.rocks", "k7").empty());
    CHECK(!plaintextRefusal("not a url", "").empty());
    CHECK(plaintextRefusal("http://k7:8789", "k7").empty());
    CHECK(plaintextRefusal("ws://K7:8789/api", " other , K7 ").empty());
    CHECK(plaintextRefusal("http://studio.lan:8080", "studio.lan:8080").empty());
    CHECK(!plaintextRefusal("http://studio.lan:9090", "studio.lan:8080").empty());
    CHECK(!plaintextRefusal("http://k7.evil:8789", "k7").empty());
}

void cacheKeyIsTheHost()
{
    CHECK(cacheKey("https://pl8.priv.frediver.se:8443/api") == "pl8.priv.frediver.se_8443");
    CHECK(cacheKey("https://app.k7.rocks") == "app.k7.rocks");
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
    RUN(formerHostsAreTheCurrentOrigin);
    RUN(registryOnLoopbackIsK7sPort);
    RUN(pl8AndK7ResolveToK7sOrigin);
    RUN(registryOnLoopbackFollowsMovedPorts);
    RUN(registryOfNonUrlIsEmpty);
    RUN(familyIsK7sOrigin);
    RUN(userOriginIsStrict);
    RUN(plaintextOnlyToLoopbackOrTheAllowlist);
    RUN(cacheKeyIsTheHost);
    RUN(loopbackHosts);
    RUN(engineOriginsAreTheStudios);
}
