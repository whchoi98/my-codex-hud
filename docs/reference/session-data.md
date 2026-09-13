# Session Data

<a href="#english">English</a> · <a href="#korean">한국어</a>

<a id="english"></a>
## English

### Overview

Read a selected local Codex rollout JSONL into normalized display state. Retained
fields include short tool targets and plan steps; full prompts, instructions,
reasoning, tool outputs, and skill bodies are not kept in that state.

### Components

| Component | Responsibility |
|---|---|
| `findSession` — [sessions.js](../../src/sessions.js) | Select a rollout by explicit path/UUID or root-session metadata. |
| `TranscriptReader` — [transcript.js](../../src/transcript.js) | Maintain a byte cursor and partial-line buffer; reduce complete records into state. |
| `createState` / `applyRecord` — [state.js](../../src/state.js) | Normalize session/approval metadata, context, cumulative tokens, rate limits, compactions, and turn state. |
| `applyActivity` — [activity.js](../../src/activity.js) | Correlate function/custom tool calls, execution/MCP/patch events, web searches, agents, and plans. |
| `skillsForTool` / `recordLoadedSkills` — [skills.js](../../src/skills.js) | Derive skill and plugin read candidates from paths and retain them after tool completion. |
| `HudSource` — [hud-source.js](../../src/hud-source.js) | Poll the embedded HUD's session and Git data; render cached state. Standalone snapshot/watch use the reader directly in [watch.js](../../src/watch.js). |

### Key decisions

- **Selection:** Automatic discovery scans `.jsonl` files under
  `<codexHome>/sessions`, through at most five nested directory levels. Candidates
  need a complete first-line `session_meta` within the 2 MiB metadata limit.
  Child/internal sessions are excluded using parent, source, and thread-source
  markers. An absolute metadata `cwd` must match the requested directory exactly
  after canonicalization. Newest file modification time wins; `since` filters
  session start time and rejects unknown start times.
- **Explicit sessions:** A non-UUID value is resolved relative to `cwd` and must
  name a regular file. UUID lookup also searches `archived_sessions` and matches
  metadata IDs case-insensitively. Both bypass automatic cwd/child/`since` filters;
  a missing explicit target raises an error rather than choosing another session.
- **Incremental parsing:** Only newline-terminated records are decoded, preserving
  split UTF-8 and unfinished final lines. Defaults limit each line to 2 MiB and
  each `read()` to 16 MiB. Malformed JSON and oversized lines increment
  `diagnostics` and are skipped through the next newline. Path/file-identity
  changes, shrinking below the cursor, same-size timestamp changes, or changed
  prefix/cursor anchor bytes reset the reader and state. `caughtUp` means the
  cursor reached the observed file size, even if the final line still lacks a newline.
- **Usage snapshots:** `event_msg` / `token_count` uses
  `info.last_token_usage.total_tokens` for context and `info.total_token_usage`
  for cumulative counters. `token_usage_record` uses `usage` and
  `thread_token_usage`, respectively, with the previously reported context window.
  Snapshots replace counters; cache tokens are not added again. Context percent
  needs a positive window and is capped at 100. Invalid numeric values become
  `null`, zero remains valid, and absent usage/limit objects preserve prior
  snapshots. `compacted` increments the compaction count and clears context
  usage/percent, retaining the window and cumulative totals. Rate limits are
  recorded snapshots; `resetsAt` is Unix seconds, while normalized event
  timestamps are milliseconds.
- **Approvals:** `turn_context` supplies allowlisted policy/reviewer values.
  A validated granular policy object becomes `granular`; omitted fields preserve
  previous values, while invalid supplied values become `null`.
- **Tools and turns:** Calls/results share call IDs; execution, MCP, and patch end
  events take precedence over later generic outputs. `exec_command_end` can
  create an entry without a begin event. Process lifecycle text is parsed only
  before the output-body delimiter. Yielded commands keep a process ID so
  `write_stdin` results can update the original call, including across turns.
  Task/turn start and completion interrupt unfinished tools except known
  background processes; `turn_aborted` interrupts all running tools. New turns
  clear the plan; `update_plan` and `plan_update` replace it with valid
  `pending`, `in_progress`, or `completed` steps.
