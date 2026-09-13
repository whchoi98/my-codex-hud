# Contributing

<a href="#english">English</a> · <a href="#korean">한국어</a>

<a id="english"></a>
## English

Read [AGENTS.md](AGENTS.md) and [architecture](docs/architecture.md). Keep terminal
handling, session parsing, and rendering changes covered by the relevant tests.
Work from a source checkout: the npm payload includes documentation but excludes
tests and the plugin's installer scripts. Follow [onboarding](docs/onboarding.md)
for prerequisites and run `npm ci` before local development.

Use focused tests while editing; choose the files that exercise the changed behavior:

| Area | Focused check |
| --- | --- |
| CLI and configuration | `node --test tests/cli.test.js tests/config.test.js` |
| Session selection and parsing | `node --test tests/sessions.test.js tests/transcript.test.js tests/state.test.js` |
| Skills, plugins, and display | `node --test tests/plugins.test.js tests/state.test.js tests/render.test.js` |
| Terminal input and lifecycle | `node --test tests/screen.test.js tests/inline.test.js tests/pty.test.js tests/watch.test.js` |
| tmux launch | `node --test tests/launch.test.js` |
| Skill registration and HUD installation | `npm run test:installer` |

Run the full checks before preparing a release, and regenerate packages after
the final source or documentation edit:

```bash
npm test
npm run check
npm run test:installer
npm run package:plugin
```

Use [the release runbook](docs/runbooks/release.md) for version synchronization
and package verification. Document user-visible changes under Unreleased unless
the project's release workflow assigns a version. Preserve historical entries.
Record the commands actually run and any failures or skipped tests. A documentation
link check does not validate terminal behavior; automated PTY tests do not establish
manual VS Code validation.

For a requested commit/push, first verify that Git metadata is valid and inspect
the branch, remote, and staged changes. Stage intended paths only and review the
exact staged diff. Include the bundled npm archive required by this repository;
`dist/` remains ignored. Use the user's chosen remote and branch. Do not invent
an upstream or publish as a side effect of documentation work.

<a id="korean"></a>
## 한국어

[AGENTS.md](AGENTS.md)와 [아키텍처](docs/architecture.md)를 읽습니다. 터미널 처리,
세션 파싱, 렌더링을 수정하면 해당 동작을 검증합니다. npm 실행 패키지에는 문서가
포함되지만 테스트와 플러그인의 설치 스크립트는 빠지므로 소스 체크아웃에서 작업합니다.
준비 사항은 [온보딩](docs/onboarding.md)을 따르고 개발 전에 `npm ci`를 실행합니다.

수정 중에는 변경한 동작을 검증하는 파일을 선택해 실행합니다.

| 영역 | 개별 검증 |
| --- | --- |
| CLI와 설정 | `node --test tests/cli.test.js tests/config.test.js` |
| 세션 선택과 파싱 | `node --test tests/sessions.test.js tests/transcript.test.js tests/state.test.js` |
| 스킬·플러그인과 표시 | `node --test tests/plugins.test.js tests/state.test.js tests/render.test.js` |
| 터미널 입력과 수명 관리 | `node --test tests/screen.test.js tests/inline.test.js tests/pty.test.js tests/watch.test.js` |
| tmux 실행 | `node --test tests/launch.test.js` |
| 스킬 등록과 HUD 설치 | `npm run test:installer` |

릴리스 준비 전에는 전체 검증을 실행하고, 마지막 소스·문서 수정 후 패키지를 갱신합니다.

```bash
npm test
npm run check
npm run test:installer
npm run package:plugin
```

버전 동기화와 패키지 검증은 [릴리스 런북](docs/runbooks/release.md)을 따릅니다.
릴리스 절차에서 버전이 정해지지 않은 사용자 변경은 Unreleased에 기록하고,
과거 항목은 보존합니다.
실제로 실행한 명령과 실패·건너뛴 테스트를 기록합니다. 문서 링크 검사로 터미널
동작을 검증했다고 보거나 자동 PTY 테스트를 VS Code 수동 검증으로 기록하지 않습니다.

커밋·푸시를 요청받으면 먼저 유효한 Git 메타데이터와 브랜치·원격·스테이징 내용을
확인합니다. 의도한 경로만 스테이징하고 실제 스테이징 차이를 검토합니다.
이 저장소에서 필요한 동봉 npm 아카이브는 포함하며 `dist/`는 계속 제외합니다.
사용자가 정한 원격과 브랜치를 사용하고, 문서 정리만으로 원격을 만들거나 공개하지 않습니다.
