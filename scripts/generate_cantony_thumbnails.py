#!/usr/bin/env python3
"""Generate compact WebP previews for images under CantonyEddy/MyWallpaper/Assets."""

import concurrent.futures
import io
import os
import sys
from pathlib import Path

import requests
from PIL import Image, ImageOps, UnidentifiedImageError

OWNER = "CantonyEddy"
REPO = "MyWallpaper"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".tif", ".tiff"}
OUTPUT = Path("thumbnails")
API = f"https://api.github.com/repos/{OWNER}/{REPO}"
TOKEN = os.environ.get("GITHUB_TOKEN", "")
HEADERS = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
if TOKEN:
    HEADERS["Authorization"] = f"Bearer {TOKEN}"

Image.MAX_IMAGE_PIXELS = 120_000_000


def api_json(url):
    response = requests.get(url, headers=HEADERS, timeout=60)
    response.raise_for_status()
    return response.json()


def collect_images(branch):
    pending = [("Assets", None)]
    images = []
    while pending:
        path, known_sha = pending.pop()
        endpoint = f"{API}/contents/{requests.utils.quote(path, safe='/')}?ref={requests.utils.quote(branch, safe='')}"
        entries = api_json(endpoint)
        if isinstance(entries, dict):
            entries = [entries]
        for entry in entries:
            entry_path = entry["path"]
            if entry["type"] == "dir":
                pending.append((entry_path, entry.get("sha")))
            elif entry["type"] == "file" and Path(entry_path).suffix.lower() in IMAGE_EXTENSIONS:
                if entry.get("download_url") and entry.get("sha"):
                    images.append((entry["sha"], entry["download_url"], entry_path))
    return images


def generate(item):
    sha, download_url, path = item
    target = OUTPUT / f"{sha}.webp"
    if target.exists():
        return True, path
    response = requests.get(download_url, headers={"User-Agent": "xLonely-wallpaper-thumbnails"}, timeout=(30, 180))
    response.raise_for_status()
    with Image.open(io.BytesIO(response.content)) as original:
        frame = ImageOps.exif_transpose(original.copy())
        if getattr(frame, "n_frames", 1) > 1:
            frame.seek(0)
            frame = ImageOps.exif_transpose(frame.copy())
        frame = ImageOps.fit(frame, (480, 300), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        if frame.mode not in ("RGB", "RGBA"):
            frame = frame.convert("RGBA" if "transparency" in frame.info else "RGB")
        target.parent.mkdir(parents=True, exist_ok=True)
        frame.save(target, format="WEBP", quality=76, method=5)
    return True, path


def main():
    repo = api_json(API)
    branch = repo.get("default_branch") or "main"
    images = collect_images(branch)
    if not images:
        raise RuntimeError("No supported image files were found under the source Assets folder.")
    print(f"Found {len(images)} source images under Assets/ on branch {branch}.")
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(generate, item): item for item in images}
        for future in concurrent.futures.as_completed(futures):
            try:
                _, path = future.result()
                print(f"Created {path}")
            except (requests.RequestException, OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
                path = futures[future][2]
                failures.append(path)
                print(f"Skipped {path}: {exc}", file=sys.stderr)
    generated = list(OUTPUT.glob("*.webp"))
    print(f"Generated {len(generated)} previews; skipped {len(failures)} source files.")
    if not generated:
        raise RuntimeError("No previews were generated.")


if __name__ == "__main__":
    main()
