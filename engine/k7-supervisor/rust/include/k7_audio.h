// k7_audio.h — the C ABI of rust/src/lib.rs: a file decoded to a rate and a channel count, and a resampler.
// A reader would get wrong who owns a block: the library does, and it stays valid until the next call on the same handle.

#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct K7Decode K7Decode;
typedef struct K7Resample K7Resample;

/** Opens `path` (UTF-8) to be read as `channels` channels at `rate`; null with `*error` set on failure. */
K7Decode* k7_decode_open(const char* path, uint32_t rate, uint32_t channels, char** error);
/** The file's own rate, before any conversion. */
uint32_t k7_decode_source_rate(const K7Decode* d);
/** The next block of interleaved frames: 0 with `*count` frames (0 at the end), or -1 with `*error` set. */
int32_t k7_decode_next(K7Decode* d, const float** frames, size_t* count, char** error);
void k7_decode_close(K7Decode* d);

/** A resampler of interleaved frames from `from` Hz to `to` Hz; null with `*error` set on failure. */
K7Resample* k7_resample_new(uint32_t from, uint32_t to, uint32_t channels, char** error);
/** Pushes `count` frames in; what came out is at `*out`, `*out_count` frames. 0, or -1 with `*error` set. */
int32_t k7_resample_push(K7Resample* r, const float* frames, size_t count, const float** out, size_t* out_count, char** error);
/** The held tail, after which the total out is ceil(in × to / from) frames. 0, or -1 with `*error` set. */
int32_t k7_resample_finish(K7Resample* r, const float** out, size_t* out_count, char** error);
void k7_resample_free(K7Resample* r);

/** Frees an `*error` any call above set. */
void k7_audio_free_string(char* s);

#ifdef __cplusplus
}
#endif