- **Skill reads:** Candidates must target `SKILL.md` via supported file/resource
  tools or literal `cat`, `sed`, `head`, `tail`, or `Get-Content` reads. They are
  recorded only when the tool is marked `completed`. Shell chains count the last
  command or earlier unconditional reads under recognized `set -e` /
  `set -o errexit`. Searches, writes, conditional/loop bodies, pipelines,
  redirections, and command substitutions are excluded. Relative paths use the
  tool's workdir/cwd or session cwd; relative reads after a shell directory change
  are skipped.
- **Plugins and read history:** Plugin metadata comes only from validated
  `plugins/cache/<marketplace>/<plugin>/<version>/skills/.../SKILL.md` paths.
  Skills deduplicate by name; plugins by marketplace and name. Repeated reads
  move entries to the end and update `lastReadAt`; plugin versions follow the
  last read, even when older. These histories persist across turns and describe
  observed reads, not an inventory of installed or currently active components.
- **Agents and bounds:** Agent results, collaboration events, and
  `sub_agent_activity` update the latest state per agent. User-message
  `<subagent_notification>` records can update only already-known agent IDs.
  New agents default to `running`; unrecognized supplied statuses also normalize
  to `running`. Retention is bounded to 100 tools, 40 agents, 40 skills, 40 plugins,
  and 100 plan steps. Tool eviction prefers the oldest non-running entry, then
  the oldest running entry if necessary. The renderer shows only running agents
  and omits their section when none remain; terminal agent states stay in the
  bounded state.
- **Embedded polling:** `HudSource.poll()` searches when unselected or following,
  with a 1-second search throttle, and otherwise keeps the selected path.
  Optional Git refresh uses the session cwd (or settings cwd); polls refresh
  after a directory change or at least 3 seconds since the last lookup. Slower
  polling can lengthen the interval. `ENOENT`, `EACCES`, and `EPERM` produce a
  waiting state and clear selection only in follow mode. `poll()` returns
  `catchingUp`; `render()` uses cached metadata without another read.

### Code pointers

- Selection and reader constraints: [metadata](../../src/sessions.js),
  [read/reset detection](../../src/transcript.js).
- State and lifecycle rules: [usage/approval reducers](../../src/state.js),
  [tool results](../../src/activity.js).
- Read history and display filtering: [skill/plugin retention](../../src/skills.js),
  [agent filtering](../../src/render.js).

### Cross-references

- [Architecture](../architecture.md)
- [Terminal](terminal.md)

<a id="korean"></a>
## 한국어

### 개요

선택한 로컬 Codex rollout JSONL을 읽어 표시용 상태로 정규화합니다. 짧은 도구
실행 대상과 계획 단계는 포함하지만, 프롬프트·지침·추론·도구 출력·스킬 본문
전체는 정규화한 상태에 보관하지 않습니다.

### 구성 요소

| 구성 요소 | 역할 |
|---|---|
| `findSession` — [sessions.js](../../src/sessions.js) | 명시한 경로/UUID 또는 루트 세션 메타데이터로 rollout을 선택합니다. |
| `TranscriptReader` — [transcript.js](../../src/transcript.js) | 바이트 커서와 미완성 줄 버퍼를 유지하고 완성된 기록을 상태에 반영합니다. |
| `createState` / `applyRecord` — [state.js](../../src/state.js) | 세션·승인 메타데이터, 컨텍스트, 누적 토큰, 사용 한도, 압축 횟수와 턴 상태를 정규화합니다. |
| `applyActivity` — [activity.js](../../src/activity.js) | 함수/커스텀 도구 호출, 실행·MCP·패치 이벤트, 웹 검색, 에이전트와 계획을 연결합니다. |
| `skillsForTool` / `recordLoadedSkills` — [skills.js](../../src/skills.js) | 경로에서 스킬·플러그인 읽기 후보를 찾고 도구 완료 후 기록합니다. |
| `HudSource` — [hud-source.js](../../src/hud-source.js) | 내장 HUD의 세션·Git 정보를 주기적으로 읽고 캐시된 상태를 렌더링합니다. 별도 snapshot/watch는 [watch.js](../../src/watch.js)에서 리더를 직접 사용합니다. |

