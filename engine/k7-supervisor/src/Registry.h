// Registry.h — presence at the studios this engine is connected to: a heartbeat every few seconds so
// a server can list it, a deregister so Stop drops it at once, and the hello that proves an address
// IS a registry before anything carrying the engine's token goes there. Always pl8's registry, one
// per family. Blocking: called through `Loop::work`. See docs/supervisor.md.

#pragma once

#include "Identity.h"

#include <nlohmann/json.hpp>

#include <map>
#include <string>
#include <vector>

namespace k7::registry {

/** What the user added, else `$STUDIO_REGISTRY_URL`, else nothing — each as its family's pl8, deduped. */
std::vector<std::string> resolve(const std::vector<std::string>& configured);

struct Probe {
    bool ok = false;
    std::string why;
};

/** Ask `url` whether it IS an engine registry; a redirect is refused, not followed. */
Probe probe(const std::string& url);

/** What one registry answered: its status (0 when nothing did) and, when it refused, why in one line. */
struct Outcome {
    std::string url;
    bool ok = false;
    int status = 0;
    std::string detail;
};

/** Every registry's outcome; `ok()` only when they ALL answered — the snapshot shows one light. */
struct Result {
    std::vector<Outcome> outcomes;
    bool ok() const;
};

/** Announce to every registry in parallel, with the id's token and tunnel secret. Never throws: a payload that will not serialise is an outcome too. */
/** What proves this machine to a studio that lists paired machines only (packages/engine-registry/docs/heartbeat.md). */
struct Credentials {
    /** By registry URL, as the settings keep them. */
    std::map<std::string, std::string> deviceTokens;
    /** `$STUDIO_DEVICE_TOKEN`: sent only when the registries themselves come from the environment. */
    std::string envToken;
    /** `$STUDIO_RENDER_KEY`: the server's own engine, which no account paired. */
    std::string renderKey;
};

Result heartbeat(const std::vector<std::string>& urls, const EngineIdentity& id, const nlohmann::json& presence,
                 const Credentials& cred = {});

/** Leave every registry, in parallel; bounded, since it runs while somebody waits to quit. */
Result deregister(const std::vector<std::string>& urls, const EngineIdentity& id);

}  // namespace k7::registry
