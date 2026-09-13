# Installation and Packaging

<a href="#english">English</a> · <a href="#korean">한국어</a>

<a id="english"></a>
## English

### Overview

Skill registration copies the complete bundle into a user or project's
`.agents/skills/codex-hud-install`. Runtime installation installs HUD into a
selected npm prefix and prepares shell integration. These are separate operations;
the [installer guide](../../plugins/codex-hud/README.md) covers commands and recovery.
GitHub plugin discovery uses the repository's `.agents/plugins/marketplace.json`,
whose `codex-hud` entry points to `./plugins/codex-hud`. Codex owns that plugin
cache; `install-skill.py` manages standalone skill copies separately.

### Components

The first three paths below are relative to
`plugins/codex-hud/skills/codex-hud-install/`; the packaging path is repository-relative.

| Component | Responsibility |
|---|---|
| `scripts/install-skill.py` | Validate the bundle, inventory ownership, register or update a skill, and retain backups. |
| `scripts/install.py` | Inspect/compare selected versions, install or update the runtime, preserve configuration, and verify real PTY startup. |
| `assets/codex-hud.sh` | Route Bash/Zsh calls through the active user/project installation or the original Codex. |
| [scripts/package-plugin.py](../../scripts/package-plugin.py) | Pack HUD, write asset metadata, copy the license, and create both ZIPs. |
| [src/installation.js](../../src/installation.js) | Read running HUD state and enabled plugin bundle metadata for doctor. |
| [src/repair-node-pty.js](../../src/repair-node-pty.js) | Inspect the selected macOS helper; explicitly repair known helper execute bits during npm postinstall or manual recovery. |

### Key decisions

- **Ownership:** `.codex-hud-skill.json` has format `1`, owner `codex-hud-install`,
  version and a file inventory. Entries record types, file/directory permissions,
  regular-file SHA-256 values and symlink targets. Updates from another bundle
  require a valid marker and unchanged owned entries. Deleted owned files and
  collisions with user-added files are errors; there is no `--force`.
  Identical registrations do not rewrite files; changed content can update even
  at the same version. Registration from the destination itself only validates.
- **Registration boundaries:** Source links must remain portable within the
  bundle. Symlinks in registration/backup directory paths are rejected.
  Updates preserve unrelated additions and stage under
  `.agents/.codex-hud-registration-*`, outside discovered skills. After rechecking
  the destination, the old directory moves to
  `.agents/skill-backups/codex-hud-install/<uuid>`. If replacement fails while the
  destination remains absent, restoration is attempted. Otherwise, or if restoration
  fails, the error identifies the retained backup.
  The ownership marker is written with mode `0600`.
- **Saved runtime state:** `<prefix>/shell.sh` carries the managed header, scope,
  language and autostart marker. Reinstallation preserves omitted language and
  enabled autostart; a prefix cannot switch scopes. Sourcing user integration adds
  the prefix's `bin` to PATH; only user installation edits selected startup files.
  Project prefixes must resolve to a subdirectory of the project.
  `--shell none --autostart` is project-only; user
  scope can preserve existing autostart with `--shell none` and no autostart flag.
- **Inspection and updates:** `--status` reads the exact selected prefix without
  npm/Codex prerequisites or writes. Before any npm install, SemVer comparison
  rejects a downgrade unless explicitly allowed and rejects unknown installed
  versions. Build metadata does not affect precedence. `--update` requires an
  existing runtime; it preserves scope/project/prefix/language/autostart and never
  rewrites startup files. It rejects shell-setting flags. Same-precedence updates
  return `unchanged`; repair can still reinstall the same version.
- **Persistent configuration:** Successful shell setup writes
  `<prefix>/install-state.json` atomically with mode `0600`, schema version `1` and
  owner `codex-hud-install`. It records the runtime version, scope, project, prefix,
  command, shell file, startup files, shell, language and autostart.
  Legacy installations recover their managed shell settings and known existing
  startup connections. An unrecoverable project root requires `--project-dir`;
  an arbitrary parent directory is not evidence of the original scope.
