// Registry.cpp — see Registry.h. The hello's path and answer are REGISTRY_HELLO_PATH and
// REGISTRY_SERVICE in packages/web-protocol/services.ts.

#include "Registry.h"

#include "Http.h"
#include "Url.h"

#include <algorithm>
#include <cstdlib>
#include <future>

namespace st0::registry {

namespace {

const std::string kHelloPath = "/api/registry/hello";
const std::string kService = "st0-registry";

std::vector<std::string> asRegistries(const std::vector<std::string>& urls)
{
    std::vector<std::string> out;
    for (const auto& u : urls) {
        const auto r = url::engineRegistryUrl(u);
        if (!r.empty() && std::find(out.begin(), out.end(), r) == out.end()) out.push_back(r);
    }
    return out;
}

bool post(const std::string& base, const std::string& path, const nlohmann::json& body)
{
    http::Request r;
    r.method = "POST";
    r.url = url::join(base, path);
    r.body = body.dump();
    r.contentType = "application/json";
    // Not up yet, or too slow to matter: the next tick retries.
    return http::send(r).ok();
}

/** `post` to every url at once, true when all of them answered. */
bool all(const std::vector<std::string>& urls, const std::string& path, const nlohmann::json& body)
{
    std::vector<std::future<bool>> calls;
    for (const auto& u : urls) calls.push_back(std::async(std::launch::async, [u, path, body] { return post(u, path, body); }));
    bool ok = true;
    for (auto& c : calls) ok = c.get() && ok;
    return ok;
}

}  // namespace

std::vector<std::string> resolve(const std::vector<std::string>& configured)
{
    if (!configured.empty()) return asRegistries(configured);
    std::vector<std::string> fromEnv;
    if (const char* env = std::getenv("STUDIO_REGISTRY_URL"); env && *env) {
        std::string s(env);
        for (size_t start = 0; start <= s.size();) {
            const size_t comma = s.find(',', start);
            fromEnv.push_back(s.substr(start, comma == std::string::npos ? std::string::npos : comma - start));
            if (comma == std::string::npos) break;
            start = comma + 1;
        }
    }
    return asRegistries(fromEnv);
}

Probe probe(const std::string& base)
{
    http::Request r;
    r.url = url::join(base, kHelloPath);
    // Longer than a heartbeat's bound: somebody waits on the form, and a slow first handshake is not a "no".
    r.timeoutSeconds = 5;
    r.followRedirects = false;
    const auto res = http::send(r);
    // The cause rides along: a refused certificate and a missing host must not read alike.
    if (res.status == 0) return {false, base + " did not answer (" + res.error + ")"};
    if (res.status >= 300 && res.status < 400) return {false, base + " did not answer (it redirects)"};
    if (res.ok()) {
        auto body = nlohmann::json::parse(res.body, nullptr, false);
        if (body.is_object() && body.value("service", "") == kService) return {true, ""};
    }
    return {false, base + " is not an st0 instance"};
}

bool heartbeat(const std::vector<std::string>& urls, const EngineIdentity& id, const nlohmann::json& presence)
{
    if (urls.empty()) return false;
    nlohmann::json body = presence;
    body["id"] = id.id;
    body["token"] = id.token;
    return all(urls, "/api/registry/heartbeat", body);
}

bool deregister(const std::vector<std::string>& urls, const EngineIdentity& id)
{
    return all(urls, "/api/registry/deregister", {{"id", id.id}, {"token", id.token}});
}

}  // namespace st0::registry
