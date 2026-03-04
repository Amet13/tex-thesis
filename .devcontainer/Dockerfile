FROM texlive/texlive:latest@sha256:62927d994f09aea455c8ea9da034af14764f9e2276a616b413545e7cec69c06b

ENV DEBIAN_FRONTEND=noninteractive
ENV DEBCONF_NONINTERACTIVE_SEEN=true

RUN sed -i 's/Components: main/Components: main contrib non-free/g' /etc/apt/sources.list.d/debian.sources && \
    apt-get update && \
    echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections && \
    apt-get install --no-install-recommends -y \
        git \
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
        chktex \
        python3-pip \
        python3-venv && \
    fc-cache -f -v && \
    luaotfload-tool -q -u -f && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages pre-commit
