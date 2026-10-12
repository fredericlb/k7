# ixwebsocket.cmake — a ceiling on what one client message may make the engine buffer, applied at fetch time like tracktion.cmake.
# The one thing a reader would get wrong: IXWebSocket's own limit is 2^63 bytes, so without this any client can exhaust memory with one frame.

include("${CMAKE_CURRENT_LIST_DIR}/../eurorack/patches/studio_replace.cmake")

# A frame, plus a fragmented message's chunks so far, past 64 MiB closes the connection with 1009 before anything is buffered.
# Anchored on the line AFTER the insertion, so the replacement does not contain what it replaces and a re-run is a no-op.
studio_replace("ixwebsocket/IXWebSocketTransport.cpp"
    "            if (ws.N > maxFrameSize)\n            {\n                return;\n            }\n\n            if (_rxbuf.size() < ws.header_size + ws.N)"
    "            if (ws.N > maxFrameSize)\n            {\n                return;\n            }\n\n            // studio: nothing past 64 MiB is buffered, a fragmented message's chunks counted with it\n            {\n                uint64_t studioHeld = ws.N;\n                for (const auto& c : _chunks) studioHeld += c.size();\n                if (studioHeld > (64ULL << 20))\n                {\n                    close(1009, \"message too big\");\n                    return;\n                }\n            }\n\n            if (_rxbuf.size() < ws.header_size + ws.N)")