### 주요 결정

- **세션 선택:** 자동 탐색은 `<codexHome>/sessions` 아래의 `.jsonl` 파일을 최대
  5단계 하위 디렉터리까지 찾습니다. 후보에는 2 MiB 메타데이터 한도 안에서 완성된
  첫 줄 `session_meta`가 있어야 합니다. 부모·source·thread-source 표식으로
  자식·내부 세션을 제외합니다. 메타데이터의 절대 경로 `cwd`는 정규화 후 요청한
  디렉터리와 정확히 일치해야 합니다. 파일 수정 시각이 가장 최근인 후보를 선택하며,
  `since`는 세션 시작 시각에 적용하고 시작 시각을 모르면 제외합니다.
- **명시한 세션:** UUID가 아닌 값은 `cwd` 기준으로 해석하며 일반 파일이어야 합니다.
  UUID는 `archived_sessions`도 검색하며 메타데이터 ID의 대소문자를 구분하지 않습니다.
  두 방식 모두 자동 선택의 cwd·자식·`since` 필터를 건너뜁니다. 명시한 대상을 찾지
  못하면 다른 세션을 선택하지 않고 오류를 반환합니다.
- **증분 파싱:** 줄바꿈으로 끝난 기록만 디코딩하므로 나뉜 UTF-8 문자와 미완성
  마지막 줄을 보존합니다. 기본 한도는 한 줄 2 MiB, `read()` 한 번에 16 MiB입니다.
  손상된 JSON과 초과 크기 줄은 `diagnostics`에 집계하고 다음 줄바꿈까지 건너뜁니다.
  경로·파일 식별자 변경, 커서보다 작아진 파일 크기, 같은 크기에서 시각 변경,
  파일 앞부분이나 커서 직전 기준 바이트의 변경을 감지하면 리더와 상태를 초기화합니다. `caughtUp`은
  커서가 관측한 파일 크기에 도달했다는 뜻이며, 마지막 줄의 줄바꿈은 아직 없을 수
  있습니다.
- **사용량 스냅샷:** `event_msg` / `token_count`의
  `info.last_token_usage.total_tokens`는 컨텍스트에, `info.total_token_usage`는
  누적 카운터에 사용합니다. `token_usage_record`는 각각 `usage`와
  `thread_token_usage`를 사용하며 앞서 보고된 컨텍스트 크기를 적용합니다.
  스냅샷은 카운터를 교체하고 캐시 토큰을 다시 더하지 않습니다. 컨텍스트 비율은
  양수인 컨텍스트 크기가 있어야 계산하며 최대 100으로 제한합니다. 잘못된 수치는
  `null`, 유효한 0은 그대로 두고, 사용량·한도 객체가 없으면 이전 스냅샷을 유지합니다.
  `compacted`는 압축 횟수를 늘리고 컨텍스트 사용량·비율을 비우며, 크기와 누적 합계는
  유지합니다.
  사용 한도는 기록된 스냅샷이며 `resetsAt`은 Unix 초, 정규화한 이벤트 시각은
  밀리초입니다.
- **승인 정보:** `turn_context`에서 허용된 정책·검토 주체 값만 반영합니다.
  유효한 세부 정책 객체는 `granular`로 정규화합니다. 필드가 생략되면 이전 값을
  유지하고, 전달된 값이 유효하지 않으면 `null`로 둡니다.
- **도구와 턴:** 호출과 결과는 호출 ID로 연결합니다. 실행·MCP·패치 종료 이벤트는
  나중의 일반 출력보다 우선하며, `exec_command_end`는 시작 이벤트 없이도 항목을
  만들 수 있습니다. 프로세스 상태 텍스트는 출력 본문 구분자 앞에서만 해석합니다.
  실행을 계속하는 명령은 프로세스 ID를 유지하므로 다음 턴에서도 `write_stdin`
  결과로 원래 호출을 갱신할 수 있습니다. 작업·턴 시작과 완료 시 알려진 백그라운드
  프로세스를 제외한 미완료 도구를 중단 처리하고, `turn_aborted`는 실행 중 도구
  전체를 중단 처리합니다. 새 턴은 계획을 비우며, `update_plan`과 `plan_update`는
  유효한 `pending`, `in_progress`, `completed` 단계로 계획을 교체합니다.
