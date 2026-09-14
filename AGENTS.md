# 프로젝트 작업 기준

Codex CLI의 로컬 rollout JSONL을 읽어 터미널 HUD를 표시하는 Node.js ESM 프로젝트이다.

## 프로젝트와 문서

- 개발 환경은 Node.js 20 이상, npm, Git이며 설치 검증·패키징에는 Python 3.9 이상이 필요하다.
- 의존성은 `npm ci`로 설치한다. 별도 빌드 없이 `node bin/codex-hud.js`로 실행하며, 세션 없이 확인하려면 `node bin/codex-hud.js demo --language ko --no-color`를 사용한다.
- CLI 진입점은 `bin/codex-hud.js`, 실행 로직은 `src/cli.js`이다.
- 세션 선택·읽기는 `src/sessions.js`와 `src/transcript.js`, 상태 처리는 `src/state.js`와 `src/activity.js`, 표시는 `src/render.js`가 맡는다.
- 스킬·플러그인 감지는 `src/skills.js`, 대화형 갱신은 `src/watch.js`와 inline용 `src/hud-source.js`가 맡는다.
- inline 터미널 처리는 `src/inline.js`, `src/screen.js`, `src/pty.js`에 있다.
- 기본 inline은 일반 화면에서 드래그·휠 스크롤을 제공하고 `src/scrollback.js`가 Codex 출력만 실제 터미널 기록에 전달한다. HUD 갱신을 기록에 섞거나 휠을 명령 이력 방향키로 바꾸지 않는다.
- 설치 스킬 등록은 `plugins/codex-hud/skills/codex-hud-install/scripts/install-skill.py`, HUD 설치는 같은 경로의 `install.py`가 맡는다. 프로젝트 범위는 사용자 셸 시작 파일과 PATH를 변경하지 않으며 자동 실행에 디렉터리 경계를 적용한다.
- `install.py --status`는 읽기 전용이며 `--update`는 기존 prefix·범위·언어·자동 실행과 시작 파일 연결을 보존한다. npm 실행 전 실제 설치 버전을 비교하고, 알 수 없는 버전이나 승인하지 않은 다운그레이드는 차단한다.
- 설치 상태 진단은 `src/installation.js`, macOS helper 권한 복구는 `src/repair-node-pty.js`가 맡는다. Doctor는 권한을 변경하지 않고 실제 PTY 시작·종료를 검증한다. 부모 셸의 자동 실행 활성화는 설정 여부와 구분한다.
- GitHub 마켓플레이스 목록은 `.agents/plugins/marketplace.json`이며 `plugins/codex-hud`를 가리킨다. 로컬 등록 성공과 GitHub에 공개된 ref의 설치 성공을 구분해 기록한다.
- 문서 목차는 `docs/README.md`, 기여·Git 준비 절차는 `CONTRIBUTING.md`, 릴리스 절차는 `docs/runbooks/release.md`를 따른다.
- 설치·등록 도구의 소유 파일, 백업과 실패 경계는 `docs/reference/installation.md`를 따른다. 배포 문서의 링크는 npm 패키지에도 존재하는 파일을 가리켜야 한다.
- 사용자 동작이나 구조가 바뀌면 해당 README·아키텍처·구현 참조 문서를 같은 작업에서 갱신한다.
- 루트 README는 프로젝트명, 라이선스·빌드·버전·언어 Shields 배지 한 줄, 영문·국문 한 줄 설명 뒤에 `# English`, `# 한국어`를 수평선으로 나눠 배치한다. 언어 배지는 `#english`, `#한국어`로 연결한다.
- README의 두 언어는 개요·기능·요구 사항·설치·사용법·설정·구조·테스트·API·기여·라이선스·연락처 순서와 정보를 맞춘다. 명령·설정값·경로는 동일하게 유지하고 설명·주석은 번역하며, 스크린샷은 양쪽 개요에 넣고 이모지는 사용하지 않는다.
- README 배지와 연락처는 실제 메타데이터·CI·공개 연락처를 근거로 작성한다. CI가 없으면 `not configured`, 공개 이메일이 없으면 미공개로 표시한다.
- 일반 문서·링크·배지 수정은 문서 정합성과 배포 파일을 중심으로 검증한다.
  코드·의존성·테스트 설정이 같으면 유효한 기존 구현 검증 결과를 재사용한다.
- 같은 변경의 테스트·코드 리뷰는 한 작업 흐름에서 담당한다. 커밋·푸시만을
  이유로 전체 검증을 반복하지 않으며 아래 릴리스 필수 검증은 유지한다.

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
- 설치 완료 검사에는 `inline.available`뿐 아니라 `inline.probe.status`가 `ok`인지 확인한다.