- **Doctor:** `hud` describes the command actually running, `plugin` describes
  enabled registrations, and `bundle` compares a cached or explicit metadata file.
  Ambiguous registered copies are not resolved by picking the highest version.
  `hud.autostart.configured` comes from managed configuration;
  `hud.autostart.active` remains `null` because parent-shell functions are not
  visible to this process. Filesystem/metadata problems are reported separately
  from native PTY availability. The bundle comparison does not verify TGZ integrity.
- **Failure boundaries:** Preflight checks Node, the bundle and startup markers.
  `--dry-run` returns the plan without installation or file writes. Actual
  installation runs npm, verifies the installed version and doctor's `codex`,
  `inline.available` and real probe result, then checks managed state/shell/startup
  files still match their earlier contents. Only then does it write shell files
  and install state. It refreshes doctor after writing configuration; a later
  diagnostic failure is a post-write failure, not a rollback. Startup writes preserve
  original modes; changed existing files receive `0600` backups under `<prefix>/backups/`.
  Each write is atomic, but the whole operation has no rollback: npm files can
  remain after failed validation, and later write failures can leave partial shell
  updates. npm output can precede the final JSON report on a successful install.
- **macOS permissions and probing:** npm postinstall runs
  `node src/repair-node-pty.js`. It restores execute bits for existing readable
  helper files in known Release/Debug/current-architecture prebuild locations;
  linked or nonregular targets are rejected. It does not load native code.
  Doctor inspects the helper selected by node-pty's successful native load and
  runs a bounded harmless Node PTY probe; it never repairs permissions.
  `--ignore-scripts` installations need the explicit repair command if execute bits
  are missing.
- **Active shell state:** There is one user slot and one project slot in each
  shell. Sourcing another project replaces `_CODEX_HUD_PROJECT_ROOT`,
  `_CODEX_HUD_PROJECT_COMMAND` and `_CODEX_HUD_PROJECT_LANGUAGE`.
  The wrapper checks physical cwd, including `-C` / `--cd` before `--`.
  Outside that project it uses the activated user command, otherwise Codex.
  Non-TTY and automation calls bypass HUD. Clearing the selected scope's variables
  disables that scope's autostart for future calls; sourcing its file restores it.
  Removing startup blocks does not clear already-loaded variables or functions.
- **Packaging contract:** `npm pack --ignore-scripts` uses the root package
  version; ZIP filenames use the plugin manifest version. The packager does not
  bump versions or enforce equality. `assets/package.json` records name, version,
  filename and SHA-256. `bundle()` checks TGZ integrity and its package name/version,
  not the separate installer scripts or shell template. ZIP roots are `codex-hud/`
  and `codex-hud-install/`; the release runbook compares their contents to source.
  The TGZ needs npm dependencies from the registry or a populated cache.

### Code pointers

Installer scripts and the shell template require the source checkout or an
extracted plugin/skill ZIP. Tests require the checkout. The npm payload includes
this documentation, the plugin README and packaging script, but omits installers
and tests; run packaging from the source checkout.

- `install-skill.py`: `inventory`, `read_marker`, `check_update`, `overlay`, `register`.
- `install.py`: `runtime_version`, `read_install_state`, `existing_configuration`,
  `bundle`, `shell_source`, `install`.
- `assets/codex-hud.sh`: `_codex_hud_interactive_args` and the `codex` function.
- Repository tests: `tests/test_skill_installer.py`, `tests/test_plugin_installer.py`.
  They use isolated directories and executable stand-ins; passing them does not
  establish installation on a new platform or interactive screen behavior.
- Doctor/native tests: `tests/doctor.test.js`, `tests/pty.test.js`,
  `tests/repair-node-pty.test.js`.

### Cross-references

