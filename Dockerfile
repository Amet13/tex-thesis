# syntax=docker/dockerfile:1

# Multi-stage build with lint and build stages.
# Usage:
#   Build PDFs:  DOCKER_BUILDKIT=1 docker build --output type=local,dest=. .
#   Lint only:   DOCKER_BUILDKIT=1 docker build --target lint .

# --- Base stage: shared TeX Live installation ---
FROM ubuntu:24.04 AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV DEBCONF_NONINTERACTIVE_SEEN=true

RUN echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections

# Install LaTeX packages, fonts, and chktex linter in a single layer
# XITS Math is included in texlive-fonts-extra; we symlink it for fontconfig discovery
RUN apt-get update && \
    apt-get install --no-install-recommends -y \
        fontconfig \
        texlive-base \
        texlive-latex-extra \
        texlive-luatex \
        texlive-fonts-extra \
        texlive-science \
        texlive-latex-recommended \
        latexmk \
        chktex \
        ttf-mscorefonts-installer \
        fonts-freefont-ttf && \
    ln -s /usr/share/texlive/texmf-dist/fonts/opentype/public/xits /usr/share/fonts/xits && \
    fc-cache -f -v && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /thesis

# Copy source files
COPY main.tex preamble.tex .latexmkrc .chktexrc ./
COPY chapters/ chapters/
COPY images/ images/
COPY slides/ slides/

# --- Lint stage: validate LaTeX sources with chktex ---
FROM base AS lint
RUN chktex -q main.tex chapters/*.tex && \
    chktex -q slides/main.tex slides/slides.tex

# --- Build stage: compile PDFs ---
FROM base AS builder
RUN latexmk -jobname=thesis main.tex & \
    (cd slides && latexmk -jobname=slides main.tex) & \
    wait

# Output stage: contains only the final PDFs
FROM scratch
COPY --from=builder /thesis/thesis.pdf /thesis.pdf
COPY --from=builder /thesis/slides/slides.pdf /slides/slides.pdf