- **스킬 읽기:** 지원하는 파일·리소스 도구나 리터럴 `cat`, `sed`, `head`, `tail`,
  `Get-Content` 명령으로 `SKILL.md`를 읽는 호출만 후보가 됩니다. 도구가
  `completed`로 처리될 때 기록합니다. 셸 명령열은 마지막 명령 또는 인식 가능한
  `set -e` / `set -o errexit` 아래의 앞선 무조건 실행 읽기만 반영합니다.
  검색·쓰기·조건문·반복문 내부·파이프·리다이렉션·명령 치환은 제외합니다. 상대 경로는
  도구의 workdir/cwd 또는 세션 cwd를 기준으로 해석하며, 셸에서 디렉터리를 바꾼
  뒤의 상대 경로 읽기는 건너뜁니다.
- **플러그인과 읽기 이력:** 플러그인 정보는 검증된
  `plugins/cache/<marketplace>/<plugin>/<version>/skills/.../SKILL.md` 경로에서만
  얻습니다. 스킬은 이름으로, 플러그인은 마켓플레이스와 이름으로 중복을 제거합니다.
  다시 읽은 항목은 배열 끝으로 옮기고 `lastReadAt`을 갱신합니다. 플러그인 버전은
  더 오래된 버전이어도 마지막 읽기를 따릅니다. 이력은 턴이 바뀌어도 유지되며,
  설치되었거나 현재 적용 중인 구성 요소 목록이 아니라 관측한 읽기를 나타냅니다.
- **에이전트와 보관 한도:** 에이전트 결과·협업 이벤트·`sub_agent_activity`로
  에이전트별 최신 상태를 갱신합니다. 사용자 메시지의 `<subagent_notification>`은
  이미 알려진 에이전트 ID만 갱신합니다. 새 에이전트의 기본 상태는 `running`이며,
  전달된 상태를 인식하지 못해도 `running`으로 정규화합니다. 도구는 최대 100개,
  에이전트·스킬·플러그인은 각각 40개, 계획은 100단계를 유지합니다. 도구가 한도를
  넘으면 가장 오래된 비실행 항목부터 제거하고, 필요하면 가장 오래된 실행 항목을
  제거합니다. 렌더러는 실행 중인 에이전트만 표시하며 하나도 없으면 해당 영역을
  생략합니다. 종료 상태도 한도 내에서는 상태에 남습니다.
- **내장 HUD 폴링:** `HudSource.poll()`은 미선택 상태이거나 follow 모드일 때
  탐색 간격을 최소 1초로 제한하고, 그 외에는 선택한 경로를 유지합니다. 선택적 Git
  조회는 세션 cwd(없으면 설정 cwd)를 쓰며, 폴링 시 디렉터리가 바뀌었거나 지난
  조회 후 3초 이상이면 갱신합니다. 폴링 간격이 길면 조회 간격도 늘어납니다.
  `ENOENT`, `EACCES`, `EPERM`은 대기 상태로 처리하고, follow 모드일 때만 선택을
  해제합니다. `poll()`은 `catchingUp`을 반환하고, `render()`는 추가 읽기 없이
  캐시된 메타데이터를 사용합니다.

### 코드 위치

- 선택·읽기 조건: [메타데이터](../../src/sessions.js),
  [읽기·초기화 감지](../../src/transcript.js).
- 상태·수명 주기 규칙: [사용량·승인 처리](../../src/state.js),
  [도구 결과](../../src/activity.js).
- 읽기 이력·표시 필터: [스킬·플러그인 보관](../../src/skills.js),
  [에이전트 필터](../../src/render.js).

### 관련 문서

- [아키텍처](../architecture.md)
- [터미널](terminal.md)