- [Installer guide](../../plugins/codex-hud/README.md)
- [Release verification](../runbooks/release.md)
- [Architecture](../architecture.md), [Terminal](terminal.md)

<a id="korean"></a>
## 한국어

### 개요

스킬 등록은 사용자 또는 프로젝트의 `.agents/skills/codex-hud-install`에
전체 번들을 복사합니다. 실행 환경 설치는 선택한 npm prefix에 HUD를 설치하고
셸 연결을 준비합니다. 두 작업은 별개이며, 명령과 복구 방법은
[설치 안내](../../plugins/codex-hud/README.md)를 따릅니다.
GitHub 플러그인 탐색에는 저장소의 `.agents/plugins/marketplace.json`을 사용하며,
`codex-hud` 항목이 `./plugins/codex-hud`를 가리킵니다. 플러그인 캐시는 Codex가
관리하고, `install-skill.py`는 단독 스킬 사본을 별도로 관리합니다.

### 구성 요소

아래 처음 세 경로는 `plugins/codex-hud/skills/codex-hud-install/` 기준이며,
패키징 경로는 저장소 루트 기준입니다.

| 구성 요소 | 역할 |
|---|---|
| `scripts/install-skill.py` | 번들 검증, 소유 항목 조사, 스킬 등록·갱신과 백업을 담당합니다. |
| `scripts/install.py` | 선택한 버전 조회·비교, 실행 파일 설치·업데이트, 설정 보존과 실제 PTY 시작 검증을 담당합니다. |
| `assets/codex-hud.sh` | Bash/Zsh 호출을 활성 사용자·프로젝트 설치 또는 원래 Codex로 전달합니다. |
| [scripts/package-plugin.py](../../scripts/package-plugin.py) | HUD 패킹, 자산 메타데이터 작성, 라이선스 복사와 두 ZIP 생성을 담당합니다. |
| [src/installation.js](../../src/installation.js) | Doctor에서 실행 중인 HUD 설정과 활성 플러그인의 동봉 메타데이터를 읽습니다. |
| [src/repair-node-pty.js](../../src/repair-node-pty.js) | 선택된 macOS helper를 진단하고, npm postinstall 또는 명시한 수동 복구에서 알려진 helper 실행 비트를 보완합니다. |

### 주요 결정

- **소유 정보:** `.codex-hud-skill.json`은 형식 `1`, 소유자 `codex-hud-install`,
  버전과 파일 목록을 담습니다. 각 항목에는 유형, 파일·디렉터리 권한, 일반 파일의
  SHA-256과 심볼릭 링크 대상이 기록됩니다. 다른 번들로 갱신하려면 유효한 소유
  표식과 변경되지 않은 소유 항목이 필요합니다. 소유 파일 삭제나 사용자가 추가한
  파일과의 충돌은 오류이며 `--force`는 없습니다. 같은 내용으로 재등록하면
  파일을 다시 쓰지 않지만, 같은 버전이라도 내용이 바뀌면 갱신합니다.
  등록 대상 자체에서 실행하면 검증만 합니다.
- **등록 경계:** 소스 링크는 번들 내부에서 이동 가능한 형태여야 합니다.
  등록·백업 디렉터리 경로의 심볼릭 링크는 거부합니다. 갱신은 사용자의 추가 파일을
  보존하며, 탐색되는 스킬 폴더 밖의 `.agents/.codex-hud-registration-*`에서
  준비합니다. 대상을 다시 확인한 뒤 기존 폴더를
  `.agents/skill-backups/codex-hud-install/<uuid>`로 옮깁니다. 교체 실패 후 대상이
  여전히 없으면 복원을 시도합니다. 대상이 생겼거나 복원도 실패하면 오류에 보관된
  백업 위치를 표시합니다.
  소유 표식은 `0600` 권한으로 씁니다.
