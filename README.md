# Codex HUD

현재 버전: **0.6.0** · [버전별 변경 이력](CHANGELOG.md)

[문서 목차](docs/README.md) · [아키텍처](docs/architecture.md) · [온보딩](docs/onboarding.md) · [기여와 Git 작업](CONTRIBUTING.md)

[claude-hud](https://github.com/jarrodwatts/claude-hud)의 화면 구성과 기능을 참고해 만든 **Codex CLI용 실시간 터미널 HUD**입니다. 현재 작업의 컨텍스트 사용량, 사용 한도, 도구 실행, 에이전트, 스킬, 플러그인과 작업 계획을 한곳에서 볼 수 있습니다.

**VS Code 통합 터미널 하나에서 Codex 아래에 전체 HUD를 고정해 표시합니다.** `codex-hud start`의 기본 실행 방식이며 tmux는 필요하지 않습니다. Node.js 20 이상에서 동작하고, HUD 데이터는 로컬 Codex 세션 기록에서 읽습니다.

```text
gpt-5 high · 승인 auto-review (on-request) · my-project [Git feat/codex-hud* 변경 3 미추적 1 ↑2] · 작업 중
컨텍스트 [████░░░░░░] 42% · 108.5k/258.4k · 압축 1
사용량 5시간 23% (초기화 1시간 36분) · 7일 41% (초기화 3일 0시간) · plus
토큰 223.9k · 세션 12분 0초 · 입력 215.4k · 출력 8.5k · 캐시 168.5k · 추론 3.2k
도구 1 실행 중 · 2 완료 · exec_command npm test
로드한 스킬 3 · code-review, test-driven-development, brainstorming
사용한 플러그인 1
  · review-kit v1.2.0 · personal
에이전트 2 실행 중
  ▶ 실행 중 · Ada (reviewer)
  ▶ 실행 중 · Lin (worker)
계획 1/3 · Build the terminal HUD
```

위 수치는 `demo`의 예시입니다. 실제 모델명과 값은 세션 기록에서 읽습니다.

## GitHub에서 설치

이 프로젝트에는 HUD 설치·진단과 선택적 자동 실행을 담당하는
[`codex-hud-install` 스킬과 `codex-hud` 플러그인](plugins/codex-hud/README.md)이
포함되어 있습니다. 단독 스킬 또는 플러그인 중 한 가지를 등록하고, 새 Codex
대화에서 HUD 설치를 요청합니다. 스킬·플러그인 등록과 HUD 실행 프로그램 설치는
별도 단계입니다.

### 단독 스킬

Codex에 다음 요청을 붙여 넣습니다.

```text
Use $skill-installer to install https://github.com/whchoi98/my-codex-hud/tree/main/plugins/codex-hud/skills/codex-hud-install into ~/.agents/skills
```

설치 스크립트와 HUD npm 아카이브를 포함한 전체 폴더가
`~/.agents/skills/codex-hud-install`에 필요합니다. `SKILL.md`만 복사하지 마세요.
`skill-installer`의 기본 경로와 구분하도록 위 요청에 설치 목적지를 명시했습니다.
기존 경로가 있으면 덮어쓰지 않으므로 갱신 방법은
[스킬 등록 안내](plugins/codex-hud/README.md)를 참고하세요.

### GitHub 플러그인

`codex plugin marketplace --help`가 동작하는 CLI에서 실행합니다.

```bash
codex plugin marketplace add whchoi98/my-codex-hud --ref main
codex plugin add codex-hud@codex-hud
```

저장소의 `.agents/plugins/marketplace.json`은 `plugins/codex-hud`를 가리킵니다.
Codex가 내려받은 소스와 플러그인 캐시를 관리합니다. 갱신할 때는 다음을 실행한 뒤
새 대화를 시작합니다.

```bash
codex plugin marketplace upgrade codex-hud
codex plugin add codex-hud@codex-hud
```

**공개 상태 확인(2026-09-13):** GitHub `main`은 아직 0.5.2이고 마켓플레이스
목록이 없어 위 플러그인 명령은 이 변경이 GitHub에 반영된 뒤 사용할 수 있습니다.
현재 공개본에서는 위의 단독 스킬 설치 또는 아래의 소스 설치를 사용할 수 있습니다.
프로젝트 범위 설치는 0.6.0부터 지원합니다.
실행 환경과 결과는 [GitHub 설치 검증](docs/verification-github-install.md)에 기록했습니다.

### HUD 설치와 적용 범위

스킬이나 플러그인을 등록한 뒤 새 Codex 대화에서 요청합니다.

```text
$codex-hud-install 사용자 전체에 HUD를 설치하고 codex 실행 시 자동으로 켜지도록 설정해줘.
```

```text
$codex-hud-install 현재 프로젝트에만 HUD를 설치하고 자동 실행을 설정해줘.
```

스킬은 처음 설치할 때 **사용자 전체(`user`) / 현재 프로젝트(`project`)** 중
적용 범위를 확인합니다. 사용자 설치는 `~/.local/share/codex-hud` 또는
`$XDG_DATA_HOME/codex-hud`, 프로젝트 설치는 `<프로젝트>/.codex-hud`를 사용합니다.
프로젝트 설치는 사용자 셸 시작 파일과 PATH를 변경하지 않고, 해당 터미널에서
`shell.sh`를 읽으면 그 프로젝트와 하위 디렉터리에 자동 실행을 적용합니다.
스킬 자체도 사용자 또는 프로젝트의 `.agents/skills`에 등록할 수 있습니다.
등록·설치 명령은 [설치 플러그인 안내](plugins/codex-hud/README.md)를 참고하세요.

`npm run package:plugin`으로 현재 HUD 실행 패키지를 동봉한 플러그인 ZIP과
단독 스킬 ZIP을 `dist/`에 만듭니다. 원본 프로젝트 폴더를 옮기지 않아도 설치할
수 있으며, npm 의존성은 네트워크 또는 기존 캐시에서 가져옵니다.
플러그인 등록만으로 HUD나 셸 설정이 바뀌지는 않습니다.

## 빠른 시작

Node.js 20 이상과 PATH에서 실행할 수 있는 Codex CLI를 준비합니다.
GitHub 소스에서 직접 설치하려면 Git으로 저장소를 내려받습니다.

```bash
git clone --depth 1 https://github.com/whchoi98/my-codex-hud.git
cd my-codex-hud
npm ci
npm install -g .
codex-hud doctor
```

이미 소스가 있다면 복제 단계부터 반복하지 않고 해당 폴더에서 npm 명령을 실행합니다.
이 경로는 `codex-hud` 실행 파일을 설치하며 셸 자동 실행은 설정하지 않습니다.

런타임 의존성은 `node-pty` **1.1.0**, `@xterm/headless` **6.0.0**, `@xterm/addon-unicode11` **0.9.0**으로 고정되어 있습니다. OS·CPU에 맞는 사전 빌드가 없는 환경에서는 `node-pty` 설치에 Python과 C/C++ 빌드 도구가 필요할 수 있습니다.

전역 설치 없이 쓰려면 `npm install` 후 아래 예제의 `codex-hud`를 `node /절대경로/my-codex-hud/bin/codex-hud.js`로 바꾸면 됩니다. 이 프로젝트는 로컬 설치용이며 npm 레지스트리에 배포되어 있다는 전제를 두지 않습니다.

### VS Code 터미널 하나에서 Codex와 함께 실행

VS Code에서 작업할 프로젝트를 열고, 통합 터미널에서 실행합니다.

```bash
codex-hud start --language ko
```

현재 터미널의 위쪽에서 Codex를 실행하고 아래쪽에는 전체 HUD를 고정합니다. 두 번째 터미널이나 tmux 설정 없이 사용할 수 있습니다.

Codex가 첫 작업을 시작하기 전에는 세션 기록이 없어 `Codex 세션 대기 중`으로 표시될 수 있습니다. 이 명령으로 시작한 Codex의 기록이 생기면 상세 HUD가 갱신됩니다.

- 실행 중인 에이전트가 늘어나면 HUD 높이도 늘어나고, 완료·종료되면 목록에서 빠지며 높이가 줄어듭니다. 터미널 크기를 바꾸면 Codex 영역과 HUD 위치가 함께 조정되고, 높이가 부족하면 Codex 입력 공간을 남겨 둡니다.
- 화면에 다 들어오지 않는 HUD 목록은 `Alt+PageUp` / `Alt+PageDown`으로 끝까지 볼 수 있습니다. `--mouse`로 실행하면 HUD 위에서 마우스 휠로도 넘길 수 있습니다. 아래쪽의 `HUD 1-18/47`은 현재 보이는 줄의 범위와 전체 줄 수입니다.
- 키보드 입력과 `Ctrl+C`는 Codex에 전달됩니다. Codex가 종료되면 HUD도 종료되고 커서와 입력 모드가 복원됩니다. 기본 실행의 출력은 터미널 스크롤백에 남으며 Codex의 종료 코드도 유지합니다.
- 기본 실행에서는 마우스 휠로 지난 출력을 보고 바로 드래그해 선택·복사할 수 있습니다. 출력이 계속 바뀌면 `Alt+M`으로 화면을 고정한 뒤 선택합니다.
- `Alt+L`로 HUD의 한글/영문을 실행 중에 전환합니다.
- 터미널이 키를 프로그램에 전달하는 경우 `Shift+PageUp` / `Shift+PageDown`으로 가상 터미널의 일반 화면 기록을 탐색합니다. 기본 휠이 이동하는 실제 터미널 스크롤백과는 별도로 최대 5,000행을 유지합니다.

Codex 옵션은 `--` 뒤에 전달합니다.

```bash
codex-hud start --language ko -- --model YOUR_MODEL
```

Codex의 `-C`/`--cd`를 전달하면 HUD도 해당 디렉터리의 세션을 찾습니다. `--preset`, `--language`, `--ascii`, `--no-color`, `--config` 등 HUD 옵션은 `--` 앞에 둡니다.

기본 inline 실행은 **Linux, macOS, WSL**을 지원합니다. 네이티브 Windows에서는 `watch`/`status`/`demo`/`setup`을 사용하거나, WSL 안에서 `start`를 실행하세요. `start`에는 표준 입력과 출력이 모두 인터랙티브 터미널이어야 합니다.

### 실행 중 언어 전환과 텍스트 복사

| 단축키 | 동작 |
| --- | --- |
| `Alt+L` | 한글 ↔ 영문 전환 |
| `Alt+M` | 텍스트 선택 모드 켜기/끄기 |

`Alt+L`은 현재 HUD의 표시 언어를 즉시 바꿉니다. 긴 갱신 주기를 설정했어도 다음 갱신을 기다리지 않습니다. 변경은 해당 실행에만 적용됩니다. 다음 실행에서는 CLI의 `--language`, 설정 파일, 기본값 `en` 순서로 언어를 정합니다. 설치 스킬의 자동 실행 함수는 설치 시 선택한 언어를 `--language`로 전달하며, 처음 설치할 때의 기본값은 `ko`입니다.

기본 실행에서는 별도 단축키 없이 마우스로 텍스트를 드래그한 뒤 터미널의 복사 메뉴나 복사 단축키를 사용하세요. 화면 갱신 중에도 같은 내용을 선택하려면 `Alt+M`을 누릅니다. 선택 모드에서는 화면 갱신이 멈추고 HUD에 안내가 표시됩니다. Codex 작업과 기록 읽기는 백그라운드에서 계속 진행됩니다.

기본 `start`의 휠은 실제 터미널 스크롤백을 이동합니다. 이전 출력을 보는 동안 HUD도 화면 밖으로 스크롤될 수 있습니다. HUD를 고정한 채 내부 목록과 Codex 기록을 휠로 넘기려면 `codex-hud start --mouse`를 사용합니다. Codex가 마우스 모드를 요청하면 해당 입력도 전달합니다. `watch --mouse`는 HUD 목록만 스크롤합니다. 마우스 캡처는 드래그 시작도 가로채므로, 이 모드에서 복사할 때는 `Alt+M`으로 잠시 해제하세요. 설정 파일의 `"mouse": true`로 저장할 수도 있으며, `--no-mouse`는 저장된 값보다 우선해 기본 휠 스크롤과 드래그 선택으로 돌아갑니다.

다시 `Alt+M`을 누르면 화면 갱신을 재개하고, `--mouse`를 켠 경우에만 마우스 캡처가 돌아옵니다. `Esc`, 일반 키보드 입력, 언어 전환, 터미널 크기 변경도 선택 모드를 종료합니다. Inline에서 `Alt+M`이나 `Esc`로 선택을 끝내면 가상 터미널에서 탐색하던 위치를 유지합니다. 최신 출력이 있는 맨 아래로 돌아가려면 `Shift+PageDown`으로 이동하거나 Codex에 일반 텍스트를 입력합니다. 단축키는 대화형 `watch`에서도 동작하며, `start --tmux`에서는 HUD 패널을 선택한 상태에서 사용합니다. `Alt` 조합이 HUD에 전달되도록 터미널의 단축키 설정이 허용해야 합니다.

Inline 선택 모드의 위·아래 방향키는 출력 기록을 탐색하며 Codex의 명령 이력을 바꾸지 않습니다. 선택 모드 밖에서는 방향키가 그대로 Codex에 전달됩니다.

화면을 고정한 동안 새 출력의 실제 터미널 기록 전달도 대기합니다. 대기열은 최대
5,000행이며 초과분은 오래된 행부터 제거합니다. 고정한 채 Codex가 종료되면
아직 전달되지 않은 출력은 터미널 기록에 남지 않으므로, 종료 전에 선택 모드를
해제하세요. 이미 전달한 출력은 종료 후에도 남습니다.

### tmux로 실행하기 (선택)

기존 tmux 방식은 `--tmux`로 선택합니다.

```bash
codex-hud start --tmux --language ko
```

이 방식에만 tmux가 필요합니다. 이미 tmux 안이라면 새 창을 만들고, tmux 밖이라면 새 세션에 연결합니다. Codex 프로세스가 종료되면 함께 만든 HUD 영역도 닫힙니다. 기존 tmux 창의 구성을 변경하지 않습니다.

목록을 넘겨 보려면 HUD 패널을 선택한 뒤 `PageUp` / `PageDown` 또는 방향키를 사용합니다.

### 별도 터미널에서 보기

이미 실행 중인 Codex 세션을 별도로 모니터링하려면 두 번째 터미널에서 실행합니다.

```bash
codex-hud watch --cwd /path/to/your/project --language ko
```

`Ctrl+C`로 HUD를 종료합니다. 화면과 커서 상태가 복원됩니다. `watch`는 Codex를 실행하거나 제어하지 않습니다.

긴 목록은 `PageUp` / `PageDown`, 위·아래 방향키로 스크롤할 수 있습니다. `Alt+PageUp` / `Alt+PageDown`도 사용할 수 있으며, `--mouse`로 실행하면 마우스 휠도 동작합니다.

세션 없이 화면을 미리 보려면:

```bash
codex-hud demo --language ko
```

`watch`/`status`/`demo`/`setup`은 네이티브 PTY 모듈을 불러오지 않습니다. inline `start`와 `doctor`가 필요할 때만 해당 모듈을 불러옵니다.

## 원본과 Codex 버전의 차이

Claude HUD는 Claude Code의 `statusLine` 명령에 등록되어 입력창 아래에 표시됩니다. 확인한 Codex의 `tui.status_line`은 **내장 항목 목록**을 받으며, 임의의 HUD 프로그램을 실행하는 명령 설정이 아닙니다.

이 프로젝트는 상세 활동을 같은 터미널의 Codex 아래 고정 영역에 표시하고, 기본 정보만 필요할 때 쓸 수 있는 Codex 내장 상태줄 설정도 제공합니다.

| 기능 | Codex HUD |
| --- | --- |
| 모델·추론 수준 | 세션의 모델과 effort |
| 컨텍스트 막대 | 최근 응답 토큰 / 보고된 컨텍스트 크기 |
| 사용 한도·초기화 시간 | 세션에 기록된 primary/secondary 사용량 |
| 도구 실행 | 호출·결과, 오류, 백그라운드 명령의 종료 추적 |
| 에이전트 | 실행 중인 에이전트의 개수와 이름·역할 표시 |
| 승인 모드 | 현재 세션에 기록된 검토 주체와 승인 정책 |
| 로드한 스킬 | 성공한 스킬 문서 읽기에서 확인한 이름을 도구 바로 아래 한 줄 목록으로 표시 |
| 사용한 플러그인 | 읽은 플러그인 스킬의 캐시 경로에서 확인한 이름·버전·마켓플레이스 |
| 작업 진행 | `update_plan`의 완료 수와 현재 단계 |
| Git | 현재 디렉터리 옆에 브랜치, 변경·미추적 파일 수, ahead/behind |
| 세션 시간 | `세션` 라벨과 함께 시작 시각 기준 경과 시간 표시 |
| 누적 토큰 | 입력·출력·캐시·추론·총량 |
| 표시 설정 | 전체/간단/최소, 한글/영문, 색상, ASCII, 너비 |
| 비용 | 표시하지 않음 |

기본 `full` 모드는 현재 세션에서 추적하는 에이전트 중 `running` 상태인 에이전트만 각각 한 줄로 나열합니다. 완료·오류·중단·종료된 에이전트는 숨깁니다. `essential`은 실행 중인 에이전트 수만 표시하고, 실행 중인 에이전트가 없으면 두 모드 모두 에이전트 제목과 요약을 생략합니다. `minimal`은 에이전트 정보를 생략합니다. 에이전트가 다시 실행되면 목록에 다시 표시됩니다.

### 현재 디렉터리·Git 상태·세션 시간

현재 디렉터리 바로 옆에 `my-project [Git main* 변경 3 미추적 1 ↑2 ↓1]`처럼 Git 상태를 표시합니다. `*`는 작업 트리에 변경이 있다는 뜻이고, `변경`은 추적 중인 파일의 변경 수, `미추적`은 아직 Git에 추가하지 않은 파일 수입니다. `↑`/`↓`는 upstream보다 앞선/뒤처진 커밋 수이며 ASCII 모드에서는 `+`/`-`로 표시합니다.

변경이 없으면 `[Git main 변경 없음]`, Git 정보를 읽을 수 없거나 Git 저장소가 아니면 `[Git —]`를 표시합니다. `--no-git` 또는 설정의 `"git": false`로 Git 조회와 표시를 생략할 수 있습니다.

토큰 행의 `세션 12분 34초`는 선택한 세션의 시작 시각부터 경과한 시간입니다. 작업 중에는 갱신되고 완료·중단 상태에서는 마지막 기록 시각을 기준으로 고정됩니다. 기존 세션을 재개하면 원래 시작 시각을 사용하며, 시작 시각을 알 수 없으면 `세션 —`로 표시합니다. Git 상태와 세션 시간은 모든 표시 모드에 포함되며, 터미널 너비가 부족하면 다른 항목과 마찬가지로 잘릴 수 있습니다.

### 승인 모드와 로드한 스킬

상단의 `승인 auto-review (on-request)`는 선택한 세션에서 마지막으로 기록된 검토 주체와 승인 정책입니다. `user`, `untrusted`, `on-request`, `on-failure`, `never`, `granular`도 기록에 따라 표시합니다. 정책이 `never`이면 `승인 never`로 표시하며, 모드를 확인할 기록이 없으면 `—`로 표시합니다. HUD는 승인 설정을 변경하지 않습니다.

`full` 모드에는 성공한 `SKILL.md` 읽기에서 확인한 스킬 이름을 도구 행 바로 아래에 한 줄로 나열합니다. 최근에 읽은 스킬부터 쉼표로 구분하고 같은 이름은 한 번만 표시합니다. 터미널 너비를 넘으면 말줄임표로 표시합니다. `essential`은 스킬 수만 표시하고, `minimal`은 스킬 목록을 생략합니다.

스킬 감지는 파일 읽기 도구와 `cat`, `sed`, `head`, `tail`, `Get-Content`의 단순한 읽기 명령을 지원합니다. 검색·수정·실패한 읽기는 제외합니다. 복합 셸 명령은 마지막 읽기 명령 또는 `set -e`로 성공을 확인할 수 있는 읽기만 반영합니다. `cd` 이후의 상대 경로, 조건부 실행, 파이프, 리다이렉션, 프로그램 내부의 파일 읽기 등은 감지하지 못할 수 있습니다. 이 목록은 현재 세션의 문서 읽기 이력이며, 스킬이 지금도 적용 중인지 또는 해제됐는지를 판별하는 표시는 아닙니다.

### 사용한 플러그인

`full` 모드의 `사용한 플러그인`에는 현재 세션에서 스킬 문서를 읽은 플러그인의 이름,
버전과 마켓플레이스를 스킬 행 아래에 표시합니다. 도구·스킬·플러그인을 모아 보여 주고,
그 아래에 에이전트와 계획을 배치합니다. `essential`은 개수만 표시하고 `minimal`은 생략합니다.
한 플러그인의 여러 스킬을 읽어도 한 번만 표시하며, 마켓플레이스가 다르면 구분합니다.
최근에 읽은 플러그인부터 최대 40개를 보여 줍니다.

정보는 `plugins/cache/<마켓플레이스>/<플러그인>/<버전>/skills/.../SKILL.md`의
성공한 읽기에서 확인합니다. 버전도 해당 읽기 시점의 캐시 경로를 기준으로 하며,
`status --json`의 `plugins`에는 이름, 버전, 마켓플레이스와 마지막 읽기 시각을 담습니다.
스킬 감지와 같은 읽기 제한이 적용됩니다. MCP 도구만 사용한 플러그인과
캐시 밖의 개발 경로는 감지하지 못합니다.

### Codex 내장 상태줄

```bash
codex-hud setup
```

이 명령은 아래 TOML을 **출력만** 합니다. 원하는 경우 `~/.codex/config.toml`에 넣으세요. 이미 `[tui]`가 있다면 해당 테이블 안의 `status_line`을 수정하고, `[tui]`를 중복 추가하지 마세요.

```toml
[tui]
status_line = ["model-with-reasoning", "current-dir", "git-branch", "context-remaining", "five-hour-limit", "weekly-limit", "used-tokens"]
```

`CODEX_HOME`을 지정했다면 설정 파일은 `$CODEX_HOME/config.toml`입니다. Codex를 다시 시작해 적용합니다. 내장 상태줄은 도구 목록과 에이전트 상세를 그리는 HUD 영역과 별개입니다.

## 명령어

| 명령 | 용도 |
| --- | --- |
| `codex-hud` 또는 `codex-hud watch` | 실시간 HUD |
| `codex-hud start` | 현재 터미널에서 Codex 실행, 전체 HUD를 아래에 고정 |
| `codex-hud start --mouse` | HUD를 고정한 내부 휠 스크롤, 복사할 때는 `Alt+M`으로 캡처 해제 |
| `codex-hud start --tmux` | 선택적으로 기존 tmux 방식 사용 |
| `codex-hud status` | 한 번 출력 |
| `codex-hud status --json` | 정규화된 JSON 데이터 |
| `codex-hud demo` | 세션이 없어도 볼 수 있는 예시 |
| `codex-hud setup` | 내장 상태줄 TOML 출력 |
| `codex-hud doctor` | Node, Codex, inline PTY, 선택적 tmux, 세션 경로 확인 |
| `codex-hud doctor --json` | 진단 결과를 JSON으로 출력 |
| `codex-hud --help` | 전체 옵션 |

자주 쓰는 옵션:

```bash
# 2줄 요약
codex-hud watch --preset minimal

# 5줄 이내 요약
codex-hud watch --preset essential

# 세션을 정확히 지정
codex-hud watch --session 11111111-1111-7111-8111-111111111111
codex-hud status --session /path/to/rollout.jsonl --json

# 같은 프로젝트에서 새 세션을 시작하면 따라가기
codex-hud watch --cwd /path/to/project --follow

# 별도 Codex 홈과 설정 사용
codex-hud watch --codex-home /path/to/codex-home --config ./hud.json

# 단순한 터미널 출력
codex-hud status --ascii --no-color --no-git --width 80
```

`watch`를 파일로 리다이렉트하거나 파이프로 연결하면 한 번 출력하고 종료합니다. `--json`이나 `--once`로도 단일 출력을 선택할 수 있습니다.

`start`에 `--json` 또는 `--once`를 주면 오류로 종료합니다. `setup`도 `--json`을 지원하지 않습니다. `--tmux`와 `--` 뒤의 Codex 인자는 `start`에서만 사용할 수 있습니다. `doctor --json`의 `inline.available`은 PTY 모듈 가용성을 나타내며, 확인된 오류 원인은 `inline.error`에 표시됩니다. `tmux` 항목은 선택적 실행 방식의 설치 여부입니다. `doctor`는 의존성이 없어도 진단 결과를 출력하므로 종료 코드뿐 아니라 각 항목을 확인해야 합니다.

### 세션 선택

- 기본 위치는 `$CODEX_HOME/sessions`, `CODEX_HOME`이 없으면 `~/.codex/sessions`입니다.
- 기본 선택은 **현재 작업 디렉터리가 정확히 일치**하는 메인 세션 중 최근 수정된 파일입니다. 상위·하위 디렉터리는 자동으로 합치지 않습니다.
- 에이전트의 자식 세션과 내부 보조 세션은 자동 선택에서 제외합니다.
- `watch`는 처음 선택한 세션을 유지합니다. `--follow`를 주면 새로 활동하는 메인 세션을 따라갑니다.
- 같은 디렉터리에서 Codex를 여러 개 실행한다면 `--session`으로 구분하세요. 기본 선택은 프로세스 PID와 연결되지 않습니다.
- 새 `start`는 실행 시각 이후 생성된 세션을 기다립니다. `resume`/`fork`와 함께 실행할 때는 기존 세션을 선택할 수 있도록 실행 시각 필터를 적용하지 않습니다. 여러 세션이 있으면 `--session`으로 HUD의 대상을 명시하세요.
- `--session UUID`를 지정하면 보관된 세션도 검색합니다. 잘못된 명시적 경로/ID는 오류로 알립니다.
- `.jsonl`이 아닌 저장 형식이나 다른 기기의 원격 세션은 지원하지 않습니다.

### 환경 설정

`$CODEX_HOME/codex-hud.json` 또는 `~/.codex/codex-hud.json`에 원하는 항목을 넣습니다. `--codex-home`을 지정하면 그 디렉터리의 `codex-hud.json`을 읽으며, `--config`는 기본 파일 대신 사용할 JSON 파일을 지정합니다. 적용 순서는 기본값 → 선택한 설정 파일 → 명시한 CLI 옵션입니다. 아래는 한글 표시를 선택한 [설정 예시](examples/config.json)입니다.

```json
{
  "preset": "full",
  "language": "ko",
  "interval": 1000,
  "width": null,
  "pathLevels": 1,
  "color": true,
  "ascii": false,
  "git": true,
  "mouse": false
}
```

| 설정 | 허용 값 | 기본값 |
| --- | --- | --- |
| `preset` | `full`, `essential`, `minimal` | `full` |
| `language` | `en`, `ko` | `en` |
| `interval` | 200–60000ms | `1000` |
| `width` | `null` 또는 1–1000열 | `null` |
| `pathLevels` | 1–3 | `1` |
| `color` | `true` / `false` | `true` |
| `ascii` | `true` / `false` | `false` |
| `git` | `true` / `false` | `true` |
| `mouse` | `false`(기본 터미널 휠·드래그 선택) / `true`(HUD·가상 화면 마우스 캡처) | `false` |

기본 언어는 영문입니다. `NO_COLOR`가 설정되었거나 `TERM=dumb`이거나 출력이 터미널이 아니면 색상을 사용하지 않습니다. 한글과 이모지의 표시 폭을 계산해 좁은 터미널에서도 줄이 넘치지 않도록 자릅니다.

기본 설정 파일이 없으면 기본값을 사용합니다. 명시한 `--config` 파일이 없거나 JSON 형식·설정 이름·값이 잘못되면 오류로 종료합니다. 설정 파일의 최대 크기는 64KiB입니다. `--help`와 `--version`은 설정 파일을 읽지 않으므로 설정 오류가 있어도 사용할 수 있습니다.

## 데이터 해석

컨텍스트 사용률은 **가장 최근 응답의 `total_tokens` / `model_context_window`**로 계산하고 최대 100%로 제한합니다. 누적 사용량을 분자로 쓰거나, 입력 토큰에 포함된 캐시 토큰을 다시 더하지 않습니다. Codex 내장 상태줄은 기본 토큰을 보정할 수 있으므로 그 비율과는 다를 수 있습니다.

`compacted` 기록이 들어오면 이전 컨텍스트 수치를 비우고 다음 사용량 기록을 기다립니다. 정보가 없을 때는 0%를 만들지 않고 `—`/`unavailable`로 표시합니다.

사용 한도는 **해당 세션이 마지막으로 기록한 스냅샷**입니다. HUD가 계정 서버에 조회하지 않으므로 다른 세션의 사용량이나 오랫동안 멈춘 세션의 최신 잔여량은 반영되지 않을 수 있습니다. API 키 기반 세션 등에서는 사용 한도 기록 자체가 없을 수 있습니다. `resetsAt`은 Unix 초, 나머지 JSON 시각 값은 밀리초입니다.

도구는 최대 100개를 유지하며, 한도를 넘으면 가장 오래된 비실행 항목부터 제거합니다. 에이전트·스킬·플러그인은 각각 최근 40개, 계획은 최대 100개를 유지합니다. 도구 수는 이 추적 범위 안의 수입니다. 로그 정책·Codex 버전에 따라 실행 중 이벤트가 기록되지 않으면 해당 활동은 결과가 기록된 뒤 표시될 수 있습니다. 도구 이름·짧은 실행 대상·계획 단계·스킬 이름·플러그인 메타데이터는 출력되지만 프롬프트, 추론 본문, 도구 출력 전체, 스킬 문서 본문은 JSON 상태에 보관하지 않습니다.

## 문제 해결

**휠을 올리면 이전 명령이 입력되고 출력 기록이 스크롤되지 않습니다.**

`codex-hud --version`으로 `0.6.0` 이상인지 확인하고 실행 중인 HUD를 재시작하세요. `codex-hud start --no-mouse`는 저장된 캡처 설정도 해제하고 실제 터미널 스크롤백을 사용합니다. Inline 실행은 Codex에 `--no-alt-screen`을 추가해 출력 기록을 유지합니다. 기본 휠 입력은 Codex의 방향키 입력으로 전달되지 않습니다.

**마우스로 드래그해도 텍스트가 선택되지 않습니다.**

`codex-hud --version`으로 `0.5.2` 이상인지 확인하고, 이미 실행 중인 HUD는 다시 시작하세요. 실행 중인 프로세스에는 소스 변경이 자동 적용되지 않습니다. `codex-hud start --no-mouse`로 실행하면 저장된 마우스 캡처 설정도 해제합니다. `--mouse`를 사용 중이라면 `Alt+M`으로 선택 모드에 들어간 뒤 드래그하세요.

**“Waiting for a Codex session”만 표시됩니다.**

`codex-hud doctor`로 홈 디렉터리와 세션 파일을 확인하세요. Codex를 시작한 디렉터리를 `--cwd`로 지정하거나 `--session`에 로그 경로를 넣습니다. `disable_response_storage`를 사용하는 등 로컬 세션이 저장되지 않으면 HUD가 읽을 기록이 없습니다.

**`start`에서 네이티브 PTY 모듈을 불러오지 못합니다.**

`codex-hud doctor`의 `Inline PTY` 항목을 확인하세요. Node.js 20 이상인지 확인하고 의존성을 다시 설치합니다. 사전 빌드가 없는 플랫폼은 Python과 C/C++ 빌드 도구가 필요할 수 있습니다. 네이티브 Windows라면 WSL에서 설치·실행하거나 `watch`를 사용하세요.

**`start`에서 인터랙티브 터미널이 필요하다고 나옵니다.**

VS Code 통합 터미널에서 직접 실행하세요. 출력 리다이렉트나 파이프에서는 `status` 또는 `watch --once`를 사용합니다. Codex 실행 파일도 PATH에 있어야 합니다.

**`start --tmux`에서 tmux를 찾지 못합니다.**

tmux를 설치해 PATH에서 실행할 수 있게 하거나, 기본 `codex-hud start`로 같은 터미널에서 실행하세요.

**수치가 바로 바뀌지 않습니다.**

HUD는 기본 1초 간격으로 로그를 읽습니다. Codex가 이벤트를 기록한 시점에 갱신되며 토큰 스트리밍 중의 추정치를 만들지 않습니다. Git 상태는 HUD 갱신 시 확인하되, 같은 디렉터리는 최소 3초 간격으로 조회합니다.

**깨진 문자가 보입니다.**

`--ascii --no-color`를 사용하세요. 터미널의 한글/이모지 글꼴에 따라 실제 글자 폭이 다를 수 있습니다.

**Codex 업데이트 이후 일부 항목이 사라졌습니다.**

이 구현은 Codex CLI **0.153.4**의 실제 로그와 공개 프로토콜 소스로 확인했습니다. Rollout JSONL은 Codex 내부 형식이므로 바뀔 수 있습니다. 알 수 없는 기록은 무시하며 손상된 JSON·지나치게 큰 줄은 건너뜁니다. `status --json`의 `diagnostics`에서 건너뛴 줄 수를 볼 수 있습니다.

## 개발

소스 체크아웃에서 실행합니다. npm 실행 패키지에는 테스트와 플러그인의 설치
스크립트가 포함되지 않습니다. 개발 환경과 작업 순서는 [온보딩](docs/onboarding.md),
변경 영역별 검증 명령은 [기여 지침](CONTRIBUTING.md)을 참고하세요.

```bash
npm ci
npm test
npm run check
npm run test:installer
npm run package:plugin
npm pack
```

실제 임시 파일·Git 저장소·CLI 하위 프로세스로 세션 선택, 이어쓰기, 파일 교체, 토큰 계산, 도구·에이전트 상태, ANSI 제거, 한글 폭, 실행 방식 선택과 인자 전달을 검증합니다. 테스트는 API 호출 없이 실행됩니다. VS Code GUI를 직접 조작한 수동 검증은 수행하지 않았습니다.

### 버전과 변경 이력 관리

기능을 추가하거나 사용자에게 보이는 동작을 변경할 때는 같은 작업에서
[`CHANGELOG.md`](CHANGELOG.md)도 갱신합니다. 다음 버전이 정해지기 전에는
`Unreleased`에 기록하고, 릴리스할 때 해당 버전과 날짜 아래로 옮깁니다.
새 기능은 마이너 버전, 수정은 패치 버전을 올리며 기존 버전의 기록은 보존합니다.

릴리스 시 `package.json`, `package-lock.json`의 루트 패키지,
`plugins/codex-hud/.codex-plugin/plugin.json`과 README의 버전 표기를 맞춥니다.
마지막 소스·문서 수정 후 `npm run package:plugin`을 실행해 설치용 아카이브,
버전 메타데이터와 체크섬을 다시 생성합니다. 구체적인 작업 기준은
[`AGENTS.md`](AGENTS.md)에 있습니다.

```text
bin/codex-hud.js     실행 진입점
src/cli.js          명령과 옵션
src/watch.js        갱신 루프와 터미널 복원
src/sessions.js     메인 세션 탐색
src/transcript.js   JSONL 증분 읽기
src/state.js        토큰·세션 상태
src/activity.js     도구·에이전트·계획
src/skills.js       성공한 스킬 문서 읽기와 플러그인 정보 감지
src/render.js       HUD 표시
src/terminal.js     문자 폭·제어 문자 처리
src/inline.js       한 터미널 실행·입력·리사이즈·복원
src/pty.js          Codex PTY와 실행 환경
src/codex-args.js   Codex 실행 옵션과 세션 선택 문맥
src/screen.js       가상 터미널과 고정 HUD 화면 합성
src/scrollback.js   Codex 출력의 실제 터미널 스크롤백 전달
src/viewport.js     긴 HUD 목록의 스크롤과 표시 범위
src/output.js       이벤트 처리를 막지 않는 터미널 출력
src/hud-source.js   하단 HUD의 증분 데이터 읽기
src/launch.js       선택적 tmux 실행
src/config.js       HUD 설정과 native TOML
src/git.js          Git 상태
```

## 출처와 라이선스

MIT. UI와 기능의 출발점은 [Jarrod Watts의 claude-hud](https://github.com/jarrodwatts/claude-hud)입니다. 원본의 Claude 전용 인증·설정·transcript 처리를 복사해 연결하는 대신 Codex 이벤트에 맞춰 새로 구현했습니다. 원본 MIT 고지는 [NOTICE](NOTICE)에 보존했습니다.

확인한 자료:

- Claude HUD 0.8.0, commit `939eb66`
- [OpenAI Codex 설정 참조](https://developers.openai.com/codex/config-reference/)
- [OpenAI Codex 공개 소스](https://github.com/openai/codex), commit `9e868bd`

OpenAI 또는 Anthropic의 공식 제품은 아닙니다.
