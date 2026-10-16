"""Test description preservation using tiny disposable photos, not real assets."""

import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ExifTags
from PIL.TiffImagePlugin import IFDRational


spec = importlib.util.spec_from_file_location(
    "gallery_builder", Path(__file__).resolve().parents[1] / "scripts/build-gallery.py"
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class GalleryBuilderTest(unittest.TestCase):
    def test_gps_decode_and_invalid_metadata(self):
        class Photo:
            def __init__(self, gps):
                self.gps = gps

            def getexif(self):
                return self

            def get_ifd(self, tag):
                return self.gps

        gps = {1: "N", 2: (47, 36, 36), 3: b"W", 4: (122, 19, 48)}
        self.assertEqual(builder.read_photo_gps(Photo(gps)), {"latitude": 47.61, "longitude": -122.33})
        self.assertEqual(builder.read_photo_gps(Photo({**gps, 1: "S", 3: "E"})), {"latitude": -47.61, "longitude": 122.33})
        for invalid in [{}, {**gps, 1: ""}, {**gps, 2: (91, 0, 0)}, {**gps, 4: (181, 0, 0)}, {**gps, 2: (1, 60, 0)}, {**gps, 4: (1, 0, float("nan"))}]:
            self.assertIsNone(builder.read_photo_gps(Photo(invalid)))

    def test_gps_extraction_preserves_manual_values_and_originals(self):
        with tempfile.TemporaryDirectory(prefix="gallery-gps-test-") as directory:
            root = Path(directory)
            gallery = root / "assets/gallery"
            gallery.mkdir(parents=True)
            exif = Image.Exif()
            exif[ExifTags.IFD.GPSInfo] = {
                1: "N", 2: tuple(IFDRational(value) for value in (47, 36, 36)),
                3: "W", 4: tuple(IFDRational(value) for value in (122, 19, 48)),
            }
            for name in ["exif.jpg", "manual.jpg", "opt-out.jpg", "partial.jpg"]:
                Image.new("RGB", (24, 16)).save(gallery / name, exif=exif)
            Image.new("RGB", (24, 16)).save(gallery / "missing.jpg")
            items = [
                {"src": "assets/gallery/exif.jpg", "description": "User location"},
                {"src": "assets/gallery/missing.jpg", "description": "No inference from this place name"},
                {"src": "assets/gallery/manual.jpg", "gps": {"latitude": 1.25, "longitude": 2.5}},
                {"src": "assets/gallery/opt-out.jpg", "gps": None},
                {"src": "assets/gallery/partial.jpg", "gps": {"latitude": 3, "longitude": None}},
            ]
            manifest = gallery / "gallery.json"
            manifest.write_text(json.dumps(items))
            hashes = {item["src"]: hashlib.sha256((root / item["src"]).read_bytes()).hexdigest() for item in items}
            for _ in range(2):
                builder.extract_gallery_gps(root)
                updated = json.loads(manifest.read_text())
                self.assertEqual(updated[0]["gps"], {"latitude": 47.61, "longitude": -122.33})
                self.assertEqual(updated[1]["gps"], {"latitude": None, "longitude": None})
                self.assertEqual(updated[2:], items[2:])
                self.assertEqual(updated[0]["description"], items[0]["description"])
                self.assertEqual(updated[1]["description"], items[1]["description"])
            self.assertFalse((gallery / "optimized").exists())
            self.assertTrue(all(hashlib.sha256((root / source).read_bytes()).hexdigest() == digest for source, digest in hashes.items()))

    def test_descriptions_survive_regeneration_and_new_photos_start_empty(self):
        with tempfile.TemporaryDirectory(prefix="gallery-builder-test-") as directory:
            root = Path(directory)
            gallery = root / "assets/gallery"
            gallery.mkdir(parents=True)
            for name in ["existing.jpg", "old-without-description.jpg", "new.jpg"]:
                Image.new("RGB", (24, 16)).save(gallery / name)
            manifest = gallery / "gallery.json"
            manifest.write_text(json.dumps([
                {"src": "assets/gallery/existing.jpg", "caption": "Custom title", "description": "京都，日本", "custom": "preserve me", "gps": {"latitude": 35.0, "longitude": 135.75}},
                {"src": "assets/gallery/old-without-description.jpg"},
            ]))
            for _ in range(2):
                builder.build_gallery(root)
                items = json.loads(manifest.read_text())
                self.assertEqual(len(items), 3)
                self.assertEqual(items[0]["description"], "京都，日本")
                self.assertEqual(items[0]["caption"], "Custom title")
                self.assertEqual(items[0]["custom"], "preserve me")
                self.assertEqual(items[0]["gps"], {"latitude": 35.0, "longitude": 135.75})
                self.assertTrue(all(item["description"] == "" for item in items[1:]))


if __name__ == "__main__":
    unittest.main()
