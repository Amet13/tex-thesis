# Makefile — shortcuts for building and checking the document.
#
# Uses the `overfull` CLI when it is installed; otherwise everything runs in
# the Overfull Docker image, so the only requirement is Docker.
#   make build                    build the PDF
#   make build IMAGE=overfull-tex:dev   use another image
# Run `make help` for all targets.

JOB    ?= $(shell sed -n 's/^jobname: *\([^ #]*\).*/\1/p' overfull.yml)
IMAGE  ?= $(or $(OVERFULL_IMAGE),ghcr.io/amet13/overfull:3)
BASE   ?= origin/main
PAGES  ?= 1-3

OVERFULL := $(shell command -v overfull 2>/dev/null)
# Run as your own user so build files are not owned by root.
DOCKER   := docker run --rm -t -u "$(shell id -u):$(shell id -g)" -e HOME=/tmp \
            -v "$(CURDIR):/work" -w /work $(IMAGE)

ifdef OVERFULL
  RUN_OVERFULL = overfull
else
  RUN_OVERFULL = $(DOCKER) overfull
endif

# latexmk directly: works with any TeX Live image, even without the CLI.
ifneq ($(shell command -v latexmk 2>/dev/null),)
  RUN_LATEXMK = latexmk
else
  RUN_LATEXMK = $(DOCKER) latexmk
endif

.DEFAULT_GOAL := help
.PHONY: help build watch check pages diff clean

help: ## Show this help
	@awk 'BEGIN{FS=":.*## "} /^[a-z-]+:.*## /{printf "  make %-8s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

build: ## Build the PDF with latexmk (no overfull CLI needed)
	$(RUN_LATEXMK)

watch: ## Rebuild the PDF on every save
	$(RUN_LATEXMK) -pvc -view=none

check: ## Preflight: build log, PDF, references, accessibility
	$(RUN_OVERFULL) check

pages: ## Render pages to PNG for review, e.g. make pages PAGES=4-6
	$(RUN_OVERFULL) pages $(PAGES)

diff: ## PDF with changes against BASE (default origin/main)
	$(RUN_OVERFULL) diff --base $(BASE)

clean: ## Remove build files (keeps the PDF)
	$(RUN_LATEXMK) -c
