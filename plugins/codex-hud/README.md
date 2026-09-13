# Codex HUD 설치 플러그인

Codex에게 HUD 설치와 진단을 맡기는 `codex-hud-install` 스킬입니다.
HUD npm 패키지를 포함하므로 원본 프로젝트 폴더 없이도 사용할 수 있습니다.
플러그인을 등록하는 것만으로 HUD나 셸 설정이 변경되지는 않습니다.

## 사용

플러그인 또는 스킬을 등록한 뒤 새 Codex 대화에서 요청합니다.

```text
$codex-hud-install HUD를 설치하고 codex 실행 시 자동으로 켜지도록 설정해줘.
```

```text
$codex-hud-install 자동 실행은 설정하지 말고 HUD만 설치해줘.
```

```text
$codex-hud-install HUD가 정상 작동하는지 확인해줘.
```

기본 설치 위치는 `~/.local/share/codex-hud`입니다. `XDG_DATA_HOME`이 있으면
그 아래의 `codex-hud`를 사용합니다. 설치 도구는 Node.js 20 이상, npm,
Python 3.9 이상, Codex CLI가 필요하며 Linux·macOS·WSL을 대상으로 합니다.
npm 의존성을 내려받을 네트워크 또는 채워진 npm 캐시가 필요합니다.
OS·CPU에 맞는 `node-pty` 사전 빌드가 없으면 C/C++ 컴파일러, make,
Node 헤더도 필요합니다. 설치 도구는 네이티브 빌드 출력을 표시합니다.

자동 실행을 요청하면 Bash/Zsh의 `codex` 함수로 연결합니다. 대화형 실행,
`resume`, `fork`에는 HUD를 붙이고 `exec`, `review`, 로그인, 도움말, 버전 확인은
원래 명령으로 전달합니다. 자동화와 파이프 입력도 원래 Codex로 전달합니다.
한 번만 HUD를 생략하려면 `command codex ...`를 사용합니다.

## 다른 환경으로 옮기기

`codex-hud-plugin-0.5.2.zip`에는 `.codex-plugin/plugin.json`과 설치 스킬,
실행 패키지가 들어 있습니다. Codex 플러그인 가져오기 기능 또는 사용 중인
로컬 마켓플레이스에 등록할 수 있습니다. 이 플러그인의 식별자는 `codex-hud`입니다.

스킬만 사용하려면 `codex-hud-install-0.5.2.zip`을 풀어 나온
`codex-hud-install` 폴더 전체를 `~/.agents/skills/`에 넣습니다.
`SKILL.md`만 복사하면 설치 스크립트와 HUD 패키지가 빠지므로 설치할 수 없습니다.
`$CODEX_HOME/skills`를 사용하는 환경에서는 해당 스킬 경로에 넣어도 됩니다.

## 직접 설치하기

아래 명령은 이 README가 있는 플러그인 폴더 기준입니다. 다른 폴더에서는
`scripts/install.py`까지의 절대 경로를 사용하세요.

```bash
python3 skills/codex-hud-install/scripts/install.py --dry-run --shell bash --autostart
python3 skills/codex-hud-install/scripts/install.py --shell bash --autostart
```

Zsh는 `--shell zsh`, 셸 설정을 건드리지 않으려면 `--shell none`을 사용합니다.
자동 실행이 필요 없으면 `--autostart`를 생략합니다. `--language en`으로
영문 HUD를 선택할 수 있습니다.

```bash
python3 skills/codex-hud-install/scripts/install.py \
  --prefix /path/to/hud --shell bash --rc-file /path/to/custom.bashrc --autostart
```

기존 설정은 보존하고 `# >>> codex-hud installer >>>` 블록만 추가·갱신합니다.
기존 파일의 백업은 설치 경로의 `backups/`에 0600 권한으로 저장합니다.
Codex의 설정과 인증 파일, npm의 전역 prefix 설정은 수정하지 않습니다.
재설치 시 기존 자동 실행과 언어 설정을 유지합니다.

설치 결과에 출력된 `source .../shell.sh` 명령으로 현재 터미널에 적용하거나
새 터미널을 여세요. 이미 실행 중인 Codex는 다시 시작해야 HUD가 붙습니다.

기본 실행에서는 마우스로 바로 텍스트를 드래그해 선택하고 복사할 수 있습니다.
실행 중에는 `Alt+L`로 HUD의 한글/영문을 전환하고, `Alt+M`으로 화면을 고정해
선택할 수 있습니다. 휠 스크롤은 `codex-hud start --mouse`로 켜며, 이 경우
복사할 때 `Alt+M`으로 마우스 캡처를 해제합니다. 다시 누르면 최신 화면과
기존 캡처 설정으로 돌아옵니다. `--no-mouse`는 저장된 캡처 설정도 해제합니다.
언어 전환은 해당 실행에만 적용되며 설치 시 선택한 기본 언어는 유지합니다.

진단의 `inline.available`이 true인지 확인하세요. 세션이 아직 없으면 HUD가
대기 상태를 보일 수 있습니다. 화면 배치는 실제 TTY에서 확인해야 하며, Codex
계정 API를 호출하거나 모델에 테스트 프롬프트를 보낼 필요는 없습니다.

## 패키지 갱신

원본 HUD 프로젝트에서 다음 명령으로 현재 소스를 다시 동봉합니다.

```bash
npm run package:plugin
```

`dist/`에 플러그인 ZIP과 단독 스킬 ZIP이 만들어지고,
`skills/codex-hud-install/assets/package.json`의 버전과 체크섬이 갱신됩니다.
동봉된 HUD의 MIT 라이선스와 원본 고지는 npm 아카이브에 포함됩니다.
버전별 변경 이력은 같은 npm 아카이브의 `CHANGELOG.md`에 포함됩니다.
릴리스할 때는 HUD와 플러그인의 버전을 함께 올린 뒤 이 명령을 실행합니다.
