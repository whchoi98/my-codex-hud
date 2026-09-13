# Codex HUD 설치 플러그인

Codex에게 HUD 설치와 진단을 맡기는 `codex-hud-install` 스킬입니다.
HUD npm 패키지를 포함하므로 원본 프로젝트 폴더 없이도 사용할 수 있습니다.
플러그인을 등록하는 것만으로 HUD나 셸 설정이 변경되지는 않습니다.

## 사용

플러그인 또는 스킬을 등록한 뒤 새 Codex 대화에서 요청합니다.

```text
$codex-hud-install 사용자 전체에 HUD를 설치하고 codex 실행 시 자동으로 켜지도록 설정해줘.
```

```text
$codex-hud-install 현재 프로젝트에만 HUD를 설치하고 자동 실행을 설정해줘.
```

```text
$codex-hud-install HUD가 정상 작동하는지 확인해줘.
```

처음 설치할 때 적용 범위가 정해지지 않았다면 스킬이 사용자 전체와 현재
프로젝트 중 하나를 선택하도록 묻습니다. 이미 지정한 범위는 다시 묻지 않습니다.
자동 실행 없이 설치하려면 요청에 “자동 실행 없이”를 덧붙입니다.

## GitHub에서 등록

**GitHub 플러그인 방식으로 설치하는 것을 권장합니다.** Codex가 배포 소스와
플러그인 캐시를 관리하며, CLI 명령으로 설치와 갱신을 처리할 수 있습니다.
등록이 끝나면 새 Codex 대화에서 위의 HUD 설치 요청을 보냅니다. 등록 단계에서는
HUD 실행 프로그램을 설치하거나 셸 자동 실행을 활성화하지 않습니다.

### GitHub 플러그인 (권장)

`plugin marketplace` 명령을 지원하는 Codex CLI에서 실행합니다.

```bash
codex plugin marketplace add whchoi98/my-codex-hud --ref main
codex plugin add codex-hud@codex-hud
```

저장소 루트의 `.agents/plugins/marketplace.json`이 이 플러그인의
`plugins/codex-hud` 경로를 가리킵니다. `codex-hud@codex-hud`의 앞부분은
플러그인 이름, 뒷부분은 마켓플레이스 이름입니다. 갱신은 다음과 같습니다.

```bash
codex plugin marketplace upgrade codex-hud
codex plugin add codex-hud@codex-hud
```

**GitHub 설치 확인(2026-09-13):** 공개 `main`에서 위 명령으로 마켓플레이스 등록과
`codex-hud` 0.6.0 설치를 확인했습니다. 단독 스킬의 GitHub 다운로드와
공개본 HUD 설치도 확인했습니다.
`--scope project`와 `install-skill.py`는 0.6.0부터 제공합니다.

이 목록이 들어 있는 로컬 체크아웃은 다음과 같이 등록할 수 있습니다.

```bash
codex plugin marketplace add /absolute/path/to/my-codex-hud
codex plugin add codex-hud@codex-hud
```

### 단독 스킬 (선택)

플러그인 명령을 사용할 수 없거나 스킬 폴더를 직접 관리하려면 단독 스킬을
선택할 수 있습니다. Codex에 다음을 요청합니다. 목적지를 명시해 전체 스킬
폴더를 `~/.agents/skills/codex-hud-install`에 설치합니다.

```text
Use $skill-installer to install https://github.com/whchoi98/my-codex-hud/tree/main/plugins/codex-hud/skills/codex-hud-install into ~/.agents/skills
```

`scripts/`, `assets/`, `agents/`를 포함한 전체 폴더가 필요합니다.
GitHub 다운로드 도구는 기존 대상이 있으면 덮어쓰지 않습니다. 이 도구로
다운로드한 사본에는 아래 등록 도구의 소유 표식이 없으므로, 그 도구로 관리하도록
바꾸려면 기존 사본을 스킬 탐색 경로 밖에 보관한 뒤 새로 등록합니다.

### GitHub 소스를 받아 HUD 설치 (선택)

Python 3.9 이상, Node.js 20 이상, npm, Git과 PATH의 Codex CLI를 준비합니다.
사용자 범위 설치 예시입니다.

