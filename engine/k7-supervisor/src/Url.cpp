// Url.cpp — see Url.h. Only the "special" schemes the WHATWG spec treats as hierarchical get an
// authority; any other scheme parses, has an origin of "null", and so is refused where one is asked.

#include "Url.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>

namespace k7::url {

namespace {

const std::string kK7Port = "8789";

/** k7's loopback port: `k7=` in `$STUDIO_PORTS` when a host moved it (services.ts's `servicePorts`), else 8789. */
std::string k7Port()
{
    const char* env = std::getenv("STUDIO_PORTS");
    if (!env) return kK7Port;
    const std::string spec(env);
    for (size_t start = 0; start <= spec.size();) {
        const size_t comma = spec.find(',', start);
        const std::string pair = spec.substr(start, comma == std::string::npos ? std::string::npos : comma - start);
        if (const size_t eq = pair.find('='); eq != std::string::npos) {
            const std::string name = pair.substr(0, eq);
            const std::string value = pair.substr(eq + 1);
            const bool digits = !value.empty() && value.size() <= 5 &&
                                std::all_of(value.begin(), value.end(), [](unsigned char c) { return std::isdigit(c); });
            if (name == "k7" && digits && std::stoi(value) > 0 && std::stoi(value) < 65536) return value;
        }
        if (comma == std::string::npos) break;
        start = comma + 1;
    }
    return kK7Port;
}

std::string lower(std::string s)
{
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); });
    return s;
}

std::string trim(const std::string& s)
{
    size_t a = 0, b = s.size();
    while (a < b && static_cast<unsigned char>(s[a]) <= ' ') ++a;
    while (b > a && static_cast<unsigned char>(s[b - 1]) <= ' ') --b;
    return s.substr(a, b - a);
}

std::string defaultPort(const std::string& scheme)
{
    if (scheme == "http" || scheme == "ws") return "80";
    if (scheme == "https" || scheme == "wss") return "443";
    if (scheme == "ftp") return "21";
    return "";
}

bool special(const std::string& scheme)
{
    return scheme == "http" || scheme == "https" || scheme == "ws" || scheme == "wss" || scheme == "ftp" ||
           scheme == "file";
}

/** The characters a host may not contain, as Node's parser refuses them. */
bool forbiddenHostChar(char c)
{
    static const std::string bad = " #%/:<>?@[\\]^|\t\r\n";
    return bad.find(c) != std::string::npos || static_cast<unsigned char>(c) < 0x20 || c == 0x7f;
}

/** `play.` and `k7.` (the alias hosts) stripped back off, giving k7's own hostname. */
std::string k7Hostname(const std::string& hostname)
{
    for (const char* label : {"play.", "k7."}) {
        const std::string prefix(label);
        if (hostname.rfind(prefix, 0) == 0) return hostname.substr(prefix.size());
    }
    return hostname;
}

}  // namespace

std::string Url::host() const { return port.empty() ? hostname : hostname + ":" + port; }

std::string Url::origin() const
{
    if (scheme != "http" && scheme != "https" && scheme != "ws" && scheme != "wss" && scheme != "ftp") return "null";
    return scheme + "://" + host();
}

