EXTENSION_UUID = statusdot@enrialonso.github.com
INSTALL_DIR    = $(HOME)/.local/share/gnome-shell/extensions/$(EXTENSION_UUID)
SRC_DIR        = src
DIST_DIR       = dist/$(EXTENSION_UUID)

.PHONY: help setup lint test check shexli _zip sync install uninstall enable disable run pack restart clean

help:
	@echo "Dev"
	@echo "  setup    install npm dependencies"
	@echo "  lint     run ESLint"
	@echo "  test     run Vitest unit tests"
	@echo "  check    lint + test (gate before packaging)"
	@echo ""
	@echo "Extension"
	@echo "  sync     copy files to GNOME extensions directory"
	@echo "  install  sync + enable extension"
	@echo "  uninstall disable + delete from extensions directory"
	@echo "  enable   enable the extension"
	@echo "  disable  disable the extension"
	@echo "  run      launch isolated nested Wayland session"
	@echo "  restart  uninstall + install + run"
	@echo "  shexli   build ZIP and run GNOME Extensions submission linter on it"
	@echo "  pack     lint + test + shexli, then build submission ZIP in dist/"
	@echo "  clean    remove dist/ and node_modules/"

# ── Dev ───────────────────────────────────────────────────────────────────────

setup:
	npm install

lint:
	npm run lint

test:
	npm test

check: lint test

shexli: _zip
	@( command -v shexli >/dev/null 2>&1 || ( [ -f .venv/bin/shexli ] && . .venv/bin/activate ) ) || \
		{ echo "shexli not found — install with: pip install -U shexli"; exit 1; }
	. .venv/bin/activate 2>/dev/null; shexli dist/$(EXTENSION_UUID).zip

# Internal: build the ZIP without gates (used by shexli and pack)
_zip:
	rm -rf dist
	mkdir -p $(DIST_DIR)
	cp -r $(SRC_DIR)/. $(DIST_DIR)/
	glib-compile-schemas $(DIST_DIR)/schemas/
	rm -f $(DIST_DIR)/schemas/gschemas.compiled
	cd $(DIST_DIR) && zip -r ../$(EXTENSION_UUID).zip .

# ── Extension ─────────────────────────────────────────────────────────────────

# Copy source files to the GNOME extensions directory (dev workflow)
sync:
	mkdir -p $(INSTALL_DIR)
	cp -r $(SRC_DIR)/. $(INSTALL_DIR)/
	glib-compile-schemas $(INSTALL_DIR)/schemas/

# Build submission ZIP into dist/ (excludes dev-only files)
pack: check shexli

# Copy + enable in one step
install: sync
	gnome-extensions enable $(EXTENSION_UUID)

# Disable + delete
uninstall:
	-gnome-extensions disable $(EXTENSION_UUID)
	rm -rf $(INSTALL_DIR)

restart: uninstall install run

enable:
	gnome-extensions enable $(EXTENSION_UUID)

disable:
	gnome-extensions disable $(EXTENSION_UUID)

clean:
	rm -rf dist node_modules

# Launch a nested GNOME Shell session for testing (Wayland)
run:
	dbus-run-session gnome-shell --devkit --wayland
