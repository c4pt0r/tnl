.PHONY: help build test fmt clean worker-install worker-dev worker-deploy check

GO ?= go
GOFMT ?= gofmt
NPM ?= npm
CLI_BIN ?= tnl
CLI_PKG ?= ./cmd/tnl
GO_FILES := $(shell rg --files -g '*.go')
WORKER_DIR ?= worker

help:
	@echo "Available targets:"
	@echo "  make build           Build the tnl CLI binary"
	@echo "  make test            Run Go tests"
	@echo "  make fmt             Format Go sources"
	@echo "  make clean           Remove built CLI binary"
	@echo "  make check           Run formatting and tests"
	@echo "  make worker-install  Install worker dependencies"
	@echo "  make worker-dev      Run the Cloudflare worker locally"
	@echo "  make worker-deploy   Deploy the Cloudflare worker"

build:
	$(GO) build -o $(CLI_BIN) $(CLI_PKG)

test:
	$(GO) test ./...

fmt:
	$(GOFMT) -w $(GO_FILES)

clean:
	rm -f $(CLI_BIN)

check: fmt test

worker-install:
	cd $(WORKER_DIR) && $(NPM) install

worker-dev:
	cd $(WORKER_DIR) && $(NPM) run dev

worker-deploy:
	cd $(WORKER_DIR) && $(NPM) run deploy
