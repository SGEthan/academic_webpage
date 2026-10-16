"""Exercise real GPS writes and HTTP protections using disposable files only."""

import copy
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("gps_server", Path(__file__).resolve().parents[1] / "scripts/gallery-gps-server.py")
gps_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gps_server)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gallery-gps-annotator-test-")
        self.root = Path(self.temp.name)
        (self.root / "assets/gallery").mkdir(parents=True)
        self.items = [
            {"src": "assets/gallery/a.jpg", "description": "用户地点", "gps": {"latitude": None, "longitude": None}, "custom": {"untouched": [1, 2]}},
            {"src": "assets/gallery/b.jpg", "description": "No GPS field"},
            {"src": "assets/gallery/known.jpg", "gps": {"latitude": 47.6, "longitude": -122.3}},
            {"src": "assets/gallery/excluded.jpg", "gps": None},
            {"src": "assets/gallery/partial.jpg", "gps": {"latitude": 35, "longitude": None}},
        ]
        self.store = gps_server.ManifestStore(self.root)
        self.store.path.write_text(json.dumps(self.items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        self.original = self.store.path.read_bytes()
        for item in self.items:
            (self.root / item["src"]).write_bytes(b"Original photo; never rewrite me.")

    def tearDown(self):
        self.temp.cleanup()

    def payload(self, index=0, gps=None):
        item = self.items[index]
        return {"src": item["src"], "gps": gps if gps is not None else {"latitude": 47.12345678, "longitude": -122.75}, "expected_gps_revision": gps_server.gps_revision(item)}

    def test_snapshot_and_exact_scope(self):
        result = self.store.snapshot()
        self.assertEqual([photo["src"] for photo in result["photos"]], [self.items[i]["src"] for i in [0, 1, 4]])
        self.assertEqual(result["excluded"], 1)
        self.assertEqual(len(result["known"]), 1)
        saved = self.store.save(self.payload())
        expected = copy.deepcopy(self.items)
        expected[0]["gps"] = {"latitude": 47.123457, "longitude": -122.75}
        self.assertEqual(json.loads(self.store.path.read_text()), expected)
        self.assertEqual((self.root / saved["backup"]).read_bytes(), self.original)
        self.assertTrue(all((self.root / item["src"]).read_bytes() == b"Original photo; never rewrite me." for item in self.items))
        self.store.undo({"undo_id": saved["undo_id"]})
        self.assertEqual(json.loads(self.store.path.read_text()), self.items)
        self.assertEqual(len(list(self.store.backups.glob("*.json"))), 2)

    def test_invalid_coordinates_and_known_gps_are_not_written(self):
        for gps in [{}, {"latitude": True, "longitude": 0}, {"latitude": "1", "longitude": 1}, {"latitude": 91, "longitude": 1}, {"latitude": 1, "longitude": -181}, {"latitude": float("nan"), "longitude": 1}, {"latitude": 1, "longitude": float("inf")}, {"latitude": 1, "longitude": 1, "extra": 2}]:
            with self.assertRaises(gps_server.ApiError):
                self.store.save(self.payload(gps=gps))
            self.assertEqual(self.store.path.read_bytes(), self.original)
        for index in [2, 3]:
            with self.assertRaises(gps_server.ApiError):
                self.store.save(self.payload(index=index))
        self.assertEqual(self.store.path.read_bytes(), self.original)
        self.assertEqual(self.store.save(self.payload(gps={"latitude": 0, "longitude": 0}))["saved"]["gps"], {"latitude": 0.0, "longitude": 0.0})

    def test_stale_save_and_undo_preserve_newer_edits(self):
        saved = self.store.save(self.payload())
        with self.assertRaises(gps_server.ApiError) as error:
            self.store.save(self.payload())
        self.assertEqual(error.exception.status, 409)
        edited = json.loads(self.store.path.read_text())
        edited[0]["description"] = "A newer user description"
        self.store.path.write_text(json.dumps(edited))
        self.store.undo({"undo_id": saved["undo_id"]})
        self.assertEqual(json.loads(self.store.path.read_text())[0]["description"], "A newer user description")
        saved = self.store.save(self.payload())
        edited = json.loads(self.store.path.read_text())
        edited[0]["gps"] = {"latitude": 1, "longitude": 2}
        self.store.path.write_text(json.dumps(edited))
        with self.assertRaises(gps_server.ApiError):
            self.store.undo({"undo_id": saved["undo_id"]})
        self.assertEqual(json.loads(self.store.path.read_text()), edited)

    def test_restore_absent_gps_and_preserve_other_fields(self):
        self.items[1]["description"] = "Edited concurrently before save"
        self.store.path.write_text(json.dumps(self.items))
        saved = self.store.save(self.payload(index=1))
        self.store.undo({"undo_id": saved["undo_id"]})
        restored = json.loads(self.store.path.read_text())
        self.assertEqual(restored, self.items)
        self.assertNotIn("gps", restored[1])

    def test_atomic_write_conflict_does_not_replace_external_edit(self):
        actual_write = self.store._write
        external = self.original + b" "

        def conflicting_write(original, items):
            self.store.path.write_bytes(external)
            return actual_write(original, items)

        with patch.object(self.store, "_write", side_effect=conflicting_write):
            with self.assertRaises(gps_server.ApiError) as error:
                self.store.save(self.payload())
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(self.store.path.read_bytes(), external)
        self.assertFalse(list(self.store.path.parent.glob(".gallery-gps-*")))


class HttpTest(StoreTest):
    def setUp(self):
        super().setUp()
        (self.root / "tools/gallery-gps").mkdir(parents=True)
        (self.root / "tools/gallery-gps/index.html").write_text("<!doctype html><title>Local annotator</title>")
        (self.root / "private.txt").write_text("Do not serve this")
        self.server = gps_server.AnnotationServer(("127.0.0.1", 0), self.root)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        super().tearDown()

    def request(self, path, method="GET", payload=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        body = json.dumps(payload) if payload is not None else None
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        status, content, response_headers = response.status, response.read(), dict(response.getheaders())
        connection.close()
        return status, content, response_headers

    def test_http_save_undo_and_private_routes(self):
        status, content, headers = self.request("/api/photos")
        self.assertEqual(status, 200)
        token = json.loads(content)["token"]
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(headers["Cache-Control"], "no-store")
        valid_headers = {"Content-Type": "application/json", "X-Gallery-GPS-Token": token}
        self.assertEqual(self.request("/api/gps", "POST", self.payload())[0], 403)
        self.assertEqual(self.request("/api/gps", "POST", self.payload(), {**valid_headers, "Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("/api/photos", headers={"Host": "evil.example"})[0], 403)
        for route in ["/private.txt", "/.local/gallery-gps-backups/x.json", "/assets/gallery/../../private.txt", "/assets/gallery/%2e%2e/%2e%2e/private.txt", "/assets/gallery/gallery.json"]:
            self.assertEqual(self.request(route)[0], 404)
        self.assertEqual(self.request("/")[0], 200)
        self.assertEqual(self.request("/assets/gallery/a.jpg")[0], 200)
        self.assertEqual(self.server.store.path.read_bytes(), self.original)
        status, body, _ = self.request("/api/gps", "POST", self.payload(), valid_headers)
        self.assertEqual(status, 200)
        saved = json.loads(body)
        self.assertEqual(len(saved["photos"]), 2)
        self.assertEqual(self.request("/api/undo", "POST", {"undo_id": saved["undo_id"]}, valid_headers)[0], 200)
        self.assertEqual(json.loads(self.server.store.path.read_text()), self.items)


if __name__ == "__main__":
    unittest.main()
