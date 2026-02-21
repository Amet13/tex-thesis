# Modern Makefile for tex-thesis
# Uses self-documenting targets and modern Make features

# --- Configuration ---
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

# Colors for output
GREEN  := $(shell tput -Txterm setaf 2)
YELLOW := $(shell tput -Txterm setaf 3)
WHITE  := $(shell tput -Txterm setaf 7)
RESET  := $(shell tput -Txterm sgr0)

# --- Targets ---

##@ Build

.PHONY: all
all: build ## Build everything (default)

.PHONY: build
build: ## Build thesis and slides PDFs via Docker
	@echo "${GREEN}▸ Building thesis and slides via Docker...${RESET}"
	@DOCKER_BUILDKIT=1 docker build --output type=local,dest=. .
	@echo "${GREEN}▸ Output: thesis.pdf, slides/slides.pdf${RESET}"

.PHONY: watch
watch: ## Watch thesis files and rebuild on changes via Docker
	@echo "${GREEN}▸ Building base Docker image for watch mode...${RESET}"
	@DOCKER_BUILDKIT=1 docker build --target base -t tex-thesis-base .
	@echo "${GREEN}▸ Starting watch mode for thesis via Docker...${RESET}"
	@docker run --rm -it -v "$$PWD:/thesis" -w /thesis tex-thesis-base latexmk -pvc -jobname=thesis main.tex

##@ Quality

.PHONY: lint
lint: ## Lint LaTeX sources (requires chktex)
	@echo "${GREEN}▸ Linting LaTeX sources...${RESET}"
	@if command -v chktex >/dev/null 2>&1; then \
		chktex -q main.tex chapters/*.tex && chktex -q slides/main.tex slides/slides.tex; \
	else \
		echo "${YELLOW}▸ chktex not found locally, falling back to Docker...${RESET}"; \
		DOCKER_BUILDKIT=1 docker build --target lint . 2>&1; \
	fi
	@echo "${GREEN}▸ Lint passed${RESET}"

.PHONY: pre-commit
pre-commit: ## Run pre-commit hooks on all files
	@echo "${GREEN}▸ Running pre-commit hooks...${RESET}"
	@pre-commit run --all-files

##@ Utilities

.PHONY: open
open: ## Open thesis.pdf
	@if [ ! -f thesis.pdf ]; then \
		echo "${YELLOW}▸ thesis.pdf not found — run 'make build' first${RESET}" >&2; \
		exit 1; \
	fi
	@case "$$(uname -s)" in \
		Darwin) open thesis.pdf & ;; \
		*)      xdg-open thesis.pdf & ;; \
	esac

.PHONY: open-slides
open-slides: ## Open slides/slides.pdf
	@if [ ! -f slides/slides.pdf ]; then \
		echo "${YELLOW}▸ slides/slides.pdf not found — run 'make build' first${RESET}" >&2; \
		exit 1; \
	fi
	@case "$$(uname -s)" in \
		Darwin) open slides/slides.pdf & ;; \
		*)      xdg-open slides/slides.pdf & ;; \
	esac

.PHONY: clean
clean: ## Remove generated PDFs and LaTeX auxiliary files
	@echo "${GREEN}▸ Removing generated PDFs and auxiliary files...${RESET}"
	@rm -f thesis.pdf slides/slides.pdf
	@rm -f *.aux *.bbl *.blg *.fdb_latexmk *.fls *.log *.out *.run.xml *.synctex.gz *.toc *.bcf
	@rm -f slides/*.aux slides/*.bbl slides/*.blg slides/*.fdb_latexmk slides/*.fls slides/*.log slides/*.out slides/*.run.xml slides/*.synctex.gz slides/*.toc slides/*.bcf slides/*.nav slides/*.snm
	@echo "${GREEN}▸ Clean${RESET}"

##@ Help

.PHONY: help
help: ## Show this help message
	@echo ''
	@echo 'Usage:'
	@echo '  ${YELLOW}make${RESET} ${GREEN}<target>${RESET}'
	@echo ''
	@awk 'BEGIN {FS = ":.*##"; printf "\n"} \
		/^[a-zA-Z_0-9-]+:.*?##/ { printf "  ${YELLOW}%-15s${RESET} %s\n", $$1, $$2 } \
		/^##@/ { printf "\n${WHITE}%s${RESET}\n", substr($$0, 5) } ' $(MAKEFILE_LIST)
	@echo ''
