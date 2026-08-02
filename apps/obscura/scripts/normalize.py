#!/usr/bin/env python3
"""
Normalize loudness of all audio files in the songs folder.

Two-pass EBU R128 normalization (target -14 LUFS, TP -1 dBTP) via ffmpeg loudnorm.

Usage:
    python scripts/normalize.py
    python scripts/normalize.py --dir data/audio
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

AUDIO_DIR = os.path.join(os.path.dirname(__file__), "..", "backend", "data", "audio")
AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".opus"}
CACHE_FILENAME = ".normalized"

TARGET_I = -14.0
TOLERANCE_LU = 0.5


def compute_md5(filepath: str) -> str:
    """Compute MD5 hash of a file."""
    h = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def load_norm_cache(audio_dir: str) -> dict[str, str]:
    """Load the .normalized cache file. Returns {relative_path: md5}."""
    cache_path = os.path.join(audio_dir, CACHE_FILENAME)
    if os.path.isfile(cache_path):
        with open(cache_path) as f:
            return json.load(f)
    return {}


def save_norm_cache(audio_dir: str, cache: dict[str, str]):
    """Save the .normalized cache file."""
    cache_path = os.path.join(audio_dir, CACHE_FILENAME)
    with open(cache_path, "w") as f:
        json.dump(cache, f, indent=2, sort_keys=True)
        f.write("\n")


def normalize_audio(filepath: str) -> tuple[bool, str | None]:
    """Two-pass EBU R128 loudness normalization (target -14 LUFS).

    Returns (success, error). Returns (True, None) if normalized,
    (True, "already normalized") if skipped because already at target.
    """
    if not os.path.isfile(filepath):
        return False, "file not found"

    ext = os.path.splitext(filepath)[1]
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=ext)
    os.close(tmp_fd)

    try:
        # Pass 1: measure loudness
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", filepath,
                "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
                "-f", "null", "-",
            ],
            capture_output=True, text=True,
        )
        stderr = result.stderr
        json_start = stderr.rfind("{")
        json_end = stderr.rfind("}") + 1
        if json_start == -1 or json_end == 0:
            return False, "could not parse loudnorm output"
        stats = json.loads(stderr[json_start:json_end])

        # Skip if already within tolerance of target loudness
        try:
            measured_i = float(stats["input_i"])
            measured_tp = float(stats["input_tp"])
            if abs(measured_i - TARGET_I) <= TOLERANCE_LU and measured_tp <= -0.5:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                return True, "already normalized"
        except (ValueError, KeyError):
            pass  # proceed with normalization if parsing fails

        # Pass 2: apply normalization with measured values
        af = (
            f"loudnorm=I=-14:TP=-1:LRA=11:"
            f"measured_I={stats['input_i']}:measured_TP={stats['input_tp']}:"
            f"measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:"
            f"offset={stats['target_offset']}:linear=true"
        )
        subprocess.run(
            ["ffmpeg", "-y", "-i", filepath, "-af", af, tmp_path],
            capture_output=True, check=True,
        )
        os.replace(tmp_path, filepath)
        return True, None
    except Exception as e:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return False, str(e)


def collect_audio_files(directory: str) -> list[str]:
    """Recursively find all audio files in a directory."""
    files = []
    for root, _, names in os.walk(directory):
        for name in sorted(names):
            if os.path.splitext(name)[1].lower() in AUDIO_EXTENSIONS:
                files.append(os.path.join(root, name))
    return files


def clear_line():
    cols = shutil.get_terminal_size().columns
    print(f"\r{' ' * cols}\r", end="", flush=True)


def main():
    parser = argparse.ArgumentParser(
        description="Normalize loudness of all audio files in the songs folder"
    )
    parser.add_argument(
        "--dir", default=AUDIO_DIR,
        help=f"Audio directory to normalize (default: {AUDIO_DIR})",
    )
    parser.add_argument(
        "--write-md5s", action="store_true",
        help="Force-write MD5s for all songs to .normalized cache without normalizing",
    )
    args = parser.parse_args()

    audio_dir = os.path.abspath(args.dir)
    if not os.path.isdir(audio_dir):
        print(f"Error: directory not found: {audio_dir}")
        sys.exit(1)

    files = collect_audio_files(audio_dir)
    if not files:
        print(f"No audio files found in {audio_dir}")
        return

    cache = load_norm_cache(audio_dir)

    # --write-md5s: just compute and store MD5s, no normalization
    if args.write_md5s:
        print(f"Writing MD5s for {len(files)} file(s)...\n")
        for i, filepath in enumerate(files, 1):
            rel = os.path.relpath(filepath, audio_dir)
            md5 = compute_md5(filepath)
            cache[rel] = md5
            print(f"  [{i}/{len(files)}] {rel} → {md5}")
        save_norm_cache(audio_dir, cache)
        print(f"\nDone: {len(files)} MD5(s) written to {CACHE_FILENAME}")
        return

    print(f"Normalizing {len(files)} audio file(s) in {audio_dir}\n")

    ok_count = 0
    skip_count = 0
    cached_count = 0
    fail_count = 0

    for i, filepath in enumerate(files, 1):
        rel = os.path.relpath(filepath, audio_dir)
        print(f"  [{i}/{len(files)}] {rel}...", end="", flush=True)

        # Check cache: skip if MD5 matches
        md5 = compute_md5(filepath)
        if rel in cache and cache[rel] == md5:
            clear_line()
            print(f"  ✓ {rel} (cached)")
            cached_count += 1
            continue

        ok, err = normalize_audio(filepath)
        clear_line()
        if ok and err == "already normalized":
            print(f"  ✓ {rel} (already normalized)")
            cache[rel] = md5
            skip_count += 1
        elif ok:
            print(f"  ♫ {rel}")
            cache[rel] = compute_md5(filepath)
            ok_count += 1
        else:
            print(f"  ⚠ {rel} ({err})")
            fail_count += 1

    save_norm_cache(audio_dir, cache)
    print(
        f"\nDone: {ok_count} normalized, {skip_count} already OK, "
        f"{cached_count} cached, {fail_count} failed"
    )


if __name__ == "__main__":
    main()
