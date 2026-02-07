.PHONY: all build open open-slides clean

# Detect OS for opening PDF
UNAME := $(shell uname -s)
ifeq ($(UNAME),Darwin)
    OPEN_CMD = open
else
    OPEN_CMD = xdg-open
endif

# Default: build thesis and slides via Docker, extract only PDFs
all: build

build:
	DOCKER_BUILDKIT=1 docker build --output type=local,dest=. .
	@echo "\n  Output: thesis.pdf, slides/slides.pdf\n"

open:
	$(OPEN_CMD) thesis.pdf &

open-slides:
	$(OPEN_CMD) slides/slides.pdf &

clean:
	rm -f thesis.pdf slides/slides.pdf
