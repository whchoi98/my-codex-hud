# Release and Git Preparation

<a href="#english">English</a> · <a href="#korean">한국어</a>

<a id="english"></a>
## English

### Prerequisites

Work from the source checkout with Node.js 20+, npm, Python 3.9+, and native PTY
dependencies available. Read [AGENTS.md](../../AGENTS.md).

### Documentation and versioning

Preserve README content and historical validation. Record unreleased work in
CHANGELOG. Documentation sync alone does not bump the version. For a release,
move the relevant Unreleased entries under its version and date, leaving
Unreleased for future work. Use a minor version for features and a patch for
fixes unless the user specifies a version.

Synchronize these fields before packaging:

| File | Version field or text |
| --- | --- |
| `package.json` | `version` (HUD source of truth) |
| `package-lock.json` | top-level `version` and `packages[""].version` |
| `plugins/codex-hud/.codex-plugin/plugin.json` | plugin `version` |
| `README.md` | current HUD version |
| `plugins/codex-hud/README.md` | plugin and standalone skill ZIP filenames |

`package:plugin` uses the root package version for the npm archive and the plugin
manifest version for ZIP filenames; it neither updates nor enforces equality
between them. After the final source/document edit, regenerate the bundle and
then validate:

```bash
npm run package:plugin
npm test
npm run check
npm run test:installer
node bin/codex-hud.js --version
```

Check the selected installation using the absolute `command` from its installer
report. Replace the example path below with that value; a project installation
defaults to `<project>/.codex-hud/bin/codex-hud`.

```bash
"/absolute/prefix/bin/codex-hud" --version
"/absolute/prefix/bin/codex-hud" doctor --json \
  --bundle plugins/codex-hud/skills/codex-hud-install/assets/package.json
```

Confirm the source and installed CLI report the intended version. If the
installed command is missing or differs, the installed-version check remains
incomplete; packaging does not update a separate installation. Check the doctor's
`codex`, `inline.available` and `inline.probe.status == "ok"` fields too. The
installation check must exercise an actual PTY child, not only import node-pty.
On macOS, verify `inline.helper.status` is `executable`. For user scope, check PATH discovery
separately with `command -v codex-hud` in a fresh terminal. Project scope does not
add HUD to PATH, and a bare command may resolve to another installation.

Generated outputs:

- `plugins/codex-hud/skills/codex-hud-install/assets/my-codex-hud-<version>.tgz`
- `plugins/codex-hud/skills/codex-hud-install/assets/package.json` (name, version,
  filename, SHA-256)
- `dist/codex-hud-plugin-<version>.zip`
- `dist/codex-hud-install-<version>.zip`

Do not edit these files by hand. The asset archive and metadata are tracked;
`dist/` is ignored. The package script also copies the root MIT license into
the plugin. Run this check from the source root to verify versions, checksum,
and bundled documentation:

```bash
python3 -B - <<'PY'
import json
import runpy
import tarfile
from pathlib import Path

version = json.loads(Path("package.json").read_text())["version"]
lock = json.loads(Path("package-lock.json").read_text())
plugin = Path("plugins/codex-hud")
manifest = json.loads((plugin / ".codex-plugin/plugin.json").read_text())
skill = plugin / "skills/codex-hud-install"
archive, metadata = runpy.run_path(str(skill / "scripts/install.py"))["bundle"]()
assert version == lock["version"] == lock["packages"][""]["version"]
assert version == manifest["version"] == metadata["version"]
with tarfile.open(archive, "r:gz") as package:
    documents = [Path(name) for name in (
        "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "AGENTS.md",
        "plugins/codex-hud/README.md",
    )] + sorted(Path("docs").rglob("*.md"))
    for path in documents:
        assert package.extractfile(f"package/{path}").read() == path.read_bytes(), path
print(f"Verified HUD {version}: {metadata['sha256']}")
PY
```

Then compare both ZIPs with the checkout using this read-only command. The roots
are `codex-hud/` for the plugin and `codex-hud-install/` for the standalone skill.
It compares every packaged file, including the plugin manifest, skill scripts,
shell template, metadata and TGZ, with the same exclusions as the packager.

