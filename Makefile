# Modern Makefile for tex-thesis
# Uses self-documenting targets and modern Make features

# --- Configuration ---
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help
BASE_IMAGE := tex-thesis-base
export SOURCE_DATE_EPOCH ?= $(shell git log -1 --format=%ct 2>/dev/null || echo 0)

# Colors for output (gracefully degrade on Windows/environments without tput)
GREEN  := $(shell tput -Txterm setaf 2 2>/dev/null)
YELLOW := $(shell tput -Txterm setaf 3 2>/dev/null)
WHITE  := $(shell tput -Txterm setaf 7 2>/dev/null)
RESET  := $(shell tput -Txterm sgr0 2>/dev/null)

# --- Targets ---

##@ Build

.PHONY: all
all: build ## Build everything (default)

.PHONY: docker-base
docker-base: ## Build base Docker image used by local build/watch/fmt targets
	@echo "${GREEN}▸ Building base Docker image...${RESET}"
	@DOCKER_BUILDKIT=1 docker build --quiet --target base -t $(BASE_IMAGE) . >/dev/null

.PHONY: build
build: build-thesis build-slides ## Build thesis and slides PDFs via Docker
	@echo "${GREEN}▸ Output: thesis.pdf, slides/slides.pdf${RESET}"

.PHONY: build-thesis
build-thesis: docker-base ## Build thesis PDF only via Docker
	@echo "${GREEN}▸ Building thesis.pdf via Docker...${RESET}"
	@docker run --rm -v "$$PWD:/thesis" -w /thesis $(BASE_IMAGE) latexmk -quiet -silent -jobname=thesis main.tex

.PHONY: build-slides
build-slides: docker-base ## Build slides PDF only via Docker
	@echo "${GREEN}▸ Building slides/slides.pdf via Docker...${RESET}"
	@docker run --rm -v "$$PWD:/thesis" -w /thesis/slides $(BASE_IMAGE) latexmk -quiet -silent -jobname=slides main.tex

.PHONY: watch
watch: watch-thesis ## Watch thesis files and rebuild on changes via Docker

.PHONY: watch-thesis
watch-thesis: docker-base ## Watch thesis sources and rebuild on changes
	@echo "${GREEN}▸ Starting watch mode for thesis via Docker...${RESET}"
	@docker run --rm -it -v "$$PWD:/thesis" -w /thesis $(BASE_IMAGE) latexmk -quiet -silent -pvc -jobname=thesis main.tex

.PHONY: watch-slides
watch-slides: docker-base ## Watch slides sources and rebuild on changes
	@echo "${GREEN}▸ Starting watch mode for slides via Docker...${RESET}"
	@docker run --rm -it -v "$$PWD:/thesis" -w /thesis/slides $(BASE_IMAGE) latexmk -quiet -silent -pvc -jobname=slides main.tex

##@ Quality

