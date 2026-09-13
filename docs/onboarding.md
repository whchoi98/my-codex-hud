# Onboarding

<a href="#english">English</a> · <a href="#korean">한국어</a>

<a id="english"></a>
## English

Use Node.js 20+, npm, Git, and Python 3.9+ for installer tests and packaging.
Codex CLI must be on PATH for `start` and runtime installation/update. The
installer's read-only `--status` does not require npm or Codex. `demo`, `setup`, and
the automated tests need no model request; `watch` and `status` read saved local
sessions. Inline mode targets Linux, macOS, and WSL. A native node-pty build may
require Python, a compiler, make, and Node headers.
On macOS, npm postinstall repairs the shipped node-pty helper's execute bits.
If scripts were skipped, run `node src/repair-node-pty.js` from that HUD package
before checking the real PTY probe.

Run these commands from the source checkout. The npm payload includes runtime
code and documentation; installer scripts and tests require the checkout (the
plugin/skill ZIPs also include the installers). There is no separate application
build step.

```bash
npm ci
node bin/codex-hud.js doctor
node bin/codex-hud.js demo --language en --no-color
npm test
npm run check
npm run test:installer
```

`npm test` runs the Node.js tests, including local PTY fixtures where supported.
`npm run check` checks JavaScript syntax. Installer tests use temporary
directories and stand-in executables for npm, Codex, and HUD; they do not install
into your real shell. They also exercise complete skill registration and the
user/project installation and autostart boundaries. The Zsh hook regression
runs when Zsh is installed and is skipped otherwise. Review `doctor` fields even when the command exits
successfully: a missing Codex executable or unavailable PTY appears in its report.
Doctor now starts and reaps a harmless Node PTY child. Confirm `inline.probe.status`
is `ok`; loading the addon alone is insufficient. Installation/version details
refer to the HUD command you ran. Use `doctor --bundle /absolute/skill/assets/package.json`
to select the bundle for comparison.

Run `node bin/codex-hud.js start --language en` in an interactive terminal to
launch Codex with the HUD. Drag text to select and copy it. Use `Alt+L` for language
and `Alt+M` to freeze the screen while selecting. The wheel scrolls native terminal
history by default. Add `--mouse` to scroll the HUD/emulated output while keeping
the footer fixed; use `Alt+M` to release capture before dragging in that mode.
Read [README](../README.md) for selection, resume, watch, and platform details.
Use [AGENTS.md](../AGENTS.md) for development rules,
[Contributing](../CONTRIBUTING.md) for focused test commands, the
[installation reference](reference/installation.md) for installer state and
failure boundaries, and the [release runbook](runbooks/release.md) for packaging.

<a id="korean"></a>
## 한국어

Node.js 20 이상, npm, Git, 설치 검증·패키징용 Python 3.9 이상을 준비합니다.
`start`와 실제 설치·업데이트에는 PATH의 Codex CLI가 필요합니다.
설치 도구의 읽기 전용 `--status`에는 npm·Codex가 필요하지 않습니다. `demo`, `setup`,
자동 검증은 모델 요청 없이 실행하며, `watch`와 `status`는 저장된 로컬
세션을 읽습니다. Inline 모드는 Linux·macOS·WSL을 대상으로 합니다.
node-pty를 직접 빌드해야 하는 환경에서는 Python, 컴파일러, make,
Node 헤더가 필요할 수 있습니다.
macOS에서는 npm postinstall이 node-pty helper의 실행 비트를 복구합니다.
설치 스크립트를 생략했다면 해당 HUD 패키지에서 `node src/repair-node-pty.js`를
실행한 뒤 실제 PTY probe를 확인합니다.

아래 명령은 소스 체크아웃에서 실행합니다. npm 실행 패키지에는 실행 코드와
문서가 포함되며, 설치 스크립트와 테스트는 체크아웃에서 사용합니다.
플러그인·스킬 ZIP에도 설치 스크립트가 들어 있습니다. 애플리케이션을 위한
별도 빌드 단계는 없습니다.

```bash
npm ci
node bin/codex-hud.js doctor
node bin/codex-hud.js demo --language en --no-color
npm test
npm run check
npm run test:installer
```

`npm test`는 지원 환경의 로컬 PTY 테스트를 포함한 Node.js 검증을 실행합니다.
`npm run check`는 JavaScript 문법을 검사합니다. 설치 검증은 임시 디렉터리와
npm·Codex·HUD 대역 실행 파일을 사용하며 실제 셸에 설치하지 않습니다.
전체 스킬 등록, 사용자·프로젝트 설치 범위와 자동 실행의 디렉터리 경계도 검증합니다.
Zsh 훅 검증은 Zsh가 설치된 환경에서 실행하며, 없으면 해당 테스트를 건너뜁니다.
`doctor`가 정상 종료해도 Codex 실행 파일이나 PTY가 없을 수 있으므로
보고서의 각 항목을 확인합니다.
Doctor는 무해한 Node PTY 자식을 실제로 시작하고 정리합니다.
모듈 로딩만으로 성공 처리하지 말고 `inline.probe.status`가 `ok`인지 확인합니다.
설치·버전 정보는 실행한 HUD 명령을 기준으로 하며, 비교할 동봉 패키지는
`doctor --bundle /absolute/skill/assets/package.json`으로 지정할 수 있습니다.

대화형 터미널에서 `node bin/codex-hud.js start --language en`을 실행하면
Codex와 HUD를 함께 시작합니다. 마우스로 바로 드래그해 선택·복사할 수 있으며,
`Alt+L`로 언어를 바꾸고 `Alt+M`으로 선택할 화면을 고정합니다. 기본 휠은 실제
터미널 기록을 스크롤합니다. HUD를 고정한 채 내부 기록을 넘기려면 `--mouse`를
사용하며, 이 경우 드래그 전에 `Alt+M`으로 캡처를 해제합니다.
세션 선택·재개·watch·플랫폼 조건은 [README](../README.md),
개발 기준은 [AGENTS.md](../AGENTS.md), 개별 검증 명령은
[기여 지침](../CONTRIBUTING.md), 설치 상태와 실패 경계는
[설치 구현 참조](reference/installation.md), 패키징은
[릴리스 런북](runbooks/release.md)을 참고하세요.