```bash
python3 -B - <<'PY'
import json
from pathlib import Path
from zipfile import ZipFile

plugin = Path("plugins/codex-hud")
skill = plugin / "skills/codex-hud-install"
version = json.loads((plugin / ".codex-plugin/plugin.json").read_text())["version"]
for source, filename in (
    (plugin, f"codex-hud-plugin-{version}.zip"),
    (skill, f"codex-hud-install-{version}.zip"),
):
    expected = {
        (Path(source.name) / path.relative_to(source)).as_posix(): path
        for path in sorted(source.rglob("*"))
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"
    }
    with ZipFile(Path("dist") / filename) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)), (filename, "duplicate entries")
        assert set(names) == set(expected), (filename, "member set differs")
        for name, path in expected.items():
            assert archive.read(name) == path.read_bytes(), (filename, name)
    print(f"Verified {filename}: {len(expected)} files")
PY
```

Also check local links from the packaged documentation. Installer scripts and
tests are absent from the npm payload; see the [installation reference](../reference/installation.md).
Automated installer tests use stand-in executables from the checkout, not the
ZIPs; they do not prove installation on a new platform or a real VS Code screen.
Preserve that distinction when recording validation results.

For installer changes, exercise an existing older user/project prefix through
`--status` and `--update`. Confirm scope, custom path, language, autostart and startup
files remain unchanged, and a newer installed version is refused before npm.
The npm package must include `src/repair-node-pty.js` and its postinstall command.
Record actual macOS validation separately from simulated file-permission tests.

### GitHub distribution

The repository catalogue is `.agents/plugins/marketplace.json`. Keep its
`codex-hud` entry pointing to `./plugins/codex-hud`, with the complete skill and
regenerated TGZ available in the same ref. The catalogue is repository metadata;
it is not required inside the standalone plugin/skill ZIPs.

Test local registration with a disposable Codex profile. Once a requested push
has made the ref public, verify the GitHub route separately:

```bash
codex plugin marketplace add whchoi98/my-codex-hud --ref main
codex plugin add codex-hud@codex-hud
```

For a GitHub installation update, run `codex plugin marketplace upgrade codex-hud`
and then `codex plugin add codex-hud@codex-hud`. These commands install the plugin;
the HUD runtime is installed separately by its skill. Record the fetched commit
and installed version. Local success does not establish availability on GitHub.
Update the dated public-status notes in both READMEs after checking the published
ref. See the [installer guide](../../plugins/codex-hud/README.md) for the standalone
GitHub skill and source-install routes.

### Commit and push

For a requested Git action, verify the working tree rather than checking only
whether a `.git` path exists:

```bash
git rev-parse --is-inside-work-tree
git status --short --branch
git remote -v
git diff --check
git diff --cached --check
```

Review and stage intended files only, including the regenerated asset archive
and metadata. Use the requested branch and remote. A valid local Git repository
is required to commit; a remote is required only for a requested push.

### Recovery

If checks fail, fix the cause and rebuild artifacts. Preserve previous release
records. A running HUD process needs a restart to load changed JavaScript;
do not terminate a user's active Codex session as part of packaging.

<a id="korean"></a>
## 한국어

### 준비 사항

Node.js 20 이상, npm, Python 3.9 이상, 네이티브 PTY 의존성이 준비된 소스
체크아웃에서 작업합니다. [AGENTS.md](../../AGENTS.md)를 읽습니다.

### 문서와 버전

README 내용과 과거 검증 기록을 보존하고 미출시 작업은 CHANGELOG에 기록합니다.
문서 동기화만으로 버전을 올리지 않습니다. 릴리스할 때는 해당 Unreleased
항목을 버전·날짜 아래로 옮기고, 다음 작업을 위해 Unreleased를 남깁니다.
사용자가 버전을 지정하지 않았다면 새 기능은 마이너, 수정은 패치 버전을 올립니다.

패키징 전에 다음 항목을 맞춥니다.

| 파일 | 버전 필드 또는 표기 |
| --- | --- |
| `package.json` | HUD 버전의 기준인 `version` |
| `package-lock.json` | 최상위 `version`, `packages[""].version` |
| `plugins/codex-hud/.codex-plugin/plugin.json` | 플러그인 `version` |
| `README.md` | 현재 HUD 버전 |
| `plugins/codex-hud/README.md` | 플러그인·단독 스킬 ZIP 파일명 |

