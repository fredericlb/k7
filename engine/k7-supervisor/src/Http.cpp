// Http.cpp — see Http.h. `compress` is off: zlib is not built in, and asking for gzip would get a
// body this client cannot read.

#include "Http.h"

#include "TrustRoots.h"

#include <ixwebsocket/IXHttpClient.h>

#include <cctype>
#include <fstream>
#include <vector>

namespace k7::http {

namespace fs = std::filesystem;

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

std::optional<std::uint64_t> contentRangeStart(const std::string& header)
{
    static const std::string unit = "bytes ";
    if (header.size() <= unit.size()) return std::nullopt;
    for (size_t i = 0; i < unit.size(); ++i)
        if (std::tolower(static_cast<unsigned char>(header[i])) != unit[i]) return std::nullopt;
    std::uint64_t value = 0;
    size_t at = unit.size(), digits = 0;
    for (; at < header.size() && std::isdigit(static_cast<unsigned char>(header[at])) && digits < 19; ++at, ++digits)
        value = value * 10 + static_cast<std::uint64_t>(header[at] - '0');
    if (digits == 0 || at >= header.size() || header[at] != '-') return std::nullopt;
    return value;
}

namespace {

/** Append the whole of `from` to `to`, a block at a time; false when either side fails. */
bool append(const fs::path& from, const fs::path& to)
{
    std::ifstream in(from, std::ios::binary);
    std::ofstream out(to, std::ios::binary | std::ios::app);
    if (!in || !out) return false;
    std::vector<char> buf(1 << 20);
    while (in.read(buf.data(), static_cast<std::streamsize>(buf.size())) || in.gcount() > 0)
        out.write(buf.data(), in.gcount());
    out.close();
    return static_cast<bool>(out);
}

}  // namespace

Response download(const Request& r, const fs::path& to, const std::function<void(std::uint64_t)>& progress)
{
    Response out;
    std::error_code ec;
    const std::uint64_t have = fs::is_regular_file(to, ec) ? fs::file_size(to, ec) : 0;
    const std::uint64_t from = ec ? 0 : have;
    // A resumed body lands beside `to` until the status says whether it continues `to` or replaces it.
    fs::path into = to;
    if (from) into += ".resume";
    std::ofstream file(into, std::ios::binary | std::ios::trunc);
    if (!file) {
        out.error = "cannot write " + into.string();
        return out;
    }
    ix::HttpClient client;
    client.setTLSOptions(tls::options());
    auto args = client.createRequest(r.url, "GET");
    args->connectTimeout = r.timeoutSeconds;
    args->transferTimeout = r.timeoutSeconds;
    args->followRedirects = r.followRedirects;
    args->compress = false;
    if (from) args->extraHeaders["Range"] = "bytes=" + std::to_string(from) + "-";
    std::uint64_t received = 0;
    // A chunk callback is what keeps the client from collecting the body: each chunk goes straight to disk.
    args->onChunkCallback = [&](const std::string& chunk) {
        file.write(chunk.data(), static_cast<std::streamsize>(chunk.size()));
        received += chunk.size();
        if (progress) progress(from + received);
    };
    auto res = client.request(r.url, "GET", "", args);
    file.close();
    const bool wrote = static_cast<bool>(file);
    // The status and headers are there even when the body was cut short.
    const int status = res ? res->statusCode : 0;
    if (from) {
        std::string range;
        if (res)
            if (auto it = res->headers.find("Content-Range"); it != res->headers.end()) range = it->second;
        const auto start = contentRangeStart(range);
        const bool continues = status == 206 && start == from;
        bool kept = true;
        if (continues) {
            kept = append(into, to);
        } else if (status == 200) {
            fs::remove(to, ec);
            fs::rename(into, to, ec);
            kept = !ec;
        }
        fs::remove(into, ec);
        if (!kept) {
            out.error = "could not write the whole of " + to.string();
            return out;
        }
        // Nothing past the end because `to` is already the whole file (`bytes */<size>`): the caller's hash decides.
        const std::string whole = "/" + std::to_string(from);
        if (status == 416 && range.size() > whole.size() && range.compare(range.size() - whole.size(), whole.size(), whole) == 0) {
            out.status = 200;
            return out;
        }
        // Nothing past the end of a file of another size, or a resume at another byte: what is here is not a prefix to trust.
        if (status == 416 || (status == 206 && !continues)) {
            fs::remove(to, ec);
            return download(r, to, progress);
        }
    } else if (status < 200 || status >= 300) {
        // An error page, or nothing at all: never left where an archive is expected.
        fs::remove(to, ec);
    }
    if (!res) {
        out.error = "no response";
        return out;
    }
    if (res->errorCode != ix::HttpErrorCode::Ok) {
        out.error = res->errorMsg.empty() ? "request failed" : res->errorMsg;
        return out;
    }
    if (!wrote) {
        out.error = "could not write the whole of " + to.string();
        return out;
    }
    out.status = status;
    return out;
}

}  // namespace k7::http
