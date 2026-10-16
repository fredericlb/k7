// Http.cpp — see Http.h. `compress` is off: zlib is not built in, and asking for gzip would get a
// body this client cannot read.

#include "Http.h"

#include "TrustRoots.h"

#include <ixwebsocket/IXHttpClient.h>

#include <fstream>

namespace k7::http {

Response send(const Request& r)
{
    ix::HttpClient client;
    client.setTLSOptions(tls::options());
    auto args = client.createRequest(r.url, r.method);
    args->connectTimeout = r.timeoutSeconds;
    args->transferTimeout = r.timeoutSeconds;
    args->followRedirects = r.followRedirects;
    args->compress = false;
    if (!r.contentType.empty()) args->extraHeaders["Content-Type"] = r.contentType;
    for (const auto& [k, v] : r.headers) args->extraHeaders[k] = v;
    auto res = client.request(r.url, r.method, r.body, args);
    Response out;
    if (!res) {
        out.error = "no response";
        return out;
    }
    if (res->errorCode != ix::HttpErrorCode::Ok) {
        out.error = res->errorMsg.empty() ? "request failed" : res->errorMsg;
        return out;
    }
    out.status = res->statusCode;
    out.body = res->body;
    return out;
}

Response download(const Request& r, const std::filesystem::path& to,
                  const std::function<void(std::uint64_t)>& progress)
{
    Response out;
    std::ofstream file(to, std::ios::binary | std::ios::trunc);
    if (!file) {
        out.error = "cannot write " + to.string();
        return out;
    }
    ix::HttpClient client;
    client.setTLSOptions(tls::options());
    auto args = client.createRequest(r.url, "GET");
    args->connectTimeout = r.timeoutSeconds;
    args->transferTimeout = r.timeoutSeconds;
    args->followRedirects = r.followRedirects;
    args->compress = false;
    std::uint64_t received = 0;
    // A chunk callback is what keeps the client from collecting the body: each chunk goes straight to disk.
    args->onChunkCallback = [&](const std::string& chunk) {
        file.write(chunk.data(), static_cast<std::streamsize>(chunk.size()));
        received += chunk.size();
        if (progress) progress(received);
    };
    auto res = client.request(r.url, "GET", "", args);
    file.close();
    if (!res) {
        out.error = "no response";
        return out;
    }
    if (res->errorCode != ix::HttpErrorCode::Ok) {
        out.error = res->errorMsg.empty() ? "request failed" : res->errorMsg;
        return out;
    }
    if (!file) {
        out.error = "could not write the whole of " + to.string();
        return out;
    }
    out.status = res->statusCode;
    return out;
}

}  // namespace k7::http