`package:plugin`은 npm 아카이브에 루트 패키지 버전을, ZIP 파일명에 플러그인
매니페스트 버전을 사용하며, 버전을 올리거나 두 값의 일치를 강제하지 않습니다.
마지막 소스·문서 수정 후 패키지를 다시 만들고 검증합니다.

```bash
npm run package:plugin
npm test
npm run check
npm run test:installer
node bin/codex-hud.js --version
```

검증할 설치는 설치 결과의 `command`에 나온 절대 경로로 확인합니다.
아래 실행 파일 경로를 그 값으로 바꾸세요. 프로젝트 설치의 기본값은
`<project>/.codex-hud/bin/codex-hud`입니다.

```bash
"/absolute/prefix/bin/codex-hud" --version
"/absolute/prefix/bin/codex-hud" doctor --json \
  --bundle plugins/codex-hud/skills/codex-hud-install/assets/package.json
```

소스와 설치된 CLI가 의도한 버전을 출력하는지 확인합니다. 설치된 명령이 없거나
버전이 다르면 설치 버전 검증은 미완료입니다. 패키징은 별도로 설치된 HUD를
갱신하지 않습니다. 진단의 `codex`, `inline.available`,
`inline.probe.status == "ok"`도 확인합니다. node-pty를 불러오는 것만으로는
통과시킬 수 없으며 실제 PTY 자식을 실행해야 합니다. macOS에서는
`inline.helper.status`가 `executable`인지도 확인합니다.
사용자 설치의 PATH 연결은 새 터미널에서 `command -v codex-hud`로 별도 확인합니다.
프로젝트 설치는 HUD를 PATH에 추가하지 않으며, 절대 경로 없이 실행한 명령은
다른 설치를 가리킬 수 있습니다.

생성 파일은 다음과 같습니다.

- `plugins/codex-hud/skills/codex-hud-install/assets/my-codex-hud-<version>.tgz`
- `plugins/codex-hud/skills/codex-hud-install/assets/package.json` (이름·버전·파일명·SHA-256)
- `dist/codex-hud-plugin-<version>.zip`
- `dist/codex-hud-install-<version>.zip`

이 파일들은 직접 편집하지 않습니다. 자산 아카이브와 메타데이터는 Git에
포함하며 `dist/`는 제외합니다. 패키징 스크립트는 루트 MIT 라이선스도
플러그인에 복사합니다. 소스 루트에서 다음 검사로 버전·체크섬·동봉 문서를 확인합니다.

```bash
python3 -B - <<'PY'
import json
import runpy
import tarfile
from pathlib import Path

version = json.loads(Path("package.json").read_text())["version"]
lock = json.loads(Path("package-lock.json").read_text())
plugin = Path("plugins/codex-hud")
manifest = json.loads((plugin / ".codex-plugin/plugin.json").read_text())
skill = plugin / "skills/codex-hud-install"
archive, metadata = runpy.run_path(str(skill / "scripts/install.py"))["bundle"]()
assert version == lock["version"] == lock["packages"][""]["version"]
assert version == manifest["version"] == metadata["version"]
with tarfile.open(archive, "r:gz") as package:
    documents = [Path(name) for name in (
        "README.md", "CHANGELOG.md", "CONTRIBUTING.md", "AGENTS.md",
        "plugins/codex-hud/README.md",
    )] + sorted(Path("docs").rglob("*.md"))
    for path in documents:
        assert package.extractfile(f"package/{path}").read() == path.read_bytes(), path
print(f"Verified HUD {version}: {metadata['sha256']}")
PY
```

이어서 다음 읽기 전용 명령으로 두 ZIP을 체크아웃과 비교합니다. 아카이브 루트는
플러그인이 `codex-hud/`, 단독 스킬이 `codex-hud-install/`입니다.
패키징 도구와 같은 제외 규칙으로 모든 동봉 파일을 비교하므로 플러그인
매니페스트, 스킬 스크립트, 셸 템플릿, 메타데이터와 TGZ도 검사합니다.

