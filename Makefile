PREFIX ?= $(HOME)/.local
BINDIR ?= $(PREFIX)/bin
BIN_NAME ?= pi-fzf
BIN_PATH := $(BINDIR)/$(BIN_NAME)

.PHONY: install uninstall build test typecheck clean

install: build
	mkdir -p "$(BINDIR)"
	ln -sfn "$(CURDIR)/bin/pi-fzf.js" "$(BIN_PATH)"
	@echo "Installed $(BIN_NAME) -> $(BIN_PATH)"
	@echo "Make sure $(BINDIR) is in your PATH."

uninstall:
	rm -f "$(BIN_PATH)"
	@echo "Removed $(BIN_PATH)"

build:
	npm install
	npm run build

typecheck:
	npm run typecheck

test:
	npm test

clean:
	rm -rf dist
