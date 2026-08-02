#!/usr/bin/env python3
"""Download audio from YouTube for all songs in a session YAML file."""

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

from normalize import normalize_audio, compute_md5, load_norm_cache, save_norm_cache


def sanitize(name: str) -> str:
    """Replace characters that are problematic in file paths."""
    return re.sub(r'[/\\:*?"<>|]', "_", name).strip()


def build_entry(song_ref: dict, audio_root: Path, download_suffix: str = "") -> dict | None:
    youtube_id = song_ref.get("youtubeId")
    artist = song_ref.get("artist", "")
    title = song_ref.get("title", "")

    if youtube_id:
        source = f"https://www.youtube.com/watch?v={youtube_id}"
        if artist and title:
            base = f"{sanitize(artist)} - {sanitize(title)}"
            label = f"{artist} - {title}"
        elif title:
            base = sanitize(title)
            label = title
        else:
            base = youtube_id
            label = youtube_id
    elif title:
        if artist:
            source = f"ytsearch1:{artist} {title}"
            base = f"{sanitize(artist)} - {sanitize(title)}"
            label = f"{artist} - {title}"
        else:
            source = f"ytsearch1:{title}"
            base = sanitize(title)
            label = title
    else:
        return None

    out = f"{base}{download_suffix}.mp3"
    return {
        "source": source,
        "output": str(audio_root / out),
        "filename": out,
        "path_key": "path",
        "song_ref": song_ref,
        "label": label,
    }


def collect_songs(session: dict) -> list[dict]:
    """Return a flat list of entries for every song to download."""
    audio_root = Path("data/audio")
    entries = []
    for category in session.get("categories", []):
        cat_suffix = category.get("downloadSuffix", "")
        for song in category.get("songs", []):
            tracks = song.get("tracks", [])
            if tracks:
                for track in tracks:
                    entry = build_entry(track, audio_root, cat_suffix)
                    if entry:
                        entries.append(entry)
            else:
                entry = build_entry(song, audio_root, cat_suffix)
                if entry:
                    entries.append(entry)
    return entries


def progress_bar(current: int, total: int, width: int = 30) -> str:
    """Return a text progress bar like [████████░░░░░░░░░░]."""
    filled = int(width * current / total)
    bar = "█" * filled + "░" * (width - filled)
    pct = current * 100 // total
    return f"[{bar}] {pct:3d}% ({current}/{total})"


def download(entry: dict) -> tuple[bool, str | None]:
    """Download a single song. Returns (success, error_message)."""
    output = entry["output"]
    os.makedirs(os.path.dirname(output), exist_ok=True)

    try:
        subprocess.run(
            [
                "yt-dlp", "-x", "--audio-format", "mp3",
                "-o", output,
                entry["source"],
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return True, None
    except subprocess.CalledProcessError as e:
        return False, e.stderr.strip() or str(e)
    except FileNotFoundError:
        print("\nError: yt-dlp not found. Install it with: pip install yt-dlp")
        sys.exit(1)


def clear_line():
    """Clear the current terminal line."""
    cols = shutil.get_terminal_size().columns
    print(f"\r{' ' * cols}\r", end="", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Download songs from YouTube for a session")
    parser.add_argument("--session", required=True, help="Path to session YAML file")
    parser.add_argument(
        "--force-norm", action="store_true",
        help="Re-normalize all existing files (not just newly downloaded ones)",
    )
    args = parser.parse_args()

    session_path = Path(args.session)
    if not session_path.exists():
        print(f"Error: {session_path} not found")
        sys.exit(1)

    with open(session_path) as f:
        session = yaml.safe_load(f)

    entries = collect_songs(session)

    # Set path on every song entry (downloaded or not) so the YAML is updated
    for entry in entries:
        entry["song_ref"][entry["path_key"]] = entry["filename"]

    # Split into existing and to-download
    existing = [e for e in entries if os.path.exists(e["output"])]
    to_download = [e for e in entries if not os.path.exists(e["output"])]
    total = len(to_download)
    norm_count = 0

    # Load normalization cache
    audio_root = os.path.abspath("data/audio")
    norm_cache = load_norm_cache(audio_root)

    if existing:
        print(f"Skipping {len(existing)} already downloaded song(s)")

    # --force-norm: normalize all existing files
    if args.force_norm and existing:
        print(f"\nNormalizing {len(existing)} existing file(s)...")
        for i, entry in enumerate(existing, 1):
            print(f"  [{i}/{len(existing)}] {entry['label']}...", end="", flush=True)

            # Check cache
            rel = os.path.relpath(entry["output"], audio_root)
            md5 = compute_md5(entry["output"])
            if rel in norm_cache and norm_cache[rel] == md5:
                clear_line()
                print(f"  ✓ {entry['label']} (cached)")
                continue

            ok, err = normalize_audio(entry["output"])
            clear_line()
            if ok and err == "already normalized":
                print(f"  ✓ {entry['label']} (already normalized)")
                norm_cache[rel] = md5
            elif ok:
                print(f"  ♫ {entry['label']}")
                norm_cache[rel] = compute_md5(entry["output"])
                norm_count += 1
            else:
                print(f"  ⚠ {entry['label']} (norm failed: {err})")

    if total == 0 and not (args.force_norm and existing):
        print("Nothing to download, all songs already exist.")
        with open(session_path, "w") as f:
            yaml.dump(session, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
        print("Session file updated with paths.")
        return

    if total > 0:
        print(f"\nDownloading {total} song(s) for session '{session_path.stem}'\n")

    failed_songs: list[tuple[str, str]] = []

    for i, entry in enumerate(to_download, 1):
        print(f"{progress_bar(i - 1, total)}  {entry['label']}...", end="", flush=True)

        ok, err = download(entry)
        clear_line()

        if ok:
            print(f"  ✓ {entry['label']}")
            # Normalize immediately after download
            nok, nerr = normalize_audio(entry["output"])
            rel = os.path.relpath(entry["output"], audio_root)
            if nok and nerr != "already normalized":
                print(f"  ♫ {entry['label']} (normalized)")
                norm_cache[rel] = compute_md5(entry["output"])
                norm_count += 1
            elif nok:
                norm_cache[rel] = compute_md5(entry["output"])
            elif not nok:
                print(f"  ⚠ {entry['label']} (norm failed: {nerr})")
        else:
            print(f"  ✗ {entry['label']}")
            failed_songs.append((entry["label"], err))

    if total > 0:
        print(f"\n{progress_bar(total, total)}")
    print(
        f"\n{total - len(failed_songs)} downloaded, {norm_count} normalized, "
        f"{len(failed_songs)} failed, {len(existing)} skipped"
    )

    if failed_songs:
        print(f"\n--- Failed songs ({len(failed_songs)}) ---")
        for label, err in failed_songs:
            print(f"  ✗ {label}")
            print(f"    {err}")

    # Save normalization cache
    save_norm_cache(audio_root, norm_cache)

    # Save updated session YAML with paths
    with open(session_path, "w") as f:
        yaml.dump(session, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    print("\nSession file updated with paths.")


if __name__ == "__main__":
    main()
