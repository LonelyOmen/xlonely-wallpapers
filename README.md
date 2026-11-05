# xLonely Wallpapers

A browsable, color-filterable gallery of my still and live wallpaper collection. The project is a static website and can be hosted for free with GitHub Pages.

**Gallery:** https://lonelyomen.github.io/xlonely-wallpapers/  
**Repository:** https://github.com/LonelyOmen/xlonely-wallpapers

## Browse the collection

The gallery includes search, Still/Live tabs, color filters, resolution and format labels, video frame rates where available, full-size previews, and direct downloads. The original files are in `wallpapers/still/` and `wallpapers/live/`; the smaller generated images in `previews/` are only for the gallery cards.

## Publish the website with GitHub Pages

After pushing the repository, open **Settings → Pages** and set the source to **Deploy from a branch**, branch **`main`**, folder **`/ (root)`**. Save and wait for the Pages build to finish. The public gallery URL is the link above.

## Add or update wallpapers

1. Copy still images to `wallpapers/still/` and videos/animated wallpapers to `wallpapers/live/`. Keep filenames unique within each folder.
2. Install the small build dependencies and regenerate the catalog and previews:

   ```sh
   python -m pip install --user Pillow
   # Install ffmpeg from your distro for live-video posters and FPS/resolution metadata.
   ./scripts/build_catalog.py
   ```

3. Review the generated cards, then commit and push the changes. The builder uses existing hand-tagged color metadata when present and assigns a best-effort color to new files; edit `scripts/seed-metadata.json` if you want to refine a wallpaper's color tags.

For a new still image, its preview is generated as a compact WebP. For a video, a frame is extracted as a JPEG poster; if `ffmpeg` is unavailable, a placeholder is used. The original remains available in the gallery either way.

## Publish from a local clone

After GitHub CLI is authenticated, from this directory:

```sh
gh repo create LonelyOmen/xlonely-wallpapers --public --source=. --remote=origin --push
```

For later updates:

```sh
git add .
git commit -m "Update wallpaper collection"
git push
```

## Files and rights

The gallery code and wallpaper assets are separate. This repository does not grant a license to reuse the wallpapers; rights remain with their respective creators or owners. Please add attribution or source links when known, and only redistribute files you have permission to publish.
