// Identity.cpp — see Identity.h. The randomness is mbedTLS's entropy source, the OS's own CSPRNG,
// rather than std::random_device, whose quality the standard does not promise.

#include "Identity.h"

#include "Paths.h"

#include <mbedtls/entropy.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace k7 {

namespace {

std::vector<unsigned char> randomBytes(size_t n)
{
    mbedtls_entropy_context ctx;
    mbedtls_entropy_init(&ctx);
    std::vector<unsigned char> out(n);
    size_t done = 0;
    while (done < n) {
        const size_t chunk = std::min<size_t>(n - done, MBEDTLS_ENTROPY_BLOCK_SIZE);
        if (mbedtls_entropy_func(&ctx, out.data() + done, chunk) != 0) {
            mbedtls_entropy_free(&ctx);
            throw std::runtime_error("no entropy source");
        }
        done += chunk;
    }
    mbedtls_entropy_free(&ctx);
    return out;
}

std::string hex(const unsigned char* p, size_t n)
{
    static const char* digits = "0123456789abcdef";
    std::string s;
    for (size_t i = 0; i < n; ++i) {
        s.push_back(digits[p[i] >> 4]);
        s.push_back(digits[p[i] & 15]);
    }
    return s;
}

std::string isoNow()
{
    const auto now = std::chrono::system_clock::now();
    const std::time_t t = std::chrono::system_clock::to_time_t(now);
    const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count() % 1000;
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof buf, "%Y-%m-%dT%H:%M:%S", &tm);
    char out[40];
    std::snprintf(out, sizeof out, "%s.%03dZ", buf, static_cast<int>(ms));
    return out;
}

}  // namespace

std::string randomHex(size_t n)
{
    const auto b = randomBytes(n);
    return hex(b.data(), b.size());
}

std::string randomUuid()
{
    auto b = randomBytes(16);
    b[6] = static_cast<unsigned char>((b[6] & 0x0f) | 0x40);
    b[8] = static_cast<unsigned char>((b[8] & 0x3f) | 0x80);
    const std::string h = hex(b.data(), b.size());
    return h.substr(0, 8) + "-" + h.substr(8, 4) + "-" + h.substr(12, 4) + "-" + h.substr(16, 4) + "-" + h.substr(20);
}

EngineIdentity ensureEngineIdentity()
{
    const auto path = paths::engineId();
    if (std::ifstream in{path, std::ios::binary}) {
        std::stringstream buf;
        buf << in.rdbuf();
        auto v = nlohmann::json::parse(buf.str(), nullptr, false);
        if (v.is_object() && v.value("id", nlohmann::json()).is_string() && v.value("token", nlohmann::json()).is_string())
            return {v["id"].get<std::string>(), v["token"].get<std::string>(), v.value("createdAt", std::string())};
    }
    EngineIdentity id{randomUuid(), randomHex(24), isoNow()};
    std::error_code ec;
    std::filesystem::create_directories(path.parent_path(), ec);
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << nlohmann::json{{"id", id.id}, {"token", id.token}, {"createdAt", id.createdAt}}.dump(2) << "\n";
    return id;
}

}  // namespace k7
