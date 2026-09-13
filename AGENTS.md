# 프로젝트 작업 기준

## 프로젝트와 문서

- CLI 진입점은 `bin/codex-hud.js`, 실행 로직은 `src/cli.js`이다.
- 세션 선택·읽기는 `src/sessions.js`와 `src/transcript.js`, 상태 처리는 `src/state.js`와 `src/activity.js`, 표시는 `src/render.js`가 맡는다.
- inline 터미널 처리는 `src/inline.js`, `src/screen.js`, `src/pty.js`에 있다.
- 문서 목차는 `docs/README.md`, 기여·Git 준비 절차는 `CONTRIBUTING.md`, 릴리스 절차는 `docs/runbooks/release.md`를 따른다.
- 사용자 동작이나 구조가 바뀌면 해당 README·아키텍처·구현 참조 문서를 같은 작업에서 갱신한다.

## 변경 이력

- 기능 추가, 버그 수정, 사용자에게 보이는 동작 변경에는 같은 작업에서 `CHANGELOG.md` 갱신을 포함한다.
- 버전이 정해지지 않은 변경은 `Unreleased`에 기록한다. 첫 항목을 넣을 때 빈 상태 안내 문구를 제거한다.
- 릴리스할 때는 해당 항목을 버전과 날짜 아래로 옮기고, `Unreleased`를 다음 작업을 위해 남긴다.
- 새 기능은 마이너 버전, 수정은 패치 버전을 올린다. 사용자가 지정한 버전이 있으면 이를 따른다.
- 기존 버전의 기록과 과거 검증 문서의 버전·결과는 보존한다. 새 버전으로 일괄 치환하지 않는다.

## Version strings

- HUD 버전의 기준은 루트 `package.json`의 `version`이다. CLI는 이 값을 읽는다.
- `package-lock.json`의 최상위 `version`과 `packages[""].version`을 함께 갱신한다.
- `plugins/codex-hud/.codex-plugin/plugin.json`의 버전을 HUD 릴리스와 맞춘다.
- 루트 `README.md`의 현재 버전과 `plugins/codex-hud/README.md`의 배포 파일명도 갱신한다.
- `plugins/codex-hud/skills/codex-hud-install/assets/package.json`과 `.tgz`는 직접 편집하지 않고, 마지막 소스·문서 수정 후 `npm run package:plugin`으로 재생성한다.
- `dist/`의 플러그인 ZIP과 단독 스킬 ZIP도 같은 명령으로 만든다. npm 패키지에 `CHANGELOG.md`가 포함되어야 한다.

## 화면 구성

- `full` 모드의 활동 정보는 `도구 → 로드한 스킬 → 플러그인 → 에이전트 → 계획` 순서로 모아 표시한다.
- 로드한 스킬은 도구 바로 아래 한 줄에 쉼표로 구분해 표시한다. 터미널 너비를 넘으면 말줄임표를 쓰고 여러 행으로 늘리지 않는다.
- 에이전트는 `running` 상태만 표시한다. 완료·오류·중단·종료된 에이전트는 숨기고, 실행 중인 에이전트가 없으면 제목과 요약도 표시하지 않는다.

## 릴리스 검증

- `npm test`, `npm run check`, `npm run test:installer`를 실행하고 결과를 확인한다.
- 소스와 설치된 `codex-hud --version`, 잠금 파일, 플러그인 메타데이터와 동봉된 npm 아카이브의 버전이 일치하는지 확인한다.
- 동봉된 npm 아카이브의 체크섬과 `CHANGELOG.md` 포함 여부를 확인한다.