std::optional<Url> parse(const std::string& raw)
{
    const std::string s = trim(raw);
    const size_t colon = s.find(':');
    if (colon == std::string::npos || colon == 0 || !std::isalpha(static_cast<unsigned char>(s[0]))) return std::nullopt;
    for (size_t i = 0; i < colon; ++i) {
        const char c = s[i];
        if (!std::isalnum(static_cast<unsigned char>(c)) && c != '+' && c != '-' && c != '.') return std::nullopt;
    }
    Url u;
    u.scheme = lower(s.substr(0, colon));
    std::string rest = s.substr(colon + 1);
    if (!special(u.scheme)) {
        u.path = rest;
        return u;
    }
    size_t i = 0;
    while (i < rest.size() && (rest[i] == '/' || rest[i] == '\\')) ++i;
    const size_t end = rest.find_first_of("/\\?#", i);
    std::string authority = rest.substr(i, end == std::string::npos ? std::string::npos : end - i);
    u.path = end == std::string::npos ? "/" : rest.substr(end);
    if (u.path[0] == '\\') u.path[0] = '/';
    if (u.path[0] == '?' || u.path[0] == '#') u.path = "/" + u.path;

    if (const size_t at = authority.rfind('@'); at != std::string::npos) {
        const std::string info = authority.substr(0, at);
        authority = authority.substr(at + 1);
        const size_t c = info.find(':');
        u.username = info.substr(0, c);
        if (c != std::string::npos) u.password = info.substr(c + 1);
    }
    std::string host = authority;
    std::string port;
    if (!host.empty() && host[0] == '[') {
        const size_t close = host.find(']');
        if (close == std::string::npos) return std::nullopt;
        if (close + 1 < host.size()) {
            if (host[close + 1] != ':') return std::nullopt;
            port = host.substr(close + 2);
        }
        host = host.substr(0, close + 1);
    } else if (const size_t c = host.rfind(':'); c != std::string::npos) {
        port = host.substr(c + 1);
        host = host.substr(0, c);
        for (char ch : host)
            if (forbiddenHostChar(ch)) return std::nullopt;
    } else {
        for (char ch : host)
            if (forbiddenHostChar(ch)) return std::nullopt;
    }
    if (host.empty() && u.scheme != "file") return std::nullopt;
    if (!port.empty()) {
        if (port.size() > 5 || !std::all_of(port.begin(), port.end(), [](unsigned char c) { return std::isdigit(c); }))
            return std::nullopt;
        const long n = std::stol(port);
        if (n > 65535) return std::nullopt;
        port = std::to_string(n);
        if (port == defaultPort(u.scheme)) port.clear();
    }
    u.hostname = lower(host);
    u.port = port;
    return u;
}

bool isLoopbackHost(const std::string& h)
{
    if (h == "localhost" || h == "[::1]") return true;
    if (h.rfind("127.", 0) != 0) return false;
    int dots = 0;
    size_t run = 0;
    for (size_t i = 4; i <= h.size(); ++i) {
        if (i == h.size() || h[i] == '.') {
            if (run == 0 || run > 3) return false;
            if (i < h.size()) ++dots;
            run = 0;
        } else if (std::isdigit(static_cast<unsigned char>(h[i]))) {
            ++run;
        } else {
            return false;
        }
    }
    return dots == 2;
}

std::string serviceUrl(const std::string& origin, const std::string& service)
{
    const auto u = parse(origin);
    if (!u) return "";
    const std::string base = k7Hostname(u->hostname);
    // pl8 is served by k7's own process, so every service shares k7's address.
    const std::string root = base == u->hostname ? u->origin() : u->scheme + "://" + base;
    return service == "z0" ? root + "/z0" : root;
}

std::string studioFamily(const std::string& raw)
{
    const auto u = parse(raw);
    if (!u) return "";
    if (isLoopbackHost(u->hostname)) return u->scheme + "://" + u->hostname;
    return serviceUrl(u->origin(), "k7");
}

std::string engineRegistryUrl(const std::string& raw)
{
    const auto u = parse(raw);
    if (!u || (u->scheme != "http" && u->scheme != "https")) return "";
    if (isLoopbackHost(u->hostname)) return u->scheme + "://" + u->hostname + ":" + k7Port();
    return serviceUrl(u->origin(), "k7");
}

std::optional<std::string> normaliseUserOrigin(const std::string& input)
{
    const std::string raw = trim(input);
    if (raw.empty()) return std::nullopt;
    const auto u = parse(raw.find("://") != std::string::npos ? raw : "https://" + raw);
    if (!u || (u->scheme != "http" && u->scheme != "https")) return std::nullopt;
    // Rejected, not dropped: a URL carrying credentials is not an address somebody meant.
    if (!u->username.empty() || !u->password.empty()) return std::nullopt;
    if (u->hostname.empty() || u->hostname.find('*') != std::string::npos) return std::nullopt;
    return u->origin();
}

std::string cacheKey(const std::string& registryUrl)
{
    const auto u = parse(registryUrl);
    std::string key = u ? u->host() : registryUrl;
    for (char& c : key)
        if (!std::isalnum(static_cast<unsigned char>(c)) && c != '.' && c != '-') c = '_';
    return key;
}

std::string join(const std::string& base, const std::string& path)
{
    std::string b = base;
    if (!b.empty() && b.back() == '/') b.pop_back();
    return b + path;
}

}  // namespace k7::url
