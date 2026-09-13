# Bash/Zsh function template. The installer supplies scoped paths and languages.
# Keep this a shell function: node-pty must find the real codex executable.
_codex_hud_interactive_args() {
    local codex_hud_seen_positional=0
    local codex_hud_directory=.
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --) printf '%s.' "$codex_hud_directory"; return 0 ;;
            -h|--help|-h?*|-V|--version|-V?*) return 1 ;;
            -C|--cd)
                [ "$#" -lt 2 ] && return 1
                shift
                codex_hud_directory=$1
                ;;
            --cd=*) codex_hud_directory=${1#--cd=} ;;
            -C=*) codex_hud_directory=${1#-C=} ;;
            -C?*) codex_hud_directory=${1#-C} ;;
            -c|--config|--enable|--disable|--remote|--remote-auth-token-env|\
            -m|--model|--local-provider|-p|--profile|-s|--sandbox|\
            --add-dir|-a|--ask-for-approval)
                [ "$#" -lt 2 ] && return 1
                shift
                ;;
            -i|--image)
                shift
                while [ "$#" -gt 0 ]; do
                    case "$1" in -) ;; -*) break ;; esac
                    shift
                done
                continue
                ;;
            -*) ;;
            *)
                if [ "$codex_hud_seen_positional" = 0 ]; then
                    case "$1" in
                        agents|exec|e|review|login|logout|mcp|plugin|mcp-server|\
                        app-server|remote-control|completion|update|doctor|\
                        sandbox|debug|apply|a|queue|archive|delete|migrate-rollouts|\
                        unarchive|cloud|exec-server|features|help)
                            return 1
                            ;;
                    esac
                    codex_hud_seen_positional=1
                fi
                ;;
        esac
        shift
    done
    # Protect trailing newlines from command substitution's trimming.
    printf '%s.' "$codex_hud_directory"
    return 0
}

# The keyword form prevents an existing `alias codex='codex --flag'` from
# expanding inside this declaration. The alias can still pass its flags to us.
function codex {
    local codex_hud_directory
    if ! [ -t 0 ] || ! [ -t 1 ] \
        || ! codex_hud_directory=$(_codex_hud_interactive_args "$@"); then
        command codex "$@"
        return $?
    fi
    codex_hud_directory=${codex_hud_directory%.}
    local codex_hud_command=${_CODEX_HUD_USER_COMMAND-}
    local codex_hud_language=${_CODEX_HUD_USER_LANGUAGE:-ko}
    if [ -n "${_CODEX_HUD_PROJECT_ROOT-}" ]; then
        case "$codex_hud_directory" in
            /*) ;;
            *) codex_hud_directory=$PWD/$codex_hud_directory ;;
        esac
        codex_hud_directory=$(
            if [ -n "${ZSH_VERSION-}" ]; then
                builtin cd -q -P -- "$codex_hud_directory" >/dev/null 2>&1
            else
                builtin cd -P -- "$codex_hud_directory" >/dev/null 2>&1
            fi && printf '%s.' "$PWD"
        ) || codex_hud_directory=
        codex_hud_directory=${codex_hud_directory%.}
        case "$codex_hud_directory" in
            "$_CODEX_HUD_PROJECT_ROOT"|"$_CODEX_HUD_PROJECT_ROOT"/*)
                codex_hud_command=${_CODEX_HUD_PROJECT_COMMAND-}
                codex_hud_language=${_CODEX_HUD_PROJECT_LANGUAGE:-ko}
                ;;
        esac
    fi
    if [ -n "$codex_hud_command" ] && command -v "$codex_hud_command" >/dev/null 2>&1; then
        command "$codex_hud_command" start --language "$codex_hud_language" -- "$@"
    else
        command codex "$@"
    fi
}
