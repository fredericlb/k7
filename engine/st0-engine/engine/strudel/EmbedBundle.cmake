# EmbedBundle.cmake — `cmake -P` script: writes strudel.bundle.js as a NUL-terminated char array into a .cpp.
# A byte array rather than a string literal, because MSVC caps one literal at 16 KiB and the bundle is ~350.
# Inputs: -DIN=<bundle.js> -DOUT=<generated.cpp>

file(READ "${IN}" hex HEX)
string(LENGTH "${hex}" hexLen)
math(EXPR size "${hexLen} / 2")
string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," bytes "${hex}")
string(REGEX REPLACE "(0x..,0x..,0x..,0x..,0x..,0x..,0x..,0x..,0x..,0x..,0x..,0x..,0x..,0x..,0x..,0x..,)" "\\1\n" bytes "${bytes}")
file(WRITE "${OUT}" "// Generated from engine/strudel/strudel.bundle.js by EmbedBundle.cmake — do not edit.\n#include <cstddef>\nextern const char studioStrudelBundle[];\nextern const std::size_t studioStrudelBundleSize;\nconst char studioStrudelBundle[] = {\n${bytes}0x00};\nconst std::size_t studioStrudelBundleSize = ${size};\n")
