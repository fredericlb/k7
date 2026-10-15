// Instruments.cpp — see Instruments.h. An archive is verified by hash BEFORE it is unpacked, so an upstream that
// changed its file is refused rather than becoming another instrument, and a folder is marked installed only once
// it is whole: unpacked beside, renamed into place, its marker written last.

#include "Instruments.h"

#include "Http.h"
#include "Paths.h"

#include <mbedtls/sha256.h>
#include <miniz.h>

#include <algorithm>
#include <array>
#include <cstdio>
#include <fstream>

namespace k7::instruments {

namespace {

// Written last into an instrument's folder: the archive hash it came from, which is what `installed` compares.
constexpr const char* kMarker = ".k7-archive";

std::string readMarker(const fs::path& folder)
{
    std::ifstream in(folder / kMarker);
    std::string s;
    std::getline(in, s);
    return s;
}

// miniz's own fopen takes a narrow path, which on Windows is not UTF-8: every file goes through a std::filesystem path.
FILE* openRead(const fs::path& p)
{
#ifdef _WIN32
    return _wfopen(p.c_str(), L"rb");
#else
    return std::fopen(p.c_str(), "rb");
#endif
}

size_t writeChunk(void* opaque, mz_uint64, const void* buf, size_t n)
{
    auto* out = static_cast<std::ofstream*>(opaque);
    out->write(static_cast<const char*>(buf), static_cast<std::streamsize>(n));
    return *out ? n : 0;
}

// A name that would land outside the folder: absolute, or climbing out with `..`.
bool escapes(const fs::path& rel)
{
    if (rel.is_absolute() || rel.has_root_name()) return true;
    for (const auto& part : rel)
        if (part == "..") return true;
    return false;
}

}  // namespace

const std::vector<Instrument>& all()
{
    // Pinned by the archive's hash: a GitHub commit's zip for the piano, plain files for the others.
    static const std::vector<Instrument> list = {
        {"salamander-grand-piano", "Salamander Grand Piano",
         "https://codeload.github.com/sfzinstruments/SalamanderGrandPiano/zip/3382bf9496bba2486f5ab0de55a264d1dfc38404",
         "4f64bc2dadf2eb893e7fb824c2982c03962025e1c82ab9e593e2f7269c50a476", 748522601},
        {"nbo-stereo-rhodes", "Stereo Rhodes", "https://www.bandshed.net/sounds/sfz/stereo_rhodes.zip",
         "d54168cf4e3ae231bd91634855ad75fa534d48cd38a3258ea6fe77da0eb40a14", 74489660},
        {"nbo-wurt", "Wurlitzer", "https://www.bandshed.net/sounds/sfz/wurt.zip",
         "b7c3b7c0bf76b22e5ab3c6b3d7f997b488a3815608f795b570a0452c31dc79ba", 7947927},
        {"lithalean-clavinet", "Clavinet", "https://musical-artifacts.com/artifacts/646/Clavinet.zip",
         "b434bd4b3eff7232948663a0b343ce79512229da912c8edb09f1a6fa2abc060d", 57271531},
        // An acoustic drum kit, Wilkinson Audio's (CC BY 4.0), at one commit of sfzinstruments' port.
        {"naked-drums", "Naked Drums",
         "https://codeload.github.com/sfzinstruments/WilkinsonAudio.NakedDrums/zip/407732a548606ac715ad8f3fbac63d9f4df77c0d",
         "a58f73d1c143f77809e45395965895b513890fa2cc7f902172e407862fcc7f11", 1283095413},
        // …and a second, Karoryfer's (CC0), with brushes, mallets and a rusty character of its own.
        {"big-rusty-drums", "Big Rusty Drums",
         "https://codeload.github.com/sfzinstruments/karoryfer.big-rusty-drums/zip/f07ce00df34a46b6b08375be56fe116cf15782bc",
         "e1f9944f43570ffe0c4d1d57750805c605e3df63dc943b622f5d6dc7b35e2781", 619428922},
        // Six vintage drum machines, one per octave — The Tic Tok Men's, at one commit of sfzinstruments' port.
        {"retro-drums", "Retro Drums",
         "https://codeload.github.com/sfzinstruments/tictokmen.retrodrums1/zip/0d1ba0a79f7616b302deb762f7390ba3c3cd1662",
         "84a1743ce653fdcc6b8f7dda03248882f632087d57b9990f58d9496c450d56e7", 1916192},
    };
    return list;
}

fs::path root() { return paths::studioDir() / "instruments"; }

bool installed(const Instrument& i) { return readMarker(root() / i.name) == i.sha256; }

const Instrument* find(const std::string& name)
{
    for (const auto& i : all())
        if (i.name == name) return &i;
    return nullptr;
}

bool present(const Instrument& i) { return !readMarker(root() / i.name).empty(); }

bool remove(const Instrument& i, std::string& error)
{
    const fs::path folder = root() / i.name;
    // The marker first: a removal cut short then reads as not installed, never as a whole instrument.
    std::error_code ec;
    fs::remove(folder / kMarker, ec);
    for (const fs::path& p : {folder, fs::path(folder.string() + ".unpack"), root() / (i.name + ".zip.part")}) {
        fs::remove_all(p, ec);
        if (ec) {
            error = "cannot delete " + paths::utf8(p) + ": " + ec.message();
            return false;
        }
    }
    return true;
}

std::string sha256Of(const fs::path& file)
{
    std::ifstream in(file, std::ios::binary);
    if (!in) return {};
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts(&ctx, 0);
    std::array<char, 1 << 16> buf{};
    while (in) {
        in.read(buf.data(), buf.size());
        if (in.gcount() > 0)
            mbedtls_sha256_update(&ctx, reinterpret_cast<const unsigned char*>(buf.data()),
                                  static_cast<size_t>(in.gcount()));
    }
    std::array<unsigned char, 32> digest{};
    mbedtls_sha256_finish(&ctx, digest.data());
    mbedtls_sha256_free(&ctx);
    static const char* hex = "0123456789abcdef";
    std::string out;
    for (auto b : digest) {
        out += hex[b >> 4];
        out += hex[b & 15];
    }
    return out;
}

bool unpackZip(const fs::path& zipPath, const fs::path& folder, std::string& error)
{
    const fs::path into = folder.string() + ".unpack";
    std::error_code ec;
    fs::remove_all(into, ec);
    fs::create_directories(into, ec);
    FILE* f = openRead(zipPath);
    if (f == nullptr) {
        error = "cannot open " + paths::utf8(zipPath);
        return false;
    }
    mz_zip_archive zip{};
    if (!mz_zip_reader_init_cfile(&zip, f, 0, 0)) {
        std::fclose(f);
        error = "not a zip archive: " + paths::utf8(zipPath);
        return false;
    }
    bool ok = true;
    const mz_uint n = mz_zip_reader_get_num_files(&zip);
    for (mz_uint i = 0; i < n && ok; ++i) {
        mz_zip_archive_file_stat st;
        if (!mz_zip_reader_file_stat(&zip, i, &st)) {
            error = "unreadable entry in the archive";
            ok = false;
            break;
        }
        const fs::path rel = paths::fromUtf8(st.m_filename).lexically_normal();
        if (escapes(rel)) {
            error = std::string("the archive names a file outside it: ") + st.m_filename;
            ok = false;
            break;
        }
        const fs::path at = into / rel;
        if (mz_zip_reader_is_file_a_directory(&zip, i)) {
            fs::create_directories(at, ec);
            continue;
        }
        fs::create_directories(at.parent_path(), ec);
        std::ofstream out(at, std::ios::binary | std::ios::trunc);
        if (!out || !mz_zip_reader_extract_to_callback(&zip, i, writeChunk, &out, 0)) {
            error = "could not unpack " + paths::utf8(rel);
            ok = false;
        }
    }
    mz_zip_reader_end(&zip);
    std::fclose(f);
    if (!ok) {
        fs::remove_all(into, ec);
        return false;
    }
    // One folder and nothing else at the top — what GitHub serves for a repository — is the instrument itself.
    fs::path source = into;
    std::vector<fs::path> top;
    for (const auto& e : fs::directory_iterator(into, ec)) top.push_back(e.path());
    if (top.size() == 1 && fs::is_directory(top[0])) source = top[0];
    fs::remove_all(folder, ec);
    fs::create_directories(folder.parent_path(), ec);
    fs::rename(source, folder, ec);
    if (ec) {
        error = "could not move the instrument into place: " + ec.message();
        fs::remove_all(into, ec);
        return false;
    }
    fs::remove_all(into, ec);
    return true;
}

bool install(const Instrument& i, const std::function<void(const Progress&)>& report, std::string& error)
{
    std::error_code ec;
    fs::create_directories(root(), ec);
    const fs::path part = root() / (i.name + ".zip.part");
    const fs::path folder = root() / i.name;
    http::Request req;
    req.url = i.url;
    // A big archive over a slow line: bounded, but in the scale of a download and not of a heartbeat.
    req.timeoutSeconds = 3600;
    req.followRedirects = true;
    // The total is the PINNED size: on a chunked response the client's own "total" is only the current chunk's.
    const auto res = http::download(req, part, [&](std::uint64_t received) {
        report({std::min(received, i.bytes), i.bytes, "downloading"});
    });
    if (!res.ok()) {
        fs::remove(part, ec);
        error = res.status ? i.url + " answered " + std::to_string(res.status) : res.error;
        return false;
    }
    const auto hash = sha256Of(part);
    if (hash != i.sha256) {
        fs::remove(part, ec);
        error = "the archive changed upstream (sha256 " + hash + "), refused";
        return false;
    }
    report({i.bytes, i.bytes, "unpacking"});
    if (!unpackZip(part, folder, error)) {
        fs::remove(part, ec);
        return false;
    }
    fs::remove(part, ec);
    std::ofstream(folder / kMarker) << i.sha256 << "\n";
    return true;
}

}  // namespace k7::instruments