- **저장된 실행 설정:** `<prefix>/shell.sh`에 관리 헤더, 범위, 언어와 자동 실행
  표식을 저장합니다. 재설치에서 언어를 생략하거나 이미 켜진 자동 실행을 생략하면
  기존 값을 유지하며, 같은 prefix의 범위를 바꿀 수 없습니다. 사용자 연결 파일을
  읽으면 prefix의 `bin`을 PATH에 추가하며, 사용자 설치만 선택한 시작 파일을
  수정합니다. 프로젝트 prefix는 실제 경로가 프로젝트의 하위 디렉터리여야 합니다.
  `--shell none --autostart`는
  프로젝트 전용이며, 사용자 범위는 `--shell none`만 주고 자동 실행 옵션을
  생략해 기존 자동 실행을 유지할 수 있습니다.
- **조회와 업데이트:** `--status`는 npm·Codex 설치 조건이나 파일 쓰기 없이
  선택한 prefix를 읽습니다. npm 실행 전 SemVer를 비교해 명시적으로 허용하지
  않은 다운그레이드와 확인할 수 없는 설치 버전을 거부합니다. 빌드 메타데이터는
  버전 우선순위에 반영하지 않습니다. `--update`는 기존 실행 파일을 요구하고
  범위·프로젝트·prefix·언어·자동 실행 설정을 보존하며 시작 파일을 다시 쓰지 않습니다.
  셸 설정 변경 옵션은 거부합니다. 같은 우선순위의 버전은 `unchanged`로 끝나며,
  복구에서는 같은 버전을 다시 설치할 수 있습니다.
- **설정 저장:** 셸 설정을 마치면 `<prefix>/install-state.json`을 `0600` 권한으로
  원자적으로 기록합니다. 스키마 버전은 `1`, 소유자는 `codex-hud-install`이며,
  실행 버전·범위·프로젝트·prefix·명령·셸 파일·시작 파일·셸·언어·자동 실행을 담습니다.
  과거 설치는 관리된 셸 설정과 확인 가능한 기존 시작 파일 연결을 복원합니다.
  프로젝트 루트를 복원할 수 없으면 `--project-dir`이 필요하며, 임의의 부모
  디렉터리를 원래 범위로 간주하지 않습니다.
- **Doctor:** `hud`는 실제 실행한 명령, `plugin`은 활성 등록, `bundle`은 캐시나
  명시한 메타데이터의 버전 비교를 나타냅니다. 등록이 여러 개라고 가장 높은 버전을
  임의로 고르지 않습니다. `hud.autostart.configured`는 관리 설정을 읽으며,
  부모 셸의 함수를 볼 수 없어 `hud.autostart.active`는 `null`입니다. 파일·메타데이터
  오류는 네이티브 PTY 가용성과 별도로 보고합니다. 버전 비교만으로 TGZ 무결성을
  검증하지 않습니다.
- **실패 경계:** 사전 검사에서 Node, 번들과 시작 파일 표식을 확인합니다.
  `--dry-run`은 설치나 파일 쓰기 없이 계획을 반환합니다. 실제 설치는 npm 실행,
  설치 버전과 진단의 `codex`·`inline.available`·실제 probe 결과 확인, 관리 상태·셸·
  시작 파일의 기존 내용 재확인을 마친 뒤 셸 파일과 설치 상태를 씁니다.
  설정 기록 후 doctor를 다시 실행하며, 이때 실패하면 파일 기록 후의 실패로
  보고하고 롤백한 것으로 처리하지 않습니다. 시작 파일은 원래 권한을
  유지하며, 변경되는 기존 파일의 백업은 `<prefix>/backups/`에 `0600` 권한으로 씁니다.
  각 쓰기는 원자적이지만 전체 작업을 되돌리지는 않습니다. 검증 실패 후 npm
  파일이 남거나, 후속 쓰기 실패로 셸 파일 일부만 갱신될 수 있습니다.
  설치 성공 시에도 최종 JSON 보고서 앞에 npm 출력이 올 수 있습니다.
