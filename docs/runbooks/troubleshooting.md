# Troubleshooting

[![English](https://img.shields.io/badge/lang-English-blue)](#english) [![한국어](https://img.shields.io/badge/lang-%ED%95%9C%EA%B5%AD%EC%96%B4-red)](#한국어)

## English

### Identify the command being diagnosed

Run diagnostics through the installed command's absolute path when several HUD
installations exist. Plugin registration, runtime installation and shell
activation are separate states.

```bash
# Identify shell functions and executables.
type -a codex codex-hud
# Check the selected installation.
/absolute/prefix/bin/codex-hud --version
/absolute/prefix/bin/codex-hud doctor --json
```

Use `hud.command`, `hud.prefix`, `hud.version`, `terminal` and `inline.probe`
from HUD 0.7.0+. For older runtimes, compare versions with the current installation
skill's `install.py --status --prefix /absolute/prefix`.
Read the [installer guide](../../plugins/codex-hud/README.md) before repairing or updating.

### macOS reports `posix_spawnp failed`

node-pty 1.1.0's npm archive ships its Darwin arm64/x64 `spawn-helper` with mode
`0644`. HUD 0.7.0's npm postinstall repairs execute bits on known helper paths.
Update the plugin/skill and the installed HUD separately.

If lifecycle scripts were skipped or permissions changed later, inspect
`inline.helper` and run its reported `repairCommand`. The installed package also
provides this explicit repair entrypoint:

```bash
# Repair helper execute bits in this installed HUD package.
node /absolute/installed/my-codex-hud/src/repair-node-pty.js
# Confirm a real PTY child starts and exits successfully.
/absolute/prefix/bin/codex-hud doctor --json
```

Check both `inline.available` and `inline.probe.status: ok`. Doctor does not change
permissions. A missing helper, incompatible native addon or continuing access
failure can require reinstalling for the current Node/platform or rebuilding
node-pty. Read the [0.7.0 verification record](../verification-0.7.0.md) for archive
evidence, automated checks and the user's Mac confirmation.

### Terminals behave differently

Compare command discovery and diagnostics in each terminal. A loaded `codex`
function does not prove its selected HUD command or PTY can start.

```bash
# Inspect the commands selected in this terminal.
type -a codex codex-hud
# Inspect Node, terminal, shell and PTY information.
codex-hud doctor --json
# Check whether inline input and output are interactive.
test -t 0 && test -t 1
# Temporarily launch Codex directly.
command codex
```

If the function is absent, source that installation's `shell.sh`. Project
autostart needs activation in each terminal; user autostart depends on the
configured startup files. Check `terminal.shell`, `terminal.zDotDir`,
`terminal.program` and both TTY fields. Keep `hud.autostart.configured` separate
from the parent shell's activation state.

### Other symptoms

| Symptom | Check or action |
| --- | --- |
| The wheel inserts an old command instead of scrolling output | Use HUD 0.6.0+ and restart the running HUD. `start --no-mouse` restores native wheel history and overrides saved capture. Inline adds Codex's `--no-alt-screen`. |
| Dragging does not select text | Use HUD 0.5.2+ with `--no-mouse`. With captured mouse input, release it using `Alt+M` before dragging. Running processes need a restart to load updated source. |
| Only “Waiting for a Codex session” appears | Inspect `codexHome`, `sessionsDirectory` and `matchingSession`. Select the exact project with `--cwd`, or pin a rollout path/UUID with `--session`. A new session needs its first saved task. No local rollout means no HUD data. |
| A resumed session shows the wrong activity | Pin the HUD explicitly with `--session`; default selection is based on session metadata and cwd, not a process PID. |
| The native PTY cannot load or start | Inspect `inline.error`, `inline.probe`, Node version and architecture. Install Node.js 20+ and the required native build tools where prebuilds are unavailable. Use WSL for inline mode on Windows. |
| `start` requires an interactive terminal | Run it directly with TTY stdin/stdout. For redirected output, use `status` or `watch --once`. |
| `start --tmux` cannot find tmux | Install tmux or use the default inline `start` backend. |
| Values do not change immediately | Session updates follow logged events and the configured interval, normally one second. Git refreshes during polling at least three seconds apart for the same directory. |
| Usage limits are absent or stale | Limits are the last recorded session snapshot. HUD does not query the account service or estimate streaming usage. |
| Characters render incorrectly | Try `--ascii --no-color` and check the terminal's Korean/emoji font widths. |
| Fields disappear after a Codex update | Rollout JSONL is an internal format. Unknown records are ignored; inspect `status --json` diagnostics for malformed or oversized lines. |

The initial parser compatibility checks used Codex CLI 0.153.4 logs and protocol
source; the [0.7.0 checks](../verification-0.7.0.md) also record the CLI used for
installation and diagnostic trials. Keep those evidence scopes distinct.

### References

- [README](../../README.md)
- [Terminal controls](../reference/terminal.md)
- [Session data](../reference/session-data.md)
- [Installation and update internals](../reference/installation.md)

---

## 한국어

### 진단할 명령 확인

HUD 설치본이 여러 개면 설치된 명령의 절대 경로로 진단합니다.
플러그인 등록, 실행 파일 설치, 셸 활성화는 별도 상태입니다.

```bash
# 셸 함수와 실행 파일을 확인합니다.
type -a codex codex-hud
# 선택한 설치본을 확인합니다.
/absolute/prefix/bin/codex-hud --version
/absolute/prefix/bin/codex-hud doctor --json
```

HUD 0.7.0 이상에서는 `hud.command`, `hud.prefix`, `hud.version`, `terminal`,
`inline.probe`를 확인합니다. 이전 실행 파일의 버전 비교는 최신 설치 스킬의
`install.py --status --prefix /absolute/prefix`를 사용합니다.
복구·업데이트 전에 [설치 안내](../../plugins/codex-hud/README.md)를 확인합니다.

### macOS의 `posix_spawnp failed`

node-pty 1.1.0 npm 아카이브의 Darwin arm64·x64 `spawn-helper`는 `0644`로
배포됩니다. HUD 0.7.0의 npm postinstall은 알려진 helper 경로의 실행 비트를
복구합니다. 플러그인·스킬과 설치된 HUD를 각각 업데이트합니다.

설치 스크립트를 생략했거나 나중에 권한이 바뀌었다면 `inline.helper`와
그 안의 `repairCommand`를 확인합니다. 설치된 패키지에서 다음 복구 진입점도
직접 사용할 수 있습니다.

```bash
# 이 설치본의 helper 실행 비트를 복구합니다.
node /absolute/installed/my-codex-hud/src/repair-node-pty.js
# 실제 PTY 자식이 시작하고 정상 종료하는지 확인합니다.
/absolute/prefix/bin/codex-hud doctor --json
```

`inline.available`과 `inline.probe.status: ok`를 함께 확인합니다. Doctor는
권한을 바꾸지 않습니다. helper 누락, 네이티브 모듈 호환성 문제, 지속되는 접근
오류는 현재 Node·플랫폼에 맞춘 재설치나 node-pty 재빌드가 필요할 수 있습니다.
아카이브 근거, 자동 검사와 Mac 사용자 확인은 [0.7.0 검증 기록](../verification-0.7.0.md)을
참고합니다.

### 터미널마다 동작이 다른 경우

각 터미널의 명령 탐색과 진단 결과를 비교합니다. `codex` 함수가 로드되어
있어도 선택한 HUD 실행 파일이나 PTY가 정상 시작한다는 보장은 없습니다.

```bash
# 이 터미널에서 선택되는 명령을 확인합니다.
type -a codex codex-hud
# Node·터미널·셸·PTY 정보를 확인합니다.
codex-hud doctor --json
# Inline 입력과 출력이 대화형인지 확인합니다.
test -t 0 && test -t 1
# 임시로 Codex를 직접 실행합니다.
command codex
```

함수가 없으면 해당 설치의 `shell.sh`를 읽습니다. 프로젝트 자동 실행은
터미널마다 활성화해야 하며, 사용자 자동 실행은 설정한 시작 파일을 사용합니다.
`terminal.shell`, `terminal.zDotDir`, `terminal.program`과 두 TTY 필드를
확인합니다. `hud.autostart.configured`와 부모 셸의 활성화 상태는 구분합니다.

### 그 밖의 증상

| 증상 | 확인·조치 |
| --- | --- |
| 휠이 출력을 스크롤하지 않고 이전 명령을 입력합니다. | HUD 0.6.0 이상을 사용하고 실행 중인 HUD를 재시작합니다. `start --no-mouse`는 저장된 캡처를 해제하고 실제 터미널 기록을 사용합니다. Inline은 Codex의 `--no-alt-screen`을 추가합니다. |
| 드래그로 텍스트가 선택되지 않습니다. | HUD 0.5.2 이상에서 `--no-mouse`를 사용합니다. 마우스를 캡처한 경우 `Alt+M`으로 해제한 뒤 드래그합니다. 바뀐 소스를 읽으려면 실행 중인 프로세스를 재시작해야 합니다. |
| “Waiting for a Codex session”만 보입니다. | `codexHome`, `sessionsDirectory`, `matchingSession`을 확인합니다. `--cwd`로 정확한 프로젝트를 선택하거나 `--session`으로 rollout 경로·UUID를 고정합니다. 새 세션은 첫 작업이 저장되어야 합니다. 로컬 rollout이 없으면 HUD 데이터도 없습니다. |
| 재개한 세션에서 다른 활동이 보입니다. | `--session`으로 HUD 대상을 명시합니다. 기본 선택은 프로세스 PID가 아닌 세션 메타데이터와 cwd를 기준으로 합니다. |
| 네이티브 PTY를 불러오거나 시작하지 못합니다. | `inline.error`, `inline.probe`, Node 버전과 아키텍처를 확인합니다. Node.js 20 이상을 설치하고, 사전 빌드가 없으면 네이티브 빌드 도구를 준비합니다. Windows inline 실행은 WSL을 사용합니다. |
| `start`에 대화형 터미널이 필요하다고 나옵니다. | 표준 입력·출력이 TTY인 터미널에서 직접 실행합니다. 리다이렉트할 때는 `status` 또는 `watch --once`를 사용합니다. |
| `start --tmux`에서 tmux를 찾지 못합니다. | tmux를 설치하거나 기본 inline `start`를 사용합니다. |
| 수치가 즉시 바뀌지 않습니다. | 세션에 기록된 이벤트와 설정한 갱신 간격을 따르며 기본값은 1초입니다. Git은 폴링 시 같은 디렉터리에 대해 최소 3초 간격으로 갱신합니다. |
| 사용 한도가 없거나 오래된 값입니다. | 한도는 해당 세션의 마지막 기록입니다. HUD는 계정 서비스를 조회하거나 스트리밍 사용량을 추정하지 않습니다. |
| 문자가 깨집니다. | `--ascii --no-color`를 사용하고 터미널의 한글·이모지 글꼴 너비를 확인합니다. |
| Codex 업데이트 이후 항목이 사라졌습니다. | Rollout JSONL은 내부 형식입니다. 알 수 없는 기록은 무시하며, `status --json`의 diagnostics에서 손상·초과 크기 줄을 확인합니다. |

최초 파서 호환성 검사는 Codex CLI 0.153.4의 로그와 프로토콜 소스를 사용했습니다.
[0.7.0 검증](../verification-0.7.0.md)에는 설치·진단에 사용한 CLI도 기록되어 있습니다.
두 검증의 근거와 범위는 구분합니다.

### 관련 문서

- [README](../../README.md)
- [터미널 제어](../reference/terminal.md)
- [세션 데이터](../reference/session-data.md)
- [설치·업데이트 내부 동작](../reference/installation.md)