.PHONY: lint
lint: ## Lint LaTeX sources (requires chktex)
	@echo "${GREEN}▸ Linting LaTeX sources...${RESET}"
	@if command -v chktex >/dev/null 2>&1 && command -v latexindent >/dev/null 2>&1; then \
		chktex -q main.tex chapters/*.tex && chktex -q slides/main.tex slides/slides.tex && \
		latexindent -l=.latexindent.yaml -k main.tex preamble.tex chapters/*.tex slides/main.tex slides/slides.tex >/dev/null; \
	else \
		echo "${YELLOW}▸ chktex/latexindent not found locally, falling back to Docker...${RESET}"; \
		DOCKER_BUILDKIT=1 docker build --quiet --target lint . >/dev/null; \
	fi
	@echo "${GREEN}▸ Lint passed${RESET}"

.PHONY: fmt
fmt: ## Format LaTeX files with latexindent
	@echo "${GREEN}▸ Formatting LaTeX sources...${RESET}"
	@if command -v latexindent >/dev/null 2>&1; then \
		latexindent -w -l=.latexindent.yaml main.tex preamble.tex chapters/*.tex slides/main.tex slides/slides.tex >/dev/null; \
	else \
		echo "${YELLOW}▸ latexindent not found locally, using Docker...${RESET}"; \
		DOCKER_BUILDKIT=1 docker build --quiet --target base -t $(BASE_IMAGE) . >/dev/null; \
		docker run --rm -v "$$PWD:/thesis" -w /thesis $(BASE_IMAGE) bash -lc 'latexindent -w -l=.latexindent.yaml main.tex preamble.tex chapters/*.tex slides/main.tex slides/slides.tex >/dev/null'; \
	fi
	@echo "${GREEN}▸ Format complete${RESET}"

.PHONY: fmt-check
fmt-check: ## Check LaTeX formatting without modifying files
	@echo "${GREEN}▸ Checking LaTeX formatting...${RESET}"
	@if command -v latexindent >/dev/null 2>&1; then \
		latexindent -k -l=.latexindent.yaml main.tex preamble.tex chapters/*.tex slides/main.tex slides/slides.tex >/dev/null; \
	else \
		echo "${YELLOW}▸ latexindent not found locally, using Docker...${RESET}"; \
		DOCKER_BUILDKIT=1 docker build --quiet --target base -t $(BASE_IMAGE) . >/dev/null; \
		docker run --rm -v "$$PWD:/thesis" -w /thesis $(BASE_IMAGE) bash -lc 'latexindent -k -l=.latexindent.yaml main.tex preamble.tex chapters/*.tex slides/main.tex slides/slides.tex >/dev/null'; \
	fi
	@echo "${GREEN}▸ Format check passed${RESET}"

.PHONY: check
check: lint fmt-check ## Run all quality checks (lint + format check)
	@echo "${GREEN}▸ All checks passed${RESET}"

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
		Darwin)               open thesis.pdf & ;; \
		MSYS*|MINGW*|CYGWIN*) cmd //c start "" "thesis.pdf" ;; \
		*)                    xdg-open thesis.pdf & ;; \
	esac

.PHONY: open-slides
open-slides: ## Open slides/slides.pdf
	@if [ ! -f slides/slides.pdf ]; then \
		echo "${YELLOW}▸ slides/slides.pdf not found — run 'make build' first${RESET}" >&2; \
		exit 1; \
	fi
	@case "$$(uname -s)" in \
		Darwin)               open slides/slides.pdf & ;; \
		MSYS*|MINGW*|CYGWIN*) cmd //c start "" "slides/slides.pdf" ;; \
		*)                    xdg-open slides/slides.pdf & ;; \
	esac

.PHONY: release
release: ## Create a release: make release VERSION=2.4.0
	@if [ -z "$(VERSION)" ]; then \
		echo "${YELLOW}▸ Usage: make release VERSION=x.y.z${RESET}" >&2; \
		exit 1; \
	fi
	@echo "${GREEN}▸ Preparing release v$(VERSION)...${RESET}"
	@sed -i.bak 's/^version: .*/version: "$(VERSION)"/' CITATION.cff && rm -f CITATION.cff.bak
	@sed -i.bak 's/^date-released: .*/date-released: "$(shell date +%Y-%m-%d)"/' CITATION.cff && rm -f CITATION.cff.bak
	@awk '/^## \[Unreleased\]/{print; print ""; print "## [v$(VERSION)] - $(shell date +%Y-%m-%d)"; next}1' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md
	@git add CITATION.cff CHANGELOG.md
	@git commit -m "Release v$(VERSION)"
	@git tag "v$(VERSION)"
	@echo "${GREEN}▸ Created commit and tag v$(VERSION)${RESET}"
	@echo "${GREEN}▸ Run 'git push && git push --tags' to publish${RESET}"

.PHONY: clean
clean: ## Remove generated PDFs and LaTeX auxiliary files
	@echo "${GREEN}▸ Removing generated PDFs and auxiliary files...${RESET}"
	@rm -f thesis.pdf slides/slides.pdf
	@rm -f *.aux *.bbl *.blg *.fdb_latexmk *.fls *.log *.out *.run.xml *.synctex.gz *.toc *.bcf *.lof *.lot *.nav *.snm *.vrb
	@rm -f slides/*.aux slides/*.bbl slides/*.blg slides/*.fdb_latexmk slides/*.fls slides/*.log slides/*.out slides/*.run.xml slides/*.synctex.gz slides/*.toc slides/*.bcf slides/*.lof slides/*.lot slides/*.nav slides/*.snm slides/*.vrb
	@echo "${GREEN}▸ Clean${RESET}"

.PHONY: clean-all
clean-all: clean ## Remove generated files plus local Docker artifacts for this project
	@echo "${GREEN}▸ Removing local Docker artifacts...${RESET}"
	@docker image rm -f $(BASE_IMAGE) >/dev/null 2>&1 || true
	@docker builder prune -f >/dev/null 2>&1 || true
	@echo "${GREEN}▸ Clean all${RESET}"

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
