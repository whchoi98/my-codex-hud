# Release and Git Preparation

<a href="#english">English</a> · <a href="#korean">한국어</a>

<a id="english"></a>
## English

### Prerequisites
Work from the source checkout with Node.js 20+, npm, Python 3.9+, and native PTY
dependencies available. Read [AGENTS.md](../../AGENTS.md).

### Documentation and versioning
Preserve README content and historical validation. Record unreleased work in
CHANGELOG. When releasing, synchronize root package.json, both root lockfile
version fields, plugin metadata, the README version, and plugin ZIP filenames.
Do not manually edit the bundled archive or generated asset metadata.

```bash
npm test
npm run check
npm run test:installer
npm run package:plugin
node bin/codex-hud.js --version
codex-hud --version
```

Repackage after the final source/document edit. Confirm archive versions,
checksums, CHANGELOG inclusion, and that packaged documentation links resolve.
The resulting `dist/` ZIPs are distribution artifacts; the installer asset
archive is part of the maintained source package.

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

Review and stage intended files only. Use the requested branch and remote.
Missing metadata or an unspecified remote is a setup issue to resolve before
committing/pushing, not evidence of a clean or published repository.

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
릴리스할 때 루트 package.json, 잠금 파일의 두 루트 버전, 플러그인 메타데이터,
README 버전, 플러그인 ZIP 파일명을 맞춥니다. 동봉 아카이브와 생성된 자산
메타데이터는 직접 수정하지 않습니다.

```bash
npm test
npm run check
npm run test:installer
npm run package:plugin
node bin/codex-hud.js --version
codex-hud --version
```

마지막 소스·문서 수정 후 패키지를 다시 만듭니다. 아카이브 버전, 체크섬,
CHANGELOG 포함 여부, 패키지 내부 문서 링크를 확인합니다. `dist/` ZIP은 배포
산출물이며 설치 스킬의 동봉 아카이브는 유지보수하는 소스 패키지에 포함합니다.

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

의도한 파일만 검토·스테이징하고 요청한 브랜치와 원격을 사용합니다. 메타데이터가
없거나 원격이 정해지지 않았다면 커밋·푸시 전에 해당 설정을 해결해야 합니다.
이는 저장소가 깨끗하거나 공개되었다는 근거가 아닙니다.

### 복구
검사가 실패하면 원인을 수정하고 배포 파일을 다시 만듭니다. 과거 릴리스 기록은
보존합니다. 실행 중인 HUD가 바뀐 JavaScript를 읽으려면 재시작이 필요하지만,
패키징 과정에서 사용자의 Codex 세션을 종료하지 않습니다.
