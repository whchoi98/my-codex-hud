# Onboarding

<a href="#english">English</a> · <a href="#korean">한국어</a>

<a id="english"></a>
## English

Use Node.js 20+, npm, Python 3.9+ for the installer tests, and Codex CLI on PATH.
Inline mode targets Linux, macOS, and WSL. A native node-pty build may require
Python, a compiler, make, and Node headers.

```bash
npm ci
node bin/codex-hud.js doctor
node bin/codex-hud.js demo --language en --no-color
npm test
npm run check
npm run test:installer
```

Run `node bin/codex-hud.js start --language en` in an interactive terminal to
launch Codex with the HUD. Drag text to select and copy it. Use `Alt+L` for language
and `Alt+M` to freeze the screen while selecting. Add `--mouse` for wheel scrolling;
in that mode, use `Alt+M` to release mouse capture before dragging.
Read [README](../README.md) for selection, resume, watch, and platform details.
Use [AGENTS.md](../AGENTS.md) for development rules and the
[release runbook](runbooks/release.md) for packaging.

<a id="korean"></a>
## 한국어

Node.js 20 이상, npm, 설치 검증용 Python 3.9 이상, PATH의 Codex CLI를 준비합니다.
Inline 모드는 Linux·macOS·WSL을 대상으로 합니다. node-pty를 직접 빌드해야
하는 환경에서는 Python, 컴파일러, make, Node 헤더가 필요할 수 있습니다.

```bash
npm ci
node bin/codex-hud.js doctor
node bin/codex-hud.js demo --language en --no-color
npm test
npm run check
npm run test:installer
```

대화형 터미널에서 `node bin/codex-hud.js start --language en`을 실행하면
Codex와 HUD를 함께 시작합니다. 마우스로 바로 드래그해 선택·복사할 수 있으며,
`Alt+L`로 언어를 바꾸고 `Alt+M`으로 선택할 화면을 고정합니다. 휠 스크롤은
`--mouse`로 켜며, 이 경우 드래그 전에 `Alt+M`으로 캡처를 해제합니다.
세션 선택·재개·watch·플랫폼 조건은 [README](../README.md),
개발 기준은 [AGENTS.md](../AGENTS.md), 패키징은
[릴리스 런북](runbooks/release.md)을 참고하세요.
