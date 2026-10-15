// Registry.cpp — see Registry.h. The hello's path and answer are REGISTRY_HELLO_PATH and
// REGISTRY_SERVICE in packages/web-protocol/services.ts.

#include "Registry.h"

#include "Http.h"
#include "Url.h"

#include <algorithm>
#include <cstdlib>
#include <future>

namespace k7::registry {

namespace {

const std::string kHelloPath = "/api/registry/hello";
const std::string kService = "k7-registry";

std::vector<std::string> asRegistries(const std::vector<std::string>& urls)
{
    std::vector<std::string> out;
    for (const auto& u : urls) {
        const auto r = url::engineRegistryUrl(u);
        if (!r.empty() && std::find(out.begin(), out.end(), r) == out.end()) out.push_back(r);
    }
    return out;
}

/** What one registry answered, cut to a line: a 400's body names the field it refused. */
std::string detailOf(const http::Response& res)
{
    if (res.status == 0) return "no answer (" + (res.error.empty() ? std::string("timed out") : res.error) + ")";
    std::string body = res.body;
    for (char& c : body)
        if (c == '\n' || c == '\r') c = ' ';
    if (body.size() > 300) body = body.substr(0, 300) + "…";
    return "HTTP " + std::to_string(res.status) + (body.empty() ? "" : " " + body);
}

Outcome post(const std::string& base, const std::string& path, const nlohmann::json& body)
{
    Outcome o{base, false, 0, ""};
    try {
        http::Request r;
        r.method = "POST";
        r.url = url::join(base, path);
        // `replace`, never the default `strict`: one byte of a hostname in the ANSI code page must
        // not turn every heartbeat into an exception nobody sees (docs/supervisor.md).
        r.body = body.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
        r.contentType = "application/json";
        const auto res = http::send(r);
        o.status = res.status;
        o.ok = res.ok();
        if (!o.ok) o.detail = detailOf(res);
    } catch (const std::exception& e) {
        o.detail = std::string("could not send: ") + e.what();
    }
    return o;
}

/** `post` to every url at once, each one's outcome kept: the snapshot shows one light, the log says which. */
Result all(const std::vector<std::string>& urls, const std::string& path, const nlohmann::json& body)
{
    std::vector<std::future<Outcome>> calls;
    for (const auto& u : urls) calls.push_back(std::async(std::launch::async, [u, path, body] { return post(u, path, body); }));
    Result r;
    for (auto& c : calls) r.outcomes.push_back(c.get());
    return r;
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
    return {false, base + " is not an k7 instance"};
}

bool Result::ok() const
{
    if (outcomes.empty()) return false;
    for (const auto& o : outcomes)
        if (!o.ok) return false;
    return true;
}

Result heartbeat(const std::vector<std::string>& urls, const EngineIdentity& id, const nlohmann::json& presence)
{
    nlohmann::json body = presence;
    body["id"] = id.id;
    body["token"] = id.token;
    // Only to an address `probe` proved is a registry; the registry binds the id to it (packages/engine-registry/docs/token.md).
    if (!id.tunnelSecret.empty()) body["tunnelSecret"] = id.tunnelSecret;
    return all(urls, "/api/registry/heartbeat", body);
}

Result deregister(const std::vector<std::string>& urls, const EngineIdentity& id)
{
    nlohmann::json body{{"id", id.id}, {"token", id.token}};
    if (!id.tunnelSecret.empty()) body["tunnelSecret"] = id.tunnelSecret;
    return all(urls, "/api/registry/deregister", body);
}

}  // namespace k7::registry
