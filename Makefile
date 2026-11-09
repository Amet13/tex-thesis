# Overfull monorepo — developer tasks. Template users: see templates/<name>/Makefile.
SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help
IMAGE ?= overfull:dev

.PHONY: install build test lint typecheck image corpus templates site e2e help

install: ## Install dependencies
	pnpm install

build: ## Build all packages
	pnpm build

test: ## Unit tests
	pnpm test

lint: ## Biome + markdownlint
	pnpm lint

typecheck: ## TypeScript
	pnpm typecheck

image: ## Build the Overfull Docker image as $(IMAGE)
	docker build -f docker/Dockerfile --target overfull -t $(IMAGE) .

corpus: image ## Recompile every corpus case and verify its rules
	docker run --rm -v "$$PWD:/repo" -w /repo -e OVERFULL_TEX_LOCAL=1 $(IMAGE) node scripts/corpus.mjs --verify

templates: ## Sync skills and agent files into templates
	pnpm templates:sync

e2e: image ## Build every template in the image and run its preflight
	bash scripts/e2e-templates.sh $(IMAGE) out

site: ## Build the website
	pnpm --filter @overfull/core build && pnpm --filter site build

help: ## Show targets
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  %-12s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