```bash
git clone --depth 1 https://github.com/whchoi98/my-codex-hud.git
cd my-codex-hud
python3 plugins/codex-hud/skills/codex-hud-install/scripts/install.py --shell none --dry-run
python3 plugins/codex-hud/skills/codex-hud-install/scripts/install.py --shell none
```

이 예시는 사용자 셸 시작 파일을 수정하지 않습니다. 설치 결과의 `command`에
나온 절대 경로로 HUD를 실행하거나, 출력된 `source .../shell.sh`로 해당 터미널의
PATH에 연결합니다. 자동 실행은 아래의 범위·셸 옵션을 확인한 뒤 별도로 선택합니다.

## 설치 범위

| 범위 | 설치 스킬 위치 | HUD 실행 파일 위치 | 자동 실행 적용 |
| --- | --- | --- | --- |
| `user` | `~/.agents/skills/codex-hud-install` | `~/.local/share/codex-hud/bin/codex-hud` | 현재 사용자 계정의 모든 프로젝트 |
| `project` | `<프로젝트>/.agents/skills/codex-hud-install` | `<프로젝트>/.codex-hud/bin/codex-hud` | 활성화한 터미널에서 해당 프로젝트와 하위 디렉터리 |

사용자 설치에서 `XDG_DATA_HOME`이 있으면 그 아래의 `codex-hud`를 사용합니다.
프로젝트 설치는 사용자 셸 시작 파일과 PATH를 바꾸지 않습니다.
스킬 등록 위치는 Codex의 [스킬 탐색 경로](https://developers.openai.com/codex/skills/#where-to-save-skills)를 따릅니다.
프로젝트 스킬을 등록해도 이미 등록한 사용자 스킬이나 플러그인은 제거하지 않습니다.

HUD 설치 도구는 Node.js 20 이상, npm,
Python 3.9 이상, Codex CLI가 필요하며 Linux·macOS·WSL을 대상으로 합니다.
npm 의존성을 내려받을 네트워크 또는 채워진 npm 캐시가 필요합니다.
OS·CPU에 맞는 `node-pty` 사전 빌드가 없으면 C/C++ 컴파일러, make,
Node 헤더도 필요합니다. 설치 도구는 네이티브 빌드 출력을 표시합니다.

자동 실행을 요청하면 Bash/Zsh의 `codex` 함수로 연결합니다. 대화형 실행,
`resume`, `fork`에는 HUD를 붙이고 `exec`, `review`, 로그인, 도움말, 버전 확인은
원래 명령으로 전달합니다. 자동화와 파이프 입력도 원래 Codex로 전달합니다.
한 번만 HUD를 생략하려면 `command codex ...`를 사용합니다.

프로젝트 자동 실행은 `source <프로젝트>/.codex-hud/shell.sh`로 현재 터미널에
연결합니다. 실제 작업 디렉터리와 `-C`/`--cd`로 지정한 디렉터리를 확인하며,
프로젝트 밖에서는 활성화된 사용자 설치가 있으면 그것을, 없으면 원래 Codex를
사용합니다. 새 터미널에서는 프로젝트의 `shell.sh`를 다시 읽어야 합니다.
직접 실행하려면 프로젝트 루트에서 `./.codex-hud/bin/codex-hud start`를 사용합니다.
한 터미널에는 프로젝트 자동 실행 설정 하나만 유지합니다. 다른 프로젝트의
`shell.sh`를 읽으면 마지막 프로젝트가 적용되므로, 이전 프로젝트로 돌아갈 때는
그 프로젝트의 파일을 다시 읽습니다.

## 다른 환경으로 옮기기

`codex-hud-plugin-0.6.0.zip`에는 `.codex-plugin/plugin.json`과 설치 스킬,
실행 패키지가 들어 있습니다. Codex 플러그인 가져오기 기능 또는 사용 중인
로컬 마켓플레이스에 등록할 수 있습니다. 이 플러그인의 식별자는 `codex-hud`입니다.

스킬만 사용하려면 `codex-hud-install-0.6.0.zip`을 풀고
`codex-hud-install` 폴더 안에서 아래 중 원하는 범위를 선택합니다.
미리 보려면 `--dry-run`을 추가합니다.

```bash
python3 scripts/install-skill.py --scope user
python3 scripts/install-skill.py --scope project --project-dir /path/to/project
```

이 단계는 Python 3.9 이상으로 동봉 패키지를 검증하고 스킬 폴더 전체를 복사합니다.
HUD 실행 파일과 셸 설정은 아직 설치하지 않습니다. 등록한 스킬에 위의 설치 요청을
보내면 해당 범위에 HUD를 설치합니다. `--project-dir`을 생략하면 실행한 디렉터리가
프로젝트이므로, 압축을 푼 폴더에서 실행할 때는 대상 프로젝트를 명시하세요.
`SKILL.md`만 복사하면 설치 스크립트와 HUD 패키지가 빠집니다.

같은 파일로 다시 등록하면 그대로 유지합니다. 이 도구가 등록한 스킬을 갱신할
때는 기존 내용을 `.agents/skill-backups/codex-hud-install/`에 보관하며,
추가한 사용자 파일은 유지합니다. 사용자가 수정한 동봉 파일이나 다른 스킬과
충돌하면 덮어쓰지 않고 오류로 알립니다.

등록 정보는 스킬 폴더의 `.codex-hud-skill.json`에 저장합니다. 파일 내용뿐 아니라
파일·디렉터리 권한과 심볼릭 링크 대상도 비교하므로, 동봉 파일을 삭제하거나
권한만 바꿔도 충돌할 수 있습니다. `--force`는 지원하지 않습니다.
오류에 나온 항목을 등록 당시 상태로 복구한 뒤 `--dry-run`으로 다시 확인하세요.
수정본을 유지하거나 수동 등록한 스킬을 교체하려면 기존 폴더를 `.agents/skills`
밖에 보관하고 새로 등록합니다. 필요한 사용자 파일은 새 동봉 파일과 겹치지 않는지
확인해 옮기며, 소유 표식을 임의로 고쳐 충돌을 우회하지 않습니다.

## 직접 설치하기

아래 명령은 배포 플러그인 또는 원본 저장소의 `plugins/codex-hud` 폴더
기준입니다. 다른 폴더에서는 `scripts/install.py`까지의 절대 경로를 사용하세요.
npm 실행 패키지에는 이 안내문만 포함되므로 설치 스크립트는 플러그인 ZIP이나
단독 스킬 ZIP에서 사용합니다.

```bash
python3 skills/codex-hud-install/scripts/install.py --scope user --dry-run --shell bash --autostart
python3 skills/codex-hud-install/scripts/install.py --scope user --shell bash --autostart
```

현재 프로젝트에만 설치하려면 프로젝트 경로를 명시합니다.

```bash
python3 skills/codex-hud-install/scripts/install.py \
  --scope project --project-dir /path/to/project --dry-run --shell none --autostart
python3 skills/codex-hud-install/scripts/install.py \
  --scope project --project-dir /path/to/project --shell none --autostart
```

`install.py`의 범위 기본값은 기존 명령과 호환되는 `user`입니다.
사용자 설치에서 Zsh는 `--shell zsh`, 셸 시작 파일을 건드리지 않으려면
`--shell none`을 사용합니다. `--shell none --autostart` 조합은 프로젝트 범위에서만
허용하며 사용자 범위에서는 오류입니다. 이미 자동 실행이 켜진 사용자 설치를
시작 파일 수정 없이 갱신하려면 `--shell none`만 지정하고 `--autostart`는 생략합니다.
프로젝트 설치는 `--shell` 값과 관계없이 사용자 시작 파일을 수정하지 않으며,
생성된 자동 실행은 Bash/Zsh에서 활성화합니다.
첫 설치에서 자동 실행이 필요 없으면 `--autostart`를 생략합니다.
`--language en`은 자동 실행 함수가 HUD에 전달할 언어를 지정합니다.
처음 설치할 때의 기본값은 `ko`이며, `codex-hud`를 직접 실행할 때는
CLI 옵션·HUD 설정 파일·기본값 `en` 순서로 언어를 정합니다.

```bash
python3 skills/codex-hud-install/scripts/install.py \
  --scope user --prefix /path/to/hud --shell bash --rc-file /path/to/custom.bashrc --autostart
```

프로젝트 설치의 `--prefix`는 해당 프로젝트의 하위 디렉터리여야 하며,
`--rc-file`은 사용자 설치에서만 사용할 수 있습니다. 서로 다른 범위의 설치에
같은 prefix를 재사용하지 않습니다. 생성된 `.codex-hud/`는 Git에 포함하지 마세요.

사용자 셸 설정은 기존 내용을 보존하고 `# >>> codex-hud installer >>>` 블록만 추가·갱신합니다.
기존 파일의 백업은 설치 경로의 `backups/`에 0600 권한으로 저장합니다.
Codex의 설정과 인증 파일, npm의 전역 prefix 설정은 수정하지 않습니다.
재설치 시 언어 옵션을 생략하면 기존 언어를 유지하고, `--autostart`를 생략해도
이미 켜진 자동 실행을 유지합니다. `--shell none`도 기존 자동 실행을 끄는
옵션은 아니며, 설치 경로의 `shell.sh`는 생성·갱신합니다.

사용자 설치에서 Bash는 `~/.bashrc`와 로그인 파일 하나를 갱신합니다. 로그인 파일은
`.bash_profile`, `.bash_login`, `.profile` 중 먼저 존재하는 파일이며,
모두 없으면 `.bash_profile`을 만듭니다. Zsh는 `$ZDOTDIR/.zshrc` 또는
`~/.zshrc`를 사용합니다. `--rc-file`을 지정하면 이 기본 목록 대신 해당
파일 하나만 갱신합니다.

`--dry-run`은 동봉 패키지의 체크섬·버전과 설치 계획을 확인하고 파일을 쓰지
않습니다. 실제 설치는 npm 설치, 설치된 버전, `doctor`의 Codex·PTY 결과가
정상인지 확인한 다음 셸 파일을 갱신합니다. 검증 실패 시 npm이 설치한 파일은
남을 수 있습니다. 캐시만으로 설치하려면 `--offline`을, 사용할 npm 캐시를
지정하려면 `--npm-cache /path/to/cache`를 추가합니다.

설치 결과의 `scope`, `project`, `prefix`, `startupFiles`로 적용 범위를 확인합니다.
프로젝트 설치의 `startupFiles`는 빈 목록입니다. 출력된 `source .../shell.sh`
명령으로 현재 터미널에 적용합니다. 사용자 시작 파일에 연결한 설치는 새 터미널에도
적용됩니다. 이미 실행 중인 Codex는 다시 시작해야 HUD가 붙습니다.

### 설치 확인

상태만 확인할 때는 재설치하지 않고 설치 결과의 `command`에 나온 절대 경로를
사용합니다. 아래 실행 파일 경로를 그 값으로 바꾸세요. 프로젝트 설치의 기본값은
`<프로젝트>/.codex-hud/bin/codex-hud`입니다.

```bash
"/absolute/prefix/bin/codex-hud" --version
"/absolute/prefix/bin/codex-hud" doctor --json
"/absolute/prefix/bin/codex-hud" status --cwd /absolute/project --language ko --no-color
```

사용자·프로젝트 설치가 함께 있으면 PATH의 `codex-hud`가 다른 설치를 가리킬 수
있습니다. 사용자 설치의 PATH 연결은 새 터미널에서 `command -v codex-hud`로
별도 확인합니다. 프로젝트 설치는 PATH에 추가하지 않습니다. `status`는 저장된
세션의 상태를 보여주며, 설치 목록이나 제거 명령은 아닙니다.

기본 실행에서는 마우스로 바로 텍스트를 드래그해 선택하고 복사할 수 있습니다.
실행 중에는 `Alt+L`로 HUD의 한글/영문을 전환하고, `Alt+M`으로 화면을 고정해
선택할 수 있습니다. 기본 휠은 터미널의 과거 출력을 스크롤합니다.
HUD를 고정한 내부 스크롤은 `codex-hud start --mouse`로 사용하며, 이 경우
복사할 때 `Alt+M`으로 마우스 캡처를 해제합니다. 다시 누르면 화면 갱신을 재개하고
기존 캡처 설정으로 돌아옵니다. Inline에서 `Alt+M`이나 `Esc`로 선택을 끝내면
가상 터미널의 탐색 위치는 유지합니다. `--no-mouse`는 저장된 캡처 설정도 해제합니다.
Inline 선택 모드에서는 위·아래 방향키로 출력 기록을 탐색하며 명령 이력을 바꾸지 않습니다.
언어 전환은 해당 실행에만 적용되며 설치 시 선택한 기본 언어는 유지합니다.

진단의 `inline.available`이 true인지 확인하세요. 세션이 아직 없으면 HUD가
대기 상태를 보일 수 있습니다. 화면 배치는 실제 TTY에서 확인해야 하며, Codex
계정 API를 호출하거나 모델에 테스트 프롬프트를 보낼 필요는 없습니다.

## 자동 실행 해제

현재 설치 도구가 만든 Bash/Zsh 함수에서 프로젝트 자동 실행만 해제하려면
해당 터미널에서 다음 변수를 비웁니다. 이후 실행은 활성화된 사용자 설치가 있으면
그것을, 없으면 원래 Codex를 사용합니다.

```bash
unset _CODEX_HUD_PROJECT_ROOT _CODEX_HUD_PROJECT_COMMAND _CODEX_HUD_PROJECT_LANGUAGE
```

사용자 자동 실행만 해제하려면 다음을 사용합니다. 프로젝트 설정은 유지되며,
`_CODEX_HUD_LANGUAGE`도 비워 이전 사용자 설정을 프로젝트 활성화 때 복원하지 않게 합니다.
두 범위를 모두 해제하려면 두 명령을 실행합니다.

```bash
unset _CODEX_HUD_USER_COMMAND _CODEX_HUD_USER_LANGUAGE _CODEX_HUD_LANGUAGE
```

이 명령은 설치 파일·PATH·다른 셸 함수를 바꾸지 않고 현재 셸의 이후 실행에만
적용됩니다. 해당 `shell.sh`를 다시 읽으면 자동 실행이 복원됩니다. 프로젝트
자동 실행은 새 터미널을 열어도 해제되지만, 사용자 시작 파일에 연결한 자동 실행은
새 터미널에서 다시 켜집니다.

새 터미널에서도 사용자 연결을 해제하려면 설치 결과의 `startupFiles`에 있는
`# >>> codex-hud installer >>>`부터 `# <<< codex-hud installer <<<`까지의
관리 블록만 제거한 뒤 새 터미널을 엽니다. 이 블록은 HUD의 PATH 연결도 담당하므로
남겨 둔 실행 파일은 절대 경로로 사용할 수 있습니다. 파일이나 블록만 지워도 이미
활성화한 셸의 변수는 남으므로 위 해제 명령 또는 새 터미널이 필요합니다.
설치 도구에는 제거 옵션이 없습니다. HUD 패키지·셸 연결·스킬 등록의 제거는
별도 작업이며, 다른 패키지와 공유하는 prefix를 통째로 삭제하지 마세요.

## 패키지 갱신

원본 HUD 프로젝트에서 다음 명령으로 현재 소스를 다시 동봉합니다.

```bash
npm run package:plugin
```

`dist/`에 플러그인 ZIP과 단독 스킬 ZIP이 만들어지고,
`skills/codex-hud-install/assets/package.json`의 버전과 체크섬이 갱신됩니다.
동봉된 HUD의 MIT 라이선스와 원본 고지는 npm 아카이브에 포함됩니다.
버전별 변경 이력과 개발 문서는 같은 npm 아카이브의 `CHANGELOG.md`, `docs/`에
포함됩니다. 마지막 소스·문서 수정 후 패키지를 다시 만들어야 배포 파일에도
반영됩니다. 이 명령은 루트 패키지나 플러그인 매니페스트의 버전을 올리지
않으므로, 릴리스할 때는 두 버전을 먼저 맞춥니다.
