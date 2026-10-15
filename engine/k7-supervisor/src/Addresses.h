// Addresses.h — what the heartbeat advertises: the hostname, a coarse machine fingerprint, and the
// IPv4s a browser on the LAN could dial. The fingerprint is a hint the registry never deduplicates
// on; the authoritative answer is a browser reaching an address and matching the engine's id.
// The shape is web-protocol's EngineAddresses. See docs/supervisor.md.

#pragma once

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

namespace k7::addresses {

/** Interfaces that reach no browser — VPNs, container bridges, WSL, Hyper-V — matched by NAME. */
bool phantomInterface(const std::string& name);

/** `{ hostname, machineFingerprint, port, addresses: { loopback, lanIps, port } }`. */
nlohmann::json presence(int port);

}  // namespace k7::addresses
