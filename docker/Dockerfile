# syntax=docker/dockerfile:1
#
# Overfull image: TeX Live 2026 + fonts + poppler + qpdf + veraPDF + Node 26 + overfull CLI.
#
# Build context is the REPOSITORY ROOT:
#   docker build -f docker/Dockerfile -t ghcr.io/amet13/overfull:dev .
#   docker build -f docker/Dockerfile --target tex -t overfull-tex:dev .   # TeX toolchain only
#   docker build -f docker/Dockerfile --target check -t overfull-check:dev .  # no TeX Live
#
# Stages:
#   tex       TeX Live 2026 (pinned digest), MS core fonts, poppler-utils, qpdf, veraPDF
#   node      tex + Node.js 26 LTS (official binary, checksum-verified)
#   builder   node + pnpm: builds the monorepo and deploys the CLI to /opt/overfull
#   check     Debian slim + Node + veraPDF + poppler + git + CLI, no TeX Live
#   overfull  final image: node + /opt/overfull, `overfull` on PATH (default target)
#
# Behind a TLS-intercepting proxy, pass its CA as an optional build secret; it is
# trusted only while a download step runs and never stored in a layer:
#   docker build --secret id=build_ca,src=/path/to/proxy-ca.crt -f docker/Dockerfile .

# ---------------------------------------------------------------------------
# tex: the LaTeX toolchain used by `overfull build` and the template Makefiles
# ---------------------------------------------------------------------------
# Pinned by digest (multi-arch index: linux/amd64, linux/arm64). Written inline,
# not as an ARG, so Dependabot can propose digest updates.
FROM texlive/texlive:latest@sha256:07e8062637249c4f780ca59f42cc2ed592bc2dc1db4320769406aee3f98aa70e AS tex

ARG VERAPDF_VERSION=1.30.4
ARG VERAPDF_SHA256=04415ef3f149526a3048b9889723e81320ddf013bd891bcc7f0f297f3eadcc23

ENV DEBIAN_FRONTEND=noninteractive \
    DEBCONF_NONINTERACTIVE_SEEN=true \
    LANG=C.UTF-8

# Fonts (Times New Roman via ttf-mscorefonts-installer, FreeMono/FreeSerif),
# PDF inspection tools. TeX Live itself (incl. biber, latexdiff, chktex,
# latexindent) and OpenJDK already ship with the base image.
RUN --mount=type=secret,id=build_ca,required=false \
    set -eux; \
    sed -i 's/^Components: main$/Components: main contrib non-free/' /etc/apt/sources.list.d/debian.sources; \
    echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections; \
    apt-get update; \
    apt-get install --no-install-recommends -y ca-certificates curl unzip xz-utils; \
    if [ -s /run/secrets/build_ca ]; then cp /run/secrets/build_ca /usr/local/share/ca-certificates/zz-build-ca.crt && update-ca-certificates >/dev/null; fi; \
    apt-get install --no-install-recommends -y \
      fontconfig ttf-mscorefonts-installer fonts-freefont-ttf poppler-utils qpdf; \
    if [ -f /usr/local/share/ca-certificates/zz-build-ca.crt ]; then rm /usr/local/share/ca-certificates/zz-build-ca.crt && update-ca-certificates --fresh >/dev/null; fi; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    test -f /usr/share/fonts/truetype/msttcorefonts/Times_New_Roman.ttf; \
    fc-cache -f; \
    luaotfload-tool -q -u -f

