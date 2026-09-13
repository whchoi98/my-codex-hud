#!/usr/bin/env python3
"""Bundle the current HUD package with its install skill and plugin."""

from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins" / "codex-hud"
SKILL = PLUGIN / "skills" / "codex-hud-install"


def archive_folder(source: Path, destination: Path) -> None:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
                archive.write(path, Path(source.name) / path.relative_to(source))


def main() -> None:
    assets = SKILL / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="codex-hud-package-") as temporary:
        result = subprocess.run(
            ["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", temporary,
             "--cache", str(Path(temporary) / "npm-cache")],
            cwd=ROOT, check=True, capture_output=True, text=True,
        )
        package = json.loads(result.stdout)[0]
        filename = package["filename"]
        source = Path(temporary) / filename
        for old in assets.glob("my-codex-hud-*.tgz"):
            if old.name != filename:
                old.unlink()
        shutil.copyfile(source, assets / filename)
    metadata = {
        "name": package["name"], "version": package["version"], "file": filename,
        "sha256": hashlib.sha256((assets / filename).read_bytes()).hexdigest(),
    }
    (assets / "package.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    shutil.copyfile(ROOT / "LICENSE", PLUGIN / "LICENSE")
    version = json.loads((PLUGIN / ".codex-plugin" / "plugin.json").read_text())["version"]
    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    archives = [
        (PLUGIN, output / f"codex-hud-plugin-{version}.zip"),
        (SKILL, output / f"codex-hud-install-{version}.zip"),
    ]
    for source, destination in archives:
        archive_folder(source, destination)
        print(f"{destination} ({destination.stat().st_size:,} bytes)")
    print(f"Bundled HUD {metadata['version']}: {metadata['sha256']}")


if __name__ == "__main__":
    main()
