// Http.h — the one HTTP client, IXWebSocket's, over mbedTLS with the OS trust roots. Blocking by
// design: every call runs on a worker thread and is bounded, since a registry that connects and
// never answers is harmless on a heartbeat and fatal on the deregister that holds Quit open.

#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <optional>
#include <string>

namespace k7::http {

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
    /** Sent as given, beside the content type. */
    std::map<std::string, std::string> headers;
};

/** Perform `r`; never throws. */
Response send(const Request& r);

/** GET `r.url` into `to`, never in memory, RESUMING a `to` already there where the server can (docs/instruments.md); `progress` gets `to`'s size. */
Response download(const Request& r, const std::filesystem::path& to,
                  const std::function<void(std::uint64_t)>& progress);

/** The first byte a `Content-Range: bytes A-B/T` answer starts at, or nothing for any other spelling. */
std::optional<std::uint64_t> contentRangeStart(const std::string& header);

}  // namespace k7::http
