// Url.h — the URL rules the supervisor shares with the web apps: which registry a typed address
// means, which studio family it belongs to, what a server's cache folder is called. The C++ twin
// of packages/web-protocol/services.ts; the tests replay its cases,
// since two spellings of one rule is what makes an engine heartbeat to the wrong place.

#pragma once

#include <optional>
#include <string>

namespace st0::url {

/** A parsed absolute URL — the WHATWG rules for http(s)/ws(s), which is all this program dials. */
struct Url {
    std::string scheme;  // lowercase, no colon
    std::string username;
    std::string password;
    std::string hostname;  // lowercase; IPv6 keeps its brackets
    std::string port;  // "" when absent or the scheme's default
    std::string path;  // from the first '/', query and fragment included
    /** `scheme://host[:port]` — "null" for a scheme with no origin. */
    std::string origin() const;
    /** `host[:port]`. */
    std::string host() const;
};

/** Parse like Node's `new URL(s)`, or nothing where that would throw. */
std::optional<Url> parse(const std::string& s);

/** Whether `hostname` is one where services are ports rather than subdomains. */
bool isLoopbackHost(const std::string& hostname);

/** Where `service` ("st0" | "pl8" | "k7" | "z0") answers, given any URL of its family — st0's origin, z0 a path; "" for a non-URL. */
std::string serviceUrl(const std::string& origin, const std::string& service);

/** The family key: st0's origin, or the bare scheme and host on loopback; "" for a non-URL. */
std::string studioFamily(const std::string& url);

/** The ONE engine registry — the family root — for any URL of a family; "" for a non-URL or a non-web scheme. */
std::string engineRegistryUrl(const std::string& url);

/** What the user typed, reduced to a bare origin, strictly; a bare host gets `https://`. */
std::optional<std::string> normaliseUserOrigin(const std::string& input);

/** A folder name for a server, from its host: `pl8.example:443` → `pl8.example_443`. */
std::string cacheKey(const std::string& registryUrl);

/** `base` with any trailing slash removed, then `path` appended. */
std::string join(const std::string& base, const std::string& path);

}  // namespace st0::url
