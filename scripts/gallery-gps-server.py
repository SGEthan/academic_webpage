"""Local-only photo GPS annotator. Run: python3 scripts/gallery-gps-server.py"""

import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import mimetypes
import os
from pathlib import Path
import secrets
import stat
import tempfile
import threading
from urllib.parse import unquote, urlsplit
from datetime import datetime, timezone


class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def valid_gps(gps):
    if not isinstance(gps, dict):
        return False
    return all(
        isinstance(gps.get(key), (int, float)) and not isinstance(gps.get(key), bool)
        and math.isfinite(gps[key]) and abs(gps[key]) <= limit
        for key, limit in (("latitude", 90), ("longitude", 180))
    )


def gps_revision(item):
    value = {"present": "gps" in item, "value": item.get("gps")}
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


class ManifestStore:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.path = self.root / "assets/gallery/gallery.json"
        self.backups = self.root / ".local/gallery-gps-backups"
        self.lock = threading.Lock()
        self.undo_entries = {}

    def _read(self):
        original = self.path.read_bytes()
        items = json.loads(original.decode("utf-8-sig"))
        if not isinstance(items, list) or any(not isinstance(item, dict) or not isinstance(item.get("src"), str) for item in items):
            raise ApiError(500, "gallery.json 格式不正确；没有写入任何内容。")
        if len({item["src"] for item in items}) != len(items):
            raise ApiError(500, "gallery.json 有重复图片路径，请先检查。")
        return original, items

    def _snapshot(self, items):
        missing, known = [], []
        excluded = 0
        for item in items:
            if valid_gps(item.get("gps")):
                known.append({"src": item["src"], "gps": item["gps"], "description": item.get("description", "")})
            elif "gps" in item and item["gps"] is None:
                excluded += 1  # Explicit opt-outs are not missing coordinates.
            else:
                photo = {key: item[key] for key in ("src", "small", "thumb", "display", "width", "height", "description", "alt", "gps") if key in item}
                photo["gps_revision"] = gps_revision(item)
                missing.append(photo)
        return {"photos": missing, "known": known, "total": len(items), "excluded": excluded}

    def snapshot(self):
        with self.lock:
            return self._snapshot(self._read()[1])

    def _write(self, original, items):
        serialized = (json.dumps(items, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
        self.backups.mkdir(parents=True, exist_ok=True, mode=0o700)
        backup = self.backups / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ-") + secrets.token_hex(4) + ".json")
        with backup.open("xb") as stream:
            stream.write(original)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.path.parent, prefix=".gallery-gps-", delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(serialized)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.chmod(stat.S_IMODE(self.path.stat().st_mode))
            if self.path.read_bytes() != original:
                raise ApiError(409, "gallery.json 刚被其他程序修改，请刷新列表后重试。")
            os.replace(temporary, self.path)
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()
        return backup.relative_to(self.root).as_posix()

    def save(self, payload):
        gps = payload.get("gps")
        if not valid_gps(gps) or set(gps) != {"latitude", "longitude"}:
            raise ApiError(400, "请提供有效的十进制经纬度（纬度 ±90，经度 ±180）。")
        with self.lock:
            original, items = self._read()
            item = next((item for item in items if item["src"] == payload.get("src")), None)
            if item is None:
                raise ApiError(404, "图片已不在 gallery.json 中，请刷新列表。")
            if payload.get("expected_gps_revision") != gps_revision(item):
                raise ApiError(409, "这张照片的 GPS 已被修改，请刷新列表后核对。")
            if valid_gps(item.get("gps")) or ("gps" in item and item["gps"] is None):
                raise ApiError(409, "已有 GPS 或被主动排除的照片不会被覆盖。")
            previous = {"present": "gps" in item, "value": item.get("gps")}
            item["gps"] = {key: round(float(gps[key]), 6) for key in ("latitude", "longitude")}
            backup = self._write(original, items)
            undo_id = secrets.token_urlsafe(24)
            self.undo_entries[undo_id] = {"src": item["src"], "previous": previous, "revision": gps_revision(item)}
            return {**self._snapshot(items), "saved": {"src": item["src"], "gps": item["gps"]}, "undo_id": undo_id, "backup": backup}

    def undo(self, payload):
        with self.lock:
            undo_id = payload.get("undo_id")
            entry = self.undo_entries.get(undo_id) if isinstance(undo_id, str) else None
            if entry is None:
                raise ApiError(409, "此记录已撤销，或标注服务已经重启。备份仍保留在 .local/gallery-gps-backups。")
            original, items = self._read()
            item = next((item for item in items if item["src"] == entry["src"]), None)
            if item is None or gps_revision(item) != entry["revision"]:
                raise ApiError(409, "这张照片的 GPS 后来又被修改了，不能覆盖；请手动核对备份。")
            if entry["previous"]["present"]:
                item["gps"] = entry["previous"]["value"]
            else:
                item.pop("gps", None)
            backup = self._write(original, items)
            del self.undo_entries[undo_id]
            return {**self._snapshot(items), "restored_src": item["src"], "backup": backup}


class AnnotationServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, root):
        self.store = ManifestStore(root)
        self.token = secrets.token_urlsafe(32)
        super().__init__(address, AnnotationHandler)
        self.allowed_hosts = {f"127.0.0.1:{self.server_port}", f"localhost:{self.server_port}"}


class AnnotationHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _check_origin(self):
        host = self.headers.get("Host", "")
        if host not in self.server.allowed_hosts:
            raise ApiError(403, "此工具只接受本机访问。")
        origin = self.headers.get("Origin")
        if origin is not None and origin != "http://" + host:
            raise ApiError(403, "不允许其他网页调用本地标注工具。")
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            raise ApiError(403, "不允许跨站请求。")

    def _send(self, status, content, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://tiles.openfreemap.org; img-src 'self' data: blob: https://tiles.openfreemap.org; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        self.end_headers()
        self.wfile.write(content)

    def _json(self, status, value):
        self._send(status, json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"))

    def _failure(self, error):
        self.close_connection = True
        if isinstance(error, ApiError):
            self._json(error.status, {"error": error.message})
        else:
            self.log_error("Annotation request failed: %s", error)
            self._json(500, {"error": "无法读写 gallery.json；请检查本地终端。没有跳过保存检查。"})

    def do_GET(self):
        try:
            self._check_origin()
            route = unquote(urlsplit(self.path).path)
            if route == "/api/photos":
                self._json(200, {**self.server.store.snapshot(), "token": self.server.token})
                return
            static = {"/": "tools/gallery-gps/index.html", "/app.js": "tools/gallery-gps/app.js", "/styles.css": "tools/gallery-gps/styles.css",
                      "/assets/vendor/maplibre/maplibre-gl-5.24.0.js": "assets/vendor/maplibre/maplibre-gl-5.24.0.js",
                      "/assets/vendor/maplibre/maplibre-gl-5.24.0.css": "assets/vendor/maplibre/maplibre-gl-5.24.0.css"}
            relative = static.get(route)
            if relative is None and route.startswith("/assets/gallery/"):
                candidate = (self.server.store.root / route.lstrip("/")).resolve()
                gallery = (self.server.store.root / "assets/gallery").resolve()
                if candidate.is_relative_to(gallery) and candidate.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}:
                    relative = candidate.relative_to(self.server.store.root).as_posix()
            if relative is None:
                raise ApiError(404, "未找到资源。请从本地标注工具首页打开。")
            path = self.server.store.root / relative
            if not path.is_file():
                raise ApiError(404, "图片或工具资源不存在。")
            self._send(200, path.read_bytes(), mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            self._failure(error)

    def do_POST(self):
        try:
            self._check_origin()
            if not secrets.compare_digest(self.headers.get("X-Gallery-GPS-Token", ""), self.server.token):
                raise ApiError(403, "保存会话已失效，请刷新标注页面。")
            if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
                raise ApiError(415, "仅支持 JSON 请求。")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ApiError(400, "请求大小不正确。")
            if not 0 < length <= 8192:
                raise ApiError(400, "请求大小不正确。")
            try:
                payload = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeError):
                raise ApiError(400, "JSON 请求格式不正确。")
            if not isinstance(payload, dict):
                raise ApiError(400, "JSON 请求应为对象。")
            route = urlsplit(self.path).path
            if route == "/api/gps":
                result = self.server.store.save(payload)
            elif route == "/api/undo":
                result = self.server.store.undo(payload)
            else:
                raise ApiError(404, "未知操作。")
            self._json(200, result)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            self._failure(error)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=1314)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    server = AnnotationServer(("127.0.0.1", args.port), root)
    print(f"GPS annotator: http://127.0.0.1:{server.server_port}/", flush=True)
    print("Only confirmed saves update assets/gallery/gallery.json. Backups: .local/gallery-gps-backups/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
