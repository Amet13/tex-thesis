# syntax=docker/dockerfile:1

# Multi-stage build: base → lint, build, devcontainer
# Usage:
#   Build PDFs:      DOCKER_BUILDKIT=1 docker build --output type=local,dest=. .
#   Lint only:       DOCKER_BUILDKIT=1 docker build --target lint .
#   Dev container:   DOCKER_BUILDKIT=1 docker build --target devcontainer .

# --- Base stage: shared TeX Live installation ---
FROM texlive/texlive:latest@sha256:a78cd7792625e4245dc73cd5db390f0b9e6c2c7c14ac8b6ca59f023ef25ea282 AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV DEBCONF_NONINTERACTIVE_SEEN=true

# Install fonts and chktex linter
RUN sed -i 's/Components: main/Components: main contrib non-free/g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections && \
    apt-get install --no-install-recommends -y \
        fontconfig \
        ttf-mscorefonts-installer \
        fonts-freefont-ttf \
        texlive-latex-recommended \
        texlive-latex-extra \
        texlive-pictures \
        texlive-science \
        texlive-bibtex-extra \
        biber \
        texlive-extra-utils \
        chktex && \
    fc-cache -f -v && \
    luaotfload-tool -q -u -f && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /thesis

# Copy source files
COPY main.tex preamble.tex references.bib .latexmkrc .chktexrc .latexindent.yaml ./
COPY chapters/ chapters/
COPY images/ images/
COPY slides/ slides/

# --- Dev container stage: base + git, pre-commit ---
FROM base AS devcontainer
COPY .devcontainer/requirements.txt /tmp/requirements.txt
RUN apt-get update && \
    apt-get install --no-install-recommends -y \
        git \
        python3-pip \
        python3-venv && \
    pip3 install --break-system-packages --require-hashes -r /tmp/requirements.txt && \
    rm -f /tmp/requirements.txt && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# --- Lint stage: validate LaTeX sources with chktex ---
FROM base AS lint
RUN chktex -q main.tex chapters/*.tex && \
    chktex -q slides/main.tex slides/slides.tex && \
    latexindent -l=.latexindent.yaml -k main.tex preamble.tex chapters/*.tex slides/main.tex slides/slides.tex

# --- Build stage: compile PDFs ---
FROM base AS builder
ARG SOURCE_DATE_EPOCH=0
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}
RUN latexmk -quiet -silent -jobname=thesis main.tex & \
    (cd slides && latexmk -quiet -silent -jobname=slides main.tex) & \
    wait

# Output stage: contains only the final PDFs
FROM scratch
COPY --from=builder /thesis/thesis.pdf /thesis.pdf
COPY --from=builder /thesis/slides/slides.pdf /slides/slides.pdf
