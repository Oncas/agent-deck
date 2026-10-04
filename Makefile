BINARY := agentdeck
IMAGE  := agentdeck-builder
BUILD_COMMIT_DATE := $(shell git show -s --format=%cs HEAD 2>/dev/null || true)
BUILD_ARGS := --build-arg BUILD_COMMIT_DATE=$(BUILD_COMMIT_DATE)
BUILD_LDFLAGS := -s -w -X agentdeck/internal/buildinfo.CommitDate=$(BUILD_COMMIT_DATE)

ELECTRON_VERSION := 34.5.8
ELECTRON_DIR     := electron
ELECTRON_DIST    := $(ELECTRON_DIR)/dist
ELECTRON_ZIP     := $(ELECTRON_DIR)/electron-v$(ELECTRON_VERSION)-linux-x64.zip
ELECTRON_SHASUMS := $(ELECTRON_DIR)/SHASUMS256.txt

.PHONY: build tidy clean electron electron-dev electron-setup electron-package electron-package-mac

build:
	docker compose build $(BUILD_ARGS) builder
	docker create --network none --name $(BINARY)-extract $(IMAGE) 2>/dev/null || true
	docker cp $(BINARY)-extract:/agentdeck ./$(BINARY)
	docker rm $(BINARY)-extract
	chmod +x ./$(BINARY)
	@echo "Built: ./$(BINARY)"

tidy:
	docker compose run --rm dev "go mod tidy"

clean:
	rm -f $(BINARY)
	docker compose down -v --rmi local 2>/dev/null || true

electron-setup:
	@if [ ! -f "$(ELECTRON_DIST)/electron" ]; then \
		set -e; \
		echo "Downloading Electron v$(ELECTRON_VERSION)..."; \
		mkdir -p $(ELECTRON_DIST); \
		curl -L -o $(ELECTRON_ZIP) \
			"https://github.com/electron/electron/releases/download/v$(ELECTRON_VERSION)/electron-v$(ELECTRON_VERSION)-linux-x64.zip"; \
		curl -L -o $(ELECTRON_SHASUMS) \
			"https://github.com/electron/electron/releases/download/v$(ELECTRON_VERSION)/SHASUMS256.txt"; \
		(cd $(ELECTRON_DIR) && grep -E "^[0-9a-f]{64} [* ]electron-v$(ELECTRON_VERSION)-linux-x64\\.zip$$" SHASUMS256.txt > electron.sha256 && sha256sum -c electron.sha256 && rm -f electron.sha256); \
		cd $(ELECTRON_DIST) && unzip -qo ../electron-v$(ELECTRON_VERSION)-linux-x64.zip; \
		rm -f $(ELECTRON_ZIP) $(ELECTRON_SHASUMS); \
		echo "Electron ready."; \
	else \
		echo "Electron already downloaded."; \
	fi

electron: build electron-setup
	cp ./$(BINARY) $(ELECTRON_DIR)/$(BINARY)
	$(ELECTRON_DIST)/electron --no-sandbox --ozone-platform-hint=auto $(ELECTRON_DIR)/main.js

electron-dev: build electron-setup
	cp ./$(BINARY) $(ELECTRON_DIR)/$(BINARY)
	AGENTDECK_DEV=1 $(ELECTRON_DIST)/electron --no-sandbox --ozone-platform-hint=auto $(ELECTRON_DIR)/main.js --dev

electron-package:
	mkdir -p dist
	rm -f dist/*.AppImage
	docker compose build $(BUILD_ARGS) electron-builder
	docker compose run --rm electron-builder
	@echo "AppImage built in ./dist/"
	@ls -lh dist/*.AppImage 2>/dev/null

electron-package-mac:
	./scripts/electron-package-mac.sh --no-open
