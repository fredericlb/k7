// Identity.h — the engine's stable local identity, `<state>/engine-id.json`: a persistent id, a
// token handed to the C++ engine and echoed on `whoami`, and a TUNNEL SECRET only this supervisor
// ever sends — to the registries it heartbeats and tunnels to, never to the engine nor a browser.
// The registry binds the id to the first secret it sees (packages/engine-registry/docs/token.md).
// The file is the owner's alone: 0600, in a 0700 folder when this creates it.

#pragma once

#include <string>

namespace k7 {

struct EngineIdentity {
    std::string id;
    std::string token;
    /** Never logged, never echoed, never handed to the engine process. */
    std::string tunnelSecret;
    std::string createdAt;
};

/** Read the persisted identity or mint and write one, so a machine keeps its id across restarts. */
EngineIdentity ensureEngineIdentity();

/** A random RFC 4122 version-4 UUID. */
std::string randomUuid();

/** `n` random bytes as lowercase hex. */
std::string randomHex(size_t n);

}  // namespace k7
