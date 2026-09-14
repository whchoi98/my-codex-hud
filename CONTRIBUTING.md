# Contributing

[![English](https://img.shields.io/badge/lang-English-blue)](#english) [![한국어](https://img.shields.io/badge/lang-%ED%95%9C%EA%B5%AD%EC%96%B4-red)](#한국어)

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
| CLI, installation diagnostics, and configuration | `node --test tests/cli.test.js tests/doctor.test.js tests/config.test.js` |
| Session selection and parsing | `node --test tests/sessions.test.js tests/transcript.test.js tests/state.test.js` |
| Skills, plugins, and display | `node --test tests/plugins.test.js tests/state.test.js tests/render.test.js` |
| Terminal input, lifecycle, and helper recovery | `node --test tests/screen.test.js tests/inline.test.js tests/pty.test.js tests/repair-node-pty.test.js tests/watch.test.js` |
| tmux launch | `node --test tests/launch.test.js` |
| Skill registration and HUD installation | `npm run test:installer` |

For prose, links, badges, and screenshots, verify affected documents and packaged
assets. Reuse valid runtime test/review results when code, dependencies, and test
configuration are unchanged. Keep one test/review owner for the same scope;
a commit or push alone does not require another full run.

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
| CLI·설치 진단과 설정 | `node --test tests/cli.test.js tests/doctor.test.js tests/config.test.js` |
| 세션 선택과 파싱 | `node --test tests/sessions.test.js tests/transcript.test.js tests/state.test.js` |
| 스킬·플러그인과 표시 | `node --test tests/plugins.test.js tests/state.test.js tests/render.test.js` |
| 터미널 입력·수명 관리·helper 복구 | `node --test tests/screen.test.js tests/inline.test.js tests/pty.test.js tests/repair-node-pty.test.js tests/watch.test.js` |
| tmux 실행 | `node --test tests/launch.test.js` |
| 스킬 등록과 HUD 설치 | `npm run test:installer` |

문장·링크·배지·스크린샷 변경은 관련 문서와 배포 자산을 확인합니다.
코드·의존성·테스트 설정이 같으면 유효한 기존 런타임 검증·리뷰 결과를 재사용합니다.
같은 범위의 테스트·리뷰는 한 작업 흐름에서 담당하며, 커밋·푸시만을 이유로
전체 검증을 다시 실행하지 않습니다.

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
