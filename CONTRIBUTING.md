# Contributing

<a href="#english">English</a> · <a href="#korean">한국어</a>

<a id="english"></a>
## English

Read [AGENTS.md](AGENTS.md) and [architecture](docs/architecture.md). Keep terminal
handling, session parsing, and rendering changes covered by the relevant tests.
Run these checks before preparing a release:

```bash
npm test
npm run check
npm run test:installer
npm run package:plugin
```

Use [the release runbook](docs/runbooks/release.md) for version synchronization
and package verification. Document user-visible changes under Unreleased unless
the project's release workflow assigns a version. Preserve historical entries.

For a requested commit/push, first verify that Git metadata is valid and inspect
the branch, remote, and staged changes. Stage intended paths only and review the
exact staged diff. Include the bundled npm archive required by this repository;
`dist/` remains ignored. Use the user's chosen remote and branch. Do not invent
an upstream or publish as a side effect of documentation work.

<a id="korean"></a>
## 한국어

[AGENTS.md](AGENTS.md)와 [아키텍처](docs/architecture.md)를 읽습니다. 터미널 처리,
세션 파싱, 렌더링을 수정하면 해당 동작을 검증합니다. 릴리스 준비 전에 다음을 실행합니다.

```bash
npm test
npm run check
npm run test:installer
npm run package:plugin
```

버전 동기화와 패키지 검증은 [릴리스 런북](docs/runbooks/release.md)을 따릅니다.
릴리스 절차에서 버전이 정해지지 않은 사용자 변경은 Unreleased에 기록하고,
과거 항목은 보존합니다.

커밋·푸시를 요청받으면 먼저 유효한 Git 메타데이터와 브랜치·원격·스테이징 내용을
확인합니다. 의도한 경로만 스테이징하고 실제 스테이징 차이를 검토합니다.
이 저장소에서 필요한 동봉 npm 아카이브는 포함하며 `dist/`는 계속 제외합니다.
사용자가 정한 원격과 브랜치를 사용하고, 문서 정리만으로 원격을 만들거나 공개하지 않습니다.
