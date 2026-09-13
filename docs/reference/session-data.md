# Session Data

<a href="#english">English</a> · <a href="#korean">한국어</a>

<a id="english"></a>
## English

### Overview
Read local Codex rollout JSONL and retain only display metadata.
### Components
Session selection chooses an explicit session or a matching root session.
The incremental reader handles appends and file replacement; reducers update
context, tokens, tools, agents, skills, plugins, and plans.
### Key decisions
Context usage is separate from cumulative tokens. Successful document reads
identify loaded skills. Agent lifecycle history is retained, while the HUD shows
only `running` agents. Missing observations remain unknown.
### Code pointers
- [sessions.js](../../src/sessions.js), [transcript.js](../../src/transcript.js)
- [state.js](../../src/state.js), [activity.js](../../src/activity.js)
- [skills.js](../../src/skills.js), [hud-source.js](../../src/hud-source.js)
### Cross-references
- [Architecture](../architecture.md)
- [Terminal](terminal.md)

<a id="korean"></a>
## 한국어

### 개요
로컬 Codex rollout JSONL을 읽고 표시용 메타데이터만 보관합니다.
### 구성 요소
명시한 세션이나 프로젝트에 맞는 루트 세션을 선택합니다. 증분 리더가 추가·교체를
처리하고 상태 처리기가 컨텍스트, 토큰, 도구, 에이전트, 스킬, 플러그인, 계획을
갱신합니다.
### 주요 결정
컨텍스트 사용량과 누적 토큰을 구분합니다. 성공한 문서 읽기로 로드한 스킬을
감지합니다. 에이전트 상태 이력은 유지하되 HUD는 `running`만 표시합니다.
확인하지 못한 값은 알 수 없는 상태로 둡니다.
### 코드 위치
- [sessions.js](../../src/sessions.js), [transcript.js](../../src/transcript.js)
- [state.js](../../src/state.js), [activity.js](../../src/activity.js)
- [skills.js](../../src/skills.js), [hud-source.js](../../src/hud-source.js)
### 관련 문서
- [아키텍처](../architecture.md)
- [터미널](terminal.md)
