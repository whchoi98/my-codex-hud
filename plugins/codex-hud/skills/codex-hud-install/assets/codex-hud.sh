# Bash/Zsh function template. The installer supplies PATH and the HUD language.
# Keep this a shell function: node-pty must find the real codex executable.
_codex_hud_interactive_args() {
    local codex_hud_seen_positional=0
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --) return 0 ;;
            -h|--help|-h?*|-V|--version|-V?*) return 1 ;;
            -c|--config|--enable|--disable|--remote|--remote-auth-token-env|\
            -m|--model|--local-provider|-p|--profile|-s|--sandbox|\
            -C|--cd|--add-dir|-a|--ask-for-approval)
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
    return 0
}

# The keyword form prevents an existing `alias codex='codex --flag'` from
# expanding inside this declaration. The alias can still pass its flags to us.
function codex {
    if [ -t 0 ] && [ -t 1 ] && command -v codex-hud >/dev/null 2>&1 \
        && _codex_hud_interactive_args "$@"; then
        command codex-hud start --language "${_CODEX_HUD_LANGUAGE:-ko}" -- "$@"
    else
        command codex "$@"
    fi
}
