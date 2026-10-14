// Registry.h — presence at the studios this engine is connected to: a heartbeat every few seconds so
// a server can list it, a deregister so Stop drops it at once, and the hello that proves an address
// IS a registry before anything carrying the engine's token goes there. Always pl8's registry, one
// per family. Blocking: called through `Loop::work`. See docs/supervisor.md.

#pragma once

#include "Identity.h"

#include <nlohmann/json.hpp>

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

/** Announce to every registry in parallel. Never throws: a payload that will not serialise is an outcome too. */
Result heartbeat(const std::vector<std::string>& urls, const EngineIdentity& id, const nlohmann::json& presence);

/** Leave every registry, in parallel; bounded, since it runs while somebody waits to quit. */
Result deregister(const std::vector<std::string>& urls, const EngineIdentity& id);

}  // namespace k7::registry
