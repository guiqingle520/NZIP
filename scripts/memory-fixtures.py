"""Create reproducible, isolated archive workloads without creating 100k disk files."""
import hashlib
import json
import pathlib
import random
import sys
import zipfile

root = pathlib.Path(sys.argv[1]).resolve()
root.mkdir(parents=True, exist_ok=True)
fixtures = []
for count in (10000, 100000):
    filename = root / f"entries-{count}.zip"
    with zipfile.ZipFile(filename, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for i in range(count):
            info = zipfile.ZipInfo(f"目录-{i // 100:04d}/文件-{i:06d}.txt", (2026, 1, 1, 0, 0, 0))
            archive.writestr(info, f"NZIP fixture {i}\n".encode())
    fixtures.append({"archive": str(filename), "entries": count, "bytes": filename.stat().st_size})

large = root / "large-256MiB.bin"
rng = random.Random(20261024)
chunk = rng.randbytes(1024 * 1024)
digest = hashlib.sha256()
with large.open("wb") as output:
    for _ in range(256):
        output.write(chunk)
        digest.update(chunk)
large_archive = root / "large-256MiB.zip"
with zipfile.ZipFile(large_archive, "w", compression=zipfile.ZIP_STORED) as archive:
    archive.write(large, arcname=large.name)
manifest = {"listings": fixtures, "large": {"source": str(large), "archive": str(large_archive), "bytes": large.stat().st_size, "sha256": digest.hexdigest()}}
(root / "fixtures.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({"manifest": str(root / "fixtures.json"), **manifest}, ensure_ascii=False))
