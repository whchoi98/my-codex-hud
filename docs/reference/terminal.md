# Terminal

[![English](https://img.shields.io/badge/lang-English-blue)](#english) [![한국어](https://img.shields.io/badge/lang-%ED%95%9C%EA%B5%AD%EC%96%B4-red)](#한국어)

<a id="english"></a>
## English

### Overview

Default `start` runs Codex in a reduced PTY and paints its emulated screen above
the HUD in the host's normal buffer, retaining native wheel scrolling and drag
selection. `--mouse` selects the host alternate screen with captured scrolling.
Standalone `watch` displays only the HUD in a dedicated terminal;
`start --tmux` runs Codex and `watch` in separate panes.

### Components

| Code | Runtime responsibility |
|---|---|
| [inline.js](../../src/inline.js), [output.js](../../src/output.js) | Own the inline child and physical terminal lifecycle, input, resize, and HUD polling through `HudSource`. Ordered asynchronous host writes and PTY pause/resume handle slow output and parsing backlog. |
| [pty.js](../../src/pty.js), [codex-args.js](../../src/codex-args.js) | Validate and prepare the executable/environment, then lazily load `node-pty` to spawn literal argv. Derive HUD cwd and resume/fork context from known options before `--`, leaving argv and the child's initial cwd unchanged. |
| [screen.js](../../src/screen.js) | Own the `@xterm/headless` buffer, child terminal replies, input routing, and composited rows/cursor/modes. The inline launcher writes these frames to the host. |
| [scrollback.js](../../src/scrollback.js) | Track completed Codex rows with markers, bound the pending history queue, and account for rows the host already archives during resize/reflow. |
| [viewport.js](../../src/viewport.js), [terminal.js](../../src/terminal.js) | Share HUD paging and width clipping between inline and watch. Text helpers strip incoming terminal controls and measure/truncate whole graphemes by terminal cells. |
| [watch.js](../../src/watch.js) | Own the standalone polling, HUD renderer/viewport, interactive input, and terminal restoration; it does not launch or send input to Codex. |
| [launch.js](../../src/launch.js) | Create a tmux window/session with quoted pane commands, forward HUD preferences to `watch`, and manage cleanup of the resources it creates. |

### Key decisions

The inline [`screenLayout`](../../src/screen.js) requests at least seven HUD
rows for `full`, growing/shrinking with rendered content; `essential` and `minimal`
request five and two. A visible HUD has one separator row and leaves at least
four Codex rows. At terminal heights of five rows or fewer, the HUD is hidden.
Native mode leaves a blank row below Codex at heights of two through five rows
to keep host viewport growth from reclaiming old scrollback.
Resize and HUD height changes resize both the emulator and child PTY.
[`HudViewport`](../../src/viewport.js) retains overflow rows, clamps the scroll
offset after content/size changes, and reserves a range-hint row when overflowing
and at least two HUD rows are available.

Mouse capture is off by default so the host terminal handles native wheel
scrollback and text dragging. `--mouse` / `"mouse": true` opts into captured scrolling
and, in inline mode, child mouse reports; `--no-mouse` overrides saved capture.
Child mouse requests cannot enable host capture without this opt-in. Ordinary
repainting does not reset mouse modes ([inline modes](../../src/screen.js),
[watch selection policy](../../src/watch.js)).

Keyboard controls apply when the terminal delivers the key sequences to the HUD.
In tmux, select the HUD pane to use watch controls.

| Input | Inline ([routing](../../src/screen.js)) | Interactive watch ([routing](../../src/watch.js)) |
|---|---|---|
| `Alt+PageUp` / `Alt+PageDown` | Page the HUD without forwarding the keys to Codex. | Page the HUD. |
| `PageUp` / `PageDown`, `Up` / `Down` | Forward to Codex; Up/Down browse output instead while selecting. | Page the HUD, or scroll one row with arrows. |
| `Shift+PageUp` / `Shift+PageDown` | Page the emulator's normal-screen history (up to 5,000 scrollback lines); forward to Codex in its alternate screen. | No HUD navigation binding. |
| `Ctrl+C` | Forward to Codex; the child determines its response. | Stop watch and restore the terminal. |

`Alt+L` switches the current run's display language immediately from cached state.
`Alt+M` paints a selection hint when HUD space is available, then freezes painting
and releases capture while Codex and HUD polling continue. `Alt+M` again, `Esc`,
ordinary keyboard input, language switching, or terminal resize resumes painting
and restores the configured mouse policy. Up/Down in inline selection mode browse
output without reaching Codex; this also handles wheel-to-arrow translation while
capture is released. Queued mouse reports are ignored while
capture is disabled. Focus reports preserve selection; incomplete theme replies
do not trap cancellation. Bracketed paste bypasses shortcut handling: inline
forwards it intact, while watch discards its contents
([inline input](../../src/screen.js), [Escape handling](../../src/screen.js),
[watch input](../../src/watch.js), [inline resize](../../src/inline.js)).

Leaving inline selection with `Alt+M` or an isolated `Esc` resumes painting at
the current emulator scroll position. These controls do not move to the live
bottom. Ordinary text input does; `Shift+PageDown` can page toward the bottom
without sending text to Codex.

With capture enabled, the wheel scrolls the HUD by three rows; HUD/separator
clicks are not sent to Codex. Over the Codex area, mouse reports go to the child
when it requests tracking. Otherwise, the wheel scrolls normal-screen history
and is ignored in an alternate child buffer with no mouse handler. It never
generates command-history arrows. Input forwarded by `input()` outside selection
mode returns the emulator to the live bottom; an isolated `Esc` returned by
`flushInput()` does not ([mouse routing](../../src/screen.js)).

Inline requires interactive stdin/stdout and uses raw input. It adds Codex's
`--no-alt-screen` once while preserving user arguments, option values, and the
`--` delimiter. Default mode moves prior terminal output into scrollback and
transfers completed Codex rows to it; HUD redraws are not appended. Native history
browsing can scroll the whole HUD out of view. The pending transfer queue retains
at most 5,000 rows, dropping the oldest pending rows on overflow. Frozen painting
pauses transfers until another frame is painted. Markers handle trimming and
display clears; full resets restart
the checkpoint. `resizeHost()` accounts for the host's own row movement and reflow
before repainting.
As with ordinary native terminal output, a host resize can retain visible
alternate-child content too; that content is Codex output, not a HUD frame.

The `--mouse` host uses an alternate screen and internal scrolling. Child clears,
scrolling, and alternate-screen changes remain
inside the emulator; physical autowrap is disabled while painting so the final
cell cannot scroll the footer. Terminal size replies describe the reduced Codex
area. Host forwarding is limited to supported modes, theme queries, and validated
clipboard writes; child window manipulation is blocked
([terminal replies](../../src/screen.js), [frame output](../../src/screen.js)).

On exit or failure, inline restores the prior stdin raw setting, resets terminal
modes/cursor, clears the native footer or leaves the captured-mode alternate screen,
and cleans up its child process group,
escalating termination when needed. It returns the child's exit code or a
signal-derived status. Already transferred output remains in terminal history
after exit. Shutdown does not end frozen selection before its final paint, so
pending output is not transferred if the display is still frozen.
HUD polling errors are displayed without stopping Codex
([polling](../../src/inline.js), [cleanup](../../src/inline.js),
[group termination](../../src/inline.js)). Watch owns its own alternate screen
and restores input/modes on shutdown ([watch lifecycle](../../src/watch.js)).

The tmux launcher requests a preset pane height once (seven/five/two rows), passes
an explicit mouse flag to `watch`, and closes only its HUD pane when the original
Codex pane exits. Setup failure cleans up its new window/session; attach failure
leaves the session running and reports a reattach command
([pane setup and cleanup](../../src/launch.js)).

Doctor uses `ptyAvailable()` to load the native dependency and actually start
a harmless Node process in a PTY. The spawn/exit probe has a two-second default
deadline; failure terminates the child and releases its listeners. No Codex/model request
or caller terminal-mode change is needed. `createPty()` adds executable/cwd/platform
context to startup failures without including argv or prompts.

On macOS, [repair-node-pty.js](../../src/repair-node-pty.js) inspects the helper
selected by node-pty's native loader. Doctor reports its path/mode and missing
execute bits without changing permissions. npm postinstall or explicit manual
execution of that helper module repairs known dependency files; see
[installation](installation.md).

### Code pointers

These tests are available only in a source checkout; the npm package excludes them.

- Layout, paging, and selection coverage: `tests/screen.test.js`, `tests/watch.test.js`.
- Literal launch context and tmux pane ownership: `tests/pty.test.js`, `tests/launch.test.js`.
- Signals, descendant cleanup, and stalled output: `tests/inline.test.js`.
- Real probe failure/cleanup and macOS helper permissions: `tests/pty.test.js`,
  `tests/repair-node-pty.test.js`, `tests/doctor.test.js`.

### Cross-references

- [README controls](../../README.md)
- [Architecture](../architecture.md), [Session data](session-data.md)
- [Original inline design](../superpowers/specs/2026-09-09-inline-hud-design.md)
- [Historical verification](../verification.md)

<a id="korean"></a>
## 한국어

### 개요

기본 `start`는 축소된 PTY에서 Codex를 실행하고 가상 화면 아래에 HUD를
표시합니다. 실제 터미널의 일반 버퍼를 사용해 기본 휠 스크롤과 드래그 선택을
유지하며, `--mouse`는 대체 화면에서 마우스를 캡처하는 방식을 선택합니다.
별도 `watch`는 전용 터미널에 HUD만 표시하며,
`start --tmux`는 Codex와 `watch`를 각각의 패널에서 실행합니다.

### 구성 요소

| 코드 | 실행 중 책임 |
|---|---|
| [inline.js](../../src/inline.js), [output.js](../../src/output.js) | Inline 자식 프로세스와 실제 터미널의 수명, 입력, 크기 변경, `HudSource`를 통한 HUD 폴링을 관리합니다. 순서를 유지하는 비동기 출력과 PTY 일시 정지·재개로 느린 출력과 파싱 대기를 처리합니다. |
| [pty.js](../../src/pty.js), [codex-args.js](../../src/codex-args.js) | 실행 파일·환경을 검증하고 준비한 뒤, 필요할 때 `node-pty`를 불러와 argv 그대로 실행합니다. `--` 앞의 알려진 옵션에서 HUD cwd와 resume/fork 문맥을 구하며, argv와 자식의 최초 cwd는 바꾸지 않습니다. |
| [screen.js](../../src/screen.js) | `@xterm/headless` 버퍼, 자식에 대한 터미널 응답, 입력 분기, 합성한 행·커서·모드를 관리합니다. Inline 실행기가 이 프레임을 실제 터미널에 씁니다. |
| [scrollback.js](../../src/scrollback.js) | 완료된 Codex 행을 표식으로 추적하고 전달 대기열을 제한하며, 크기 변경과 줄 재배치 때 실제 터미널이 이미 기록한 행을 반영합니다. |
| [viewport.js](../../src/viewport.js), [terminal.js](../../src/terminal.js) | Inline과 watch의 HUD 페이징과 너비 제한을 공유합니다. 텍스트 함수는 외부 터미널 제어 문자를 제거하고, 글자 묶음을 유지하며 셀 단위로 너비를 재거나 자릅니다. |
| [watch.js](../../src/watch.js) | 별도 폴링, HUD 렌더러·뷰포트, 대화형 입력, 터미널 복원을 관리합니다. Codex를 실행하거나 입력을 보내지는 않습니다. |
| [launch.js](../../src/launch.js) | 인자를 인용 처리한 패널 명령으로 tmux 창·세션을 만들고, HUD 설정을 `watch`에 전달하며, 자신이 만든 자원을 정리합니다. |

### 주요 결정

Inline의 [`screenLayout`](../../src/screen.js)은 `full`에 최소 7개의 HUD
행을 요청하고 렌더링한 내용에 따라 높이를 늘리거나 줄입니다. `essential`과
`minimal`은 각각 5행과 2행을 요청합니다. HUD가 표시되면 구분선 1행을 두고
Codex에 최소 4행을 남깁니다. 터미널 높이가 5행 이하이면 HUD를 숨깁니다.
기본 모드는 높이가 2~5행이면 Codex 아래에 빈 행 하나를 남겨, 창을 늘릴 때
실제 터미널이 이전 기록을 표시 영역으로 끌어오는 것을 방지합니다.
터미널 크기나 HUD 높이가 바뀌면 에뮬레이터와 자식 PTY 크기를 함께 조정합니다.
[`HudViewport`](../../src/viewport.js)는 넘치는 행을 보관하고, 내용·크기가
바뀌면 스크롤 위치를 유효 범위로 조정합니다. 내용이 넘치고 HUD 공간이
2행 이상이면 표시 범위를 안내할 행을 하나 확보합니다.

터미널이 기본 휠 스크롤과 드래그 선택을 처리하도록 마우스 캡처는 끕니다.
`--mouse` 또는 `"mouse": true`로 내부 스크롤을 캡처하며, inline에서는 Codex 마우스
입력도 전달합니다. `--no-mouse`는 저장된 캡처 설정을 해제합니다. 사용자가
켜지 않으면 Codex의 마우스 모드 요청도 실제 터미널의 캡처를 켤 수 없습니다. 일반적인 화면
갱신은 마우스 모드를 초기화하지 않습니다
([inline 모드](../../src/screen.js), [watch 선택 정책](../../src/watch.js)).

키보드 제어는 터미널이 해당 키 시퀀스를 HUD에 전달할 때 동작합니다.
Tmux에서는 HUD 패널을 선택해야 watch 제어를 사용할 수 있습니다.

| 입력 | Inline ([입력 분기](../../src/screen.js)) | 대화형 watch ([입력 분기](../../src/watch.js)) |
|---|---|---|
| `Alt+PageUp` / `Alt+PageDown` | Codex에 키를 보내지 않고 HUD를 페이지 단위로 이동합니다. | HUD를 페이지 단위로 이동합니다. |
| `PageUp` / `PageDown`, `Up` / `Down` | Codex에 전달하되, 선택 모드의 위·아래 방향키는 출력 기록을 탐색합니다. | HUD를 페이지 단위로, 방향키는 한 행씩 이동합니다. |
| `Shift+PageUp` / `Shift+PageDown` | 에뮬레이터의 일반 화면 기록을 페이지 단위로 이동합니다(스크롤백 최대 5,000행). 자식의 대체 화면에서는 Codex에 전달합니다. | HUD 이동에 할당되지 않은 키입니다. |
| `Ctrl+C` | Codex에 전달하며, 자식이 처리 방식을 결정합니다. | Watch를 종료하고 터미널을 복원합니다. |

`Alt+L`은 캐시된 상태로 현재 실행의 표시 언어를 즉시 바꿉니다.
`Alt+M`은 HUD 공간이 있으면 선택 안내를 표시한 뒤 화면 갱신과 캡처를
멈춥니다. 이때도 Codex 실행과 HUD 폴링은 계속됩니다. 다시 `Alt+M`을
누르거나 `Esc`, 일반 키보드 입력, 언어 전환, 터미널 크기 변경이 발생하면
화면 갱신을 재개하고 설정된 캡처 정책으로 돌아갑니다.
Inline 선택 모드의 위·아래 방향키는 Codex에 보내지 않고 출력 기록을 탐색합니다.
캡처 해제 중 터미널이 휠을 방향키로 변환하는 경우도 이 경로로 처리합니다.
캡처가 꺼져 있으면 뒤늦게 도착한 마우스 보고는 무시합니다. 포커스 알림은 선택 모드를 유지하며,
미완성 테마 응답이 취소 입력을 가로채지 않습니다. Bracketed paste 안에서는
단축키를 처리하지 않습니다. Inline은 붙여넣기를 그대로 전달하고 watch는
내용을 버립니다
([inline 입력](../../src/screen.js), [Escape 처리](../../src/screen.js),
[watch 입력](../../src/watch.js), [inline 크기 변경](../../src/inline.js)).

Inline에서 `Alt+M`이나 단독 `Esc`로 선택을 끝내면 가상 터미널의 현재 스크롤
위치에서 갱신을 재개합니다. 이 키들은 최신 출력으로 이동시키지 않습니다.
일반 텍스트를 입력하면 맨 아래로 돌아가며, Codex에 텍스트를 보내지 않고
이동하려면 `Shift+PageDown`으로 아래쪽을 탐색합니다.

캡처를 켜면 휠로 HUD를 3행씩 이동하며, HUD·구분선 클릭은 Codex에 보내지
않습니다. Codex 영역에서는 자식이 마우스 추적을 요청한 경우 보고를
전달합니다. 요청하지 않은 경우에는 휠로 일반 화면 기록을 이동하거나,
자식이 대체 화면이면 해당 휠 입력을 무시합니다. 명령 이력 방향키를 만들지
않습니다. 선택 모드 밖에서 `input()`이 Codex에 입력을 전달하면 에뮬레이터는
최신 출력이 있는 맨 아래로 돌아가며, `flushInput()`이 전달하는 단독 `Esc`는
스크롤 위치를 유지합니다
([마우스 입력 분기](../../src/screen.js)).

Inline은 대화형 표준 입력·출력과 raw 입력을 사용합니다. 사용자 인자·옵션 값·
`--` 구분자를 보존하면서 Codex의 `--no-alt-screen`을 한 번 추가합니다.
기본 모드는 기존 터미널 출력을 스크롤백으로 옮기고 완료된 Codex 행을 전달하며,
HUD 갱신을 기록에 추가하지 않습니다. 과거 기록을 볼 때는 HUD 전체가 화면 밖으로
스크롤될 수 있습니다. 전달 대기열은 최대 5,000행을 유지하고 초과하면 오래된
대기 행부터 제거합니다. 화면이 고정되면 다음 프레임을 그릴 때까지 전달도
멈춥니다. 표식으로 기록 잘림·화면 지우기를 처리하고 전체 초기화 때는 추적 위치를
새로 시작합니다.
`resizeHost()`는 실제 터미널의 행 이동·줄 재배치를 반영한 뒤 화면을 갱신합니다.
일반적인 터미널 출력처럼 크기 변경 때 화면에 보이던 자식 대체 화면의 내용도
기록될 수 있습니다. 이 내용 역시 HUD 프레임이 아닌 Codex 출력입니다.

`--mouse`는 대체 화면과 내부 스크롤을 사용합니다. 자식의 화면 지우기·스크롤·
대체 화면 전환은 에뮬레이터
안에서 처리합니다. 마지막 셀 출력이 하단 HUD를 밀어내지 않도록 화면을
그릴 때 실제 터미널의 자동 줄바꿈을 끕니다. 터미널 크기 응답은 축소된
Codex 영역을 나타냅니다. 실제 터미널에는 지원하는 모드·테마 질의·검증한
클립보드 쓰기만 전달하며, 자식의 창 조작은 차단합니다
([터미널 응답](../../src/screen.js), [프레임 출력](../../src/screen.js)).

종료나 오류 시 inline은 이전 stdin raw 설정을 복원하고, 터미널 모드·커서를
초기화한 뒤 기본 모드의 하단 HUD를 지우거나 캡처 모드의 대체 화면에서 나옵니다.
자신이 실행한 자식 프로세스 그룹을
정리하며 필요하면 강제 종료합니다. 자식의 종료 코드 또는 시그널에 따른
상태를 반환합니다. 이미 전달한 출력은 종료 후에도 터미널 기록에 남습니다.
종료 처리의 마지막 갱신은 선택 모드를 해제하지 않으므로, 화면이 고정된 상태로
종료하면 대기 중인 출력은 전달되지 않습니다.
HUD 폴링 오류는 Codex를 멈추지 않고 화면에 표시합니다
([폴링](../../src/inline.js), [정리](../../src/inline.js),
[그룹 종료](../../src/inline.js)). Watch는 자체 대체 화면을 사용하고 종료할
때 입력·모드를 복원합니다([watch 수명 관리](../../src/watch.js)).

Tmux 실행기는 프리셋의 패널 높이(7/5/2행)를 한 번 요청하고, `watch`에
마우스 옵션을 명시적으로 전달합니다. 원래 Codex 패널이 종료되면 자신이
만든 HUD 패널만 닫습니다. 준비 단계에서 실패하면 새 창·세션을 정리하며,
연결에 실패하면 세션을 실행 상태로 남기고 재연결 명령을 안내합니다
([패널 준비와 정리](../../src/launch.js)).

Doctor는 `ptyAvailable()`로 네이티브 의존성을 불러온 뒤 무해한 Node 프로세스를
PTY에서 실제로 실행합니다. 기본 2초 제한 시간의 probe가 실패하면 자식을 종료하고
리스너를 정리합니다. Codex·모델 요청이나 호출한 터미널의 모드 변경은 필요하지
않습니다. `createPty()`의 시작 오류에는 argv·프롬프트를 제외한 실행 파일·cwd·
플랫폼 정보를 덧붙입니다.

macOS의 [repair-node-pty.js](../../src/repair-node-pty.js)는 node-pty의 네이티브
로더가 선택한 helper를 검사합니다. Doctor는 경로·모드와 실행 비트 누락을
보고하며 권한을 바꾸지 않습니다. npm postinstall 또는 명시적인 수동 실행이
알려진 의존성 파일을 복구합니다. [설치 참조](installation.md)를 참고하세요.

### 코드 위치

아래 테스트는 소스 체크아웃에서만 볼 수 있으며 npm 패키지에는 포함되지 않습니다.

- 레이아웃·페이징·선택 검증: `tests/screen.test.js`, `tests/watch.test.js`.
- 인자를 그대로 유지하는 실행 문맥과 tmux 패널 소유 범위: `tests/pty.test.js`, `tests/launch.test.js`.
- 시그널·자손 프로세스 정리·출력 정체: `tests/inline.test.js`.
- 실제 probe 실패·정리와 macOS helper 권한: `tests/pty.test.js`,
  `tests/repair-node-pty.test.js`, `tests/doctor.test.js`.

### 관련 문서

- [README 제어 방법](../../README.md)
- [아키텍처](../architecture.md), [세션 데이터](session-data.md)
- [원래 inline 설계](../superpowers/specs/2026-09-09-inline-hud-design.md)
- [과거 검증](../verification.md)
