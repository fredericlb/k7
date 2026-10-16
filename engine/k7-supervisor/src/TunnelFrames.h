// TunnelFrames.h — the tunnel's wire, the C++ twin of packages/engine-tunnel/frames.ts: JSON control
// messages as TEXT frames, and anything carrying bytes as a BINARY frame whose first four bytes give,
// big-endian, the length of a JSON header, the payload following. Two spellings of one wire, so the
// conformance suite in engine-tunnel runs against both agents.

#pragma once

#include <nlohmann/json.hpp>

#include <optional>
#include <string>

namespace k7::tunnel {

/** Where the hub listens, under the registry's own `/api`. */
inline const std::string kPath = "/api/engine-tunnel";
/** The engine's token rides in a header, never the query, so no access log keeps it. */
inline const std::string kTokenHeader = "x-studio-engine-token";
/** The machine's tunnel secret, the credential the registry binds the id to; never the engine's, never a browser's. */
inline const std::string kSecretHeader = "x-studio-tunnel-secret";
/** The server's render machine proves itself with this one, a key the deployment shares — never the engine's token. */
inline const std::string kRenderKeyHeader = "x-studio-render-key";
/** File chunks are cut to this, so one large take never holds the socket for long. */
constexpr size_t kChunkBytes = 256 * 1024;
/** Past this many unsent bytes an upload waits; small, since every other channel's frames queue behind it (packages/engine-tunnel/docs/tunnel.md). */
constexpr size_t kHighWaterBytes = 1024 * 1024;

/** A binary frame: the header, then the payload. */
std::string encodeBinary(const nlohmann::json& header, const std::string& payload);

struct Binary {
    nlohmann::json header;
    std::string payload;
};

/** Null for a frame too short or a header that is not JSON. */
std::optional<Binary> decodeBinary(const std::string& frame);

/** `https://h/x` → `wss://h/x/api/engine-tunnel?id=…`. */
std::string tunnelUrl(const std::string& registryUrl, const std::string& id);

}  // namespace k7::tunnel
