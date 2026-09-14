# Codex HUD 0.7.0 Verification

Date: 2026-09-13

[![English](https://img.shields.io/badge/lang-English-blue)](#english) [![한국어](https://img.shields.io/badge/lang-%ED%95%9C%EA%B5%AD%EC%96%B4-red)](#한국어)

<a id="english"></a>
## English

### Evidence and scope

Automated checks ran on Linux with Node.js 20.20.1, npm 10.8.2, Python 3.9.25,
and Codex CLI 0.154.0. The source started from `5b23e95` (0.6.0), matching
`origin/main` when work began.

The user supplied separate Mac evidence: arm64, Node.js 24.8.0, Zsh and
`TERM_PROGRAM=ghostty`; the HUD function was loaded. They verified that the
installed `spawn-helper` matched the npm archive, a fresh temporary installation
was reported successful but could not start HUD, and changing only helper
permissions from `0644` to `0744` made the same start command succeed.
These are user-reported checks of the existing installation, not a Mac GUI test
of this new release.

The node-pty 1.1.0 archive was independently downloaded using the URL in the source
checkout's `package-lock.json` and matched its SHA-512 integrity value.
Both `package/prebuilds/darwin-arm64/spawn-helper` and
`package/prebuilds/darwin-x64/spawn-helper` had mode `0644`, with no execute bit.
This establishes missing execute bits in the dependency distribution itself.

### Automated checks

| Check | Result |
| --- | --- |
| `npm test` | 327 passed; no failures or skips. |
| `npm run check` | 42 JavaScript files syntax checked. |
| `npm run test:installer` | 112 tests: 111 passed, one Zsh test skipped because Zsh was unavailable. |
| Doctor/CLI regressions | Running source/installed paths, configured versus active state, explicit/automatic bundle comparison, ambiguous plugins, malformed metadata, legacy project roots, bounded rejection of expanding paths and terminal context. |
| Native PTY regressions | Real harmless Node spawn/exit, startup failure, timeout cleanup, selected helper diagnostics and errors without prompt/argv disclosure. |
| Helper repair regressions | Execute-bit restoration, idempotence, preserved bytes/unrelated permissions, supported layouts and refusal of linked or nonregular targets. |
| Installer regressions | Read-only status, downgrade/unknown-version refusal before npm, SemVer ordering, scope preservation, legacy root recovery, and rejection of load-only doctor success. |

### Real installation and update trials

Trials used temporary homes, prefixes and Codex profiles with actual npm
installations. No model requests or real user startup-file edits were made.

- A 0.6.0 **user** installation used a custom prefix, Zsh startup file, English and
  enabled autostart. Updating to 0.7.0 while `SHELL` named Bash preserved all
  settings and the startup file's bytes/mode/mtime. The final report and a fresh
  doctor read agreed on 0.7.0 and `inline.probe.status: ok`.
- A 0.6.0 **project** installation used a nested custom prefix, Korean and disabled
  autostart. Its unrecoverable legacy project root was rejected until explicitly
  supplied. The update preserved the root, prefix, language and disabled autostart,
  with no user startup edits and a successful real PTY probe.
- A current installer paired with an older 0.6.0 bundle refused to replace the
  installed 0.7.0 runtime. Installation state, shell file, package version and
  startup file were unchanged. A same-version update returned `unchanged` without
  rewriting those files.
- An independent skill trial requested an update using only an older local bundle.
  It inspected the selected prefix, reported the downgrade, and retained 0.7.0.
  Follow-up hashes/modes/timestamps confirmed the runtime metadata, install state,
  shell file and Zsh startup file were unchanged.
- The distributed repair module was run against the actual installed node-pty
  payload in subprocesses configured to exercise Darwin arm64/x64 file selection
  on Linux. Each selected helper changed from `0664` to `0775`; bytes and all
  non-execute permission bits were preserved. This checks repair of real payload
  files, not execution of a macOS binary.

The [release runbook](runbooks/release.md) checks compare versions, bundled
SHA-256, all packaged Markdown and both ZIP member sets/content. The npm payload
includes the repair module and its postinstall command. Historical validation
records were preserved.

### Limits

No new macOS iTerm/cmux GUI session was executed from this Linux environment.
The new doctor proves a harmless Node PTY can start; it does not prove a Codex
screen is visible or that the parent shell has activated autostart.
Installation can leave npm or configuration files changed when a later check
fails; errors distinguish failure after configuration writes from a rollback.
Older installer copies do not gain the new downgrade guard automatically.

### User confirmation (2026-09-14)

Following the 0.7.0 release, the user confirmed that HUD operates normally on
their Mac. This is a user-provided real-device confirmation that supplements
the automated Linux checks recorded above.

### README command checks (2026-09-14)

The bilingual README update changed documentation and bundled assets, with no
runtime, dependency or test edits. Existing release checks above retain their
original scope. New coverage examples were checked on Linux with Node.js 20.20.1:

| Command | Result |
| --- | --- |
| `npm test -- --experimental-test-coverage` | 326 passed, one failed: the short-PTY watch test reported `last agent was lost after resize`. |
| `node --experimental-test-coverage --test --test-name-pattern='watch pages through' tests/watch.test.js` | The failing test passed in isolation; five unrelated tests were skipped by the name filter. |
| `node --experimental-test-coverage --test tests/render.test.js` | 34 passed, with a coverage report for the selected rendering tests. |

The full-suite failure occurred after the test resized its PTY and immediately
sent page-down keys; the final viewport showed `HUD 37-41/45`. An isolated pass
does not establish that the timing failure is fixed. The README documents the
verified rendering-only coverage command and does not claim full-suite coverage
success.

<a id="korean"></a>
## 한국어

### 근거와 범위

자동 검증 환경은 Linux, Node.js 20.20.1, npm 10.8.2, Python 3.9.25,
Codex CLI 0.154.0입니다. 작업 시작 소스는 `5b23e95`(0.6.0)이며,
당시 `origin/main`과 일치했습니다.

사용자는 별도의 맥북 검증 결과를 제공했습니다. arm64, Node.js 24.8.0,
Zsh, `TERM_PROGRAM=ghostty` 환경에서 HUD 함수가 로드된 상태였습니다.
설치된 `spawn-helper`가 npm 원본과 일치하고, 임시 새 설치도 성공으로
판정되지만 HUD 시작은 실패하며, 권한만 `0644 → 0744`로 바꾸면 같은 시작
명령이 성공했다고 확인했습니다. 이는 기존 설치에 대한 사용자 제공 근거이며,
이 새 버전의 Mac GUI 검증 결과로 간주하지 않습니다.

별도로 소스 체크아웃의 `package-lock.json`에 기록된 URL에서 node-pty 1.1.0을
내려받아 SHA-512 무결성이 일치하는지 확인했습니다.
`package/prebuilds/darwin-arm64/spawn-helper`와
`package/prebuilds/darwin-x64/spawn-helper` 모두 실행 비트 없는 `0644`였습니다.
따라서 의존성 배포물 자체의 실행 비트 누락까지 확인했습니다.

### 자동 검사

| 검사 | 결과 |
| --- | --- |
| `npm test` | 327개 통과. 실패·건너뜀 없음. |
| `npm run check` | JavaScript 파일 42개 문법 검사. |
| `npm run test:installer` | 총 112개 중 111개 통과. Zsh가 없어 관련 테스트 1개 건너뜀. |
| Doctor·CLI 회귀 | 실행한 소스·설치 경로, 설정과 활성화 구분, 명시·자동 동봉 버전 비교, 중복 플러그인, 잘못된 메타데이터, 과거 프로젝트 루트, 경로 확장의 빠른 거부와 터미널 정보. |
| 네이티브 PTY 회귀 | 실제 Node 시작·종료, 시작 실패, 시간 초과 정리, 선택된 helper 진단과 프롬프트·argv를 노출하지 않는 오류. |
| Helper 복구 회귀 | 실행 비트 복구, 반복 실행, 파일 내용·다른 권한 보존, 지원 경로와 링크·비일반 파일 거부. |
| 설치기 회귀 | 읽기 전용 상태, npm 전 다운그레이드·버전 미확인 차단, SemVer 비교, 범위 보존, 과거 루트 복원과 로딩만 확인한 진단 결과의 거부. |

### 실제 설치·업데이트 검증

임시 홈·prefix·Codex 프로필에서 실제 npm 설치를 사용했습니다.
모델 요청이나 실제 사용자 시작 파일의 수정은 수행하지 않았습니다.

- 0.6.0 **사용자** 설치에 사용자 지정 prefix, Zsh 시작 파일, 영문과 자동 실행을
  설정했습니다. `SHELL`을 Bash로 바꾼 환경에서 0.7.0으로 업데이트해도 설정과
  시작 파일의 내용·권한·수정 시각이 유지됐습니다. 완료 보고서와 새 doctor 결과가
  모두 0.7.0과 `inline.probe.status: ok`를 확인했습니다.
- 0.6.0 **프로젝트** 설치는 중첩된 사용자 지정 prefix, 한글, 자동 실행 꺼짐을
  사용했습니다. 과거 프로젝트 루트가 복원되지 않으면 거부하고, 루트를 명시하면
  정확히 보존했습니다. prefix·언어·자동 실행도 유지됐으며 사용자 시작 파일 수정
  없이 실제 PTY probe가 통과했습니다.
- 현재 설치 스크립트에 과거 0.6.0 동봉 패키지를 제공했을 때 설치된 0.7.0 교체를
  거절했습니다. 설치 상태·셸 파일·패키지 버전·시작 파일은 그대로였습니다.
  같은 버전의 업데이트도 `unchanged`로 끝나며 해당 파일을 다시 쓰지 않았습니다.
- 독립된 스킬 실행 검증에서도 오래된 로컬 번들만 주고 업데이트를 요청했습니다.
  선택한 prefix를 조회해 다운그레이드를 알리고 0.7.0을 유지했습니다. 이후
  해시·권한·수정 시각으로 실행 메타데이터·설치 상태·셸 파일·Zsh 시작 파일이
  바뀌지 않았는지 확인했습니다.
- 배포되는 복구 모듈을 실제 설치된 node-pty 파일에 적용했습니다. Linux 하위
  프로세스에서 Darwin arm64·x64 파일 선택을 각각 모의했고, 선택한 helper는
  `0664 → 0775`로 바뀌었습니다. 파일 내용과 실행 비트 외의 권한은 유지됐습니다.
  실제 배포 파일의 권한 복구 검증이며 macOS 바이너리를 실행한 결과는 아닙니다.

[릴리스 런북](runbooks/release.md)의 검사는 버전, 동봉 SHA-256, 전체 Markdown과
두 ZIP의 파일 목록·내용을 비교합니다. npm 패키지에는 복구 모듈과 postinstall
명령이 포함됩니다. 과거 버전의 검증 기록은 보존했습니다.

### 검증 한계

이 Linux 환경에서 새 macOS iTerm·cmux GUI 세션을 직접 실행하지는 않았습니다.
새 doctor는 무해한 Node PTY가 시작하는지 확인하며, Codex 화면 표시나 부모
셸의 자동 실행 활성화를 보장하지 않습니다. 후속 검사가 실패하면 npm 또는
설정 파일이 이미 변경됐을 수 있으며, 설정 기록 후 실패를 롤백으로 보고하지
않습니다. 과거 설치 스크립트 사본에는 다운그레이드 방지가 자동 적용되지 않습니다.

### 사용자 후속 확인 (2026-09-14)

0.7.0 배포 후 사용자가 맥에서 HUD가 정상 동작한다고 확인했습니다.
사용자가 제공한 실기기 확인 결과이며, 위에 기록한 Linux 자동 검증을
보완하는 근거로 추가합니다.

### README 명령 확인 (2026-09-14)

이중 언어 README 작업은 문서와 동봉 자산을 갱신했으며, 런타임·의존성·테스트는
수정하지 않았습니다. 위 릴리스 검증의 원래 범위는 유지합니다.
새 커버리지 예제는 Linux의 Node.js 20.20.1에서 확인했습니다.

| 명령 | 결과 |
| --- | --- |
| `npm test -- --experimental-test-coverage` | 326개 통과, 1개 실패입니다. 짧은 PTY의 watch 테스트에서 `last agent was lost after resize`가 발생했습니다. |
| `node --experimental-test-coverage --test --test-name-pattern='watch pages through' tests/watch.test.js` | 실패했던 테스트는 단독 실행에서 통과했으며, 무관한 테스트 5개는 이름 필터로 건너뛰었습니다. |
| `node --experimental-test-coverage --test tests/render.test.js` | 34개가 통과하고 선택한 렌더링 테스트의 커버리지 보고서를 출력했습니다. |

전체 실행에서는 테스트가 PTY 크기를 바꾼 직후 PageDown을 전달한 뒤 실패했으며,
최종 뷰포트는 `HUD 37-41/45`였습니다. 단독 실행의 통과만으로 타이밍 문제가
해결됐다고 판단하지 않습니다. README에는 확인된 렌더링 전용 커버리지 명령을
안내하며, 전체 커버리지 실행이 통과했다고 표시하지 않습니다.
