"""Generate web-sized gallery assets without modifying any original photos.

Run: python3 scripts/build-gallery.py (requires Pillow).
Existing manifest order, captions, and custom fields are preserved.
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageOps


def build_gallery(root: Path) -> None:
    gallery = root / "assets" / "gallery"
    manifest = gallery / "gallery.json"
    items = json.loads(manifest.read_text(encoding="utf-8-sig")) if manifest.exists() else []
    existing = {item["src"] for item in items}
    extensions = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
    for source in sorted(gallery.iterdir(), key=lambda path: path.name.lower()):
        relative = source.relative_to(root).as_posix()
        if source.is_file() and source.suffix.lower() in extensions and relative not in existing:
            title = source.stem.replace("_", " ").replace("-", " ")
            items.append({"src": relative, "alt": title, "caption": title})

    output = gallery / "optimized"
    output.mkdir(exist_ok=True)
    total_bytes = {"small": 0, "thumb": 0, "display": 0}
    for item in items:
        source = (root / item["src"]).resolve()
        if not source.is_relative_to(gallery.resolve()) or not source.is_file():
            raise ValueError(f"Missing or invalid gallery source: {item['src']}")
        with Image.open(source) as original:
            image = ImageOps.exif_transpose(original)
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            item["width"], item["height"] = image.size
            item["variants"] = []
            # Keep the original extension in derived names to avoid basename collisions.
            for field, edge, quality in (("small", 800, 80), ("thumb", 1600, 82), ("display", 2560, 88)):
                destination = output / f"{source.name}.{field}.webp"
                resized = image.copy()
                resized.thumbnail((edge, edge), Image.Resampling.LANCZOS)
                if not destination.exists() or destination.stat().st_mtime < source.stat().st_mtime:
                    options = {"quality": quality, "method": 6}
                    if original.info.get("icc_profile"):
                        options["icc_profile"] = original.info["icc_profile"]
                    resized.save(destination, "WEBP", **options)
                item[field] = destination.relative_to(root).as_posix()
                item["variants"].append({"src": item[field], "width": resized.width, "height": resized.height})
                resized.close()
                total_bytes[field] += destination.stat().st_size
            image.close()

    # This is generated metadata, not a source-photo rewrite.
    manifest.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sizes = ", ".join(f"{field}: {size / 1024 / 1024:.2f} MiB" for field, size in total_bytes.items())
    print(f"Built {len(items)} photos ({sizes}); originals unchanged.")


def build_profile(root: Path) -> None:
    source = root / "assets" / "profile-photo.jpg"
    if not source.exists():
        return
    total_bytes = 0
    with Image.open(source) as original:
        image = ImageOps.exif_transpose(original).convert("RGB")
        for width in (400, 800):
            destination = source.with_name(f"profile-photo-{width}.webp")
            if not destination.exists() or destination.stat().st_mtime < source.stat().st_mtime:
                height = round(image.height * width / image.width)
                resized = image.resize((width, height), Image.Resampling.LANCZOS)
                options = {"quality": 85, "method": 6}
                if original.info.get("icc_profile"):
                    options["icc_profile"] = original.info["icc_profile"]
                resized.save(destination, "WEBP", **options)
                resized.close()
            total_bytes += destination.stat().st_size
        image.close()
    print(f"Built responsive portrait variants ({total_bytes / 1024:.0f} KiB); original unchanged.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-root", type=Path, default=Path(__file__).resolve().parent.parent)
    site_root = parser.parse_args().site_root.resolve()
    build_gallery(site_root)
    build_profile(site_root)
