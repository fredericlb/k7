// Http.h — the one HTTP client, IXWebSocket's, over mbedTLS with the OS trust roots. Blocking by
// design: every call runs on a worker thread and is bounded, since a registry that connects and
// never answers is harmless on a heartbeat and fatal on the deregister that holds Quit open.

#pragma once

#include <string>

namespace st0::http {

struct Response {
    int status = 0;  // 0 when nothing answered
    std::string body;
    std::string error;
    bool ok() const { return status >= 200 && status < 300; }
};

struct Request {
    std::string method = "GET";
    std::string url;
    std::string body;
    std::string contentType;
    /** Whole seconds, the client's own unit; the connect and the transfer are each bounded by it. */
    int timeoutSeconds = 2;
    /** A redirect is REFUSED where the answer must come from the address asked. */
    bool followRedirects = false;
};

/** Perform `r`; never throws. */
Response send(const Request& r);

}  // namespace st0::http
