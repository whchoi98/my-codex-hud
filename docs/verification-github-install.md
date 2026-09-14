# GitHub Installation Verification

Date: 2026-09-13

[![English](https://img.shields.io/badge/lang-English-blue)](#english) [![한국어](https://img.shields.io/badge/lang-%ED%95%9C%EA%B5%AD%EC%96%B4-red)](#한국어)

<a id="english"></a>
## English

The initial checks below describe the pre-publication snapshots. The follow-up
records successful installation from GitHub after the catalogue was pushed.

### Scope and environment

Checked the GitHub installation pattern used by `whchoi98/codex-project-init`
against this HUD repository. Environment: Linux, Node.js 20.20.1, npm 10.8.2,
Python 3.9.25, and Codex CLI 0.154.0.

The fetched `whchoi98/my-codex-hud` `main` commit was
`1a02656fb6534f2838286ddc217b546746f749f5`, with HUD 0.5.2 and no
`.agents/plugins/marketplace.json`. The local working tree was 0.6.0, with the
new `codex-hud` catalogue pointing to `./plugins/codex-hud`.
The reference README was read from GitHub; command syntax was also checked
against the installed CLI's `plugin marketplace add` and `plugin add` help.

### Results

| Trial | Result |
| --- | --- |
| GitHub standalone skill download | Passed with `skill-installer`'s `install-skill-from-github.py`, selecting `plugins/codex-hud/skills/codex-hud-install` and a temporary `--dest`. |
| Runtime install from that downloaded skill | Passed: 0.5.2 in a temporary prefix, `--shell none`, no startup-file edits, valid version/JSON demo, and `doctor.inline.available: true`. |
| GitHub source install | Passed: a fresh clone, `npm ci`, and `npm install --global --prefix <temporary-prefix> .`; installed 0.5.2 and passed the Codex/PTY diagnostics. |
| GitHub marketplace registration | Failed as expected for the recorded public commit: `marketplace root does not contain a supported manifest`. |
| Local marketplace registration and plugin install | Passed in a disposable Codex profile: `codex plugin marketplace add <checkout>`, then `codex plugin add codex-hud@codex-hud`; CLI listed 0.6.0 as installed and enabled. |
| Regenerated standalone skill ZIP | Passed: extracted ZIP, registered the skill into a temporary project's `.agents/skills`, then installed through that registered copy with `--scope project --shell none --autostart`. |
| Project runtime verification | Passed: 0.6.0, `startupFiles: []`, autostart enabled in the generated shell file, valid JSON demo, and available PTY. |

All runtime installation trials used isolated prefixes and Codex profiles.
No model prompts were sent. Project registration and installation did not create
user startup files. The local plugin trial proves catalogue layout and installation;
it does not prove that the pending catalogue has been published on GitHub.

### Supporting checks

- `npm test`: 284 passed. The initial restricted execution lost child Node
  stdout/stderr and reported two failing test files. A standalone child-process
  probe reproduced empty stream output and `spawnSync EPERM`; rerunning the suite
  outside that sandbox passed without code changes.
- `npm run check`: syntax checked 38 JavaScript files.
- `npm run test:installer`: 62 tests, 61 passed and one Zsh test skipped because
  Zsh was not installed.
- Project Init document/local-link checks and `git diff --check` passed.
- Plugin and marketplace validation passed. Local source, installed CLI, lockfile,
  plugin metadata, and bundled runtime versions agreed at 0.6.0.
- The [release runbook](runbooks/release.md) checks passed for bundled SHA-256,
  packaged documentation including CHANGELOG, and both ZIP member sets/content.

No manual VS Code GUI test was performed. GitHub plugin installation requires
the catalogue and its referenced plugin to be present in the published ref.
After publication, repeat the GitHub commands in [README](../README.md) and update
its public-status note; this record describes the snapshots tested above.

### After publication

On 2026-09-13, commit `b6393153f09639eb30d90efa4dc8805367b57a3b` was pushed to
`origin/main`. In a fresh temporary Codex profile, these commands all exited 0:

```bash
codex plugin marketplace add whchoi98/my-codex-hud --ref main --json
codex plugin add codex-hud@codex-hud --json
codex plugin list --json
```

The installed plugin was `codex-hud@codex-hud` version 0.6.0, enabled and installed
from the GitHub marketplace. Its cached bundle and metadata matched the published
checkout byte for byte; SHA-256 verification passed. The remote `main` SHA matched
the pushed commit. The READMEs were then updated to describe the available GitHub
installation route. The earlier 0.5.2 results remain as the pre-publication record.

<a id="korean"></a>
## 한국어

아래 최초 검사는 공개 전 소스를 대상으로 한 기록입니다. 후속 검증에는 목록을
푸시한 뒤 GitHub에서 설치에 성공한 결과를 추가했습니다.

### 범위와 환경

`whchoi98/codex-project-init`의 GitHub 설치 방식을 HUD 저장소에서도 사용할 수
있는지 확인했습니다. 환경은 Linux, Node.js 20.20.1, npm 10.8.2,
Python 3.9.25, Codex CLI 0.154.0입니다.

가져온 `whchoi98/my-codex-hud`의 `main` 커밋은
`1a02656fb6534f2838286ddc217b546746f749f5`입니다. HUD 버전은 0.5.2이며
`.agents/plugins/marketplace.json`은 없었습니다. 로컬 작업 트리는 0.6.0이며,
새 `codex-hud` 목록이 `./plugins/codex-hud`를 가리킵니다.
참고 저장소의 README는 GitHub에서 읽었고, 설치된 CLI의
`plugin marketplace add`와 `plugin add` 도움말로 명령 구문도 확인했습니다.

### 결과

| 검증 | 결과 |
| --- | --- |
| GitHub 단독 스킬 다운로드 | 통과. `skill-installer`의 `install-skill-from-github.py`로 `plugins/codex-hud/skills/codex-hud-install`을 임시 `--dest`에 설치했습니다. |
| 내려받은 스킬로 HUD 설치 | 통과. 임시 prefix에 0.5.2를 `--shell none`으로 설치했고, 시작 파일 수정 없이 버전·JSON 데모·`doctor.inline.available: true`를 확인했습니다. |
| GitHub 소스 설치 | 통과. 새 clone에서 `npm ci`, `npm install --global --prefix <임시-prefix> .`를 실행했고, 설치된 0.5.2의 Codex·PTY 진단이 정상이었습니다. |
| GitHub 마켓플레이스 등록 | 기록한 공개 커밋에서는 예상대로 실패했습니다. 오류는 `marketplace root does not contain a supported manifest`입니다. |
| 로컬 목록 등록과 플러그인 설치 | 일회용 Codex 프로필에서 통과. `codex plugin marketplace add <체크아웃>` 다음 `codex plugin add codex-hud@codex-hud`를 실행했고, CLI가 0.6.0을 설치·활성 상태로 표시했습니다. |
| 재생성한 단독 스킬 ZIP | 통과. ZIP을 풀어 임시 프로젝트의 `.agents/skills`에 등록한 뒤, 그 사본에서 `--scope project --shell none --autostart`로 설치했습니다. |
| 프로젝트 HUD 검증 | 통과. 버전 0.6.0, `startupFiles: []`, 생성된 셸 파일의 자동 실행 설정, JSON 데모와 PTY 가용성을 확인했습니다. |

실제 HUD 설치는 모두 격리된 prefix와 Codex 프로필을 사용했고 모델 프롬프트를
보내지 않았습니다. 프로젝트 등록·설치는 사용자 시작 파일을 만들지 않았습니다.
로컬 플러그인 검증은 목록 구조와 설치 동작을 확인한 결과이며, 아직 반영하지 않은
목록이 GitHub에 공개됐다는 뜻은 아닙니다.

### 함께 수행한 검사

- `npm test`: 284개 통과. 처음 제한된 환경에서는 자식 Node의 stdout/stderr가
  비어 두 테스트 파일이 실패했습니다. 별도 자식 프로세스 명령에서도 빈 스트림
  출력과 `spawnSync EPERM`을 재현했고, 코드 수정 없이 샌드박스 밖에서 재실행해
  통과했습니다.
- `npm run check`: JavaScript 파일 38개 문법 검사.
- `npm run test:installer`: 총 62개 중 61개 통과. Zsh가 없어 관련 테스트 1개를
  건너뛰었습니다.
- Project Init의 문서·로컬 링크 검사와 `git diff --check` 통과.
- 플러그인·마켓플레이스 검증 통과. 로컬 소스, 설치된 CLI, 잠금 파일, 플러그인
  메타데이터와 동봉 실행 패키지 버전이 0.6.0으로 일치했습니다.
- [릴리스 런북](runbooks/release.md)의 SHA-256, CHANGELOG를 포함한 동봉 문서,
  두 ZIP의 파일 목록·내용 비교 검사 통과.

VS Code GUI 수동 검증은 수행하지 않았습니다. GitHub 플러그인 설치에는 공개된
ref 안에 목록과 해당 플러그인이 함께 있어야 합니다. 공개 후 [README](../README.md)의
GitHub 명령을 다시 검증하고 공개 상태 안내를 갱신합니다. 이 기록은 위에서
확인한 시점의 소스와 설치 결과를 설명합니다.

### 공개 후 검증

2026-09-13에 `b6393153f09639eb30d90efa4dc8805367b57a3b` 커밋을
`origin/main`에 푸시했습니다. 새 임시 Codex 프로필에서 다음 명령이 모두
종료 코드 0으로 완료됐습니다.

```bash
codex plugin marketplace add whchoi98/my-codex-hud --ref main --json
codex plugin add codex-hud@codex-hud --json
codex plugin list --json
```

GitHub 마켓플레이스에서 `codex-hud@codex-hud` 0.6.0을 설치했고,
설치·활성 상태를 확인했습니다. 캐시의 동봉 패키지와 메타데이터는 공개한
체크아웃과 바이트 단위로 일치했으며 SHA-256 검증도 통과했습니다.
원격 `main`의 SHA가 푸시한 커밋과 일치하는지도 확인했습니다.
이후 두 README를 실제 사용 가능한 GitHub 설치 상태로 갱신했습니다.
앞의 0.5.2 결과는 공개 전 기록으로 보존합니다.
