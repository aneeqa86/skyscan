"""Compact binary point cloud for the browser.

Layout (little endian):
  uint32  header_len
  bytes   JSON header (UTF-8), padded with spaces to a multiple of 4 bytes
  float32 xyz[count * 3]   metres: east, north offset from the AOI centre, z above the AOI ground datum
  uint16  hag_cm[count]    height above ground in centimetres
  uint8   classification[count]
  uint8   intensity[count] scaled 0..255 (99th percentile = 255)
"""
from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np

MAX_POINTS = 300_000
VERSION = 1


def decimate(n: int, max_points: int = MAX_POINTS, seed: int = 0) -> np.ndarray:
    if n <= max_points:
        return np.arange(n)
    rng = np.random.default_rng(seed)
    return np.sort(rng.choice(n, size=max_points, replace=False))


def encode(
    x, y, z, hag, classification, intensity, *, center_lonlat, center_xy, datum_z, epsg, extra=None
) -> bytes:
    n = len(x)
    xyz = np.empty((n, 3), dtype="<f4")
    xyz[:, 0] = np.asarray(x) - center_xy[0]
    xyz[:, 1] = np.asarray(y) - center_xy[1]
    xyz[:, 2] = np.asarray(z) - datum_z
    hag_cm = np.clip(np.round(np.asarray(hag) * 100), 0, 65535).astype("<u2")
    cls = np.asarray(classification).astype("u1")
    inten = np.asarray(intensity, dtype=np.float64)
    top = np.percentile(inten, 99) if n else 1.0
    inten8 = np.clip(inten / max(top, 1.0) * 255, 0, 255).astype("u1")
    header = {
        "version": VERSION,
        "count": int(n),
        "center": [float(center_lonlat[0]), float(center_lonlat[1])],
        "center_projected": [float(center_xy[0]), float(center_xy[1])],
        "datum_z": float(datum_z),
        "epsg": int(epsg),
        "bounds": {
            "x": [float(xyz[:, 0].min()), float(xyz[:, 0].max())] if n else [0, 0],
            "y": [float(xyz[:, 1].min()), float(xyz[:, 1].max())] if n else [0, 0],
            "z": [float(xyz[:, 2].min()), float(xyz[:, 2].max())] if n else [0, 0],
            "hag": [0.0, float(hag_cm.max() / 100) if n else 0.0],
        },
        "classes": sorted(int(c) for c in np.unique(cls)),
        "layout": ["xyz:float32x3", "hag_cm:uint16", "classification:uint8", "intensity:uint8"],
        **(extra or {}),
    }
    hb = json.dumps(header).encode("utf-8")
    hb += b" " * ((-len(hb)) % 4)
    return b"".join(
        [struct.pack("<I", len(hb)), hb, xyz.tobytes(), hag_cm.tobytes(), cls.tobytes(), inten8.tobytes()]
    )


def decode(buf: bytes) -> tuple[dict, dict]:
    """Inverse of encode (used by tests and tooling)."""
    (hlen,) = struct.unpack_from("<I", buf, 0)
    header = json.loads(buf[4 : 4 + hlen].decode("utf-8"))
    n = header["count"]
    off = 4 + hlen
    xyz = np.frombuffer(buf, dtype="<f4", count=n * 3, offset=off).reshape(n, 3)
    off += n * 12
    hag = np.frombuffer(buf, dtype="<u2", count=n, offset=off)
    off += n * 2
    cls = np.frombuffer(buf, dtype="u1", count=n, offset=off)
    off += n
    inten = np.frombuffer(buf, dtype="u1", count=n, offset=off)
    return header, {"xyz": xyz, "hag_cm": hag, "classification": cls, "intensity": inten}


def write(path: Path, data: bytes) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return len(data)
