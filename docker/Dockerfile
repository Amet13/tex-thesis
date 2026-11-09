# syntax=docker/dockerfile:1
#
# Overfull image: TeX Live 2026 + fonts + poppler + qpdf + veraPDF + Node 24 + overfull CLI.
#
# Build context is the REPOSITORY ROOT:
#   docker build -f docker/Dockerfile -t ghcr.io/amet13/overfull:dev .
#   docker build -f docker/Dockerfile --target tex -t overfull-tex:dev .   # TeX toolchain only
#
# Stages:
#   tex       TeX Live 2026 (pinned digest), MS core fonts, poppler-utils, qpdf, veraPDF
#   node      tex + Node.js 24 (official binary, checksum-verified)
#   builder   node + pnpm: builds the monorepo and deploys the CLI to /opt/overfull
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

ARG VERAPDF_VERSION=1.30.3
ARG VERAPDF_SHA256=b512bf24945503a33fc10738ecffc1f2dccaaf8593a448e94ee9ac86a9559a59

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
# node: add Node.js 24 so the overfull CLI can run inside the image
# ---------------------------------------------------------------------------
FROM tex AS node

ARG NODE_VERSION=24.22.2
ARG NODE_SHA256_AMD64=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75
ARG NODE_SHA256_ARM64=eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8
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

ARG PNPM_VERSION=12.18.0
RUN --mount=type=secret,id=build_ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/build_ca npm install -g "pnpm@${PNPM_VERSION}" && pnpm --version

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
