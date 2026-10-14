// Identity.h — the engine's stable local identity, `<state>/engine-id.json`: a persistent id and a
// secret token, handed to the C++ engine and echoed on `whoami`, so a lookalike listener cannot
// produce the real token and the registry can refuse it. A per-engine secret, not a user's.

#pragma once

#include <string>

namespace k7 {

struct EngineIdentity {
    std::string id;
    std::string token;
    std::string createdAt;
};

/** Read the persisted identity or mint and write one, so a machine keeps its id across restarts. */
EngineIdentity ensureEngineIdentity();

/** A random RFC 4122 version-4 UUID. */
std::string randomUuid();

/** `n` random bytes as lowercase hex. */
std::string randomHex(size_t n);

}  // namespace k7