```bash
python3 -B - <<'PY'
import json
from pathlib import Path
from zipfile import ZipFile

plugin = Path("plugins/codex-hud")
skill = plugin / "skills/codex-hud-install"
version = json.loads((plugin / ".codex-plugin/plugin.json").read_text())["version"]
for source, filename in (
    (plugin, f"codex-hud-plugin-{version}.zip"),
    (skill, f"codex-hud-install-{version}.zip"),
):
    expected = {
        (Path(source.name) / path.relative_to(source)).as_posix(): path
        for path in sorted(source.rglob("*"))
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"
    }
    with ZipFile(Path("dist") / filename) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)), (filename, "duplicate entries")
        assert set(names) == set(expected), (filename, "member set differs")
        for name, path in expected.items():
            assert archive.read(name) == path.read_bytes(), (filename, name)
    print(f"Verified {filename}: {len(expected)} files")
PY
```

패키지 내부 문서의 로컬 링크도 확인합니다. npm 패키지에는 설치 스크립트와
테스트가 없으며, 자세한 구성은 [설치 구현 참조](../reference/installation.md)를 따릅니다.
설치 자동 검증은 ZIP 대신 체크아웃의 대역 실행 파일을 사용하므로 새로운
플랫폼의 실제 설치나 VS Code 화면을 검증한 결과로 기록하지 않습니다.

설치기를 바꿨다면 기존 구버전의 사용자·프로젝트 prefix에 `--status`와 `--update`를
적용해 범위·사용자 지정 경로·언어·자동 실행·시작 파일을 보존하는지 확인합니다.
이미 설치된 버전이 더 새로우면 npm 실행 전에 거절해야 합니다. npm 패키지에는
`src/repair-node-pty.js`와 postinstall 명령이 포함되어야 합니다.
실제 macOS 검증과 모의 파일 권한 테스트는 구분해 기록합니다.

### GitHub 배포

저장소 목록은 `.agents/plugins/marketplace.json`입니다. `codex-hud` 항목은
`./plugins/codex-hud`를 가리켜야 하며, 같은 ref에 전체 스킬과 재생성한 TGZ가
있어야 합니다. 이 목록은 저장소 메타데이터이므로 단독 플러그인·스킬 ZIP 안에는
필요하지 않습니다.

일회용 Codex 프로필로 로컬 등록을 검증합니다. 요청받은 푸시로 ref가 공개된 뒤에는
GitHub 경로를 별도로 확인합니다.

```bash
codex plugin marketplace add whchoi98/my-codex-hud --ref main
codex plugin add codex-hud@codex-hud
```

GitHub 설치본 갱신은 `codex plugin marketplace upgrade codex-hud` 다음
`codex plugin add codex-hud@codex-hud`를 실행합니다. 이 명령들은 플러그인을
등록하며 HUD 실행 프로그램은 스킬로 별도 설치합니다. 가져온 커밋과 설치 버전을
기록하고 로컬 성공을 GitHub 공개 여부의 근거로 사용하지 않습니다. 공개 ref를
검증한 뒤 두 README의 날짜가 붙은 공개 상태 안내를 갱신합니다. GitHub 단독
스킬과 소스 설치 경로는 [설치 안내](../../plugins/codex-hud/README.md)를 참고하세요.

### 커밋과 푸시

Git 작업을 요청받으면 `.git` 경로 존재 여부만 확인하지 말고 실제 작업 트리를
검증합니다.

```bash
git rev-parse --is-inside-work-tree
git status --short --branch
git remote -v
git diff --check
git diff --cached --check
```

재생성한 자산 아카이브와 메타데이터를 포함해 의도한 파일만 검토·스테이징하고
요청한 브랜치와 원격을 사용합니다. 커밋에는 유효한 로컬 Git 저장소가
필요하며, 원격은 푸시를 요청받았을 때만 필요합니다.

### 복구

검사가 실패하면 원인을 수정하고 배포 파일을 다시 만듭니다. 과거 릴리스 기록은
보존합니다. 실행 중인 HUD가 바뀐 JavaScript를 읽으려면 재시작이 필요하지만,
패키징 과정에서 사용자의 Codex 세션을 종료하지 않습니다.
