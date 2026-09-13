# Terminal

<a href="#english">English</a> · <a href="#korean">한국어</a>

<a id="english"></a>
## English

### Overview
Run Codex in a reduced PTY and paint its emulated screen above the HUD.
### Components
The launcher owns process lifetime, input forwarding, resize, backpressure, and
restoration. The screen owns the virtual buffer, HUD viewport, and safe terminal
mode output. Standalone watch uses the same HUD renderer.
### Key decisions
Reserve HUD rows without allowing child cursor commands to overwrite them.
Mouse capture is off by default so the host terminal receives the press that
starts native text dragging. `--mouse` / `"mouse": true` opts into wheel scrolling
and child mouse reports; `--no-mouse` overrides saved capture. Child mouse requests
cannot enable host capture without this opt-in. Keyboard paging remains available.
Only change mouse modes when needed. `Alt+L` changes display language; `Alt+M`
freezes painting and releases capture for selection, then restores the configured
mouse policy on resume. Ignore queued mouse reports while capture is disabled.
Focus reports and incomplete terminal replies must not break selection or swallow
cancellation. Inline and standalone watch use the same policy; the tmux launcher
passes an explicit mouse flag to its HUD pane.
### Code pointers
- [inline.js](../../src/inline.js), [pty.js](../../src/pty.js)
- [screen.js](../../src/screen.js), [output.js](../../src/output.js)
- [watch.js](../../src/watch.js), [viewport.js](../../src/viewport.js)
### Cross-references
- [README controls](../../README.md)
- [Original inline design](../superpowers/specs/2026-09-09-inline-hud-design.md)
- [Historical verification](../verification.md)

<a id="korean"></a>
## 한국어

### 개요
축소된 PTY에서 Codex를 실행하고 가상 화면 아래에 HUD를 표시합니다.
### 구성 요소
실행기는 프로세스 수명, 입력 전달, 크기 변경, 출력 지연, 복원을 관리합니다.
화면 모듈은 가상 버퍼, HUD 보기 위치, 안전한 터미널 모드 출력을 담당합니다.
별도 watch도 같은 HUD 렌더러를 사용합니다.
### 주요 결정
HUD 행을 확보하고 자식의 커서 명령이 해당 영역을 덮어쓰지 못하게 합니다.
드래그 시작 클릭을 터미널이 받을 수 있도록 기본 마우스 캡처는 끕니다.
`--mouse` 또는 `"mouse": true`로 휠 스크롤과 Codex 마우스 입력을 켜며,
`--no-mouse`는 저장된 캡처 설정을 해제합니다. 사용자가 켜지 않으면 Codex의
마우스 모드 요청도 실제 터미널의 캡처를 켤 수 없습니다. 키보드 페이징은 유지합니다.
마우스 모드는 필요한 경우에만 바꿉니다. `Alt+L`은 표시 언어를 바꾸고,
`Alt+M`은 화면 갱신과 캡처를 멈춘 뒤 종료 시 설정된 캡처 정책으로 돌아갑니다.
캡처가 꺼져 있을 때 뒤늦게 도착한 마우스 보고는 무시합니다. 포커스 알림과
미완성 터미널 응답이 선택 모드를 깨거나 취소 키를 가로채면 안 됩니다.
Inline과 별도 watch는 같은 정책을 사용하고, tmux 실행기는 HUD 패널에
마우스 옵션을 명시적으로 전달합니다.
### 코드 위치
- [inline.js](../../src/inline.js), [pty.js](../../src/pty.js)
- [screen.js](../../src/screen.js), [output.js](../../src/output.js)
- [watch.js](../../src/watch.js), [viewport.js](../../src/viewport.js)
### 관련 문서
- [README 제어 방법](../../README.md)
- [원래 inline 설계](../superpowers/specs/2026-09-09-inline-hud-design.md)
- [과거 검증](../verification.md)
