# Codex HUD 0.8.0 Verification

Date: 2026-10-18

[![English](https://img.shields.io/badge/lang-English-blue)](#english) [![한국어](https://img.shields.io/badge/lang-%ED%95%9C%EA%B5%AD%EC%96%B4-red)](#한국어)

## English

### Environment and results

Checks ran on Linux arm64 with Node.js 22.23.3 and 24.22.0, Python 3.9.25,
and Codex CLI 0.163.0. Official Node archives were checked against their published
SHA-256 sums. `npm ci` installed the locked dependencies using Node 24.

| Check | Result |
| --- | --- |
| `npm test -- --test-reporter=spec` on Node 22 | 339 passed; no failures or skips. |
| The same command on Node 24 | 339 passed; no failures or skips. |
| `npm run check` | 42 JavaScript files syntax checked. |
| `npm run test:installer` | 113 tests: 112 passed, one skipped because local Zsh was unavailable. |
| `node --experimental-test-coverage --test --test-reporter=spec tests/watch.test.js` | Six passed, including PTY resize and paging. |
| Source and existing linked `codex-hud --version` | Both reported 0.8.0. |
| Installed command's `doctor --json --bundle .../assets/package.json` on Node 24 | `inline.available: true`, `inline.probe.status: ok`, bundle comparison `same`. |

### Regression evidence

Worktree tests first reproduced missing discovery in inline/tmux and the CLI.
Real temporary Git worktrees cover opt-in discovery, exact-root matching,
child-session exclusion, fresh-session cutoffs, explicit sessions, new/removed
registrations, paths containing spaces/Unicode/newlines, and unavailable Git.
A review also reproduced a stale worktree path reused by another repository;
canonical Git common-directory comparison now rejects it. The added regression
failed before that fix and passed afterward.

An isolated Codex 0.163.0 fork metadata check, without a submitted model turn,
recorded a new timestamp and a managed worktree cwd, supporting the fresh-session
cutoff used for `fork <UUID> --worktree`.

Installer tests first showed Node 20/21 being accepted. They now verify refusal
before npm or configuration writes, and successful dry-runs with Node 22/24.
The watch paging test waits for the child's resized viewport before sending keys.
The historical failure in [0.7.0](verification-0.7.0.md) remains unchanged.

### Execution and distribution limits

Initial environment-prefixed test commands inside the execution sandbox lost
nested Node stdout and test-runner messages, producing four file-level failures.
A minimal independent child-process probe reproduced the lost output. Identical
commands outside that sandbox preserved the output and passed; the full results
above use that execution path. No production code or test assertions were weakened
to accommodate the sandbox.

The new CI workflow configures Linux/macOS × Node 22/24 with Python 3.11 and
installs Zsh on Linux. Its YAML, shell commands and bundle-check script were
validated locally. This session did not execute hosted GitHub jobs or a macOS GUI.
Release artifacts must pass the version, checksum, source-content and ZIP checks
in the [release runbook](runbooks/release.md) after this record is included.

## 한국어

### 환경과 결과

Linux arm64에서 Node.js 22.23.3·24.22.0, Python 3.9.25와 Codex CLI 0.163.0으로
검증했습니다. 공식 Node 아카이브는 공개된 SHA-256과 대조했으며,
Node 24의 `npm ci`로 잠금 파일에 지정된 의존성을 설치했습니다.

| 검사 | 결과 |
| --- | --- |
| Node 22의 `npm test -- --test-reporter=spec` | 339개 통과. 실패·건너뜀 없음. |
| Node 24의 같은 명령 | 339개 통과. 실패·건너뜀 없음. |
| `npm run check` | JavaScript 42개 파일 문법 검사. |
| `npm run test:installer` | 113개 중 112개 통과. 로컬 Zsh가 없어 1개 건너뜀. |
| `node --experimental-test-coverage --test --test-reporter=spec tests/watch.test.js` | PTY 크기 변경과 페이지 이동을 포함한 6개 통과. |
| 소스와 기존 연결된 `codex-hud --version` | 모두 0.8.0 출력. |
| Node 24에서 설치 명령의 `doctor --json --bundle .../assets/package.json` | `inline.available: true`, `inline.probe.status: ok`, 동봉 버전 비교 `same`. |

### 회귀 검증 근거

작업 트리 테스트로 inline·tmux와 CLI의 세션 탐색 누락을 먼저 재현했습니다.
실제 임시 Git 작업 트리에서 명시적 활성화, 정확한 루트 일치, 자식 세션 제외,
시작 시각 필터, 명시한 세션 우선순위, 작업 트리 생성·제거, 공백·한글·줄바꿈이
있는 경로와 Git 조회 실패를 확인했습니다. 리뷰에서는 다른 저장소가 재사용한
오래된 작업 트리 경로도 재현했습니다. 실제 Git 공통 디렉터리를 대조하도록
보완했고, 추가한 회귀 테스트는 수정 전에 실패하고 수정 후 통과했습니다.

분리된 Codex 0.163.0 환경에서 모델 턴을 제출하지 않고 fork 메타데이터를 확인했습니다.
새 시작 시각과 관리되는 작업 트리 cwd가 기록되어, `fork <UUID> --worktree`에
적용한 새 세션 시각 필터의 전제를 확인했습니다.

설치 테스트에서는 Node 20·21을 허용하던 동작을 먼저 재현했습니다.
이제 npm 실행과 설정 변경 전에 거부하고, Node 22·24에서는 dry-run이 성공합니다.
Watch 페이지 테스트는 자식 프로세스의 새 화면 크기를 확인한 뒤 키를 보냅니다.
과거 [0.7.0](verification-0.7.0.md)의 실패 기록은 그대로 보존했습니다.

### 실행 환경과 배포 검증 범위

처음에는 실행 샌드박스에서 환경 변수를 붙인 테스트 명령의 하위 Node 출력과
테스트 러너 메시지가 누락되어 파일 단위 실패 4개가 발생했습니다.
별도의 최소 하위 프로세스 예제로 출력 누락을 재현했으며, 같은 명령을 샌드박스
밖에서 실행하면 출력이 보존되고 통과했습니다. 위 전체 결과는 이 실행 경로에서
확인했습니다. 샌드박스에 맞추려고 제품 코드나 테스트 조건을 완화하지 않았습니다.

새 CI는 Linux·macOS의 Node 22/24와 Python 3.11을 사용하며 Linux에 Zsh를 설치합니다.
YAML, 셸 명령과 동봉 패키지 검사 스크립트는 로컬에서 확인했습니다.
이 작업에서 호스팅된 GitHub 작업이나 macOS GUI를 실행하지는 않았습니다.
이 기록을 포함한 최종 배포물은 [릴리스 런북](runbooks/release.md)의 버전·체크섬·
소스 내용·ZIP 검사를 통과해야 합니다.
