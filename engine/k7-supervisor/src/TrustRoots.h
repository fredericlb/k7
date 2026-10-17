// TrustRoots.h — the certificates the OS trusts, as one PEM string for mbedTLS. Not a preference: a
// studio added from the app is routinely behind a local proxy with a private CA, which exists in
// the OS store and nowhere else, and without it every heartbeat fails the handshake SILENTLY — a
// registry that is down is not an error — so the engine never appears in that studio's picker.
// `$STUDIO_EXTRA_CA_CERTS` names a PEM file appended to the set. See docs/supervisor.md.

#pragma once

#include <ixwebsocket/IXSocketTLSOptions.h>

#include <string>

namespace k7::tls {

/** Every trusted root as PEM, read once and cached; empty when the platform gave none. */
const std::string& rootsPem();

/** Read the roots again at the next `rootsPem`: an embedded supervisor restarted in one process, with no TLS socket open. */
void forgetRoots();

/** How many certificates `rootsPem` holds, for the one log line that says TLS is set up. */
int rootCount();

/** What every TLS socket of this program dials with: those roots, and the peer always verified. */
ix::SocketTLSOptions options();

}  // namespace k7::tls
