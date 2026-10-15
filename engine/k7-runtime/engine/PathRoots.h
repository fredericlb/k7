// PathRoots.h — which files a document off the wire may make the engine READ or WRITE: under one of the
// allowed roots once symlinks are resolved, and never a UNC path. JUCE-free so tests/ has it in a FAST binary.
// The one thing a reader would get wrong: with no roots set — the CLI's one-shot modes — every path but a
// UNC one passes; serve() sets them before the first document is read (docs/pathRoots.md).

#pragma once

#include <string>
#include <vector>

namespace studio {

/** `\\host\share`, `//host/share`, `\\?\…`: a path that would make the engine dial a network share. */
bool isUncPath(const std::string& path);

/** Whether `path` ends in `ext` (with its dot), ignoring ASCII case. */
bool hasExtensionCi(const std::string& path, const std::string& ext);

/** Whether `path` (UTF-8) resolves, symlinks followed, at or below one of `roots`; a UNC path never does. */
bool pathUnderRoots(const std::string& path, const std::vector<std::string>& roots);

/** A pattern sound name that can only name a child of a bank: no separator, `.`, `..`, drive or control char. */
bool safeSoundName(const std::string& name);

/** A path list split on the platform's separator (`;` on Windows, `:` elsewhere), empty entries dropped. */
std::vector<std::string> splitRootList(const std::string& list);

struct PathRootSet {
    std::vector<std::string> read;
    std::vector<std::string> write;
};

/** The process's roots; serve() calls it once, before anything is read. */
void setPathRoots(PathRootSet roots);

/** The roots serve() would set: the state directory, `$STUDIO_ENGINE_ROOTS`, and the temp directory for reads. */
PathRootSet defaultPathRoots(const std::string& stateDir);

/** A file a document names for reading: refused when UNC, or outside the read roots once those are set. */
bool readAllowed(const std::string& path);

/** A file or directory a document names for writing: the same test against the write roots. */
bool writeAllowed(const std::string& path);

}  // namespace studio
