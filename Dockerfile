# syntax=docker/dockerfile:1

# Multi-stage build: produces only thesis.pdf and slides/slides.pdf as output.
# Usage: DOCKER_BUILDKIT=1 docker build --output type=local,dest=. .

FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive
ENV DEBCONF_NONINTERACTIVE_SEEN=true

RUN echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections

# Install LaTeX packages and fonts in a single layer
# XITS Math is included in texlive-fonts-extra; we symlink it for fontconfig discovery
RUN apt-get update && \
    apt-get install --no-install-recommends -y \
        fontconfig \
        texlive-base \
        texlive-latex-extra \
        texlive-xetex \
        texlive-fonts-extra \
        texlive-science \
        texlive-latex-recommended \
        latexmk \
        ttf-mscorefonts-installer \
        fonts-freefont-ttf && \
    ln -s /usr/share/texlive/texmf-dist/fonts/opentype/public/xits /usr/share/fonts/xits && \
    fc-cache -f -v && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /thesis

# Copy source files
COPY main.tex preamble.tex ./
COPY inc/ inc/
COPY images/ images/
COPY slides/ slides/

# Build thesis
RUN latexmk -xelatex -synctex=1 -interaction=nonstopmode -jobname=thesis main.tex

# Build slides
RUN cd slides && latexmk -xelatex -synctex=1 -interaction=nonstopmode -jobname=slides main.tex

# Output stage: contains only the final PDFs
FROM scratch
COPY --from=builder /thesis/thesis.pdf /thesis.pdf
COPY --from=builder /thesis/slides/slides.pdf /slides/slides.pdf