# veraPDF (greenfield, CLI only) — PDF/A, PDF/UA-1, PDF/UA-2 and WCAG 2.2 profiles.
COPY docker/verapdf-auto-install.xml /tmp/verapdf-auto-install.xml
RUN --mount=type=secret,id=build_ca,required=false \
    set -eux; \
    if [ -s /run/secrets/build_ca ]; then cp /run/secrets/build_ca /usr/local/share/ca-certificates/zz-build-ca.crt && update-ca-certificates >/dev/null; fi; \
    cd /tmp; \
    curl -fsSLo verapdf.zip "https://software.verapdf.org/releases/${VERAPDF_VERSION%.*}/verapdf-greenfield-${VERAPDF_VERSION}-installer.zip"; \
    echo "${VERAPDF_SHA256}  verapdf.zip" | sha256sum -c -; \
    unzip -q verapdf.zip; \
    java -jar "verapdf-greenfield-${VERAPDF_VERSION}/verapdf-izpack-installer-${VERAPDF_VERSION}.jar" /tmp/verapdf-auto-install.xml; \
    ln -s /opt/verapdf/verapdf /usr/local/bin/verapdf; \
    rm -rf /tmp/verapdf* /opt/verapdf/Uninstaller; \
    if [ -f /usr/local/share/ca-certificates/zz-build-ca.crt ]; then rm /usr/local/share/ca-certificates/zz-build-ca.crt && update-ca-certificates --fresh >/dev/null; fi; \
    verapdf --version

WORKDIR /work
CMD ["bash"]

# ---------------------------------------------------------------------------
# node: add Node.js 26 LTS so the overfull CLI can run inside the image
# ---------------------------------------------------------------------------
FROM tex AS node

ARG NODE_VERSION=26.13.0
ARG NODE_SHA256_AMD64=d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997
ARG NODE_SHA256_ARM64=406fe3fbde1c054adff8b297c16fdb5af6659db327c1ac8acd46b56ef1af9a92
ARG TARGETARCH

