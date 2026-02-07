#!/usr/bin/env bash
#
# Build script for tex-thesis
# Replaces Makefile — no 'make' dependency needed
#
set -euo pipefail

# Colors (disabled if not a terminal)
if [[ -t 1 ]]; then
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    RED='\033[0;31m'
    NC='\033[0m'
else
    GREEN='' YELLOW='' RED='' NC=''
fi

info()  { printf "${GREEN}▸ %s${NC}\n" "$*"; }
warn()  { printf "${YELLOW}▸ %s${NC}\n" "$*"; }
error() { printf "${RED}✖ %s${NC}\n" "$*" >&2; }

# Detect OS for opening PDFs
open_cmd() {
    case "$(uname -s)" in
        Darwin) open "$@" ;;
        *)      xdg-open "$@" ;;
    esac
}

cmd_build() {
    info "Building thesis and slides via Docker…"
    DOCKER_BUILDKIT=1 docker build --output type=local,dest=. .
    info "Output: thesis.pdf, slides/slides.pdf"
}

cmd_open() {
    if [[ ! -f thesis.pdf ]]; then
        error "thesis.pdf not found — run '$0 build' first"
        exit 1
    fi
    open_cmd thesis.pdf &
}

cmd_open_slides() {
    if [[ ! -f slides/slides.pdf ]]; then
        error "slides/slides.pdf not found — run '$0 build' first"
        exit 1
    fi
    open_cmd slides/slides.pdf &
}

cmd_clean() {
    info "Removing generated PDFs…"
    rm -f thesis.pdf slides/slides.pdf
    info "Clean"
}

cmd_help() {
    cat <<EOF
Usage: $0 <command>

Commands:
  build         Build thesis and slides PDFs via Docker
  open          Open thesis.pdf
  open-slides   Open slides/slides.pdf
  clean         Remove generated PDFs
  help          Show this help message
EOF
}

# --- main ---
case "${1:-help}" in
    build)       cmd_build ;;
    open)        cmd_open ;;
    open-slides) cmd_open_slides ;;
    clean)       cmd_clean ;;
    help|--help|-h) cmd_help ;;
    *)
        error "Unknown command: $1"
        cmd_help
        exit 1
        ;;
esac
