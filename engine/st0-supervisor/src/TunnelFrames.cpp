// TunnelFrames.cpp — see TunnelFrames.h.

#include "TunnelFrames.h"

#include "Url.h"

#include <cctype>
#include <cstdio>

namespace st0::tunnel {

std::string encodeBinary(const nlohmann::json& header, const std::string& payload)
{
    const std::string head = header.dump();
    const auto n = static_cast<uint32_t>(head.size());
    std::string out;
    out.reserve(4 + head.size() + payload.size());
    out.push_back(static_cast<char>((n >> 24) & 0xff));
    out.push_back(static_cast<char>((n >> 16) & 0xff));
    out.push_back(static_cast<char>((n >> 8) & 0xff));
    out.push_back(static_cast<char>(n & 0xff));
    out += head;
    out += payload;
    return out;
}

std::optional<Binary> decodeBinary(const std::string& frame)
{
    if (frame.size() < 4) return std::nullopt;
    const auto b = reinterpret_cast<const unsigned char*>(frame.data());
    const size_t len = (size_t(b[0]) << 24) | (size_t(b[1]) << 16) | (size_t(b[2]) << 8) | size_t(b[3]);
    if (4 + len > frame.size()) return std::nullopt;
    auto header = nlohmann::json::parse(frame.substr(4, len), nullptr, false);
    if (header.is_discarded() || !header.is_object()) return std::nullopt;
    return Binary{std::move(header), frame.substr(4 + len)};
}

std::string tunnelUrl(const std::string& registryUrl, const std::string& id)
{
    const auto u = url::parse(registryUrl);
    if (!u) return "";
    std::string path = u->path;
    if (const size_t q = path.find_first_of("?#"); q != std::string::npos) path = path.substr(0, q);
    if (!path.empty() && path.back() == '/') path.pop_back();
    std::string encoded;
    for (unsigned char c : id) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
            encoded.push_back(static_cast<char>(c));
        } else {
            char buf[4];
            std::snprintf(buf, sizeof buf, "%%%02X", c);
            encoded += buf;
        }
    }
    const std::string scheme = u->scheme == "https" ? "wss" : "ws";
    return scheme + "://" + u->host() + path + kPath + "?id=" + encoded;
}

}  // namespace st0::tunnel