- **macOS 권한과 프로브:** npm postinstall이 `node src/repair-node-pty.js`를 실행합니다.
  알려진 Release·Debug·현재 아키텍처의 prebuild 위치에서 읽을 수 있는 기존
  helper의 실행 비트를 복구하며, 링크나 일반 파일이 아닌 대상은 거부합니다.
  네이티브 코드는 불러오지 않습니다. Doctor는 node-pty가 실제로 불러온 네이티브
  모듈의 helper를 확인하고, 제한 시간 안에서 무해한 Node PTY를 실행합니다.
  Doctor 자체는 권한을 복구하지 않습니다. `--ignore-scripts` 설치에서 실행 비트가
  없으면 명시적인 복구 명령이 필요합니다.
- **활성 셸 설정:** 셸마다 사용자 설정과 프로젝트 설정을 하나씩 유지합니다.
  다른 프로젝트를 활성화하면 `_CODEX_HUD_PROJECT_ROOT`,
  `_CODEX_HUD_PROJECT_COMMAND`, `_CODEX_HUD_PROJECT_LANGUAGE`가 교체됩니다.
  함수는 `--` 앞의 `-C` / `--cd`를 포함한 실제 작업 디렉터리를 검사합니다.
  프로젝트 밖에서는 활성 사용자 명령을 사용하고, 없으면 Codex로 전달합니다.
  비TTY 실행과 자동화 명령은 HUD를 거치지 않습니다. 선택한 범위의 변수를 비우면
  그 셸의 이후 자동 실행을 해제하며, 해당 파일을 다시 읽으면 복원됩니다.
  시작 파일 블록을 지워도 이미 읽은 변수나 함수는 없어지지 않습니다.
- **패키징 계약:** `npm pack --ignore-scripts`는 루트 패키지 버전을,
  ZIP 파일명은 플러그인 매니페스트 버전을 사용합니다. 패키징 도구는 버전을
  올리거나 두 값의 일치를 강제하지 않습니다. `assets/package.json`은 이름,
  버전, 파일명과 SHA-256을 기록합니다. `bundle()`은 TGZ 무결성과 내부 패키지
  이름·버전을 검사하며 별도의 설치 스크립트나 셸 템플릿은 검사하지 않습니다.
  ZIP 루트는 `codex-hud/`와 `codex-hud-install/`이며, 릴리스 런북에서 내용을
  소스와 비교합니다. TGZ 설치에는 레지스트리나 채워진 캐시의 npm 의존성이 필요합니다.

### 코드 위치

설치 스크립트와 셸 템플릿은 소스 체크아웃 또는 압축을 푼 플러그인·스킬 ZIP에
있으며 테스트에는 체크아웃이 필요합니다. npm 패키지는 이 문서, 플러그인 README와
패키징 스크립트를 포함하지만 설치 도구와 테스트는 제외합니다. 패키징은 소스
체크아웃에서 실행합니다.

- `install-skill.py`: `inventory`, `read_marker`, `check_update`, `overlay`, `register`.
- `install.py`: `runtime_version`, `read_install_state`, `existing_configuration`,
  `bundle`, `shell_source`, `install`.
- `assets/codex-hud.sh`: `_codex_hud_interactive_args`와 `codex` 함수.
- 저장소 테스트: `tests/test_skill_installer.py`, `tests/test_plugin_installer.py`.
  격리된 디렉터리와 대역 실행 파일을 사용하므로 통과 결과만으로 새 플랫폼의
  실제 설치나 대화형 화면 동작을 확인할 수는 없습니다.
- Doctor·네이티브 검증: `tests/doctor.test.js`, `tests/pty.test.js`,
  `tests/repair-node-pty.test.js`.

### 관련 문서

- [설치 안내](../../plugins/codex-hud/README.md)
- [릴리스 검증](../runbooks/release.md)
- [아키텍처](../architecture.md), [터미널](terminal.md)
