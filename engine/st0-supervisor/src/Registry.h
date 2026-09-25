// Registry.h — presence at the studios this engine is connected to: a heartbeat every few seconds so
// a server can list it, a deregister so Stop drops it at once, and the hello that proves an address
// IS a registry before anything carrying the engine's token goes there. Always pl8's registry, one
// per family. Blocking: called through `Loop::work`. See docs/supervisor.md.

#pragma once

#include "Identity.h"

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

namespace st0::registry {

/** What the user added, else `$STUDIO_REGISTRY_URL`, else nothing — each as its family's pl8, deduped. */
std::vector<std::string> resolve(const std::vector<std::string>& configured);

struct Probe {
    bool ok = false;
    std::string why;
};

/** Ask `url` whether it IS an engine registry; a redirect is refused, not followed. */
Probe probe(const std::string& url);

/** Announce to every registry in parallel; true only if they ALL answered — the tray shows one light. */
bool heartbeat(const std::vector<std::string>& urls, const EngineIdentity& id, const nlohmann::json& presence);

/** Leave every registry, in parallel; bounded, since it runs while somebody waits to quit. */
bool deregister(const std::vector<std::string>& urls, const EngineIdentity& id);

}  // namespace st0::registry