RUN --mount=type=secret,id=build_ca,required=false \
    set -eux; \
    if [ -s /run/secrets/build_ca ]; then cp /run/secrets/build_ca /usr/local/share/ca-certificates/zz-build-ca.crt && update-ca-certificates >/dev/null; fi; \
    arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$arch" in \
      amd64) node_arch=x64;   sum="${NODE_SHA256_AMD64}" ;; \
      arm64) node_arch=arm64; sum="${NODE_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    echo "${sum}  /tmp/node.tar.xz" | sha256sum -c -; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner \
      --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE' --exclude='*/include' --exclude='*/share/doc'; \
    rm /tmp/node.tar.xz; \
    if [ -f /usr/local/share/ca-certificates/zz-build-ca.crt ]; then rm /usr/local/share/ca-certificates/zz-build-ca.crt && update-ca-certificates --fresh >/dev/null; fi; \
    node --version; npm --version

# ---------------------------------------------------------------------------
# builder: build the pnpm monorepo and deploy the CLI with prod deps only
# ---------------------------------------------------------------------------
FROM node AS builder

# pnpm comes from docker/pnpm/package-lock.json: `npm ci` checks every
# package against its integrity hash.
COPY docker/pnpm/package.json docker/pnpm/package-lock.json /opt/pnpm/
RUN --mount=type=secret,id=build_ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/build_ca npm ci --prefix /opt/pnpm --no-audit --no-fund \
 && ln -s /opt/pnpm/node_modules/.bin/pnpm /usr/local/bin/pnpm \
 && pnpm --version

WORKDIR /src
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.cache/pnpm-store \
    --mount=type=secret,id=build_ca,required=false \
    export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca \
 && pnpm config set store-dir /root/.cache/pnpm-store \
 && pnpm install --frozen-lockfile --filter overfull... \
 && pnpm --filter overfull... run build \
 && pnpm --filter overfull deploy --prod --legacy /opt/overfull

# ---------------------------------------------------------------------------
# check: CLI + veraPDF + poppler + git, no TeX Live (`--target check`)
# ---------------------------------------------------------------------------
# For checking a PDF that was built elsewhere. Placed before `overfull` so the
# full image stays the default (last) stage. Pinned by digest (multi-arch
# index: linux/amd64, linux/arm64).
FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS check

ARG VERSION=dev
ARG VERAPDF_VERSION=1.30.4
ARG VERAPDF_SHA256=04415ef3f149526a3048b9889723e81320ddf013bd891bcc7f0f297f3eadcc23
ARG NODE_VERSION=26.13.0
ARG NODE_SHA256_AMD64=d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997
ARG NODE_SHA256_ARM64=406fe3fbde1c054adff8b297c16fdb5af6659db327c1ac8acd46b56ef1af9a92
ARG TARGETARCH

LABEL org.opencontainers.image.title="overfull (check only)" \
      org.opencontainers.image.description="The overfull CLI with veraPDF, poppler and git, without TeX Live: checks PDFs, logs and bibliographies built elsewhere" \
      org.opencontainers.image.source="https://github.com/amet13/overfull" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

ENV DEBIAN_FRONTEND=noninteractive \
    DEBCONF_NONINTERACTIVE_SEEN=true \
    LANG=C.UTF-8

COPY docker/verapdf-auto-install.xml /tmp/verapdf-auto-install.xml
RUN --mount=type=secret,id=build_ca,required=false \
    set -eux; \
    apt-get update; \
    apt-get install --no-install-recommends -y ca-certificates curl unzip xz-utils; \
    if [ -s /run/secrets/build_ca ]; then cp /run/secrets/build_ca /usr/local/share/ca-certificates/zz-build-ca.crt && update-ca-certificates >/dev/null; fi; \
    apt-get install --no-install-recommends -y default-jre-headless poppler-utils git libatomic1; \
    arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$arch" in \
      amd64) node_arch=x64;   sum="${NODE_SHA256_AMD64}" ;; \
      arm64) node_arch=arm64; sum="${NODE_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"; \
    echo "${sum}  /tmp/node.tar.xz" | sha256sum -c -; \
    tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner \
      --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE' --exclude='*/include' --exclude='*/share/doc'; \
    rm /tmp/node.tar.xz; \
    cd /tmp; \
    curl -fsSLo verapdf.zip "https://software.verapdf.org/releases/${VERAPDF_VERSION%.*}/verapdf-greenfield-${VERAPDF_VERSION}-installer.zip"; \
    echo "${VERAPDF_SHA256}  verapdf.zip" | sha256sum -c -; \
    unzip -q verapdf.zip; \
    java -jar "verapdf-greenfield-${VERAPDF_VERSION}/verapdf-izpack-installer-${VERAPDF_VERSION}.jar" /tmp/verapdf-auto-install.xml; \
    ln -s /opt/verapdf/verapdf /usr/local/bin/verapdf; \
    rm -rf /tmp/verapdf* /opt/verapdf/Uninstaller; \
    if [ -f /usr/local/share/ca-certificates/zz-build-ca.crt ]; then rm /usr/local/share/ca-certificates/zz-build-ca.crt && update-ca-certificates --fresh >/dev/null; fi; \
    apt-get purge -y --auto-remove curl unzip xz-utils; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    node --version; verapdf --version; pdfinfo -v; git --version

COPY --from=builder /opt/overfull /opt/overfull
RUN ln -s /opt/overfull/dist/bin.js /usr/local/bin/overfull \
 && chmod +x /opt/overfull/dist/bin.js \
 && overfull --version \
 && git config --system --add safe.directory /work

WORKDIR /work
CMD ["overfull", "--help"]

# ---------------------------------------------------------------------------
# overfull: final image (default target)
# ---------------------------------------------------------------------------
FROM node AS overfull

ARG VERSION=dev
LABEL org.opencontainers.image.title="overfull" \
      org.opencontainers.image.description="Preflight kit for LaTeX papers and theses: TeX Live 2026, veraPDF, poppler, latexdiff and the overfull CLI" \
      org.opencontainers.image.source="https://github.com/amet13/overfull" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

COPY --from=builder /opt/overfull /opt/overfull
RUN ln -s /opt/overfull/dist/bin.js /usr/local/bin/overfull \
 && chmod +x /opt/overfull/dist/bin.js \
 && overfull --version

# git (already in the base image) is needed by `overfull diff`. Only the
# repository mounted at /work is marked safe (the container runs as root by
# default and the mount is owned by the host user); never '*'.
RUN git --version && git config --system --add safe.directory /work

WORKDIR /work
CMD ["overfull", "--help"]
