const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const staticDir = path.join(__dirname, '..', 'static');
const repoRoot = path.join(staticDir, '..', '..', '..');
const appJs = fs.readFileSync(path.join(staticDir, 'app.js'), 'utf8');
const terminalTransportJs = fs.readFileSync(path.join(staticDir, 'terminal_transport.js'), 'utf8');
const iconsJs = fs.readFileSync(path.join(staticDir, 'icons.js'), 'utf8');
const keymapJs = fs.readFileSync(path.join(staticDir, 'keymap.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(staticDir, 'style.css'), 'utf8');
const jobsCss = fs.readFileSync(path.join(staticDir, 'jobs.css'), 'utf8');
const apiGo = fs.readFileSync(path.join(repoRoot, 'internal', 'server', 'api.go'), 'utf8');
const ptyManagerGo = fs.readFileSync(path.join(repoRoot, 'internal', 'pty', 'manager.go'), 'utf8');
const configGo = fs.readFileSync(path.join(repoRoot, 'internal', 'config', 'config.go'), 'utf8');
const databaseGo = fs.readFileSync(path.join(repoRoot, 'internal', 'server', 'database.go'), 'utf8');
const serverGo = fs.readFileSync(path.join(repoRoot, 'internal', 'server', 'server.go'), 'utf8');
const websocketGo = fs.readFileSync(path.join(repoRoot, 'internal', 'server', 'websocket.go'), 'utf8');
const gitGo = fs.readFileSync(path.join(repoRoot, 'internal', 'server', 'git.go'), 'utf8');
const serverDevGo = fs.readFileSync(path.join(repoRoot, 'internal', 'server', 'dev.go'), 'utf8');
const buildInfoGo = fs.readFileSync(path.join(repoRoot, 'internal', 'server', 'build_info.go'), 'utf8');
const cmdMainGo = fs.readFileSync(path.join(repoRoot, 'cmd', 'agentdeck', 'main.go'), 'utf8');
const electronDockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile.electron'), 'utf8');
const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');
const electronDevScript = fs.readFileSync(path.join(repoRoot, 'scripts', 'electron-dev.sh'), 'utf8');
const themesDir = path.join(staticDir, 'themes');
const darkThemeJson = fs.readFileSync(path.join(themesDir, 'dark.json'), 'utf8');
const lightThemeJson = fs.readFileSync(path.join(themesDir, 'light.json'), 'utf8');
const solarizedLightThemeJson = fs.readFileSync(path.join(themesDir, 'solarized-light.json'), 'utf8');
const githubLightThemeJson = fs.readFileSync(path.join(themesDir, 'github-light.json'), 'utf8');
const catppuccinLatteThemeJson = fs.readFileSync(path.join(themesDir, 'catppuccin-latte.json'), 'utf8');
const darculaThemeJson = fs.readFileSync(path.join(themesDir, 'darcula.json'), 'utf8');
const draculaThemeJson = fs.readFileSync(path.join(themesDir, 'dracula.json'), 'utf8');
const nordThemeJson = fs.readFileSync(path.join(themesDir, 'nord.json'), 'utf8');
const monokaiProThemeJson = fs.readFileSync(path.join(themesDir, 'monokai-pro.json'), 'utf8');
const synthwaveThemeJson = fs.readFileSync(path.join(themesDir, 'synthwave-84.json'), 'utf8');
const gruvboxThemeJson = fs.readFileSync(path.join(themesDir, 'gruvbox-dark.json'), 'utf8');
const catppuccinMochaThemeJson = fs.readFileSync(path.join(themesDir, 'catppuccin-mocha.json'), 'utf8');
const solarizedDarkThemeJson = fs.readFileSync(path.join(themesDir, 'solarized-dark.json'), 'utf8');
const ayuMirageThemeJson = fs.readFileSync(path.join(themesDir, 'ayu-mirage.json'), 'utf8');
const themeIndexJson = fs.readFileSync(path.join(themesDir, 'index.json'), 'utf8');
const electronDir = path.join(repoRoot, 'electron');
const electronPackageJson = fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8');
const electronMainJs = fs.readFileSync(path.join(electronDir, 'main.js'), 'utf8');
const electronPreloadJs = fs.readFileSync(path.join(electronDir, 'preload.js'), 'utf8');

test('static helper scripts are loaded before app.js', () => {
    const iconsIndex = indexHtml.indexOf('<script src="/icons.js"></script>');
    const helperIndex = indexHtml.indexOf('<script src="/terminal_interactions.js"></script>');
    const transportIndex = indexHtml.indexOf('<script src="/terminal_transport.js"></script>');
    const keymapIndex = indexHtml.indexOf('<script src="/keymap.js"></script>');
    const appIndex = indexHtml.indexOf('<script src="/app.js"></script>');

    assert.notEqual(iconsIndex, -1);
    assert.notEqual(helperIndex, -1);
    assert.notEqual(transportIndex, -1);
    assert.notEqual(keymapIndex, -1);
    assert.notEqual(appIndex, -1);
    assert.ok(iconsIndex < appIndex);
    assert.ok(helperIndex < appIndex);
assert.ok(helperIndex < keymapIndex);
assert.ok(keymapIndex < appIndex);
assert.ok(transportIndex < appIndex);
assert.match(styleCss, /@import url\('\/jobs\.css'\);/);
assert.match(iconsJs, /window\.AgentDeckIcons/);
assert.match(iconsJs, /'power':/);
});

test('browser runtime assets are loaded locally', () => {
    assert.doesNotMatch(indexHtml, /https:\/\/cdn\.jsdelivr\.net/);
    assert.doesNotMatch(indexHtml, /https:\/\/fonts\.googleapis\.com/);
    assert.doesNotMatch(indexHtml, /https:\/\/fonts\.gstatic\.com/);
    assert.match(indexHtml, /\/vendor\/xterm\/xterm\.css/);
    assert.match(indexHtml, /\/vendor\/xterm\/xterm\.js/);
    assert.match(indexHtml, /\/vendor\/xterm-addons\/addon-fit\.js/);
    assert.match(indexHtml, /\/vendor\/xterm-addons\/addon-unicode-graphemes\.js/);
    assert.match(indexHtml, /\/vendor\/monaco-editor\/min\/vs\/loader\.js/);
    assert.match(appJs, /\/vendor\/monaco-editor\/min\/vs/);
    assert.equal(JSON.parse(electronPackageJson).devDependencies['@xterm/xterm'], '6.0.0');
    assert.equal(JSON.parse(electronPackageJson).devDependencies['@xterm/addon-fit'], '0.11.0');
});

test('local server binds loopback and Electron uses the same host', () => {
    assert.match(cmdMainGo, /host := flag\.String\("host", "127\.0\.0\.1"/);
    assert.match(cmdMainGo, /net\.JoinHostPort\(\*host, strconv\.Itoa\(\*port\)\)/);
    assert.match(electronMainJs, /const SERVER_HOST = "127\.0\.0\.1"/);
    assert.match(electronMainJs, /"--host", SERVER_HOST/);
    assert.doesNotMatch(electronMainJs, /http:\/\/localhost:\$\{port\}/);
});

test('electron downloads verify matching checksum entries', () => {
    assert.match(makefile, /\[\* \]electron-v\$\(ELECTRON_VERSION\)-linux-x64\\\\\.zip\$\$/);
    assert.match(electronDockerfile, /\[\* \]electron-v\$\{ELECTRON_VERSION\}-linux-x64\\\\\.zip\$/);
    assert.doesNotMatch(makefile, /grep [^|]+\| sha256sum -c -/);
    assert.doesNotMatch(electronDockerfile, /grep [^|]+\| sha256sum -c -/);
});

test('direct DOM references point at existing HTML ids', () => {
    const htmlIDs = new Set([...indexHtml.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
    const missing = [];
    for (const match of appJs.matchAll(/document\.getElementById\('([^']+)'\)\s*\./g)) {
        if (!htmlIDs.has(match[1])) missing.push(match[1]);
    }

    assert.deepEqual([...new Set(missing)].sort(), []);
});

test('keymap profiles are wired through config, modal, and command dispatch', () => {
    const paletteStart = appJs.indexOf('function commandPaletteActions');
    const paletteEnd = appJs.indexOf('return decorateCommandActions(actions, state);', paletteStart);
    const paletteSection = appJs.slice(paletteStart, paletteEnd);
    const keyboardStart = appJs.indexOf("document.addEventListener('keydown'");
    const keyboardEnd = appJs.indexOf('// ─── Window Resize', keyboardStart);
    const keyboardSection = appJs.slice(keyboardStart, keyboardEnd);

    assert.match(keymapJs, /DEFAULT_PROFILE_NAME = 'Default'/);
    assert.match(keymapJs, /function normalizeConfig/);
    assert.match(keymapJs, /function serializeState/);
    assert.match(keymapJs, /function eventMatchesCommand/);
    assert.match(configGo, /KeymapProfiles\s+\[\]KeymapProfile\s+`json:"keymap_profiles,omitempty"`/);
    assert.match(configGo, /ActiveKeymap\s+string\s+`json:"active_keymap_profile,omitempty"`/);
    assert.match(apiGo, /KeymapProfiles\s+\*\[\]config\.KeymapProfile\s+`json:"keymap_profiles"`/);
    assert.match(apiGo, /ActiveKeymap\s+\*string\s+`json:"active_keymap_profile"`/);
    assert.match(apiGo, /cfg\.KeymapProfiles = cloneKeymapProfiles/);
    assert.match(apiGo, /cfg\.ActiveKeymap = \*p\.ActiveKeymap/);
    assert.match(indexHtml, /id="shortcuts-config-btn"/);
    assert.match(indexHtml, /id="keymap-config-modal"/);
    assert.match(indexHtml, /id="keymap-command-list"/);
    assert.match(styleCss, /#keymap-command-list/);
    assert.match(appJs, /function openKeymapConfigModal/);
    assert.match(appJs, /function saveKeymapConfig/);
    assert.match(appJs, /function resetKeymapProfile/);
    assert.match(appJs, /Keymap\.defaultBindings\(keymapOptions\(\)\)/);
    assert.match(appJs, /Keymap\.serializeState\(keymapDraftState\)/);
    assert.match(appJs, /if \(!keymapDraftState\) \{\s*keymapDraftState = Keymap\.cloneState\(keymapState\);/);
    assert.doesNotMatch(appJs, /keymapDraftState = Keymap\.cloneState\(keymapDraftState \|\| keymapState\)/);
    assert.match(appJs, /state\.profiles\.find\(profile => profile\.id === state\.activeProfileID\)/);
    assert.doesNotMatch(appJs, /function keymapDraftProfile\(\) \{\s*return Keymap\.activeProfile/);
    assert.match(appJs, /nameInput\.readOnly = profile\.id === Keymap\.DEFAULT_PROFILE_ID/);
    assert.match(appJs, /let keymapSaveInFlight = false;/);
    assert.match(appJs, /function renderKeymapSaveButton/);
    assert.match(appJs, /btn\.textContent = keymapSaveInFlight \? 'Saving\.\.\.' : 'Save Profile'/);
    assert.match(appJs, /if \(!keymapDraftState \|\| keymapSaveInFlight\) return;/);
    assert.match(appJs, /Profile save failed/);
    assert.match(appJs, /timeoutMs: CONFIG_SAVE_TIMEOUT_MS/);
    assert.match(appJs, /timeoutMessage: 'Keymap save timed out\. Please try again\.'/);
    assert.doesNotMatch(appJs, /timeoutMs: options\.timeoutMs \?\? CONFIG_SAVE_TIMEOUT_MS/);
    assert.match(appJs, /keymapSaveInFlight = false;\s*renderKeymapSaveButton\(\);/);
    assert.doesNotMatch(appJs, /if \(btn && isKeymapConfigOpen\(\)\)/);
    assert.match(appJs, /else if \(profile\.id === Keymap\.DEFAULT_PROFILE_ID\) profile\.bindings\[command\.id\] = \[\]/);
    assert.doesNotMatch(appJs, /record\.disabled = profileLocked/);
    assert.doesNotMatch(appJs, /Create a new profile to edit shortcuts/);
    assert.doesNotMatch(styleCss, /\.keymap-record-btn:disabled/);
    assert.match(appJs, /profile\.bindings\[commandID\] = \[normalized\]/);
    assert.match(indexHtml, /Save Profile/);
    assert.match(indexHtml, /id="keymap-profile-reset-btn"/);
    assert.match(styleCss, /#keymap-profile-reset-btn/);
    assert.match(paletteSection, /id: 'app\.openKeymapConfig'/);
    assert.match(appJs, /function stableCommandID/);
    assert.match(paletteSection, /id: 'terminal\.closePaneOrTab'/);
    assert.match(paletteSection, /const fileID = stableCommandID\(\[activeProject, file\.name\]\);/);
    assert.doesNotMatch(paletteSection, /\.\$\{idx\}/);
    assert.match(appJs, /return decorateCommandActions\(actions, state\);/);
    assert.match(appJs, /function keymapCommandForEvent/);
    assert.match(appJs, /function dispatchKeymapAction/);
    assert.match(keyboardSection, /if \(handleKeymapCaptureKeydown\(ev\)\) return;/);
    assert.match(keyboardSection, /dispatchKeymapAction\(ev\)/);
    assert.match(appJs, /if \(isTerminalCopyShortcut\(ev\) && ev\.type === 'keydown'\)[\s\S]*if \(shouldBlockTerminalShortcut\(ev\)\) return false;/);
    assert.doesNotMatch(appJs, /electronAppShortcut/);
    assert.match(appJs, /electronShortcutInput/);
    assert.match(electronMainJs, /before-input-event/);
    assert.match(electronMainJs, /shortcut-input/);
    assert.doesNotMatch(electronMainJs, /app-shortcut/);
    assert.doesNotMatch(electronMainJs, /close-pane-or-tab/);
    assert.match(electronPreloadJs, /electronShortcutInput/);
    assert.match(electronPreloadJs, /shortcut-input/);
    assert.doesNotMatch(electronPreloadJs, /app-shortcut/);
});

test('dangerous permission toggles are wired through settings and config', () => {
    const capabilitiesStart = appJs.indexOf('function renderSettingsCapabilities');
    const capabilitiesEnd = appJs.indexOf('function renderProjectTags', capabilitiesStart);
    const capabilitiesSection = appJs.slice(capabilitiesStart, capabilitiesEnd);
    const toggleStart = appJs.indexOf('function settingsDangerousToggleHTML');
    const toggleEnd = appJs.indexOf('function initSettings', toggleStart);
    const toggleSection = appJs.slice(toggleStart, toggleEnd);
    const saveStart = appJs.indexOf('async function saveSettings');
    const saveEnd = appJs.indexOf('// ─── Side panels', saveStart);
    const saveSection = appJs.slice(saveStart, saveEnd);

	assert.match(configGo, /DangerousPermissions\s+map\[string\]bool\s+`json:"dangerous_permissions,omitempty"`/);
	assert.match(configGo, /CLIIntegrations\s+\[\]CLIIntegration\s+`json:"cli_integrations,omitempty"`/);
	assert.match(apiGo, /DangerousPermissions\s+\*map\[string\]bool\s+`json:"dangerous_permissions"`/);
	assert.match(apiGo, /CLIIntegrations\s+\*\[\]config\.CLIIntegration\s+`json:"cli_integrations"`/);
	assert.match(apiGo, /cfg\.DangerousPermissions = cloneBoolMap\(\*p\.DangerousPermissions\)/);
	assert.match(apiGo, /cfg\.CLIIntegrations = cloneCLIIntegrations\(\*p\.CLIIntegrations\)/);
	assert.match(apiGo, /SetDangerousPermissions\(next\.DangerousPermissions\)/);
	assert.match(apiGo, /SetCLIIntegrations\(next\.CLIIntegrations\)/);
	assert.match(indexHtml, /id="settings-cli-integrations-list"/);
	assert.match(indexHtml, /id="settings-cli-integration-command"/);
	assert.match(indexHtml, /id="settings-cli-integration-resume"/);
	assert.doesNotMatch(indexHtml, /id="settings-cli-integration-dangerous"/);
	assert.doesNotMatch(indexHtml, /id="settings-dangerous-list"/);
	assert.doesNotMatch(indexHtml, /Permission Bypass/);
	assert.match(styleCss, /\.settings-health-toggle/);
	assert.match(styleCss, /#settings-cli-integration-modal/);
	assert.match(indexHtml, /id="settings-cli-integration-open-btn"/);
	assert.match(appJs, /function openSettingsCLIIntegrationModal/);
	assert.match(appJs, /function closeSettingsCLIIntegrationModal/);
	assert.match(appJs, /function normalizeCLIIntegrations/);
	assert.match(appJs, /Integration id .* is reserved by a built-in CLI/);
	assert.match(appJs, /resume_command: String\(integration\.resume_command \|\| ''\)\.trim\(\)/);
	assert.match(appJs, /dangerousFlag: ''/);
	assert.match(appJs, /function refreshAIProviders/);
	assert.match(appJs, /function normalizeDangerousPermissions/);
	assert.match(appJs, /function settingsDangerousToggleHTML/);
    assert.match(toggleSection, /provider\.dangerousLabel/);
    assert.match(toggleSection, /provider\.dangerousFlag/);
    assert.match(capabilitiesSection, /settingsDangerousToggleHTML\(provider\)/);
    assert.match(capabilitiesSection, /bindSettingsDangerousToggle\(provider\)/);
	assert.match(saveSection, /const nextDangerousPermissions = remapDangerousPermissions\(readSettingsDangerousPermissions\(\), cliTransition, nextCLIProviders\)/);
	assert.match(saveSection, /cli_integrations: nextCLIIntegrations/);
	assert.match(saveSection, /dangerous_permissions: nextDangerousPermissions/);
	assert.match(appJs, /Cursor force mode/);
	assert.doesNotMatch(appJs, /settingsLabel: 'Headroom \(headroom\)'/);
	assert.doesNotMatch(indexHtml, /value="headroom"/);
	assert.match(appJs, /settingsEditingCLIIntegrationID/);
	assert.match(appJs, /function editSettingsCLIIntegration/);
	assert.match(appJs, /item\.id === integration\.id && item\.id !== editingID/);
	assert.match(appJs, /if \(duplicate\) \{/);
	assert.match(appJs, /Integration id "\$\{integration\.id\}" is already used\./);
	assert.match(appJs, /if \(!replaced\) nextIntegrations\.push\(integration\)/);
	assert.match(appJs, /const selectedCLI = document\.getElementById\('settings-cli-select'\)\?\.value \|\| ''/);
	assert.match(appJs, /const nextSelectedCLI = editingID && selectedCLI === editingID \? integration\.id : selectedCLI/);
	assert.match(appJs, /settingsPendingCLIRenames\.push\(\{ from: editingID, to: integration\.id \}\)/);
	assert.match(appJs, /nextDangerousPermissions\[integration\.id\] = true/);
	assert.match(appJs, /function migrateTerminalCLIs/);
	assert.match(appJs, /function isCustomCLIProvider/);
	assert.match(appJs, /if \(isCustomCLIProvider\(normalized\)\) return normalized/);
	assert.match(appJs, /function providerOptionsWithSelection/);
	assert.match(appJs, /providerOptionsWithSelection\(paneValue, baseProviders\)/);
	assert.match(appJs, /function buildCLITransition/);
	assert.match(appJs, /function applyCLITransition/);
	assert.match(appJs, /function remapDangerousPermissions/);
	assert.match(saveSection, /const cliTransition = buildCLITransition/);
	assert.match(appJs, /const migratedPaneCLI = migrateTerminalCLIs\(cliTransition\)/);
	assert.match(appJs, /function buildTabLayoutsPayload\(cliTransition = null\)/);
	assert.match(appJs, /applyCLITransition\(t\.cli, cliTransition\)/);
	assert.match(appJs, /function saveTabsNow\(cliTransition = null\)/);
	assert.match(appJs, /tab_layouts: buildTabLayoutsPayload\(cliTransition\)/);
	assert.match(appJs, /saveTabsNow\(cliTransition\)/);
	assert.doesNotMatch(appJs, /function migrateRemovedTerminalCLIs/);
	assert.doesNotMatch(appJs, /removedCLIIDs/);
	assert.match(indexHtml, /settings-cli-integration-cancel-btn/);
	assert.match(appJs, /settingsLabel: 'Cursor CLI \(cursor-agent\)'/);
    assert.doesNotMatch(appJs, /settingsLabel: 'Cursor CLI \(cursor-agent -f\)'/);
    assert.doesNotMatch(indexHtml, /cursor-agent -f/);
});

test('custom CLI transitions compose rename and removal state', () => {
	const providersStart = appJs.indexOf('const BUILT_IN_AI_PROVIDERS');
	const providersEnd = appJs.indexOf('function hasPrimaryModifier', providersStart);
	const cliStart = appJs.indexOf('function normalizeCLI(cli)');
	const cliEnd = appJs.indexOf('function renderTerminalProviderSwitcher', cliStart);
	assert.ok(providersStart >= 0 && providersEnd > providersStart);
	assert.ok(cliStart >= 0 && cliEnd > cliStart);

	const code = `
		const assert = require('node:assert/strict');
		let currentCLI = 'claude';
		let runtimeCapabilities = null;
		let terminals = {};
		${appJs.slice(providersStart, providersEnd)}
		${appJs.slice(cliStart, cliEnd)}

		refreshAIProviders([{ id: 'old-cli', name: 'Old CLI', command: 'old-cli' }]);
		let transition = buildCLITransition({
			previousIntegrations: customCLIIntegrations,
			nextIntegrations: [{ id: 'new-cli', name: 'New CLI', command: 'new-cli' }],
			renames: [{ from: 'old-cli', to: 'new-cli' }],
		});
		assert.equal(applyCLITransition('old-cli', transition), 'new-cli');
		assert.deepEqual(
			remapDangerousPermissions(
				{ 'old-cli': true },
				transition,
				buildAIProviderState([{ id: 'new-cli', name: 'New CLI', command: 'new-cli' }]).providers,
			),
			{},
		);

		transition = buildCLITransition({
			previousIntegrations: [{ id: 'old-cli', command: 'old-cli' }],
			nextIntegrations: [{ id: 'final-cli', command: 'final-cli' }],
			renames: [
				{ from: 'old-cli', to: 'middle-cli' },
				{ from: 'middle-cli', to: 'final-cli' },
			],
		});
		assert.equal(applyCLITransition('old-cli', transition), 'final-cli');
		assert.equal(applyCLITransition('middle-cli', transition), 'final-cli');

		transition = buildCLITransition({
			previousIntegrations: [{ id: 'old-cli', command: 'old-cli' }],
			nextIntegrations: [],
			renames: [{ from: 'old-cli', to: 'deleted-cli' }],
		});
		assert.equal(applyCLITransition('old-cli', transition), 'claude');
		assert.equal(applyCLITransition('deleted-cli', transition), 'claude');
		assert.deepEqual(
			remapDangerousPermissions(
				{ 'old-cli': true },
				transition,
				buildAIProviderState([]).providers,
			),
			{},
		);

		terminals = {
			one: { cli: 'old-cli' },
			two: { cli: 'deleted-cli' },
			special: { kind: 'job', cli: 'old-cli' },
		};
		assert.equal(migrateTerminalCLIs(transition), true);
		assert.equal(terminals.one.cli, 'claude');
		assert.equal(terminals.two.cli, 'claude');
		assert.equal(terminals.special.cli, 'old-cli');

		refreshAIProviders([{ id: 'custom-cli', name: 'Custom CLI', command: 'custom-cli' }]);
		runtimeCapabilities = { dependencies: { claude: { available: true } } };
		assert.equal(resolveRuntimeCLI('custom-cli'), 'custom-cli');
		assert.ok(providerOptionsWithSelection('custom-cli', [{ value: 'claude', shortLabel: 'Claude' }])
			.some(provider => provider.value === 'custom-cli'));
	`;
	vm.runInNewContext(code, { require });
});

test('themes load from static theme definition files', () => {
    const themeStart = appJs.indexOf('// ─── Theme');
    const themeEnd = appJs.indexOf('function initTerminalProviderSwitcher', themeStart);
    const themeSection = appJs.slice(themeStart, themeEnd);
    const monacoStart = appJs.indexOf('// ─── Monaco Editor');
    const monacoEnd = appJs.indexOf('function getLangFromFile', monacoStart);
    const monacoSection = appJs.slice(monacoStart, monacoEnd);
    const navStateStart = styleCss.indexOf('.mode-btn:hover');
    const navStateEnd = styleCss.indexOf('.terminal-tab .tab-dot', navStateStart);
    const navStateSection = styleCss.slice(navStateStart, navStateEnd);
    const contextMenuStart = styleCss.indexOf('.terminal-context-item:hover');
    const contextMenuEnd = styleCss.indexOf('.terminal-context-item.disabled', contextMenuStart);
    const contextMenuStateSection = styleCss.slice(contextMenuStart, contextMenuEnd);

    assert.match(darkThemeJson, /"id": "dark"/);
    assert.match(lightThemeJson, /"id": "light"/);
    assert.match(solarizedLightThemeJson, /"id": "solarized-light"/);
    assert.match(githubLightThemeJson, /"id": "github-light"/);
    assert.match(catppuccinLatteThemeJson, /"id": "catppuccin-latte"/);
    assert.match(darculaThemeJson, /"id": "darcula"/);
    assert.match(draculaThemeJson, /"id": "dracula"/);
    assert.match(nordThemeJson, /"id": "nord"/);
    assert.match(monokaiProThemeJson, /"id": "monokai-pro"/);
    assert.match(synthwaveThemeJson, /"id": "synthwave-84"/);
    assert.match(gruvboxThemeJson, /"id": "gruvbox-dark"/);
    assert.match(catppuccinMochaThemeJson, /"id": "catppuccin-mocha"/);
    assert.match(solarizedDarkThemeJson, /"id": "solarized-dark"/);
    assert.match(ayuMirageThemeJson, /"id": "ayu-mirage"/);
    assert.match(darculaThemeJson, /"name": "Darcula"/);
    assert.match(darculaThemeJson, /"#161719"/);
    assert.match(darculaThemeJson, /"#1f2022"/);
    assert.match(darculaThemeJson, /"#214283"/);
    assert.match(darculaThemeJson, /"#6a8759"/);
    assert.match(darculaThemeJson, /"#a9b7c6"/);
    assert.match(draculaThemeJson, /"#282a36"/);
    assert.match(monokaiProThemeJson, /"#2d2a2e"/);
    assert.match(nordThemeJson, /"#2e3440"/);
    assert.match(gruvboxThemeJson, /"#282828"/);
    assert.match(catppuccinMochaThemeJson, /"#11111b"/);
    assert.match(solarizedDarkThemeJson, /"#002b36"/);
    assert.match(ayuMirageThemeJson, /"#161a23"/);
    assert.match(githubLightThemeJson, /"#ffffff"/);
    assert.match(themeIndexJson, /dark\.json/);
    assert.match(themeIndexJson, /light\.json/);
    assert.match(themeIndexJson, /solarized-light\.json/);
    assert.match(themeIndexJson, /github-light\.json/);
    assert.match(themeIndexJson, /catppuccin-latte\.json/);
    assert.match(themeIndexJson, /darcula\.json/);
    assert.match(themeIndexJson, /dracula\.json/);
    assert.match(themeIndexJson, /nord\.json/);
    assert.match(themeIndexJson, /monokai-pro\.json/);
    assert.match(themeIndexJson, /synthwave-84\.json/);
    assert.match(themeIndexJson, /gruvbox-dark\.json/);
    assert.match(themeIndexJson, /catppuccin-mocha\.json/);
    assert.match(themeIndexJson, /solarized-dark\.json/);
    assert.match(themeIndexJson, /ayu-mirage\.json/);
    assert.match(darculaThemeJson, /"terminal"/);
    assert.match(darculaThemeJson, /"monaco"/);
    assert.match(indexHtml, /theme-css-/);
    assert.match(indexHtml, /Loading themes/);
    assert.match(serverGo, /GET \/api\/themes/);
    assert.doesNotMatch(indexHtml, /<option value="darcula">Darcula<\/option>/);
    assert.doesNotMatch(styleCss, /html\[data-theme="darcula"\]\s*\{\s*--bg:/);
    assert.doesNotMatch(navStateSection, /rgba\(122,\s*162,\s*247/);
    assert.doesNotMatch(navStateSection, /html\[data-theme="darcula"\]/);
    assert.match(navStateSection, /background: var\(--bg-hover\)/);
    assert.match(navStateSection, /background: var\(--bg-secondary\)/);
    assert.match(contextMenuStateSection, /background: var\(--bg-hover\)/);
    assert.match(themeSection, /async function loadThemeDefinitions/);
    assert.match(themeSection, /\/api\/themes/);
    assert.match(themeSection, /loadThemeDefinitionsFromStaticManifest/);
    assert.match(themeSection, /\/themes\/index\.json/);
    assert.match(themeSection, /function renderThemeOptions/);
    assert.match(themeSection, /function normalizeThemeMode/);
    assert.match(themeSection, /defineMonacoThemes/);
    assert.doesNotMatch(themeSection, /const TERM_THEME_DARCULA/);
    assert.match(monacoSection, /defineMonacoThemes\(\)/);
    assert.match(monacoSection, /monaco\.editor\.setTheme\(getMonacoThemeName\(\)\)/);
    assert.doesNotMatch(appJs, /getEffectiveTheme\(\) === 'light' \? 'tokyonight-light' : 'tokyonight'/);
});

test('file editor detects Monaco languages from filenames', () => {
    const start = appJs.indexOf('function getLangFromFile');
    const end = appJs.indexOf('function fetchFileBlame', start);
    const context = {};
    vm.runInNewContext(`${appJs.slice(start, end)}\nthis.getLangFromFile = getLangFromFile;`, context);

    const expectedLanguages = {
        'app.js': 'javascript',
        'app.ts': 'typescript',
        'component.jsx': 'javascript',
        'component.tsx': 'typescript',
        'module.mjs': 'javascript',
        'config.cjs': 'javascript',
        'main.go': 'go',
        'script.py': 'python',
        'main.rs': 'rust',
        'task.rb': 'ruby',
        'index.html': 'html',
        'style.css': 'css',
        'style.scss': 'scss',
        'style.less': 'less',
        'data.json': 'json',
        'config.yaml': 'yaml',
        'config.yml': 'yaml',
        'config.toml': 'ini',
        'README.md': 'markdown',
        'script.sh': 'shell',
        'script.bash': 'shell',
        'script.zsh': 'shell',
        'query.sql': 'sql',
        'document.xml': 'xml',
        'icon.svg': 'xml',
        'Main.java': 'java',
        'Main.kt': 'kotlin',
        'main.c': 'c',
        'main.cpp': 'cpp',
        'header.h': 'c',
        'index.php': 'php',
        'component.vue': 'html',
        'component.svelte': 'html',
        'templates/page.html.twig': 'twig',
        'containers/api/Dockerfile': 'dockerfile',
        'schema.graphql': 'graphql',
        'queries/user.gql': 'graphql',
        'infra/main.tf': 'hcl',
        'infra/dev.tfvars': 'hcl',
        'infra/module.hcl': 'hcl',
        'messages/user.proto': 'proto',
        'NOTICE': 'plaintext',
    };

    for (const [filename, language] of Object.entries(expectedLanguages)) {
        assert.equal(context.getLangFromFile(filename), language, filename);
    }
});

test('terminal links route through the shared external opener', () => {
    const start = appJs.indexOf('async function openExternal');
    const end = appJs.indexOf('// ─── Database Workbench', start);
    const openExternalSection = appJs.slice(start, end);

    assert.match(appJs, /activate\(\)\s*\{\s*void openExternal\(url\);\s*\}/);
    assert.match(appJs, /findTerminalLinks\(term\.buffer\.active, bufferLineNumber - 1, term\.cols\)/);
    assert.match(appJs, /linkHandler:\s*\{\s*activate\(_event,\s*text\)\s*\{\s*void openExternal\(text\);\s*\},\s*allowNonHttpProtocols:\s*false,\s*\}/);
    assert.match(openExternalSection, /openExternalUrl/);
    assert.match(openExternalSection, /electronOpenExternal: window\.electronOpenExternal/);
    assert.match(openExternalSection, /External opener unavailable/);
    assert.doesNotMatch(openExternalSection, /new URL\(url/);
    assert.doesNotMatch(openExternalSection, /window\.open\(safeUrl/);
    assert.doesNotMatch(appJs, /window\.open\(url,\s*'_blank'\)/);
    assert.doesNotMatch(appJs, /window\.electronOpenExternal\(url\)/);
});

test('stray drop guard defers to the browser for native text drops', () => {
    assert.match(appJs, /acceptsTextDrop\(ev\.target, ev\.dataTransfer\?\.types, uriList\)/);
    assert.match(appJs, /const uriList = ev\.dataTransfer\?\.getData\('text\/uri-list'\) \|\| ''/);
    assert.match(appJs, /document\.addEventListener\('dragover', guardStrayDrop\)/);
    assert.match(appJs, /document\.addEventListener\('drop', guardStrayDrop\)/);
    assert.doesNotMatch(appJs, /document\.addEventListener\('drop', \(ev\) => ev\.preventDefault\(\)\)/);
});

test('terminal tabs can be dragged into a persisted order', () => {
    const reorderStart = appJs.indexOf('function reorderTab');
    const reorderEnd = appJs.indexOf('function getPaneKeys', reorderStart);
    const reorderSection = appJs.slice(reorderStart, reorderEnd);
    const context = {};

    assert.ok(reorderStart >= 0 && reorderEnd > reorderStart);
    vm.runInNewContext(`
        let tabOrder = ['one', 'two', 'three'];
        ${reorderSection}
        this.reorderTab = reorderTab;
        this.getTabOrder = () => [...tabOrder];
    `, context);

    assert.equal(context.reorderTab('one', 'three', true), true);
    assert.deepEqual(Array.from(context.getTabOrder()), ['two', 'three', 'one']);
    assert.equal(context.reorderTab('one', 'three', true), false);
    assert.deepEqual(Array.from(context.getTabOrder()), ['two', 'three', 'one']);
    assert.equal(context.reorderTab('missing', 'two', false), false);

    assert.match(appJs, /tab\.draggable = true/);
    assert.match(appJs, /tab\.ondragstart =/);
    assert.match(appJs, /tab\.ondragover =/);
    assert.match(appJs, /tab\.ondrop =/);
    assert.match(appJs, /if \(draggedTabKey\) \{\s*updateStatusContext\(\);\s*return;/);
    assert.match(appJs, /tab\.ondragend = \(\) => \{[\s\S]*?renderTabs\(\);/);
    assert.match(appJs, /if \(reorderTab\(sourceName, name, insertAfter\)\) renderTabs\(\)/);
    assert.match(appJs, /open_tabs: names/);
    assert.match(styleCss, /\.terminal-tab\.drop-before/);
    assert.match(styleCss, /\.terminal-tab\.drop-after/);
});

test('directory selection is wired through setup, settings, and Electron', () => {
    assert.match(indexHtml, /Select the services directory that contains your project repositories/);
    assert.match(indexHtml, /id="setup-dir-select-btn"/);
    assert.match(indexHtml, /id="settings-scan-select-btn"/);
    assert.match(indexHtml, /id="settings-scan-add-btn"/);
    assert.match(indexHtml, /id="settings-extra-select-btn"/);
    assert.match(styleCss, /\.setup-path-row/);
    assert.match(styleCss, /\.settings-path-row/);
    assert.match(styleCss, /\.path-select-btn/);
    assert.match(appJs, /async function selectDirectory/);
    assert.match(appJs, /window\.electronSelectFolder/);
    assert.match(appJs, /async function selectSetupDirectory/);
    assert.match(appJs, /async function selectSettingsScanPath/);
    assert.match(appJs, /function addScanPath/);
    assert.match(appJs, /function renderScanPaths/);
    assert.match(appJs, /JSON\.stringify\(\{ scan_paths: \[dir\] \}\)/);
    assert.match(appJs, /scan_paths:\s*settingsScanPaths/);
    assert.match(appJs, /async function selectSettingsExtraProject/);
    assert.match(electronMainJs, /dialog\.showOpenDialog/);
    assert.match(electronMainJs, /ipcMain\.handle\("select-folder"/);
    assert.match(electronPreloadJs, /electronSelectFolder/);
    assert.match(electronPreloadJs, /select-folder/);
});

test('electron dev mode serves static files from disk and reloads renderer', () => {
    const initStart = appJs.indexOf('async function init');
    const initEnd = appJs.indexOf('// ─── Setup', initStart);
    const initSection = appJs.slice(initStart, initEnd);

    assert.match(cmdMainGo, /dev-static-dir/);
    assert.match(cmdMainGo, /monaco-dir/);
assert.match(cmdMainGo, /sql-formatter-dir/);
assert.match(cmdMainGo, /os\.DirFS\(staticDir\)/);
assert.match(cmdMainGo, /monacoFS = os\.DirFS\(monacoDir\)/);
assert.match(cmdMainGo, /sqlFormatterFS = os\.DirFS\(sqlFormatterDir\)/);
assert.match(serverGo, /GET \/api\/dev\/reload-stamp/);
assert.match(serverGo, /GET \/vendor\/monaco-editor\/min\/vs\//);
assert.match(serverGo, /http\.StripPrefix\("\/vendor\/monaco-editor\/min\/vs\/"/);
assert.match(serverGo, /GET \/vendor\/sql-formatter\//);
assert.match(serverGo, /http\.StripPrefix\("\/vendor\/sql-formatter\/"/);
assert.match(serverGo, /newStaticHandler\(staticFS, devMode\)/);
assert.match(indexHtml, /\/vendor\/monaco-editor\/min\/vs\/loader\.js/);
assert.match(appJs, /vs: '\/vendor\/monaco-editor\/min\/vs'/);
assert.match(serverDevGo, /func newDevReloadHandler/);
assert.match(serverDevGo, /func newStaticHandler/);
assert.match(serverDevGo, /Cache-Control", "no-store"/);
assert.match(serverDevGo, /func staticReloadStamp/);
    assert.match(appJs, /let devReloadTimer = null/);
    assert.match(appJs, /function initDevReload/);
    assert.match(initSection, /initDevReload\(\)/);
    assert.match(initSection, /\/api\/dev\/reload-stamp/);
    assert.match(initSection, /window\.location\.reload\(\)/);
    assert.match(initSection, /shouldRestoreDatabaseView\(\)/);
    assert.match(initSection, /showDatabase\(\)/);
    assert.match(electronMainJs, /function isDevMode/);
    assert.match(electronMainJs, /--dev-static-dir/);
    assert.match(electronMainJs, /--monaco-dir/);
    assert.match(electronMainJs, /--sql-formatter-dir/);
    assert.match(electronMainJs, /"node_modules", "monaco-editor", "min", "vs"/);
    assert.match(electronMainJs, /"node_modules", "sql-formatter", "dist"/);
    assert.match(electronMainJs, /cmd", "agentdeck", "static"/);
    assert.match(electronMainJs, /webContents\.session\.clearCache\(\)/);
    assert.match(makefile, /electron-dev:/);
    assert.match(makefile, /AGENTDECK_DEV=1/);
    assert.match(makefile, /electron --no-sandbox/);
    assert.match(electronDevScript, /docker compose build/);
    assert.match(electronDevScript, /AGENTDECK_DEV=1 exec/);
    assert.match(electronDevScript, /electron" --no-sandbox/);
    assert.match(electronDevScript, /--dev/);
});

test('orchestrator, github dashboard, skills panel and codex account switcher stay removed', () => {
    const catalogStart = appJs.indexOf('function keymapCommandCatalog');
    const catalogEnd = appJs.indexOf('function currentKeymapCommands', catalogStart);
    const catalogSection = appJs.slice(catalogStart, catalogEnd);
    const paletteStart = appJs.indexOf('function commandPaletteActions');
    const paletteEnd = appJs.indexOf('return decorateCommandActions(actions, state);', paletteStart);
    const paletteSection = appJs.slice(paletteStart, paletteEnd);

    assert.doesNotMatch(indexHtml, /id="github-btn"|id="orchestrator-btn"|id="orch-agents-panel"|id="agent-modal"|id="codex-account-modal"/);
    assert.doesNotMatch(appJs, /codex\/accounts|auth\.json|restart_on_codex_switch/);
    assert.doesNotMatch(serverGo, /codex\/accounts/);
    assert.doesNotMatch(configGo, /restart_on_codex_switch/);
    assert.doesNotMatch(keymapJs, /app\.openGitHubDashboard|app\.openAgentsDashboard/);
    assert.doesNotMatch(catalogSection, /Open GitHub dashboard|Open agents dashboard/);
    assert.doesNotMatch(paletteSection, /Open GitHub dashboard|Open agents dashboard/);
    assert.doesNotMatch(appJs, /isOrchTab|isGitHubTab|isSpecialTab|openOrchestrator|openGitHubDashboard|initSkills/);
    assert.doesNotMatch(appJs, /\/api\/(orchestrator|skills|github\/overview|github\/pr)/);
    assert.doesNotMatch(indexHtml, /id="skills-section"|id="skill-info-modal"/);
    assert.doesNotMatch(serverGo, /\/api\/(orchestrator|skills|github\/overview|github\/pr)/);
    assert.doesNotMatch(appJs, /document\.getElementById\('(github-btn|orchestrator-btn|orch-agents-panel|agent-modal|agent-modal-backdrop|agent-modal-close|agent-modal-title|agent-modal-terminal)'\)\.(onclick|style|classList|textContent|innerHTML|addEventListener|setAttribute)/);
});

test('jobs page is wired through menu, commands, api, and approved fields', () => {
    const catalogStart = appJs.indexOf('function keymapCommandCatalog');
    const catalogEnd = appJs.indexOf('function currentKeymapCommands', catalogStart);
    const catalogSection = appJs.slice(catalogStart, catalogEnd);
    const paletteStart = appJs.indexOf('function commandPaletteActions');
    const paletteEnd = appJs.indexOf('return decorateCommandActions(actions, state);', paletteStart);
    const paletteSection = appJs.slice(paletteStart, paletteEnd);

    assert.match(indexHtml, /id="jobs-btn"/);
    assert.match(indexHtml, /id="jobs-view"/);
    assert.match(indexHtml, /id="job-project"/);
    assert.match(indexHtml, /id="job-schedule"/);
    assert.match(indexHtml, /id="job-schedule-builder-btn"/);
    assert.match(indexHtml, /id="job-schedule-modal"/);
    assert.match(indexHtml, /id="job-schedule-mode"/);
    assert.match(indexHtml, /id="job-schedule-preview-list"/);
    assert.match(indexHtml, /value="custom">Custom cron/);
    assert.match(indexHtml, /id="job-schedule-use-btn"/);
    assert.match(indexHtml, /id="job-prompt"/);
    assert.match(indexHtml, /id="job-log-modal"/);
    assert.match(indexHtml, /id="job-log-response-btn"/);
    assert.match(indexHtml, /id="job-log-terminal-btn"/);
    assert.match(keymapJs, /'app\.openJobs': \['Primary\+Shift\+J'\]/);
    assert.match(catalogSection, /Open jobs/);
    assert.match(paletteSection, /Open jobs/);
    assert.match(appJs, /fetchJSON\('\/api\/jobs'\)/);
    assert.match(appJs, /run manually/);
    assert.match(appJs, /if \(mode === 'custom'\)/);
    assert.match(appJs, /fetchJSON\('\/api\/jobs\/schedule\/preview'/);
    assert.match(appJs, /function setJobScheduleValidation\(valid/);
    assert.match(appJs, /function jobScheduleLocalError\(schedule\)/);
    assert.match(appJs, /let jobSchedulePreviewBlocksSave = false/);
    assert.match(appJs, /blockSave: true/);
    assert.match(appJs, /jobSchedulePreviewBlocksSave\) \{/);
    assert.doesNotMatch(appJs, /if \(!jobScheduleValid\) throw/);
    assert.match(appJs, /function updateJobSaveState\(\)/);
    assert.match(appJs, /function hideJobs\(\) \{\s*closeJobScheduleBuilder\(\);\s*closeJobLogs\(\);/);
    assert.match(appJs, /if \(jobsActive\) \{\s*hideJobs\(\);/);
    assert.match(appJs, /function startJobsPoll\(\)/);
    assert.match(appJs, /setInterval\(\(\) => loadJobs\(\{ notify: true, render: jobsActive \}\), 10000\)/);
    assert.match(appJs, /function initNotificationHandlers\(\)/);
    assert.match(appJs, /window\.electronOnNotificationClick/);
    assert.match(appJs, /function sendJobNotification\(job, notification = null\)/);
    assert.match(appJs, /window\.electronNotify\(payload\)/);
    assert.match(appJs, /function openJobFromNotification\(jobID\)/);
    assert.match(appJs, /let pendingJobNotifications = \{\}/);
    assert.match(appJs, /function jobStatusNotificationKey\(snapshot\)/);
    assert.match(appJs, /function jobStatusNotification\(job, snapshot\)/);
    assert.match(appJs, /pendingNotifications\.push\(notification\)/);
    assert.match(appJs, /nextPendingNotifications\[job\.id\] = pendingNotifications/);
    assert.match(appJs, /openJobLogs\(job, \{ mode: 'terminal' \}\)/);
    assert.match(appJs, /fetchJSON\(`\/api\/jobs\/\$\{encodeURIComponent\(job\.id\)\}\/duplicate`/);
    assert.match(appJs, /fetchJSON\(`\/api\/jobs\/\$\{encodeURIComponent\(job\.id\)\}\/run`/);
    assert.match(appJs, /function cancelJob\(job\)/);
    assert.match(appJs, /fetchJSON\(`\/api\/jobs\/\$\{encodeURIComponent\(job\.id\)\}\/cancel`/);
    assert.match(appJs, /function jobResponseLogText\(output\)/);
    assert.match(appJs, /JOB_RESPONSE_LOG_MAX_LINES = 500/);
    assert.match(appJs, /function scrollJobLogTextToBottom\(pre\)/);
    assert.match(appJs, /pre\.scrollTop = pre\.scrollHeight/);
    assert.match(appJs, /function scrollJobLogTerminalToBottom\(term\)/);
    assert.match(appJs, /jobLogConnection = connectTerminalWs\(term, fitAddon, baseWsUrl, \{\s*afterWrite:/);
    assert.match(styleCss, /--font-mono:/);
    assert.match(jobsCss, /font-family: var\(--font-mono\)/);
    assert.match(appJs, /function setJobLogMode\(mode\)/);
    assert.match(appJs, /job-log-response-btn/);
    assert.match(jobsCss, /#job-log-actions/);
    assert.match(jobsCss, /\.job-log-text/);
    assert.match(electronMainJs, /Notification/);
    assert.match(electronMainJs, /ipcMain\.handle\("show-notification"/);
    assert.match(electronMainJs, /webContents\.send\("notification-click"/);
    assert.match(electronPreloadJs, /electronNotify/);
    assert.match(electronPreloadJs, /electronOnNotificationClick/);
    assert.match(appJs, /const sessionKey = jobLogInfo\.session;/);
    assert.match(appJs, /\/ws\/\$\{encodeURIComponent\(sessionKey\)\}/);
    assert.match(configGo, /Jobs\s+\[\]Job\s+`json:"jobs,omitempty"`/);
    assert.match(configGo, /NextRunAt\s+\*time\.Time\s+`json:"next_run_at,omitempty"`/);
    assert.match(serverGo, /GET \/api\/jobs/);
    assert.match(serverGo, /POST \/api\/jobs/);
    assert.match(serverGo, /POST \/api\/jobs\/schedule\/preview/);
    assert.match(serverGo, /PATCH \/api\/jobs\/\{id\}/);
    assert.match(serverGo, /POST \/api\/jobs\/\{id\}\/duplicate/);
    assert.match(serverGo, /POST \/api\/jobs\/\{id\}\/run/);
    assert.match(serverGo, /POST \/api\/jobs\/\{id\}\/cancel/);
    assert.match(serverGo, /GET \/api\/jobs\/\{id\}\/runs/);
    assert.match(serverGo, /GET \/api\/jobs\/\{id\}\/output/);
});

test('database workbench is wired through menu, settings, api, and file picker', () => {
    const catalogStart = appJs.indexOf('function keymapCommandCatalog');
    const catalogEnd = appJs.indexOf('function currentKeymapCommands', catalogStart);
    const catalogSection = appJs.slice(catalogStart, catalogEnd);
    const paletteStart = appJs.indexOf('function commandPaletteActions');
    const paletteEnd = appJs.indexOf('return decorateCommandActions(actions, state);', paletteStart);
    const paletteSection = appJs.slice(paletteStart, paletteEnd);
    const runQueryStart = appJs.indexOf('async function runDatabaseQuery');
    const runQueryEnd = appJs.indexOf('function rememberDatabaseQuery', runQueryStart);
    const runQuerySection = appJs.slice(runQueryStart, runQueryEnd);
    const saveQueryStart = appJs.indexOf('async function saveActiveDatabaseQuery');
    const saveQueryEnd = appJs.indexOf('function openSavedDatabaseQuery', saveQueryStart);
    const saveQuerySection = appJs.slice(saveQueryStart, saveQueryEnd);
    const appSidebarStart = indexHtml.indexOf('id="sidebar"');
    const appSidebarEnd = indexHtml.indexOf('id="sidebar-collapse-btn"', appSidebarStart);
    const appSidebarSection = indexHtml.slice(appSidebarStart, appSidebarEnd);
    const databaseBodyStart = indexHtml.indexOf('id="database-body"');
    const databaseBodyEnd = indexHtml.indexOf('id="terminal-tabs"', databaseBodyStart);
    const databaseBodySection = indexHtml.slice(databaseBodyStart, databaseBodyEnd);
    const gitPanelStart = indexHtml.indexOf('<div id="git-panel">');
    const gitPanelEnd = indexHtml.indexOf('id="docker-section"', gitPanelStart);
    const gitPanelSection = indexHtml.slice(gitPanelStart, gitPanelEnd);
    const workbenchTabsStart = indexHtml.indexOf('id="database-workbench-tabs"');
    const workbenchTabsEnd = indexHtml.indexOf('id="database-console"', workbenchTabsStart);
    const workbenchTabsSection = indexHtml.slice(workbenchTabsStart, workbenchTabsEnd);
    const settingsDatabaseStart = indexHtml.indexOf('Database Connections');
    const settingsDatabaseEnd = indexHtml.indexOf('</section>', settingsDatabaseStart);
    const settingsDatabaseSection = indexHtml.slice(settingsDatabaseStart, settingsDatabaseEnd);

    assert.match(indexHtml, /id="sidebar-title"/);
    assert.match(indexHtml, /id="project-sidebar-body"/);
    assert.match(indexHtml, /id="database-btn"/);
    assert.match(indexHtml, /id="database-view"/);
    assert.match(indexHtml, /id="database-header-title"/);
    assert.match(indexHtml, /id="database-workbench-tabs"/);
    assert.match(indexHtml, /id="database-result-context-menu"/);
    assert.doesNotMatch(indexHtml, /id="database-connection-select"/);
    assert.match(indexHtml, /id="database-connection-tree"/);
    assert.match(workbenchTabsSection, /id="database-new-query-tab-btn"/);
    assert.match(workbenchTabsSection, /id="database-query-tabs"/);
    assert.match(workbenchTabsSection, /id="database-result-tabs"/);
    assert.match(indexHtml, /id="database-query-input"/);
    assert.match(indexHtml, /id="database-query-editor"/);
    assert.match(indexHtml, /id="database-query-buttons"/);
    assert.match(gitPanelSection, /id="database-inspector"/);
    assert.match(indexHtml, /id="database-run-query-btn"[^>]*aria-label="Run query"[\s\S]*?data-icon="play"/);
    assert.match(indexHtml, /id="database-explain-query-btn"[^>]*aria-label="Explain query"[\s\S]*?data-icon="info"/);
    assert.match(indexHtml, /id="database-pretty-query-btn"/);
    assert.match(indexHtml, /id="database-pretty-query-btn"[^>]*aria-label="Prettify SQL"[\s\S]*?data-icon="sparkles"/);
    assert.match(indexHtml, /id="database-save-query-btn"[^>]*aria-label="Save query"[\s\S]*?data-icon="save"/);
    assert.match(indexHtml, /id="database-export-csv-btn"[^>]*aria-label="Export CSV"[\s\S]*?data-icon="download"/);
    assert.doesNotMatch(indexHtml, /id="database-pretty-query-btn"[\s\S]*?>[\s\S]*?pretty[\s\S]*?<\/button>/);
    assert.match(indexHtml, /id="database-save-query-form"/);
    assert.match(indexHtml, /id="database-save-query-name"/);
    assert.match(indexHtml, /id="database-save-query-confirm"[^>]*aria-label="Save query"[\s\S]*?data-icon="check"/);
    assert.match(indexHtml, /id="settings-database-list"/);
    assert.match(indexHtml, /id="settings-database-file-select-btn"/);
    assert.match(indexHtml, /id="settings-database-password"/);
    assert.match(indexHtml, /id="database-password-modal"/);
    assert.match(indexHtml, /id="database-password-save"/);
    assert.match(appSidebarSection, /id="database-sidebar"/);
    assert.doesNotMatch(databaseBodySection, /id="database-sidebar"/);
    assert.doesNotMatch(databaseBodySection, /id="database-inspector"/);
    assert.match(settingsDatabaseSection, /id="database-discovery"/);
    assert.doesNotMatch(appSidebarSection, /id="database-discovery"/);
    assert.match(styleCss, /#database-body/);
    assert.match(styleCss, /#database-header-title/);
    assert.match(styleCss, /#database-workbench-tabs/);
    assert.match(styleCss, /#git-panel\.database-mode > :not\(#database-inspector\)/);
    assert.match(styleCss, /#project-sidebar-body/);
    assert.match(styleCss, /\.database-table-filter/);
    assert.match(styleCss, /\.database-binary-column/);
    assert.match(styleCss, /#database-table-count-btn/);
    assert.match(styleCss, /#database-table-query-btn/);
    assert.match(styleCss, /#database-cancel-query-btn/);
    assert.match(styleCss, /\.database-result-summary/);
    assert.match(styleCss, /\.database-context-separator/);
    assert.match(styleCss, /\.database-column-toggle/);
    assert.match(styleCss, /\.database-sortable-column/);
    assert.match(styleCss, /#database-query-status/);
    assert.match(styleCss, /\.database-query-spinner/);
    assert.match(styleCss, /#database-save-query-form/);
    assert.match(styleCss, /\.database-tree-connection/);
    assert.match(styleCss, /\.database-tree-database-toggle/);
    assert.match(styleCss, /\.database-tree-database-group \.database-tree-table-list/);
    assert.match(styleCss, /\.database-tree-table-row/);
    assert.match(styleCss, /#database-workbench\s*\{[\s\S]*?flex: 1 1 auto/);
    assert.match(styleCss, /#settings-database-list/);
    assert.match(styleCss, /#settings-modal-body input\[type="password"\]/);
    assert.match(styleCss, /#database-password-content/);
    assert.match(appJs, /function showDatabase/);
    assert.match(appJs, /function updateSidebarMode/);
    assert.match(appJs, /gitPanel\.classList\.toggle\('database-mode', databaseActive\)/);
    assert.match(appJs, /function renderDatabaseActivePane/);
    assert.match(appJs, /classList\.toggle\('database-query-empty', queryEmpty\)/);
    assert.match(appJs, /resultsEl\.style\.display = queryEmpty \? 'none' : 'flex'/);
    assert.match(appJs, /function activateDatabaseQueryTab/);
    assert.match(appJs, /function startDatabaseQueryProgress/);
    assert.match(appJs, /function stopDatabaseQueryProgress/);
    assert.match(appJs, /function cancelDatabaseQuery/);
    assert.match(appJs, /databaseQueryAbortController\.abort\(\)/);
    assert.match(appJs, /signal: progress\?\.signal/);
    assert.match(appJs, /id="database-query-status"/);
    assert.match(appJs, /id="database-cancel-query-btn"/);
    assert.match(appJs, /function formatDatabaseQueryElapsed/);
assert.match(appJs, /function prettifyActiveDatabaseQuery\(\)/);
assert.match(appJs, /function databaseFormatterLanguage\(conn\)/);
assert.match(appJs, /SQL_FORMATTER_LOCAL_SRC = '\/vendor\/sql-formatter\/sql-formatter\.min\.js'/);
assert.doesNotMatch(appJs, /SQL_FORMATTER_CDN_SRC/);
assert.doesNotMatch(appJs, /https:\/\/cdn\.jsdelivr\.net\/npm\/sql-formatter/);
assert.match(appJs, /function loadSQLFormatterScript\(src\)/);
assert.match(appJs, /async function resolveSQLFormatter\(\)/);
assert.match(appJs, /loadSQLFormatterScript\(SQL_FORMATTER_LOCAL_SRC\)[\s\S]*?const formatter = window\.sqlFormatter/);
assert.match(appJs, /const formatter = await resolveSQLFormatter\(\)/);
assert.match(appJs, /formatter\.format\(sql, \{/);
assert.match(appJs, /keywordCase: 'upper'/);
    assert.match(appJs, /document\.getElementById\('database-pretty-query-btn'\)\.onclick = prettifyActiveDatabaseQuery/);
    assert.match(appJs, /document\.getElementById\('database-pretty-query-btn'\)\?\.toggleAttribute\('disabled', disabled\)/);
    assert.match(electronPreloadJs, /contextBridge\.exposeInMainWorld\("sqlFormatter"/);
    assert.match(electronPreloadJs, /ipcRenderer\.invoke\("sql-format"/);
    assert.doesNotMatch(electronPreloadJs, /require\("sql-formatter"\)/);
    assert.match(electronMainJs, /function formatSQL\(sql, options\)/);
    assert.match(electronMainJs, /require\("sql-formatter"\)/);
    assert.match(electronMainJs, /ipcMain\.handle\("sql-format"/);
    assert.match(electronPackageJson, /"sql-formatter": "15\.8\.1"/);
    assert.match(electronPackageJson, /"node_modules\/sql-formatter\/\*\*"/);
    assert.match(electronPackageJson, /"monaco-editor": "0\.50\.0"/);
    assert.match(electronPackageJson, /"node_modules\/monaco-editor\/min\/\*\*"/);
 assert.match(indexHtml, /src="\/vendor\/monaco-editor\/min\/vs\/loader\.js"/);
    assert.match(appJs, /function initDatabaseQueryEditor/);
 assert.match(appJs, /require\.config\(\{ paths: \{ vs: '\/vendor\/monaco-editor\/min\/vs' \} \}\)/);
    assert.match(appJs, /monaco\.editor\.createModel\(tab\?\.sql \|\| input\.value \|\| 'select 1;', 'sql'\)/);
    assert.match(appJs, /fixedOverflowWidgets: true/);
    assert.match(appJs, /databaseQueryEditor\.addCommand\(monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.Enter/);
    assert.match(appJs, /monaco\.languages\.registerCompletionItemProvider\('sql'/);
    assert.match(appJs, /function databaseSQLCompletionItems\(model, position\)/);
    assert.match(appJs, /function databaseSQLCompletionContext\(model, position\)/);
    assert.match(appJs, /const refs = databaseSQLStatementTableRefs\(context\.fullStatement \|\| context\.statement, tables\)/);
    assert.match(appJs, /function databaseSQLCurrentStatementAtPosition\(model, position, fallback = ''\)/);
    assert.match(appJs, /area: qualifier \? 'qualified' : databaseSQLCompletionArea\(statement\)/);
    assert.match(appJs, /function databaseSQLCursorInQuotedText\(text, offset = null\)/);
    assert.match(appJs, /if \(context\.insideQuotedText\) return \[\]/);
    assert.match(appJs, /host\.addEventListener\('keydown', ev => \{\s*consumeDatabaseAutocompleteEscape\(ev\);\s*\}, true\)/);
    assert.match(appJs, /function databaseQueryAutocompleteOpen\(\)/);
    assert.match(appJs, /function consumeDatabaseAutocompleteEscape\(ev\)/);
    assert.match(appJs, /editor\.trigger\('keyboard', 'hideSuggestWidget', \{\}\)/);
    assert.match(appJs, /function databaseSQLStatementTableRefs\(statement, tables\)/);
    assert.match(appJs, /function databaseSQLQualifiedCompletionItems\(qualifier, tables, refs, range, kind\)/);
    assert.match(appJs, /function databaseSQLKeywordCompletionRange\(model, position, keyword, fallbackRange\)/);
    assert.match(appJs, /databaseSQLKeywordCompletionItems\(range, kind, DATABASE_WHERE_COMPLETION_KEYWORDS, '1', \{ model, position \}\)/);
    assert.match(appJs, /tailMatch = prefix\.match\(\/\(\?:\[A-Za-z_\]\[\\w\$\]\*\\s\*\)\+\$\/\)/);
    assert.match(appJs, /if \(refs\.length === 0\) databaseSQLAllColumnCompletionItems\(tables, range, kind, '1'\)\.forEach\(push\)/);
    assert.match(appJs, /if \(refs\.length === 0\) databaseSQLAllColumnCompletionItems\(tables, range, kind, '3'\)\.forEach\(push\)/);
assert.match(appJs, /function databaseSQLAllColumnCompletionItems\(tables, range, kind, sortPrefix, options = \{\}\)/);
assert.match(appJs, /if \(items\.length >= maxItems\) return items/);
assert.match(appJs, /const tab = activeDatabaseQueryTab\(\);\s*const tables = databaseSchemaCompletionTables\(tab\?\.connectionID \|\| selectedDatabaseID\)/);
assert.match(appJs, /function databaseSchemaCompletionTables\(connectionID = selectedDatabaseID\)/);
assert.match(appJs, /const cache = databaseSchemaCacheForConnection\(id\)/);
assert.match(styleCss, /#database-query-editor\.active/);
    assert.match(styleCss, /#database-query-editor \.monaco-editor \.suggest-widget/);
    assert.match(styleCss, /z-index: 10000 !important/);
    assert.match(appJs, /consoleEl\.style\.display = queryActive && queryTab \? 'flex' : 'none'/);
    assert.match(runQuerySection, /tab\.result = result/);
    assert.doesNotMatch(runQuerySection, /addDatabaseResultTab/);
    assert.match(appJs, /function scanDatabaseDiscovery/);
    assert.match(appJs, /function renderSettingsDatabases/);
    assert.match(appJs, /async function createDatabaseConnection/);
    assert.match(appJs, /async function updateDatabaseConnection/);
    assert.match(appJs, /async function deleteDatabaseConnection/);
assert.match(appJs, /async function withDatabasePasswordRetry/);
assert.match(appJs, /function requestDatabasePassword/);
assert.match(appJs, /databasePasswordPrompt\.connectionID === connectionID/);
assert.match(appJs, /async function addOrUpdateSettingsDatabase/);
    assert.match(appJs, /DATABASE_SELECTED_CONNECTION_KEY/);
    assert.match(appJs, /DATABASE_ACTIVE_VIEW_KEY/);
    assert.match(appJs, /let expandedDatabaseConnectionID = ''/);
    assert.match(appJs, /let databaseConnectionTreeTouched = false/);
    assert.match(appJs, /function loadStoredDatabaseState/);
    assert.match(appJs, /function persistSelectedDatabaseConnection/);
    assert.match(appJs, /function shouldRestoreDatabaseView/);
    assert.match(appJs, /function databaseConnectionDatabaseName/);
    assert.match(appJs, /function databaseHeaderTitle/);
    assert.match(appJs, /function renderDatabaseHeaderTitle/);
    assert.match(appJs, /\['Database', \.\.\.details\]\.join\(' - '\)/);
    assert.match(appJs, /await updateDatabaseConnection\(conn\.id, conn\)/);
    assert.match(appJs, /await createDatabaseConnection\(savedConn\)/);
    // Connections save through their own API, so settings autosave ignores them.
    assert.doesNotMatch(appJs.slice(appJs.indexOf('function currentSettingsSnapshot'), appJs.indexOf('function settingsModalIsOpen')), /databases:/);
    assert.match(appJs, /function closeDatabaseQueryTab/);
    assert.match(appJs, /let databaseQueryTabsLoaded = false/);
    assert.match(appJs, /function defaultDatabaseQueryTab/);
    assert.match(appJs, /if \(databaseQueryTabs\.length === 0\) databaseQueryTabs = \[defaultDatabaseQueryTab\(\)\]/);
    assert.match(appJs.slice(appJs.indexOf('function closeDatabaseQueryTab'), appJs.indexOf('function updateActiveDatabaseQuerySQL')), /databaseQueryTabs\.push\(defaultDatabaseQueryTab\(\)\)/);
    assert.match(appJs, /let databaseSchemaCacheByConnection = \{\}/);
    assert.match(appJs, /let databaseSchemaRequestSeqByConnection = \{\}/);
    assert.match(appJs, /let databaseConnectedByConnection = \{\}/);
    assert.match(appJs, /function databaseSchemaCacheForConnection\(connectionID = selectedDatabaseID\)/);
    assert.match(appJs, /const requestSeq = \(databaseSchemaRequestSeqByConnection\[id\] \|\| 0\) \+ 1/);
    assert.match(appJs, /databaseSchemaRequestSeqByConnection\[id\] !== requestSeq/);
    assert.match(appJs, /function closeDatabaseResultTab/);
    assert.match(appJs, /function duplicateDatabaseResultTab/);
    assert.match(appJs, /function showDatabaseResultContextMenu/);
    assert.match(appJs, /function showDatabaseColumnContextMenu/);
    assert.match(appJs, /function setDatabaseColumnConversion/);
    assert.match(appJs, /function databaseColumnConversionMode/);
    assert.match(appJs, /function databaseVisibleColumnEntries/);
    assert.match(appJs, /function setDatabaseColumnVisibility/);
    assert.match(appJs, /function setDatabaseAllColumnsVisibility/);
    assert.match(appJs, /function bindDatabaseInspectorVisibility/);
    assert.match(appJs, /function databaseCellConversionMode/);
    assert.match(appJs, /function orderedUUIDString/);
    assert.match(appJs, /function cycleDatabaseTableOrdering/);
    assert.match(appJs, /function databaseDisplayColumnTypes/);
    assert.match(appJs, /function isDatabaseTinyIntColumn/);
    assert.match(appJs, /function formatDatabaseTinyIntBoolean/);
    assert.match(appJs, /tinyint\\s\*\\\(\\s\*1\\s\*\\\)/);
    assert.match(appJs, /UUID string \(ordered time\)/);
    assert.match(appJs, /columnConversions/);
    assert.match(appJs, /const mode = databaseCellConversionMode\(tab, value, column\.type, column\.index\)/);
    assert.match(appJs, /return csvEscape\(value, column\.type, mode\)/);
    assert.match(appJs, /function csvEscape\(value, column = null, mode = ''\)/);
    assert.match(appJs, /formatDatabaseCell\(value, column, mode\)/);
    assert.match(appJs, /hiddenColumns/);
    assert.match(appJs, /Hide column/);
    assert.match(appJs, /id="database-column-visibility-all"/);
    assert.match(appJs, /data-db-inspector-column/);
    assert.match(appJs, /function applyDatabaseTableWhere/);
    assert.match(appJs, /function countDatabaseTableRows\(tabID, where\)/);
    assert.match(appJs, /function databaseTableCountURL\(connectionID, table, where = ''\)/);
    assert.match(appJs, /function clearDatabaseTableCountStatus\(tabID = ''\)/);
    assert.match(appJs, /databaseTableCountStatus = \{/);
    assert.match(appJs, /function createDatabaseQueryFromTableView/);
    assert.match(appJs, /function setDatabaseTableOrdering/);
    assert.match(appJs, /id="database-table-filter-input"/);
    assert.match(appJs, /id="database-table-count-btn"/);
    assert.match(appJs, /id="database-table-query-btn"/);
    assert.match(appJs, /id="database-table-count-btn"[\s\S]*?iconHTML\('hash'\)[\s\S]*?id="database-table-query-btn"[\s\S]*?iconHTML\('plus'\)[\s\S]*?id="database-table-filter-clear"/);
    assert.match(appJs, /countBtn\.onclick = \(\) => \{[\s\S]*?if \(databaseWhereEditor\) input\.value = databaseWhereEditor\.getValue\(\);[\s\S]*?countDatabaseTableRows\(tab\.id, input\.value\);[\s\S]*?\}/);
    assert.match(appJs, /addDatabaseQueryTab\(sql\.endsWith\('\;'\)/);
    assert.match(appJs, /connectionID: tab\.connectionID \|\| String\(tab\.tableKey \|\| ''\)\.split\('\\u001f'\)\[0\] \|\| selectedDatabaseID \|\| ''/);
    assert.match(appJs, /whereDraft: String\(options\.where \|\| ''\)/);
    assert.match(appJs, /function databaseTableFilterValue\(tab\)/);
    assert.match(appJs, /function databaseSQLHighlightHTML\(sql\)/);
    assert.match(appJs, /function renderDatabaseTableFilterHighlight\(input\)/);
    assert.match(appJs, /id="database-table-filter-monaco"/);
    assert.match(appJs, /let databaseWhereEditor = null/);
    assert.match(appJs, /let databaseWhereCompletionModels = new WeakMap\(\)/);
    assert.match(appJs, /function databaseWhereMonacoCompletionItems\(model, position, tab, range, kind\)/);
    assert.match(appJs, /databaseWhereCompletionModels\.get\(model\)/);
    assert.match(appJs, /function initDatabaseWhereEditor\(tab, input, state = null\)/);
    assert.match(appJs, /databaseWhereEditor = monaco\.editor\.create\(host, \{/);
    assert.match(appJs, /databaseWhereCompletionModels\.set\(model, tab\)/);
    assert.match(appJs, /suggest: \{ selectionMode: 'always' \}/);
    assert.match(appJs, /acceptSuggestionOnEnter: 'on'/);
    assert.match(appJs, /if \(ev\.keyCode !== monaco\.KeyCode\.Enter\) return;\s*if \(databaseWhereAutocompleteOpen\(\)\) return;\s*ev\.preventDefault\(\);/);
    assert.match(appJs, /function disposeDatabaseWhereEditor\(\)/);
    assert.match(appJs, /function databaseWhereAutocompleteOpen\(\)/);
    assert.match(appJs, /databaseWhereAutocompleteOpen\(\)[\s\S]*\? databaseWhereEditor/);
    assert.match(appJs, /if \(consumeDatabaseAutocompleteEscape\(ev\)\) return;[\s\S]*?if \(databaseActive\) \{\s*hideDatabase\(\);/);
    assert.match(styleCss, /\.sql-token-keyword/);
    assert.match(styleCss, /#database-table-filter-monaco/);
    assert.match(styleCss, /\.database-sql-filter-editor\.monaco-active input/);
    assert.match(styleCss, /#database-table-filter-monaco \.monaco-editor \.suggest-widget/);
    assert.match(appJs, /input\.value = databaseTableFilterValue\(tab\)/);
    assert.match(appJs, /input\.oninput = \(\) => \{\s*tab\.whereDraft = input\.value;\s*clearDatabaseTableCountStatus\(tab\.id\);\s*renderDatabaseTableFilterHighlight\(input\);\s*\}/);
    assert.doesNotMatch(appJs, /input\.value = tab\.where \|\| ''/);
    assert.doesNotMatch(appJs, /value="\$\{esc\(tab\.where/);
    assert.match(appJs, /params\.set\('where', condition\)/);
    assert.match(appJs, /params\.set\('order_column', orderColumn\)/);
    assert.match(appJs, /params\.set\('order_dir', dir\)/);
    assert.match(appJs, /data-db-column-index/);
    assert.match(appJs, /databaseTableTabKey\(conn\.id, table\)/);
    assert.match(appJs, /databaseResultTabs\.find\(tab => tab\.kind === 'table' && tab\.tableKey === tableKey\)/);
    assert.doesNotMatch(appJs, /data-db-binary/);
    assert.doesNotMatch(appJs, /function showDatabaseCellContextMenu/);
    assert.match(appJs, /fetchJSON\('\/api\/databases', \{/);
    assert.match(appJs, /fetchJSON\(`\/api\/databases\/\$\{encodeURIComponent\(id\)\}`, \{/);
    assert.match(appJs, /password: document\.getElementById\('settings-database-password'\)\.value/);
    assert.match(indexHtml, /id="database-save-query-btn"/);
    assert.match(styleCss, /\.database-saved-query-row/);
    assert.match(appJs, /function normalizeDatabaseSavedQueries/);
    assert.match(appJs, /saved_queries: normalizeDatabaseSavedQueries/);
    assert.match(appJs, /let databaseOrphanedQueries = \[\]/);
    assert.match(appJs, /function selectDatabaseConnection/);
    assert.match(appJs, /function activeDatabaseQueryConnection/);
    assert.match(appJs, /function rebindActiveDatabaseQueryTabConnection/);
    assert.match(appJs, /if \(changed\) rebindActiveDatabaseQueryTabConnection\(selectedDatabaseID\)/);
    assert.match(appJs, /tab\.connectionID = nextID/);
    assert.match(appJs, /tab\.savedQueryID = ''/);
    assert.match(appJs, /function syncDatabaseConnectionTreeExpansion/);
    assert.match(appJs, /function toggleDatabaseConnectionTree/);
    assert.match(appJs, /if \(expandedDatabaseConnectionID === nextID\) \{\s*expandedDatabaseConnectionID = '';\s*renderDatabaseConnectionTree\(\);\s*return;\s*\}/);
    assert.match(appJs, /button\.onclick = \(\) => toggleDatabaseConnectionTree\(conn\.id\)/);
assert.match(appJs, /databaseTreeActionButton\('rotate-cw', 'Refresh connection schema', \(\) => loadDatabaseSchema\(conn\.id, \{ force: true \}\)\)/);
assert.match(appJs, /databaseTreeActionButton\('play', 'Connect database', \(\) => loadDatabaseSchema\(conn\.id, \{ force: true \}\)\)/);
assert.match(appJs, /databaseTreeActionButton\('power', 'Disconnect database', \(\) => disconnectDatabaseConnection\(conn\.id\)\)/);
const schemaLoadSection = appJs.slice(appJs.indexOf('async function loadDatabaseSchema'), appJs.indexOf('async function refreshDatabaseSchemaGroup'));
assert.match(schemaLoadSection, /if \(hadCache\) \{[\s\S]*?clearDatabaseSchemaCache\(id\);[\s\S]*?setDatabaseSchemaError\(id, message\);/);
const disconnectSection = appJs.slice(appJs.indexOf('async function disconnectDatabaseConnection'), appJs.indexOf('function renderDatabaseSchema'));
assert.doesNotMatch(disconnectSection, /clearDatabaseSchemaCache/);
    assert.match(appJs, /const expanded = conn\.id === expandedDatabaseConnectionID/);
    assert.match(appJs, /iconHTML\(expanded \? 'chevron-down' : 'chevron-right'\)/);
assert.match(appJs, /let collapsedDatabaseTreeSections = \{\}/);
assert.match(appJs, /const DATABASE_CONNECTION_STATUS_TTL_MS = 5 \* 60 \* 1000/);
assert.match(appJs, /let databaseConnectedAtByConnection = \{\}/);
assert.match(appJs, /let databaseConnectedExpiryTimers = \{\}/);
assert.match(appJs, /function applyDatabaseConnectionStatuses\(value\)/);
assert.match(appJs, /setTimeout\(\(\) => \{[\s\S]*?renderDatabaseConnectionTree\(\);[\s\S]*?\}, DATABASE_CONNECTION_STATUS_TTL_MS\)/);
assert.match(appJs, /if \(connectedAt && Date\.now\(\) - connectedAt >= DATABASE_CONNECTION_STATUS_TTL_MS\)/);
assert.match(appJs, /applyDatabaseConnectionStatuses\(data && data\.connected\)/);
assert.match(appJs, /function toggleDatabaseTreeSection\(key, defaultCollapsed = false\)/);
    assert.match(appJs, /function appendDatabaseTreeSectionToggle\(section, title, sectionKey, collapsed, defaultCollapsed = false\)/);
    assert.match(appJs, /databaseTreeSectionKey\(conn\.id, 'tables'\)/);
    assert.match(appJs, /appendDatabaseTreeSectionToggle\(section, 'Databases', sectionKey, collapsed\)/);
    assert.match(appJs, /function appendDatabaseTreeDatabaseGroup\(container, conn, schema\)/);
    assert.match(appJs, /databaseTreeSectionKey\(conn\.id, `database:\$\{schema\.name\}`\)/);
    assert.match(appJs, /databaseTreeSectionCollapsed\(key, true\)/);
    assert.match(appJs, /refreshDatabaseSchemaGroup\(conn\.id, schema\.name \|\| 'main'\)/);
    assert.match(appJs, /function appendDatabaseTreeTableRow\(container, conn, table\)/);
    assert.match(appJs, /refreshDatabaseTableSchema\(conn\.id, table\)/);
    assert.match(appJs, /sectionKey: databaseTreeSectionKey\(conn\.id, 'saved-queries'\)/);
    assert.match(styleCss, /\.database-tree-section-toggle/);
    assert.match(styleCss, /\.database-tree-action/);
    assert.match(appJs, /if \(selectedDatabaseID && options\.loadIfMissing && !hasSelectedSchema\) loadDatabaseSchema\(selectedDatabaseID, \{ force: false \}\)/);
    assert.doesNotMatch(appJs, /loadDatabaseConnections\(\)\.then\(\(\) => \{\s*if \(selectedDatabaseID\) loadDatabaseSchema\(\);/);
    assert.match(appJs, /function renderDatabaseConnectionTree/);
    assert.match(appJs, /databaseOrphanedQueries = normalizeDatabaseSavedQueries\(data && data\.orphaned_queries\)/);
    assert.match(appJs, /function applyDatabaseState\(data\)/);
    assert.match(appJs, /function renderDatabaseSavedQueries/);
    assert.match(appJs, /function saveActiveDatabaseQuery/);
    assert.match(appJs, /function openDatabaseSaveQueryForm/);
    assert.match(appJs, /function confirmDatabaseSaveQuery/);
    assert.match(appJs, /function saveActiveDatabaseQueryWithName/);
    assert.match(appJs, /function openSavedDatabaseQuery/);
    assert.match(appJs, /function deleteSavedDatabaseQuery/);
    assert.match(appJs, /function openOrphanedDatabaseQuery/);
    assert.match(appJs, /connectionID: query\.connection_id \|\| ''/);
    assert.match(appJs, /function deleteOrphanedDatabaseQuery/);
    assert.match(appJs, /Orphaned Queries/);
    assert.match(appJs, /appendDatabaseTableTreeSection\(children, conn\)/);
    assert.match(databaseGo, /func loadMySQLSchema\(ctx context\.Context, db \*sql\.DB\)/);
    assert.match(databaseGo, /WHERE table_schema NOT IN \('information_schema', 'mysql', 'performance_schema', 'sys'\)/);
    assert.doesNotMatch(databaseGo, /func mysqlTables\(ctx context\.Context, db \*sql\.DB, database string\)/);
    assert.match(appJs, /async function deleteDatabaseOrphanedQuery\(queryID\)/);
    assert.match(appJs, /\/api\/databases\/orphaned-queries\/\$\{encodeURIComponent\(queryID\)\}/);
    assert.match(appJs, /document\.getElementById\('database-save-query-btn'\)\.onclick = saveActiveDatabaseQuery/);
    assert.match(appJs, /document\.getElementById\('database-save-query-form'\)\.onsubmit = confirmDatabaseSaveQuery/);
    assert.doesNotMatch(saveQuerySection, /prompt\(/);
    assert.match(saveQuerySection, /const conn = activeDatabaseQueryConnection\(tab\)/);
    assert.doesNotMatch(saveQuerySection, /databaseConnectionByID\(selectedDatabaseID\)/);
    assert.match(appJs, /tab\.savedQueryID = savedQuery\.id/);
    assert.match(appJs, /addDatabaseQueryTab\(query\.sql, \{\s*title: query\.name,\s*savedQueryID: query\.id,\s*connectionID: conn\.id,/);
    assert.match(runQuerySection, /const conn = activeDatabaseQueryConnection\(tab\)/);
    assert.doesNotMatch(runQuerySection, /databaseConnectionByID\(selectedDatabaseID\)/);
    assert.match(styleCss, /\.database-tab-close/);
    assert.doesNotMatch(styleCss, /\.database-tab-duplicate/);
    assert.match(catalogSection, /app\.openDatabase/);
    assert.match(paletteSection, /Open database workbench/);
    assert.match(configGo, /DatabaseConnections\s+\[\]DatabaseConnection\s+`json:"database_connections,omitempty"`/);
    assert.match(configGo, /DatabaseOrphanedQueries\s+\[\]DatabaseSavedQuery\s+`json:"database_orphaned_queries,omitempty"`/);
    assert.match(configGo, /SavedQueries\s+\[\]DatabaseSavedQuery\s+`json:"saved_queries,omitempty"`/);
    assert.match(configGo, /ConnectionName\s+string\s+`json:"connection_name,omitempty"`/);
    assert.match(configGo, /type DatabaseSavedQuery struct/);
    assert.match(appJs, /database\.placeholder = driver === 'mysql' \? 'optional; all visible databases are listed' : 'app'/);
    assert.match(appJs, /conn\.driver === 'postgres' && !conn\.database/);
    assert.match(apiGo, /databaseStore\s+\*databaseStore/);
    assert.match(apiGo, /databaseConnections\s+\[\]config\.DatabaseConnection/);
    assert.match(apiGo, /configWithoutDatabaseState/);
    assert.match(serverGo, /GET \/api\/databases/);
    assert.match(serverGo, /POST \/api\/databases/);
    assert.match(serverGo, /PATCH \/api\/databases\/\{id\}/);
    assert.match(serverGo, /DELETE \/api\/databases\/\{id\}/);
    assert.match(serverGo, /POST \/api\/databases\/discover/);
    assert.match(serverGo, /POST \/api\/databases\/test/);
    assert.match(serverGo, /POST \/api\/databases\/\{id\}\/password/);
    assert.match(serverGo, /POST \/api\/databases\/\{id\}\/saved-queries/);
    assert.match(serverGo, /PATCH \/api\/databases\/\{id\}\/saved-queries\/\{query_id\}/);
    assert.match(serverGo, /DELETE \/api\/databases\/orphaned-queries\/\{query_id\}/);
    assert.match(serverGo, /GET \/api\/databases\/\{id\}\/schema/);
    assert.match(serverGo, /GET \/api\/databases\/\{id\}\/schemas\/\{schema\}/);
    assert.match(serverGo, /GET \/api\/databases\/\{id\}\/schemas\/\{schema\}\/tables\/\{table\}/);
    assert.match(serverGo, /POST \/api\/databases\/\{id\}\/disconnect/);
    assert.match(serverGo, /GET \/api\/databases\/\{id\}\/tables\/\{schema\}\/\{table\}/);
    assert.match(serverGo, /POST \/api\/databases\/\{id\}\/query/);
    assert.match(databaseGo, /databaseIdleTimeout = 5 \* time\.Minute/);
    assert.match(databaseGo, /func \(a \*apiHandler\) pooledDatabase/);
    assert.match(databaseGo, /func \(a \*apiHandler\) runDatabaseIdleCloser/);
    assert.match(databaseGo, /func \(a \*apiHandler\) handleDatabaseDisconnect/);
    assert.match(databaseGo, /func loadDatabaseSchemaGroup/);
    assert.match(databaseGo, /func loadDatabaseTableSchema/);
    assert.match(databaseGo, /driver == dbDriverPostgres && strings\.TrimSpace\(conn\.Database\) == ""/);
    assert.match(databaseGo, /conn\.Host != "" && \(driver == dbDriverMySQL \|\| conn\.Database != ""\)/);
    assert.match(databaseGo, /cfg\.DBName = strings\.TrimSpace\(conn\.Database\)/);
    assert.match(electronMainJs, /ipcMain\.handle\("select-file"/);
    assert.match(electronPreloadJs, /electronSelectFile/);
});

test('app uses toasts instead of blocking alerts', () => {
    assert.doesNotMatch(appJs, /\balert\s*\(/);
    assert.doesNotMatch(appJs, /\balert\b,/);
    assert.match(appJs, /showToast\('Commit failed'/);
    assert.match(appJs, /showToast\('External link failed'/);
});

test('confirmations use an in-app dialog instead of native modals', () => {
    const dialogStart = appJs.indexOf('function restoreFocusAfterDialog');
    const dialogEnd = appJs.indexOf('function stopTerminalSession', dialogStart);
    const dialogSection = appJs.slice(dialogStart, dialogEnd);

    assert.match(styleCss, /#toast-region\s*\{[\s\S]*pointer-events:\s*none;/);
    assert.match(indexHtml, /id="app-dialog-modal"/);
    assert.match(indexHtml, /id="app-dialog-input"/);
    assert.match(indexHtml, /id="app-dialog-confirm"/);
    assert.match(styleCss, /#app-dialog-message\s*\{[\s\S]*white-space:\s*pre-line;/);
    assert.match(appJs, /function appConfirm\(message\)/);
    assert.match(appJs, /function appPrompt\(message, defaultValue\)/);
    assert.match(appJs, /function restoreFocusAfterDialog\(previousActive\)/);
    assert.match(dialogSection, /restoreFocusAfterDialog\(pending\.previousActive\)/);
    assert.match(dialogSection, /window\.setTimeout\(\(\) => \{\s*if \(appDialog\) return;/);
    assert.match(dialogSection, /ev\.stopPropagation\(\);\s*\/\/[^\n]*\n\s*if \(ev\.isComposing \|\| ev\.keyCode === 229\) return;\s*ev\.preventDefault\(\);/);
    assert.match(dialogSection, /if \(ev\.key === 'Escape'\) cancelAppDialog\(\);/);
    assert.match(dialogSection, /else acceptAppDialog\(\);/);
    assert.match(appJs, /shortcutBlockingModalIDs = \[[\s\S]*?'app-dialog-modal',/);
    assert.doesNotMatch(appJs, /\bprompt\s*\(/);
    assert.doesNotMatch(appJs, /\bconfirm\s*\(/);
    assert.doesNotMatch(appJs, /electronRestoreWindowFocus/);
    assert.doesNotMatch(electronPreloadJs, /restore-window-focus/);
    assert.doesNotMatch(electronMainJs, /restore-window-focus/);
    assert.doesNotMatch(electronMainJs, /mainWindow\.blur\(\)/);
});

test('text input requests use an in-app modal because Electron has no window.prompt', () => {
    assert.doesNotMatch(appJs, /\bprompt\s*\(/);

    assert.match(indexHtml, /id="text-prompt-modal"/);
    assert.match(indexHtml, /id="text-prompt-title"/);
    assert.match(indexHtml, /id="text-prompt-subtitle"/);
    assert.match(indexHtml, /id="text-prompt-input"/);
    assert.match(indexHtml, /id="text-prompt-cancel"/);
    assert.match(indexHtml, /id="text-prompt-submit"/);
    assert.match(styleCss, /#text-prompt-modal,/);
    assert.match(styleCss, /#text-prompt-input:focus\s*\{/);

    assert.match(appJs, /function requestTextInput\(\{ title, subtitle = '', defaultValue = '', submitLabel = 'OK' \}\)/);
    assert.match(appJs, /textInputRequest = \{ resolve, previousActive \}/);
    assert.match(appJs, /function settleTextInputRequest\(value\)/);
    assert.match(appJs, /restoreFocusAfterDialog\(request\.previousActive\)/);
    assert.match(appJs, /initTextPrompt\(\);/);
    assert.match(appJs, /'text-prompt-modal',/);

    const escapeStart = appJs.indexOf('if (handleKeymapCaptureKeydown(ev)) return;');
    const escapeSection = appJs.slice(escapeStart, escapeStart + 1200);
    assert.match(escapeSection, /if \(textInputRequest\) \{\s*cancelTextInputRequest\(\);/);

    const initStart = appJs.indexOf('function initTextPrompt()');
    const initSection = appJs.slice(initStart, appJs.indexOf('function initCommandPalette()', initStart));
    assert.match(initSection, /text-prompt-backdrop'\)\.onclick = cancelTextInputRequest/);
    assert.match(initSection, /text-prompt-submit'\)\.onclick = submitTextInputRequest/);
    assert.match(initSection, /ev\.key === 'Enter'/);
});

test('every text prompt call site awaits the modal', () => {
    const callers = [
        'async function promptCreateWorktree',
        'async function promptOpenWorktree',
        'async function promptRemoveWorktree',
        'async function editorNewFile',
        'async function editorRenameFile',
    ];
    callers.forEach(signature => {
        const start = appJs.indexOf(signature);
        assert.notEqual(start, -1, `${signature} must stay async`);
        assert.match(appJs.slice(start, start + 900), /await requestTextInput\(\{/);
    });
});

test('terminal pane installs a context menu handler', () => {
    assert.match(indexHtml, /id="terminal-context-menu"/);
    assert.match(appJs, /paneBody\.addEventListener\('contextmenu', \(ev\) => showTerminalContextMenu\(ev, term\)\)/);
    assert.match(appJs, /getTerminalContextMenuItems/);
});

test('docker controls use repository-owned compose stacks', () => {
    assert.match(indexHtml, /id="docker-compose-name"/);
    assert.match(appJs, /docker_compose_file/);
    assert.match(appJs, /async function startDockerStack/);
    assert.match(appJs, /async function stopDockerStack/);
    assert.doesNotMatch(indexHtml, /Docker Overrides|settings-docker-service/);
    assert.doesNotMatch(appJs, /docker_services|settingsDockerServices/);
    assert.doesNotMatch(configGo, /DockerServices|docker_services/);
    assert.doesNotMatch(apiGo, /DockerServices|docker_services/);
});

test('the shell command runner and saved commands are gone', () => {
    assert.doesNotMatch(indexHtml, /terminal-command-modal|id="cmd-|settings-favorites-list/);
    assert.doesNotMatch(appJs, /executeTerminalCommand|favoriteCommands|favorite_commands|\/exec`/);
    assert.doesNotMatch(serverGo, /POST \/exec/);
    assert.doesNotMatch(configGo, /FavoriteCommand/);
});

test('github today activity is compact and refreshes periodically', () => {
    const dockerIndex = indexHtml.indexOf('id="docker-section"');
    const activityIndex = indexHtml.indexOf('id="github-activity-section"');
    const gitHeaderIndex = indexHtml.indexOf('id="git-panel-header"');
    const activitySection = indexHtml.slice(activityIndex, gitHeaderIndex);

    assert.ok(dockerIndex !== -1 && activityIndex !== -1 && gitHeaderIndex !== -1);
    assert.ok(dockerIndex < activityIndex);
    assert.ok(activityIndex < gitHeaderIndex);
    assert.doesNotMatch(activitySection, /GitHub Today|github-activity-header/);
    assert.match(activitySection, /id="github-activity-refresh"/);
    assert.match(styleCss, /#github-activity-section/);
    assert.match(styleCss, /#github-activity-refresh/);
    assert.match(appJs, /async function loadGitHubActivityToday/);
    assert.match(appJs, /fetchJSON\('\/api\/github\/activity\/today'\)/);
    assert.match(appJs, /function syncGitHubActivityVisibility/);
    assert.match(appJs, /showGitHubActivity = Boolean\(cfg && cfg\.show_github_activity\)/);
    assert.match(appJs, /show_github_activity: showGitHubActivitySetting/);
    assert.match(appJs, /setInterval\(loadGitHubActivityToday, 60000\)/);
    assert.match(indexHtml, /id="settings-github-activity"/);
    assert.match(configGo, /ShowGitHubActivity\s+bool\s+`json:"show_github_activity,omitempty"`/);
    assert.match(apiGo, /ShowGitHubActivity\s+\*bool\s+`json:"show_github_activity"`/);
    assert.match(serverGo, /GET \/api\/github\/activity\/today/);
});

test('the AI usage box sits between GitHub activity and git status', () => {
    const gitPanelStart = indexHtml.indexOf('<div id="git-panel">');
    const gitPanelEnd = indexHtml.indexOf('<div id="agent-picker-modal"', gitPanelStart);
    const gitPanelSection = indexHtml.slice(gitPanelStart, gitPanelEnd);
    const githubIndex = gitPanelSection.indexOf('id="github-activity-section"');
    const usageIndex = gitPanelSection.indexOf('id="usage-section"');
    const gitHeaderIndex = gitPanelSection.indexOf('id="git-panel-header"');

    assert.ok(githubIndex !== -1 && usageIndex !== -1 && gitHeaderIndex !== -1);
    assert.ok(githubIndex < usageIndex);
    assert.ok(usageIndex < gitHeaderIndex);
    for (const id of ['usage-tabs', 'usage-body', 'usage-refresh']) {
        assert.match(gitPanelSection, new RegExp(`id="${id}"`));
    }
    assert.match(indexHtml, /id="settings-usage-rows"/);
});

test('every usage provider is wired through the backend and config', () => {
    const match = /const USAGE_PROVIDERS = (\[[\s\S]*?\n    \]);/.exec(appJs);
    assert.ok(match, 'USAGE_PROVIDERS not found');
    const providers = vm.runInNewContext(match[1]);
    const usageGo = fs.readFileSync(path.join(repoRoot, 'internal', 'server', 'usage.go'), 'utf8');
    assert.match(serverGo, /for _, provider := range usageProviders \{\s*mux\.HandleFunc\("GET \/api\/"\+provider\.name\+"\/usage"/);
    assert.ok(providers.length >= 2);
    for (const { id, label, cliName, dependency } of providers) {
        assert.ok(label && cliName && dependency, `${id} is missing a field`);
        assert.match(usageGo, new RegExp(`\\{name: "${id}",`), `${id} has no backend usage provider`);
        for (const field of [`show_${id}_usage`, `${id}_billing`, `${id}_monthly_budget`]) {
            assert.match(configGo, new RegExp(`json:"${field},omitempty"`), `config.go lacks ${field}`);
            assert.match(apiGo, new RegExp(`json:"${field}"`), `api.go lacks ${field}`);
        }
    }
});

function functionSource(name) {
    const match = new RegExp(`^([ \\t]*)(?:async )?function ${name}\\(`, 'm').exec(appJs);
    assert.ok(match, `function ${name} not found`);
    const end = appJs.indexOf('\n' + match[1] + '}\n', match.index);
    return appJs.slice(match.index, end + match[1].length + 2);
}

test('manual usage refresh follows an in-flight cached load', async () => {
    const urls = [];
    let resolveFirst;
    const context = {
        Promise,
        URLSearchParams,
        Intl,
        renderUsageBox: () => {},
        fetchJSON: (url) => {
            urls.push(url);
            if (urls.length === 1) {
                return new Promise(resolve => { resolveFirst = resolve; });
            }
            return Promise.resolve({});
        },
        usageState: { codex: { loadPromise: null, loadIsFresh: false } },
    };
    vm.runInNewContext(functionSource('loadUsage'), context);
    const codex = { id: 'codex', label: 'Codex' };

    const cachedLoad = context.loadUsage(codex);
    const refresh = context.loadUsage(codex, { fresh: true });
    const duplicateRefresh = context.loadUsage(codex, { fresh: true });
    assert.equal(urls.length, 1);
    assert.match(urls[0], /^\/api\/codex\/usage\?/);

    resolveFirst({});
    await Promise.all([cachedLoad, refresh, duplicateRefresh]);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /(?:\?|&)fresh=1(?:&|$)/);
});

test('startup git pull mode is wired through settings and config', () => {
    const saveStart = appJs.indexOf('async function saveSettings');
    const saveEnd = appJs.indexOf('// ─── Side panels', saveStart);
    const saveSection = appJs.slice(saveStart, saveEnd);

    assert.match(indexHtml, /id="settings-startup-git-pull-ff-only"/);
    assert.match(configGo, /StartupGitPullFFOnly\s+bool\s+`json:"startup_git_pull_ff_only,omitempty"`/);
    assert.match(apiGo, /StartupGitPullFFOnly\s+\*bool\s+`json:"startup_git_pull_ff_only"`/);
    assert.match(appJs, /startupGitPullFFOnly = Boolean\(cfg && cfg\.startup_git_pull_ff_only\)/);
    assert.match(appJs, /settings-startup-git-pull-ff-only'\)\.checked = startupGitPullFFOnly/);
    assert.match(appJs, /const startupPullFFOnly = Boolean\(document\.getElementById\('settings-startup-git-pull-ff-only'\)\?\.checked\)/);
    assert.match(saveSection, /const startupGitPullFFOnlySetting = Boolean\(document\.getElementById\('settings-startup-git-pull-ff-only'\)\?\.checked\)/);
    assert.match(saveSection, /startup_git_pull_ff_only: startupGitPullFFOnlySetting/);
});

test('status bar displays the stamped version, with the commit date as its tooltip', () => {
    const start = indexHtml.indexOf('<div id="statusbar">');
    const end = indexHtml.indexOf('</div>', start);
    const statusbarSection = indexHtml.slice(start, end);
    const renderStart = appJs.indexOf('function renderBuildInfo');
    const renderEnd = appJs.indexOf('async function loadBuildInfo', renderStart);
    const buildInfoSection = appJs.slice(renderStart, renderEnd);

    assert.match(statusbarSection, /id="build-info"/);
    assert.ok(statusbarSection.indexOf('id="build-info"') < statusbarSection.indexOf('id="command-palette-btn"'));
    assert.match(styleCss, /#build-info/);
    assert.match(appJs, /async function loadBuildInfo\(\)/);
    assert.match(appJs, /fetchJSON\('\/api\/build'\)/);
    assert.doesNotMatch(buildInfoSection, /commit_short|built_at|modified/);
    assert.match(serverGo, /"GET \/api\/build", api\.handleBuildInfo/);
    assert.match(buildInfoGo, /buildinfo\.Current\(\)/);

    const render = (info) => {
        const el = { textContent: '', title: '' };
        const document = { getElementById: () => el };
        vm.runInNewContext(`${functionSource('renderBuildInfo')}\nrenderBuildInfo(info);`, { document, info });
        return el;
    };
    assert.deepEqual({ ...render({ version: '1.2.0', commit_date: '2026-10-05' }) },
        { textContent: '1.2.0', title: 'Version 1.2.0, committed 2026-10-05' });
    assert.deepEqual({ ...render({ commit_date: '2026-10-05' }) },
        { textContent: '2026-10-05', title: 'committed 2026-10-05' });
    assert.deepEqual({ ...render(null) }, { textContent: 'unknown', title: 'unknown' });
});

test('command palette exposes git status panel actions', () => {
    const start = appJs.indexOf('function commandPaletteActions');
    const end = appJs.indexOf('sortedProjects().forEach(project => {', start);
    const paletteSection = appJs.slice(start, end);

    assert.match(paletteSection, /Open editor/);
    assert.match(paletteSection, /Git: Checkout main\/master/);
    assert.match(paletteSection, /Git: Pull/);
    assert.match(paletteSection, /Git: Commit changes/);
    assert.match(paletteSection, /Git: Revert all changes/);
    assert.match(paletteSection, /openEditorModal\(\)/);
    assert.match(paletteSection, /document\.getElementById\('git-checkout-main-btn'\)\.click\(\)/);
    assert.match(paletteSection, /pullProject\(activeProject\)/);
    assert.match(paletteSection, /openCommitModal\(\)/);
    assert.match(paletteSection, /document\.getElementById\('git-revert-btn'\)\.click\(\)/);
    assert.doesNotMatch(appJs, /BUILT_IN_GIT_COMMANDS|git status --short --branch|git log --oneline --decorate/);
});

test('command palette exposes workflow actions while skipping skills agents and github additions', () => {
    const start = appJs.indexOf('function commandPaletteActions');
    const end = appJs.indexOf('return decorateCommandActions(actions, state);', start);
    const paletteSection = appJs.slice(start, end);

    assert.match(paletteSection, /Project: Open folder/);
    assert.match(paletteSection, /Project: Pin/);
    assert.match(paletteSection, /Project: Restart session/);
    assert.match(paletteSection, /Worktree: Create/);
    assert.match(paletteSection, /Worktree: Open/);
    assert.match(paletteSection, /Worktree: Remove/);
    assert.match(paletteSection, /Docker: Start stack/);
    assert.match(paletteSection, /Docker: Stop stack/);
    assert.match(paletteSection, /Overview: Refresh/);
    assert.match(paletteSection, /Overview: Pull all/);
    assert.match(paletteSection, /Projects: Rescan/);
    assert.match(paletteSection, /rescanProjects\(\)/);
    assert.match(paletteSection, /Git: Switch branch/);
    assert.match(paletteSection, /Git: View changed files/);
    assert.match(paletteSection, /Git: Open diff:/);
    assert.match(paletteSection, /Git: Revert file:/);
    assert.match(paletteSection, /Terminal: Split pane/);
    assert.match(paletteSection, /Terminal: Close active pane\/tab/);
    assert.doesNotMatch(paletteSection, /Skill: Run|Agents: View|Agents: Cancel|GitHub: Refresh|GitHub: Open selected MR|GitHub: Approve/);
});

test('projects can be rescanned from sidebar without app restart', () => {
    assert.match(indexHtml, /id="rescan-projects-btn" data-icon="rotate-cw" title="Rescan projects"/);
    assert.match(styleCss, /#rescan-projects-btn/);
    assert.match(appJs, /let projectRescanInFlight = false;/);
    assert.match(appJs, /async function rescanProjects/);
    assert.match(appJs, /fetchJSON\('\/api\/rescan', \{ method: 'POST' \}\)/);
    assert.match(appJs, /document\.getElementById\('rescan-projects-btn'\)\.onclick = \(\) => rescanProjects/);
});

test('command palette git file actions use project-scoped git status data', () => {
    const currentFilesStart = appJs.indexOf('function currentGitFiles');
    const currentFilesEnd = appJs.indexOf('function openFirstChangedFileDiff', currentFilesStart);
    const currentFilesSection = appJs.slice(currentFilesStart, currentFilesEnd);
    const switchStart = appJs.indexOf('async function switchProject');
    const switchEnd = appJs.indexOf('// ─── Tab Persistence', switchStart);
    const switchSection = appJs.slice(switchStart, switchEnd);
    const commitStart = appJs.indexOf('function openCommitModal');
    const commitEnd = appJs.indexOf('function closeCommitModal', commitStart);
    const commitSection = appJs.slice(commitStart, commitEnd);
    const diffStart = appJs.indexOf('function showDiffModal');
    const diffEnd = appJs.indexOf('function disposeEditors', diffStart);
    const diffSection = appJs.slice(diffStart, diffEnd);
    const openFirstStart = appJs.indexOf('function openFirstChangedFileDiff');
    const openFirstEnd = appJs.indexOf('async function updateGitStatus', openFirstStart);
    const openFirstSection = appJs.slice(openFirstStart, openFirstEnd);
    const paletteStart = appJs.indexOf('function commandPaletteActions');
    const paletteEnd = appJs.indexOf('sortedProjects().forEach(project => {', paletteStart);
    const paletteSection = appJs.slice(paletteStart, paletteEnd);

    assert.match(appJs, /let gitStatusProject = null/);
    assert.match(appJs, /let gitStatusState = 'idle'/);
    assert.match(appJs, /function resetGitStatusForProject\(projectName\)/);
    assert.match(currentFilesSection, /currentGitStatusState\(\) !== 'ready'/);
    assert.match(currentFilesSection, /return gitStatusFiles\.map/);
    assert.doesNotMatch(currentFilesSection, /querySelectorAll\('#git-content/);
    assert.match(currentFilesSection, /function showCurrentGitStatusNotReadyToast\(title\)/);
    assert.match(currentFilesSection, /function currentGitFilesSubtitle\(files\)/);
    assert.match(switchSection, /resetGitStatusForProject\(name\);\s*updateGitStatus\(\{ fresh: true \}\)/);
    assert.match(appJs, /setCurrentGitFiles\(projectName, \[\], 'loading'\)/);
    assert.match(appJs, /setCurrentGitFiles\(projectName, \[\], 'unavailable'\)/);
    assert.match(openFirstSection, /showCurrentGitStatusNotReadyToast\('Changes unavailable'\)/);
    assert.match(commitSection, /commitFiles = currentGitFiles\(\)/);
    assert.match(commitSection, /showCurrentGitStatusNotReadyToast\('Commit unavailable'\)/);
    assert.match(commitSection, /There are no changed files to commit/);
    assert.match(diffSection, /const files = currentGitFiles\(\)/);
    assert.match(diffSection, /showCurrentGitStatusNotReadyToast\('Diff unavailable'\)/);
    assert.match(diffSection, /There are no changed files to show/);
    assert.match(paletteSection, /const gitFilesSubtitle = currentGitFilesSubtitle\(gitFiles\)/);
    assert.match(paletteSection, /subtitle: gitFilesSubtitle/);
    assert.match(appJs, /function refreshCommandPaletteForGitStatus\(projectName\)/);
    assert.match(appJs, /projectName === activeProject && isCommandPaletteOpen\(\)/);
    assert.match(appJs, /refreshCommandPaletteForGitStatus\(projectName\);/);
});

test('git status panel shows changed file and line totals', () => {
    const renderStart = appJs.indexOf('function renderGitStatus');
    const renderEnd = appJs.indexOf('// Skip DOM update if nothing changed', renderStart);
    const renderSection = appJs.slice(renderStart, renderEnd);

    assert.match(appJs, /function gitStatusCount\(value\)/);
    assert.match(appJs, /function gitChangeSummary\(files, added, deleted\)/);
    assert.match(renderSection, /const linesAdded = gitStatusCount\(status\.lines_added\)/);
    assert.match(renderSection, /const linesDeleted = gitStatusCount\(status\.lines_deleted\)/);
    assert.match(renderSection, /class="git-change-summary"/);
    assert.match(renderSection, /gitChangeSummary\(files\.length, linesAdded, linesDeleted\)/);
    assert.match(styleCss, /\.git-change-summary\s*\{/);
});

test('worktree prompts accept displayed labels', () => {
    const labelStart = appJs.indexOf('function worktreeChoiceLabel');
    const openStart = appJs.indexOf('async function promptOpenWorktree', labelStart);
    const choiceSection = appJs.slice(labelStart, openStart);
    const removeEnd = appJs.indexOf('async function confirmDeleteWorktree', openStart);
    const promptSection = appJs.slice(openStart, removeEnd);

    assert.match(choiceSection, /function worktreeChoiceLabel\(wt\)/);
    assert.match(choiceSection, /`\$\{wt\.name\} \(\$\{wt\.branch\}\)`/);
    assert.match(choiceSection, /function worktreeChoiceCandidates\(wt\)/);
    assert.match(choiceSection, /worktreeChoiceLabel\(wt\)/);
    assert.match(choiceSection, /normalizedWorktreeChoice\(candidate\) === q/);
    assert.match(choiceSection, /normalizedWorktreeChoice\(candidate\)\.includes\(q\)/);
    assert.match(promptSection, /wts\.map\(worktreeChoiceLabel\)\.join\(', '\)/);
    assert.match(promptSection, /worktreeChoiceLabel\(wts\[0\]\)/);
});

test('worktree add row uses a single focus-open branch combobox', () => {
    const renderStart = appJs.indexOf('// Add worktree row');
    const renderEnd = appJs.indexOf('async function updateBadges', renderStart);
    const renderSection = appJs.slice(renderStart, renderEnd);
    const createStart = appJs.indexOf('async function createWorktreeFromInput');
    const createEnd = appJs.indexOf('async function createWorktree(projectName', createStart);
    const createSection = appJs.slice(createStart, createEnd);
    const createWorktreeStart = appJs.indexOf('function normalizedBranchName', createStart);
    const createWorktreeEnd = appJs.indexOf('async function promptCreateWorktree', createWorktreeStart);
    const createWorktreeSection = appJs.slice(createWorktreeStart, createWorktreeEnd);
    const autocompleteStart = appJs.indexOf('let _autocompleteDropdown = null');
    const autocompleteEnd = appJs.indexOf('async function togglePin', autocompleteStart);
    const autocompleteSection = appJs.slice(autocompleteStart, autocompleteEnd);

    assert.match(renderSection, /input\.onfocus = \(\) => showBranchAutocomplete\(p\.name, input\)/);
    assert.match(renderSection, /input\.oninput = \(\) => updateBranchAutocomplete\(p\.name, input\)/);
    assert.match(renderSection, /activateBranchAutocomplete\(p\.name, input\)/);
    assert.match(renderSection, /addBtn\.onclick = \(ev\) => \{[\s\S]*activateBranchAutocomplete\(p\.name, input\);/);
    assert.match(renderSection, /moveBranchAutocompleteHighlight\(1\)/);
    assert.match(renderSection, /moveBranchAutocompleteHighlight\(-1\)/);
    assert.doesNotMatch(renderSection, /createWorktreeFromInput\(p\.name, input\)/);
    assert.doesNotMatch(renderSection, /baseInput/);
    assert.match(createSection, /await createWorktree\(projectName, branch\);/);
    assert.match(createWorktreeSection, /function normalizedBranchName\(value\)/);
    assert.match(createWorktreeSection, /const existingBranch = allBranches\.find\(b => normalizedBranchName\(b\) === normalizedBranchName\(selectedBranch\)\)/);
    assert.match(createWorktreeSection, /selectedBranch = existingBranch/);
    assert.match(createWorktreeSection, /const payload = \{ branch: selectedBranch, isNew \}/);
    assert.match(autocompleteSection, /function branchAutocompleteItems\(branches, query\)/);
    assert.match(autocompleteSection, /const maxItems = 8/);
    assert.match(autocompleteSection, /items\.push\(\{ type: 'create', branch: query, label: `Create/);
    assert.match(autocompleteSection, /branches\.some\(b => normalizedBranchName\(b\) === normalizedQuery\)/);
    assert.match(autocompleteSection, /branches\.filter\(b => normalizedBranchName\(b\)\.includes\(normalizedQuery\)\)/);
    assert.match(autocompleteSection, /matches\.slice\(0, maxItems - items\.length\)\.forEach\(branch =>/);
    assert.match(autocompleteSection, /highlightedIndex: input\.value\.trim\(\) \? 0 : -1/);
    assert.match(autocompleteSection, /_autocompleteState\.highlightedIndex = input\.value\.trim\(\) \? 0 : -1/);
    assert.match(autocompleteSection, /_autocompleteState\.highlightedIndex = query \? 0 : -1/);
    assert.match(autocompleteSection, /if \(_autocompleteState\.highlightedIndex < 0\) \{/);
    assert.match(autocompleteSection, /itemData\.type === 'create'/);
    assert.match(autocompleteSection, /function activateBranchAutocomplete\(projectName, input\)/);
    assert.match(styleCss, /\.branch-autocomplete-item\.highlighted/);
    assert.doesNotMatch(styleCss, /\.worktree-base-input/);
});

test('saved worktree tabs are restored only when the worktree still exists', () => {
    const initStart = appJs.indexOf('async function init()');
    const initEnd = appJs.indexOf('// Poll badges every 15 seconds', initStart);
    const initSection = appJs.slice(initStart, initEnd);

    assert.match(initSection, /const wtParents = new Set\(\)/);
    assert.match(initSection, /await Promise\.all\(\[\.\.\.wtParents\]\.map\(name => fetchWorktrees\(name\)\)\)/);
    assert.match(initSection, /const \[parentName, wtName\] = t\.split\('@', 2\)/);
    assert.match(initSection, /return wts\.some\(wt => wt\.name === wtName\)/);
    assert.match(initSection, /const restoreTarget = validTabs\.includes\(savedActive\) \? savedActive : validTabs\[0\]/);
});

test('worktree route extraction does not split project names on worktrees except deletes', () => {
    const routeStart = serverGo.indexOf('mux.HandleFunc("/api/projects/"');
    const routeEnd = serverGo.indexOf('// Static files', routeStart);
    const routeSection = serverGo.slice(routeStart, routeEnd);

    assert.match(routeSection, /if r\.Method == http\.MethodDelete/);
    assert.match(routeSection, /strings\.Index\(rest, "\/worktrees\/"\)/);
    assert.match(routeSection, /strings\.HasSuffix\(rest, s\)/);
    assert.match(routeSection, /"\/file\/blame"/);
    assert.match(routeSection, /r\.Header\.Set\("X-Worktree-Name", projectName\[atIdx\+1:\]\)/);
    assert.match(routeSection, /projectName = projectName\[:atIdx\]/);
});

test('terminal clipboard access goes through guarded helpers', () => {
    assert.match(appJs, /function writeClipboardText/);
    assert.match(appJs, /navigator\?\.clipboard\?\.writeText/);
    assert.doesNotMatch(appJs, /navigator\.clipboard\.writeText\(sel\)/);
    assert.doesNotMatch(appJs, /if \(sel\) navigator\.clipboard\.writeText\(sel\)/);
});

test('electron clipboard bridge uses main-process ipc handlers', () => {
    assert.match(electronMainJs, /ipcMain\.handle\("clipboard-read-text"/);
    assert.match(electronMainJs, /ipcMain\.handle\("clipboard-write-text"/);
    assert.match(electronMainJs, /clipboard\.writeText/);
    assert.match(electronPreloadJs, /ipcRenderer\.invoke\("clipboard-read-text"\)/);
    assert.match(electronPreloadJs, /ipcRenderer\.invoke\("clipboard-write-text"/);
    assert.doesNotMatch(electronPreloadJs, /clipboard\.writeText/);
    assert.doesNotMatch(electronPreloadJs, /clipboard\.readText/);
});

test('find preview editor supports inline editing and saving', () => {
    const start = appJs.indexOf('function showFindPreview');
    const end = appJs.indexOf('// ─── Go to File', start);
    const findPreviewSection = appJs.slice(start, end);

    assert.match(appJs, /async function saveFindPreviewFile/);
    assert.match(findPreviewSection, /findPreviewEditor = monaco\.editor\.create\(container, \{\s*model,/);
    assert.match(findPreviewSection, /findPreviewEditor\.addCommand\(monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS/);
    assert.match(appJs, /function detachFindPreviewFromEditorModel/);
    assert.match(appJs, /Object\.keys\(editorOpenFiles\)\.forEach\(detachFindPreviewFromEditorModel\)/);
    assert.match(appJs, /detachFindPreviewFromEditorModel\(path\)/);
    assert.doesNotMatch(findPreviewSection, /findPreviewEditor\.focus\(\)/);
    assert.doesNotMatch(findPreviewSection, /readOnly:\s*true/);
});

test('monaco editor commands are scoped per-editor to avoid global keybinding leakage', () => {
    // Monaco standalone editors share one global keybinding service, so any
    // command registered with addCommand (no `when` context) fires in EVERY
    // editor. The diff editor's Backspace/Delete overrides were leaking into
    // the plain editor modal, breaking delete keys there. Every addCommand
    // must pass an editor-scoped context key as its third argument.

    const diffStart = appJs.indexOf('function createDiffEditor');
    const diffEnd = appJs.indexOf('function scrollToChange', diffStart);
    const createDiffEditorSection = appJs.slice(diffStart, diffEnd);

    // Diff editor: scope key created and passed to each addCommand.
    assert.match(createDiffEditorSection, /modifiedEditor\.createContextKey\(/);
    assert.match(createDiffEditorSection, /modifiedEditor\.addCommand\(\s*monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS,[\s\S]*?\},\s*\w+\s*\)/);
    assert.match(createDiffEditorSection, /runSingleCharacterDiffDelete\(modifiedEditor, false\);\s*\},\s*\w+\s*\)/);
    assert.match(createDiffEditorSection, /runSingleCharacterDiffDelete\(modifiedEditor, true\);\s*\},\s*\w+\s*\)/);

    // Plain editor modal: Ctrl+S scoped too.
    const switchStart = appJs.indexOf('function editorSwitchTab');
    const switchEnd = appJs.indexOf('function buildEditorImagePreview', switchStart);
    const switchSection = appJs.slice(switchStart, switchEnd);
    assert.match(switchSection, /editorInstance\.createContextKey\(/);
    assert.match(switchSection, /editorInstance\.addCommand\(\s*monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS,[\s\S]*?\},\s*\w+\s*\)/);

    // Find preview editor: Ctrl+S scoped too.
    const findStart = appJs.indexOf('function showFindPreview');
    const findEnd = appJs.indexOf('// ─── Go to File', findStart);
    const findPreviewSection = appJs.slice(findStart, findEnd);
    assert.match(findPreviewSection, /findPreviewEditor\.createContextKey\(/);
    assert.match(findPreviewSection, /findPreviewEditor\.addCommand\(\s*monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS,[\s\S]*?\},\s*\w+\s*\)/);
});

test('monaco diff and file explorer expose git blame', () => {
    const diffStart = appJs.indexOf('// ─── Diff Modal');
    const diffEnd = appJs.indexOf('// ─── Editor Modal', diffStart);
    const diffSection = appJs.slice(diffStart, diffEnd);
    const editorStart = appJs.indexOf('// ─── Editor Modal');
    const editorEnd = appJs.indexOf('// ─── Find in Files Modal', editorStart);
    const editorSection = appJs.slice(editorStart, editorEnd);
    const diffLoadBlameStart = appJs.indexOf('async function loadCurrentDiffBlame', diffStart);
    const diffLoadBlameEnd = appJs.indexOf('function toggleDiffBlame', diffLoadBlameStart);
    const diffLoadBlameSection = appJs.slice(diffLoadBlameStart, diffLoadBlameEnd);
    const createDiffEditorStart = appJs.indexOf('function createDiffEditor', diffStart);
    const createDiffEditorEnd = appJs.indexOf('function defaultDiffDelete', createDiffEditorStart);
    const createDiffEditorSection = appJs.slice(createDiffEditorStart, createDiffEditorEnd);
    const editorLoadBlameStart = appJs.indexOf('async function loadEditorBlameForCurrentFile', editorStart);
    const editorLoadBlameEnd = appJs.indexOf('function toggleEditorBlame', editorLoadBlameStart);
    const editorLoadBlameSection = appJs.slice(editorLoadBlameStart, editorLoadBlameEnd);
    const editorSwitchStart = appJs.indexOf('function editorSwitchTab', editorStart);
    const editorSwitchEnd = appJs.indexOf('function buildEditorImagePreview', editorSwitchStart);
    const editorSwitchSection = appJs.slice(editorSwitchStart, editorSwitchEnd);

    assert.match(serverGo, /HandleFunc\("GET \/file\/blame", api\.handleFileBlame\)/);
    assert.match(apiGo, /func \(a \*apiHandler\) handleFileBlame/);
    assert.match(indexHtml, /id="diff-blame-btn"/);
    assert.match(indexHtml, /id="editor-blame-btn"/);
    assert.match(indexHtml, /data-action="blame"/);
    assert.match(appJs, /function fetchFileBlame\(projectName, filename, ref = 'working'\)/);
    assert.match(appJs, /\/file\/blame\?\$\{params\.toString\(\)\}/);
    assert.match(appJs, /function monacoBlameModelState\(editor\)/);
    assert.match(appJs, /function monacoBlameModelUnchanged\(editor, state\)/);
    assert.match(appJs, /function applyMonacoBlame\(editor, lines\)/);
    assert.match(appJs, /lineNumbers: lineNumber =>/);
    assert.match(diffSection, /function toggleDiffBlame\(\)/);
    assert.match(diffSection, /currentDiffBlameTarget\(\)/);
    assert.match(diffSection, /ref: 'head'/);
    assert.match(diffSection, /!monacoBlameModelUnchanged\(target\.editor, modelState\)/);
    assert.match(diffLoadBlameSection, /clearMonacoBlame\(otherDiffBlameEditor\(target\.editor\)\)/);
    assert.doesNotMatch(diffLoadBlameSection, /const requestSequence = \+\+diffBlameRequestSequence;\s*clearDiffBlameDecorations\(\)/);
    assert.match(createDiffEditorSection, /if \(diffBlameEnabled\) clearMonacoBlame\(modifiedEditor\)/);
    assert.match(editorSection, /function editorFileIsDirty\(path\)/);
    assert.match(editorSection, /function disableEditorBlame\(\)/);
    assert.match(editorSection, /async function editorOpenFile\(path, line\)/);
    assert.match(editorSection, /function toggleEditorBlame\(\)/);
    assert.match(editorSection, /async function editorOpenBlame\(path\)/);
    assert.match(editorSection, /editorFileIsDirty\(editorActiveFile\)/);
    assert.match(editorSection, /editorOpenFile\(path\)/);
    assert.match(editorSection, /editorFileIsDirty\(path\)/);
    assert.match(editorSection, /disableEditorBlame\(\)/);
    assert.match(editorSection, /!monacoBlameModelUnchanged\(editorInstance, modelState\)/);
    assert.doesNotMatch(editorLoadBlameSection, /const requestSequence = \+\+editorBlameRequestSequence;\s*clearEditorBlameDecorations\(\)/);
    assert.match(editorSection, /if \(editorBlameEnabled && editorActiveFile === path && editorInstance && editorInstance\.getModel\(\) === model\) \{\s*disableEditorBlame\(\)/);
    assert.match(editorSwitchSection, /clearEditorBlameDecorations\(\);\s*if \(editorBlameEnabled\) loadEditorBlameForCurrentFile\(\)/);
    assert.match(editorSection, /editorOpenBlame\(contextTarget\.path\)/);
    assert.match(styleCss, /\.git-blame-enabled \.line-numbers\s*\{/);
    assert.match(styleCss, /#editor-status-blame\s*\{/);
});

test('diff modal does not override nested monaco editor panes', () => {
    assert.match(styleCss, /#diff-modal-body\s*>\s*\.monaco-editor,\s*#diff-modal-body\s*>\s*\.monaco-diff-editor\s*\{/);
    assert.doesNotMatch(styleCss, /#diff-modal-body\s+\.monaco-editor,\s*#diff-modal-body\s+\.monaco-diff-editor\s*\{/);
});

test('diff modal disables Monaco hunk discard gutter control', () => {
    const start = appJs.indexOf('function createDiffEditor');
    const end = appJs.indexOf('currentDiffEditor.setModel', start);
    const createDiffEditorOptions = appJs.slice(start, end);

    assert.match(createDiffEditorOptions, /renderMarginRevertIcon:\s*false/);
});

test('diff lines expose a GitHub-style plus that opens an inline AI comment', () => {
    const diffStart = appJs.indexOf('// ─── Diff Modal');
    const diffEnd = appJs.indexOf('// ─── Editor Modal', diffStart);
    const diffSection = appJs.slice(diffStart, diffEnd);
    const createStart = appJs.indexOf('function createDiffEditor', diffStart);
    const createEnd = appJs.indexOf('function defaultDiffDelete', createStart);
    const createSection = appJs.slice(createStart, createEnd);

    assert.match(createSection, /glyphMargin:\s*true/);
    assert.match(createSection, /registerDiffCommentEditor\(originalEditor, 'original'\)/);
    assert.match(createSection, /registerDiffCommentEditor\(modifiedEditor, 'modified'\)/);
    assert.match(diffSection, /glyphMarginClassName: 'diff-comment-glyph'/);
    assert.match(diffSection, /label: 'Comment to current AI'/);
    assert.match(diffSection, /editor\.onMouseMove/);
    assert.match(diffSection, /openDiffComment\(editor, side, ev\.target\.position\.lineNumber\)/);
    assert.match(diffSection, /zone\.className = 'diff-comment-zone'/);
    assert.match(diffSection, /textarea\.className = 'diff-comment-input'/);
    assert.match(diffSection, /accessor\.addZone\(\{/);
    assert.match(diffSection, /suppressMouseDown: false/);
    assert.match(diffSection, /sendButton\.textContent = 'Send to AI'/);
    assert.match(diffSection, /ev\.key === 'Enter' && \(ev\.ctrlKey \|\| ev\.metaKey\)/);
    assert.match(diffSection, /textarea\.addEventListener\('keydown',[\s\S]*?ev\.stopPropagation\(\);\s*if \(ev\.isComposing \|\| ev\.keyCode === 229\) return;/);
    assert.match(diffSection, /closeActiveDiffComment\(\{ focusEditor: false \}\);/);
    assert.match(styleCss, /\.diff-comment-glyph::before\s*\{[^}]*content:\s*'\+'/s);
    assert.match(styleCss, /\.diff-comment-zone\s*\{/);
    assert.match(styleCss, /\.diff-comment-form\s*\{/);
    assert.match(styleCss, /\.diff-comment-input\s*\{/);
});

test('diff comment drafts close on layout changes without intercepting IME cancellation', () => {
    const toggleStart = appJs.indexOf("document.getElementById('diff-view-toggle').onclick");
    const toggleEnd = appJs.indexOf('// ─── Editor Modal', toggleStart);
    const toggleSection = appJs.slice(toggleStart, toggleEnd);
    const keyboardStart = appJs.indexOf('// ─── Keyboard Shortcuts');
    const keyboardEnd = appJs.indexOf('if (settingsCLIIntegrationModalIsOpen())', keyboardStart);
    const keyboardSection = appJs.slice(keyboardStart, keyboardEnd);

    assert.match(toggleSection, /closeActiveDiffComment\(\{ focusEditor: false \}\);[\s\S]*?renderSideBySide: diffSideBySide/);
    assert.match(keyboardSection, /if \(activeDiffComment\) \{\s*ev\.stopPropagation\(\);\s*if \(ev\.isComposing \|\| ev\.keyCode === 229\) return;\s*ev\.preventDefault\(\);\s*closeActiveDiffComment\(\);/);
});

test('diff comment gutter tracks the hovered line and opens the correct side', () => {
    const start = appJs.indexOf('function setDiffCommentGlyph');
    const end = appJs.indexOf('function diffEntryName', start);
    const registrations = {};
    const decorationCalls = [];
    const opened = [];
    const editor = {
        addAction(action) { registrations.action = action; },
        onMouseMove(callback) { registrations.mouseMove = callback; },
        onMouseLeave(callback) { registrations.mouseLeave = callback; },
        onMouseDown(callback) { registrations.mouseDown = callback; },
        deltaDecorations(previous, decorations) {
            decorationCalls.push({ previous, decorations });
            return decorations.length ? ['glyph-1'] : [];
        },
    };
    const monaco = {
        Range: class Range {
            constructor(startLineNumber, startColumn, endLineNumber, endColumn) {
                Object.assign(this, { startLineNumber, startColumn, endLineNumber, endColumn });
            }
        },
    };

    vm.runInNewContext(`${appJs.slice(start, end)}
        registerDiffCommentEditor(editor, 'original');
        registrations.mouseMove({ target: { position: { lineNumber: 17 } } });
        assert.equal(decorationCalls.length, 1);
        assert.equal(decorationCalls[0].decorations[0].range.startLineNumber, 17);
        assert.equal(decorationCalls[0].decorations[0].options.glyphMarginClassName, 'diff-comment-glyph');

        registrations.mouseDown({
            target: {
                element: { classList: { contains: value => value === 'diff-comment-glyph' } },
                position: { lineNumber: 17 },
            },
        });
        assert.equal(opened.length, 1);
        assert.equal(opened[0][0], 'original');
        assert.equal(opened[0][1], 17);

        registrations.action.run();
        assert.equal(opened.length, 2);
        assert.equal(opened[1][0], 'original');
        assert.equal(opened[1][1], undefined);
        registrations.mouseLeave();
        assert.equal(decorationCalls[1].decorations.length, 0);
    `, {
        assert,
        decorationCalls,
        editor,
        monaco,
        opened,
        registrations,
        openDiffComment: (_editor, side, lineNumber) => opened.push([side, lineNumber]),
    });
});

test('diff comments send structured file, line, side, and comment data to the focused AI terminal', () => {
    const start = appJs.indexOf('function buildDiffCommentPrompt');
    const end = appJs.indexOf('function closeActiveDiffComment', start);
    const pasted = [];
    const requestedProjects = [];
    const sent = [];
    const toasts = [];
    let terminal = {
        term: { paste: value => pasted.push(value) },
        connection: {
            state: 'open',
            sendInput: value => {
                sent.push(value);
                return true;
            },
        },
    };

    vm.runInNewContext(`${appJs.slice(start, end)}
        const prompt = buildDiffCommentPrompt('src/a "quoted".js', 42, 'original', '  Explain this branch.  ');
        const payload = JSON.parse(prompt.slice(prompt.indexOf('\\n') + 1));
        assert.deepEqual(payload, {
            file: 'src/a "quoted".js',
            line: 42,
            side: 'HEAD',
            comment: 'Explain this branch.',
        });

        assert.equal(sendDiffCommentToAI('project-a', prompt), true);
        assert.equal(requestedProjects[0], 'project-a');
        assert.equal(pasted.length, 1);
        assert.equal(pasted[0], prompt);
        assert.equal(sent.length, 1);
        assert.equal(sent[0], '\\r');

        terminal.connection.state = 'reconnecting';
        assert.equal(sendDiffCommentToAI('project-a', prompt), false);
        assert.equal(toasts.length, 1);
        assert.equal(toasts[0][0], 'Comment not sent');
    `, {
        assert,
        activeTab: 'project-a',
        getTerminalEntry: projectName => {
            requestedProjects.push(projectName);
            return terminal;
        },
        pasted,
        requestedProjects,
        sent,
        showToast: (...args) => toasts.push(args),
        terminal,
        toasts,
    });
});

test('image diff and source previews expose shared zoom controls', () => {
    const zoomStart = appJs.indexOf('const IMAGE_ZOOM_LEVELS');
    const zoomEnd = appJs.indexOf('function renderImageDiff', zoomStart);
    const zoomSection = appJs.slice(zoomStart, zoomEnd);
    const paneStart = appJs.indexOf('function buildImagePane');
    const paneEnd = appJs.indexOf('function renderBinaryMessage', paneStart);
    const paneSection = appJs.slice(paneStart, paneEnd);
    const previewStart = appJs.indexOf('function buildEditorImagePreview');
    const previewEnd = appJs.indexOf('function renderEditorTabs', previewStart);
    const previewSection = appJs.slice(previewStart, previewEnd);

    assert.match(zoomSection, /const IMAGE_ZOOM_LEVELS = \[0\.25, 0\.5, 0\.75, 1, 1\.25, 1\.5, 2, 3, 4, 8\]/);
    assert.match(zoomSection, /const IMAGE_ZOOM_WHEEL_THRESHOLD = 30/);
    assert.match(zoomSection, /const IMAGE_ZOOM_WHEEL_COOLDOWN_MS = 220/);
    assert.match(zoomSection, /zoomOut\.onclick = \(\) => setZoom\(zoomIndex - 1\)/);
    assert.match(zoomSection, /reset\.onclick = \(\) => setZoom\(IMAGE_ZOOM_FIT_INDEX\)/);
    assert.match(zoomSection, /zoomIn\.onclick = \(\) => setZoom\(zoomIndex \+ 1\)/);
    assert.match(zoomSection, /stage\.addEventListener\('wheel',[\s\S]*?ev\.ctrlKey[\s\S]*?ev\.metaKey[\s\S]*?passive: false/);
    assert.match(paneSection, /buildImageZoomControls\(paneBody, img\)/);
    assert.match(previewSection, /buildImageZoomControls\(stage, img\)/);
    assert.match(styleCss, /\.image-zoom-controls\s*\{/);
    assert.match(styleCss, /\.diff-image-pane-body\s*\{[\s\S]*?overflow: auto/);
    assert.match(styleCss, /\.editor-image-preview-stage\s*\{[\s\S]*?overflow: auto/);
});

test('image zoom controls resize from the fitted dimensions and reset', () => {
    const zoomStart = appJs.indexOf('const IMAGE_ZOOM_LEVELS');
    const zoomEnd = appJs.indexOf('function renderImageDiff', zoomStart);
    const listeners = {};
    const style = {
        removeProperty(name) {
            delete this[name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())];
        },
    };
    const makeElement = () => ({
        children: [],
        style: {},
        appendChild(child) { this.children.push(child); },
        setAttribute(name, value) { this[name] = value; },
    });
    const stage = {
        clientWidth: 320,
        clientHeight: 180,
        scrollWidth: 320,
        scrollHeight: 180,
        scrollLeft: 0,
        scrollTop: 0,
        addEventListener(name, handler) { listeners[name] = handler; },
        getBoundingClientRect() { return { left: 10, top: 20 }; },
    };
    const img = {
        complete: true,
        naturalWidth: 400,
        naturalHeight: 200,
        style,
        addEventListener(name, handler) { listeners[`image:${name}`] = handler; },
        getBoundingClientRect() { return { width: 200, height: 100 }; },
    };
    let now = 0;
    const context = {
        document: { createElement: makeElement },
        iconHTML: name => `<svg data-icon="${name}"></svg>`,
        performance: { now: () => now },
    };

    vm.runInNewContext(
        `${appJs.slice(zoomStart, zoomEnd)}\nthis.buildImageZoomControls = buildImageZoomControls;`,
        context,
    );
    const controls = context.buildImageZoomControls(stage, img);
    const [zoomOut, reset, zoomIn] = controls.children;

    assert.equal(reset.textContent, 'Fit');
    assert.equal(reset.disabled, true);
    assert.equal(zoomOut.disabled, false);
    assert.equal(zoomIn.disabled, false);

    zoomIn.onclick();
    assert.equal(reset.textContent, '125%');
    assert.equal(style.width, '250px');
    assert.equal(style.height, '125px');
    assert.equal(style.maxWidth, 'none');
    assert.equal(style.maxHeight, 'none');

    reset.onclick();
    assert.equal(reset.textContent, 'Fit');
    assert.equal(style.width, undefined);
    assert.equal(style.height, undefined);
    assert.equal(style.maxWidth, undefined);
    assert.equal(style.maxHeight, undefined);

    const wheel = (deltaY, modifiers = { ctrlKey: true, metaKey: false }) => {
        let prevented = false;
        listeners.wheel({
            ...modifiers,
            deltaY,
            deltaMode: 0,
            clientX: 170,
            clientY: 110,
            preventDefault() { prevented = true; },
        });
        return prevented;
    };

    assert.equal(wheel(-10), true);
    assert.equal(wheel(-10), true);
    assert.equal(reset.textContent, 'Fit');
    assert.equal(wheel(-10), true);
    assert.equal(reset.textContent, '125%');

    now = 100;
    assert.equal(wheel(-30), true);
    assert.equal(reset.textContent, '125%');

    now = 221;
    assert.equal(wheel(-30), true);
    assert.equal(reset.textContent, '150%');

    assert.equal(wheel(30, { ctrlKey: false, metaKey: false }), false);
    assert.equal(reset.textContent, '150%');
});

test('diff modal exposes changed-file sidebar navigation', () => {
    const markupStart = indexHtml.indexOf('<div id="diff-modal"');
    const markupEnd = indexHtml.indexOf('<!-- Editor context menu -->', markupStart);
    const markupSection = indexHtml.slice(markupStart, markupEnd);
    const diffStart = appJs.indexOf('// ─── Diff Modal');
    const diffEnd = appJs.indexOf('// ─── Editor Modal', diffStart);
    const diffSection = appJs.slice(diffStart, diffEnd);

    assert.match(markupSection, /id="diff-modal-main"/);
    assert.match(markupSection, /id="diff-file-sidebar"/);
    assert.match(markupSection, /id="diff-file-panel-toggle" class="sidebar-collapse-btn diff-file-panel-toggle" data-icon="chevron-left"/);
    assert.match(markupSection, /id="diff-file-list"/);
    assert.match(styleCss, /#diff-modal-main\s*\{/);
    assert.match(styleCss, /#diff-file-sidebar\s*\{/);
    assert.match(styleCss, /#diff-modal-main\.diff-file-panel-collapsed #diff-file-sidebar\s*\{/);
    assert.match(styleCss, /\.diff-file-panel-toggle\s*\{/);
    assert.match(styleCss, /\.diff-tree-row\s*\{/);
    assert.match(styleCss, /\.diff-dir-row\s*\{/);
    assert.match(styleCss, /\.diff-file-item\.active\s*\{/);
    assert.match(diffSection, /function renderDiffFileSidebar\(\)/);
    assert.match(diffSection, /let diffCollapsedDirs = new Set\(\)/);
    assert.match(diffSection, /const DIFF_FILE_PANEL_COLLAPSED_KEY = 'diff-file-panel-collapsed'/);
    assert.match(diffSection, /let diffFilePanelCollapsed = loadDiffFilePanelCollapsedPreference\(\)/);
    assert.match(diffSection, /function buildDiffFileTree\(\)/);
    assert.match(diffSection, /filename\.split\('\/'\)\.filter\(Boolean\)/);
    assert.match(diffSection, /function expandActiveDiffFileParents\(\)/);
    assert.match(diffSection, /diffCollapsedDirs\.delete\(dirPath\)/);
    assert.match(diffSection, /function appendDiffTreeNodes\(list, node, depth\)/);
    assert.match(diffSection, /row\.onclick = \(\) => \{/);
    assert.match(diffSection, /item\.title = filename/);
    assert.match(diffSection, /item\.onclick = \(\) => selectDiffFile\(file\.index\)/);
    assert.match(diffSection, /function selectDiffFile\(index\)/);
    assert.match(diffSection, /function updateDiffFilePanelState\(\)/);
    assert.match(diffSection, /toggle\.classList\.toggle\('collapsed', diffFilePanelCollapsed\)/);
    assert.match(diffSection, /toggle\.setAttribute\('data-tooltip', toggle\.title\)/);
    assert.match(diffSection, /localStorage\.getItem\(DIFF_FILE_PANEL_COLLAPSED_KEY\) === 'true'/);
    assert.match(diffSection, /localStorage\.setItem\(DIFF_FILE_PANEL_COLLAPSED_KEY, diffFilePanelCollapsed \? 'true' : 'false'\)/);
    assert.match(diffSection, /document\.getElementById\('diff-file-panel-toggle'\)\.onclick = \(\) => setDiffFilePanelCollapsed\(!diffFilePanelCollapsed\)/);
    assert.match(diffSection, /expandActiveDiffFileParents\(\);\s*appendDiffTreeNodes\(list, buildDiffFileTree\(\), 0\)/);
    assert.match(diffSection, /modal\.style\.display = 'flex';\s*updateDiffFilePanelState\(\);\s*renderDiffFileSidebar\(\);/);
    assert.match(diffSection, /renderDiffFileSidebar\(\);/);
});

test('right-side Git diff file labels expose full paths on hover', () => {
    const gitStart = appJs.indexOf('// ─── Git Status');
    const gitEnd = appJs.indexOf('// ─── Branch Dropdown', gitStart);
    const gitSection = appJs.slice(gitStart, gitEnd);

    assert.match(gitSection, /function gitFileRowHTML\(file, label, depth = 0\)/);
    assert.match(gitSection, /class="git-file-name" title="\$\{esc\(file\.name\)\}"/);
});

test('viewed Git file state persists by project revision and reconciles stale entries', () => {
    const start = appJs.indexOf("const GIT_VIEWED_FILES_KEY = 'git-viewed-files-v1'");
    const end = appJs.indexOf('function gitStatusStateForProject', start);
    const storage = new Map([['git-viewed-files-v1', '{malformed']]);
    const syncedProjects = [];
    const code = `${appJs.slice(start, end)}
        const first = { name: 'src/first.js', revision: 'revision-1' };
        const second = { name: 'src/second.js', revision: 'revision-2' };
        assert.equal(gitFileIsViewed('project-a', first), false);

        setGitFileViewed('project-a', first, true);
        assert.equal(gitFileIsViewed('project-a', first), true);
        assert.equal(gitFileIsViewed('project-b', first), false);
        assert.equal(syncedProjects.join(','), 'project-a');

        gitViewedFiles = loadGitViewedFiles();
        assert.equal(gitFileIsViewed('project-a', first), true);
        assert.equal(reconcileGitViewedFiles('project-a', [first], true), false);
        assert.equal(reconcileGitViewedFiles('project-a', [{ ...first, revision: 'revision-changed' }], true), true);
        assert.equal(gitFileIsViewed('project-a', first), false);

        const changedFirst = { ...first, revision: 'revision-changed' };
        setGitFileViewed('project-a', changedFirst, true);
        setGitFileViewed('project-a', second, true);
        assert.equal(reconcileGitViewedFiles('project-a', [changedFirst], true), true);
        assert.equal(gitFileIsViewed('project-a', changedFirst), true);
        assert.equal(gitFileIsViewed('project-a', second), false);

        setGitFileViewed('project-a', changedFirst, false);
        assert.equal(gitFileIsViewed('project-a', changedFirst), false);
        setGitFileViewed('project-b', second, true);
        assert.equal(reconcileGitViewedFiles('project-b', [second], false), true);
        assert.equal(gitFileIsViewed('project-b', second), false);
    `;
    vm.runInNewContext(code, {
        assert,
        localStorage: {
            getItem: key => storage.has(key) ? storage.get(key) : null,
            setItem: (key, value) => storage.set(key, value),
        },
        syncedProjects,
        syncGitViewedUI: projectName => syncedProjects.push(projectName),
    });
});

test('marking an edited diff viewed saves, refreshes, and advances to the next file', async () => {
    const start = appJs.indexOf('async function toggleCurrentDiffViewed()');
    const end = appJs.indexOf('function syncOpenDiffFileRevisions', start);
    const source = appJs.slice(start, end);
    const entry = { kind: 'local', filename: 'src/changed.js', revision: 'before-save' };
    const nextEntry = { kind: 'local', filename: 'src/next.js', revision: 'next-revision' };
    const currentFileData = {
        projectName: 'project-a',
        filename: entry.filename,
        modified: 'before edit',
        readOnly: false,
    };
    const events = [];
    const viewedCalls = [];
    const context = {
        diffFiles: [entry, nextEntry],
        diffAllFiles: [entry, nextEntry],
        diffIndex: 0,
        diffProjectName: 'project-a',
        currentFileData,
        diffEntryCanBeViewed: () => true,
        diffEntryName: candidate => candidate.filename,
        diffEntryIsViewed: () => false,
        getCurrentContent: () => 'after edit',
        saveCurrentFile: async options => {
            events.push(`save:${options.refreshStatus}`);
            currentFileData.modified = 'after edit';
            return true;
        },
        updateGitStatus: async () => {
            events.push('status');
            return {
                is_git_repo: true,
                files: [{ name: entry.filename, revision: 'after-save' }],
            };
        },
        setGitFileViewed: (...args) => viewedCalls.push(args),
        diffNavigate: direction => events.push(`navigate:${direction}`),
    };

    const marked = await vm.runInNewContext(`${source}\ntoggleCurrentDiffViewed();`, context);

    assert.equal(marked, true);
    assert.deepEqual(events, ['save:false', 'status', 'navigate:1']);
    assert.equal(entry.revision, 'after-save');
    assert.equal(viewedCalls.length, 1);
    assert.equal(viewedCalls[0][0], 'project-a');
    assert.deepEqual({ ...viewedCalls[0][1] }, { name: entry.filename, revision: 'after-save' });
    assert.equal(viewedCalls[0][2], true);
});

test('marking a diff unviewed stays on the current file', async () => {
    const start = appJs.indexOf('async function toggleCurrentDiffViewed()');
    const end = appJs.indexOf('function syncOpenDiffFileRevisions', start);
    const source = appJs.slice(start, end);
    const entry = { kind: 'local', filename: 'src/changed.js', revision: 'viewed-revision' };
    const viewedCalls = [];
    const navigations = [];
    const context = {
        diffFiles: [entry, { kind: 'local', filename: 'src/next.js', revision: 'next-revision' }],
        diffAllFiles: [entry],
        diffIndex: 0,
        diffProjectName: 'project-a',
        diffEntryCanBeViewed: () => true,
        diffEntryName: candidate => candidate.filename,
        diffEntryIsViewed: () => true,
        setGitFileViewed: (...args) => viewedCalls.push(args),
        diffNavigate: direction => navigations.push(direction),
    };

    const unmarked = await vm.runInNewContext(`${source}\ntoggleCurrentDiffViewed();`, context);

    assert.equal(unmarked, true);
    assert.equal(viewedCalls.length, 1);
    assert.equal(viewedCalls[0][0], 'project-a');
    assert.deepEqual({ ...viewedCalls[0][1] }, { name: entry.filename, revision: entry.revision });
    assert.equal(viewedCalls[0][2], false);
    assert.deepEqual(navigations, []);
});

test('Git diff surfaces expose viewed state without a right-panel checkbox', () => {
    const gitStart = appJs.indexOf('// ─── Git Status');
    const gitEnd = appJs.indexOf('// ─── Branch Dropdown', gitStart);
    const gitSection = appJs.slice(gitStart, gitEnd);
    const diffStart = appJs.indexOf('// ─── Diff Modal');
    const diffEnd = appJs.indexOf('// ─── Editor Modal', diffStart);
    const diffSection = appJs.slice(diffStart, diffEnd);
    const loadStart = appJs.indexOf('async function loadDiff', diffStart);
    const loadEnd = appJs.indexOf('function formatBytes', loadStart);
    const loadSection = appJs.slice(loadStart, loadEnd);

    assert.match(indexHtml, /id="diff-viewed-toggle" type="button"[^>]*aria-pressed="false">mark viewed<\/button>/);
    assert.match(gitSection, /revision: typeof file\.revision === 'string' \? file\.revision : ''/);
    assert.doesNotMatch(gitSection, /git-file-viewed-toggle|type="checkbox"/);
    assert.match(gitSection, /gitFileIsViewed\(gitStatusProject, file\)/);
    assert.match(gitSection, /viewed \? ' viewed' : ''/);
    assert.match(gitSection, /reconcileGitViewedFiles\(projectName, gitStatusFiles, isGitRepo\)/);
    assert.match(gitSection, /syncOpenDiffFileRevisions\(projectName, gitStatusFiles\)/);
    assert.match(diffSection, /revision: file\.revision/);
    assert.match(diffSection, /function updateDiffViewedButton\(\)/);
    assert.match(diffSection, /function toggleCurrentDiffViewed\(\)/);
    assert.match(diffSection, /commandShortcutLabel\('diff\.toggleViewed'\)/);
    assert.match(appJs, /\{ id: 'diff\.toggleViewed', title: 'Diff: Toggle viewed'/);
    assert.match(appJs, /const allowsPlainShortcut = commandID === 'diff\.toggleViewed'/);
    assert.match(diffSection, /className = 'diff-file-viewed-indicator'/);
    assert.match(diffSection, /iconHTML\('check'\)/);
    assert.match(diffSection, /modifiedModel\.onDidChangeContent[\s\S]*?setGitFileViewed\(projectName, \{ name: filename, revision: viewedEntry\.revision \}, false\)/);
    assert.doesNotMatch(loadSection, /setGitFileViewed\(/);
    assert.match(styleCss, /\.git-file\.viewed \.git-file-name/);
    assert.match(styleCss, /\.diff-file-item\.viewed \.diff-file-name/);
    assert.match(styleCss, /#diff-viewed-toggle\.active/);
});

test('right-side Git diff panel toggles between list and tree views', () => {
    const gitStart = appJs.indexOf('// ─── Git Status');
    const gitEnd = appJs.indexOf('// ─── Branch Dropdown', gitStart);
    const gitSection = appJs.slice(gitStart, gitEnd);

    assert.match(gitSection, /let gitFileTreeView = false/);
    assert.match(gitSection, /function buildGitFileTree\(files\)/);
    assert.match(gitSection, /file\.name\.split\('\/'\)\.filter\(Boolean\)/);
    assert.match(gitSection, /function gitFileTreeHTML\(node, depth = 0\)/);
    assert.match(gitSection, /class="git-tree-dir"/);
    assert.match(gitSection, /id="git-file-view-toggle"/);
    assert.match(gitSection, /gitFileTreeView = !gitFileTreeView;\s*renderGitStatus\(status, projectName\)/);
    assert.match(styleCss, /#git-file-view-toggle[^{]*\{/);
    assert.match(styleCss, /\.git-tree-dir\s*\{/);
});

test('right-side Git panel can compare against the trunk fork point', () => {
    const gitStart = appJs.indexOf('// ─── Git Status');
    const gitEnd = appJs.indexOf('// ─── Branch Dropdown', gitStart);
    const gitSection = appJs.slice(gitStart, gitEnd);

    assert.match(gitSection, /let gitTrunkDiffView = loadGitTrunkDiffViewPreference\(\)/);
    assert.match(gitSection, /if \(gitTrunkDiffView\) params\.set\('base', 'trunk'\)/);
    assert.match(gitSection, /gitStatusDiffBase = status\.diff_base \|\| ''/);
    assert.match(gitSection, /gitStatusTrunkBranch = status\.trunk_branch \|\| ''/);
    assert.match(gitSection, /id="git-diff-base-toggle"/);
    assert.match(gitSection, /gitTrunkDiffView = !gitTrunkDiffView;\s*saveGitTrunkDiffViewPreference\(\);/);
    assert.match(styleCss, /#git-diff-base-toggle\s*\{/);
    assert.match(styleCss, /#git-diff-base-toggle\.active\s*\{/);

    // Reverting the working tree cannot undo the committed half of a trunk diff.
    assert.match(gitSection, /'git-revert-btn'\)\.style\.display = visible && !gitTrunkDiffView/);
    assert.match(gitGo, /files = append\(files, GitFile\{Status: shortDiffStatus\(status\), Name: name\}\)/);
    assert.doesNotMatch(gitGo, /GitFile\{Status: shortDiffStatus\(status\), Name: name, Revertible: true\}/);
});

test('trunk comparison reads the original side of every diff from the fork point', () => {
    assert.match(gitGo, /func gitTrunkForkPoint\(projectPath, trunk string\) string/);
    assert.match(gitGo, /runGit\(projectPath, "merge-base", ref, "HEAD"\)/);
    // A plain `git diff <commit>` already spans committed and uncommitted work.
    assert.match(gitGo, /runGit\(projectPath, "diff", "--name-status", "-z", base, "--"\)/);
    assert.match(gitGo, /runGit\(projectPath, "ls-files", "--others", "--exclude-standard"\)/);
    assert.match(gitGo, /if !isGitCommitHash\(base\) \{/);

    assert.match(apiGo, /if r\.URL\.Query\(\)\.Get\("base"\) == "trunk" \{/);
    assert.match(apiGo, /func baseCommitParam\(w http\.ResponseWriter, r \*http\.Request\) \(string, bool\)/);
    assert.match(apiGo, /base must be a commit hash/);
    assert.match(apiGo, /origBytes, origExists := readBaseBytes\(dir, base, path\)/);

    const diffStart = appJs.indexOf('// ─── Diff Modal');
    const diffEnd = appJs.indexOf('function formatBytes', diffStart);
    const diffSection = appJs.slice(diffStart, diffEnd);
    assert.match(diffSection, /const baseCommit = currentGitDiffBase\(\)/);
    assert.match(diffSection, /const baseParam = baseCommit \? `&base=\$\{encodeURIComponent\(baseCommit\)\}` : ''/);
    assert.match(diffSection, /path=\$\{encodeURIComponent\(filename\)\}\$\{baseParam\}/);
    assert.match(appJs, /function blobUrl\(filename, ref, baseCommit = ''\)/);
    assert.match(appJs, /blobUrl\(filename, 'head', baseCommit\)/);
});

test('right-side Git tree groups paths while preserving full file names', () => {
    const start = appJs.indexOf('function gitFileStatusClass');
    const end = appJs.indexOf('function resetGitStatusForProject', start);
    const code = `${appJs.slice(start, end)}
        const files = [
            { name: 'src/api/client.js', status: ' M', revertible: true },
            { name: 'README.md', status: '??', revertible: false },
        ];
        const html = gitFileTreeHTML(buildGitFileTree(files));
        assert.ok(html.includes('class="git-tree-dir" data-directory="src"'));
        assert.ok(html.includes('class="git-tree-dir" data-directory="src/api"'));
        assert.ok(html.includes('class="git-directory-revert"'));
        assert.ok(html.includes('data-file="src/api/client.js"'));
        assert.ok(html.includes('title="src/api/client.js">client.js</span>'));
    `;
    vm.runInNewContext(code, { assert, esc: value => String(value) });
});

test('right-side Git tree can revert all changes in a directory', () => {
    const revertStart = appJs.indexOf('// ─── Git Revert');
    const revertEnd = appJs.indexOf("document.getElementById('git-revert-btn')", revertStart);
    const revertSection = appJs.slice(revertStart, revertEnd);
    const gitStart = appJs.indexOf('// ─── Git Status');
    const gitEnd = appJs.indexOf('// ─── Branch Dropdown', gitStart);
    const gitSection = appJs.slice(gitStart, gitEnd);

    assert.match(revertSection, /async function revertDirectory\(directory\)/);
    assert.match(revertSection, /await appConfirm\(`Revert all changes in \$\{directory\}\/\?/);
    assert.match(revertSection, /\/revert-directory/);
    assert.match(gitSection, /class="git-directory-revert" title="Revert this directory"/);
    assert.match(gitSection, /revertDirectory\(dirEl\.dataset\.directory\)/);
    assert.match(styleCss, /\.git-tree-dir:hover \.git-directory-revert/);
    assert.match(serverGo, /"POST \/revert-directory", api\.handleGitRevertDirectory/);
});

test('non-Git diff files do not expose destructive revert controls', () => {
    const diffStart = appJs.indexOf('// ─── Diff Modal');
    const diffEnd = appJs.indexOf('// ─── Editor Modal', diffStart);
    const diffSection = appJs.slice(diffStart, diffEnd);

    assert.match(appJs, /revertible: file\.revertible !== false/);
    assert.match(appJs, /const revert = file\.revertible !== false \?/);
    assert.match(diffSection, /revertible: file\.revertible/);
    assert.match(diffSection, /entry\.revertible !== false/);
    assert.match(appJs, /const isGitRepo = status\.is_git_repo === true/);
    assert.match(appJs, /setGitRepositoryActionsVisible\(isGitRepo\)/);
    assert.match(appJs, /setGitStatusPollInterval\(isGitRepo \? GIT_STATUS_POLL_INTERVAL_MS : NON_GIT_STATUS_POLL_INTERVAL_MS\)/);
    assert.match(appJs, /if \(file\.revertible !== false\)/);
});

test('diff modal can hide test files from its tree and navigation', () => {
    const diffStart = appJs.indexOf('// ─── Diff Modal');
    const diffEnd = appJs.indexOf('// ─── Editor Modal', diffStart);
    const diffSection = appJs.slice(diffStart, diffEnd);

    assert.match(indexHtml, /id="diff-tests-toggle" title="Hide test files">hide tests</);
    assert.match(styleCss, /#diff-tests-toggle/);
    assert.match(diffSection, /let diffAllFiles = \[\]/);
    assert.match(diffSection, /function setDiffTestsHidden\(hidden\)/);
    assert.match(diffSection, /diffAllFiles\.filter\(entry => !diffEntryIsTest\(entry\)\)/);
    assert.match(diffSection, /document\.getElementById\('diff-tests-toggle'\)\.onclick = \(\) => setDiffTestsHidden\(!diffTestsHidden\)/);
    assert.match(diffSection, /function showEmptyDiffFilterState\(\)/);
    assert.match(diffSection, /function updateDiffFileNavigation\(\)/);
    assert.match(diffSection, /if \(currentDiffEditor && currentDiffEditor\.layout\) currentDiffEditor\.layout\(\)/);
    assert.match(styleCss, /@media \(max-width: 760px\)[\s\S]*#diff-modal-header[\s\S]*flex-wrap: wrap/);
});

test('diff test filter matches test paths without matching ordinary substrings', () => {
    const start = appJs.indexOf('function diffEntryName');
    const end = appJs.indexOf('function diffEntryReadOnly', start);
    const code = `${appJs.slice(start, end)}
        assert.equal(diffEntryIsTest({ filename: 'src/api/__tests__/request.ts' }), true);
        assert.equal(diffEntryIsTest({ filename: 'src/api/tests/request.ts' }), true);
        assert.equal(diffEntryIsTest({ filename: 'src/api/test/request.ts' }), true);
        assert.equal(diffEntryIsTest({ filename: 'src/api/__test__/request.ts' }), true);
        assert.equal(diffEntryIsTest({ filename: 'src/api/request.test.ts' }), true);
        assert.equal(diffEntryIsTest({ filename: 'src/api/request_test.go' }), true);
        assert.equal(diffEntryIsTest({ filename: 'src/api/test_request.py' }), true);
        assert.equal(diffEntryIsTest({ filename: 'src/api/contest.ts' }), false);
        assert.equal(diffEntryIsTest({ filename: 'src/api/testing.ts' }), false);
        assert.equal(diffEntryIsTest({ filename: 'src/api/tests-utils/request.ts' }), false);
    `;
    vm.runInNewContext(code, { assert });
});

test('diff modal keeps plain delete keys from removing multi-line diff selections', () => {
    const start = appJs.indexOf('function createDiffEditor');
    const end = appJs.indexOf('function scrollToChange', start);
    const createDiffEditorSection = appJs.slice(start, end);

    assert.match(createDiffEditorSection, /modifiedEditor\.addCommand\(monaco\.KeyCode\.Delete/);
    assert.match(createDiffEditorSection, /runSingleCharacterDiffDelete\(modifiedEditor,\s*false\)/);
    assert.match(createDiffEditorSection, /modifiedEditor\.addCommand\(monaco\.KeyCode\.Backspace/);
    assert.match(createDiffEditorSection, /runSingleCharacterDiffDelete\(modifiedEditor,\s*true\)/);
    assert.match(createDiffEditorSection, /function runSingleCharacterDiffDelete\(editor,\s*backwards\)/);
    assert.match(createDiffEditorSection, /selections\.length > 1/);
    assert.match(createDiffEditorSection, /selection\.startLineNumber !== selection\.endLineNumber/);
    assert.match(createDiffEditorSection, /editor\.executeEdits\('diff-single-character-delete'/);
    assert.match(createDiffEditorSection, /function collapseUnsafeDiffEditorSelectionForPlainInput\(ev\)/);
    assert.match(createDiffEditorSection, /modifiedEditor\.setSelection\(new monaco\.Selection/);
});

test('diff modal lets focused Monaco panes handle arrow keys and typing', () => {
    const keyboardStart = appJs.indexOf('// Diff modal shortcuts');
    const keyboardEnd = appJs.indexOf('if (!Keymap.isPotentialShortcutEvent', keyboardStart);
    const keyboardSection = appJs.slice(keyboardStart, keyboardEnd);

    assert.match(appJs, /function diffEditorHasKeyboardFocus\(ev\)/);
    assert.match(appJs, /if \(!currentDiffEditor\) return false;/);
    assert.doesNotMatch(appJs, /currentDiffEdito[^r]/);
    assert.match(appJs, /editor\.hasTextFocus && editor\.hasTextFocus\(\)/);
    assert.match(appJs, /editor\.hasWidgetFocus && editor\.hasWidgetFocus\(\)/);
    assert.match(keyboardSection, /const diffEditorEvent = diffEditorHasKeyboardFocus\(ev\)/);
    assert.match(keyboardSection, /collapseUnsafeDiffEditorSelectionForPlainInput\(ev\)/);
    assert.match(keyboardSection, /if \(diffEditorEvent\) \{\s*collapseUnsafeDiffEditorSelectionForPlainInput\(ev\);\s*return;\s*\}/);
    assert.match(keyboardSection, /Keymap\.eventMatchesCommand\(keymapState, 'diff\.toggleViewed', ev, keymapOptions\(\)\)/);
    assert.match(keyboardSection, /toggleCurrentDiffViewed\(\)/);
    assert.match(keyboardSection, /!ev\.repeat/);
    assert.match(keyboardSection, /diffChangeNavigate\(1\)/);
});

test('diff modal persists modified model changes', () => {
    const start = appJs.indexOf('function createDiffEditor');
    const end = appJs.indexOf('function scrollToChange', start);
    const createDiffEditorSection = appJs.slice(start, end);
    const saveStart = appJs.indexOf('async function saveCurrentFile');
    const saveEnd = appJs.indexOf('function diffNavigate', saveStart);
    const saveSection = appJs.slice(saveStart, saveEnd);
    const switchStart = appJs.indexOf('async function switchProject');
    const switchEnd = appJs.indexOf('// ─── Tab Persistence', switchStart);
    const switchSection = appJs.slice(switchStart, switchEnd);
    const loadStart = appJs.indexOf('async function loadDiff');
    const loadEnd = appJs.indexOf('function formatBytes', loadStart);
    const loadSection = appJs.slice(loadStart, loadEnd);
    const revertStart = appJs.indexOf('async function diffRevertCurrent');
    const revertEnd = appJs.indexOf("document.getElementById('diff-modal-backdrop')", revertStart);
    const revertSection = appJs.slice(revertStart, revertEnd);

    assert.match(switchSection, /closeDiffModal\(\)/);
    assert.match(loadSection, /const projectName = diffProjectName \|\| activeProject/);
    assert.match(loadSection, /const requestSequence = \+\+diffRequestSequence/);
    assert.match(loadSection, /\/api\/projects\/\$\{encodeURIComponent\(projectName\)\}\/file/);
    assert.match(loadSection, /if \(requestSequence !== diffRequestSequence \|\| diffProjectName !== projectName\) return/);
    assert.match(loadSection, /currentFileData = \{ original: data\.original, modified: data\.modified, filename, readOnly, projectName \}/);
    assert.match(loadSection, /currentFileData\.projectName !== projectName/);
    assert.match(createDiffEditorSection, /const modifiedModel = modifiedEditor\.getModel\(\)/);
    assert.match(createDiffEditorSection, /const clearPendingAutoSave = \(\) => \{/);
    assert.match(createDiffEditorSection, /clearPendingDiffAutoSave = clearPendingAutoSave/);
    assert.match(createDiffEditorSection, /const changeDisposable = modifiedModel\.onDidChangeContent\(\(\) => \{/);
    assert.match(createDiffEditorSection, /const saveSequence = \+\+diffSaveSequence/);
    assert.match(createDiffEditorSection, /abortActiveDiffSave\(\)/);
    assert.match(createDiffEditorSection, /if \(saveSequence === diffSaveSequence && currentFileData && currentFileData\.projectName === projectName && currentFileData\.filename === filename\)/);
    assert.match(createDiffEditorSection, /saveDiffContent\(projectName, filename, content, \{ auto: true, sequence: saveSequence \}\)/);
    assert.match(createDiffEditorSection, /const cleanupDiffAutoSave = \(\) => \{/);
    assert.match(createDiffEditorSection, /clearPendingAutoSave\(\)/);
    assert.match(createDiffEditorSection, /changeDisposable\.dispose\(\)/);
    assert.match(createDiffEditorSection, /clearPendingDiffAutoSave === clearPendingAutoSave/);
    assert.match(createDiffEditorSection, /currentDiffEditor\.onDidDispose\(\(\) => \{/);
    assert.match(createDiffEditorSection, /currentFileData && currentFileData\.projectName === projectName && currentFileData\.filename === filename/);
    assert.match(revertSection, /if \(cancelDiffAutoSave\) \{/);
    assert.match(revertSection, /cancelDiffAutoSave\(\)/);
    assert.match(revertSection, /cancelActiveDiffSave\(\)/);
    assert.match(revertSection, /const projectName = diffProjectName \|\| activeProject/);
    assert.match(revertSection, /const requestSequence = diffRequestSequence/);
    assert.match(revertSection, /\/api\/projects\/\$\{encodeURIComponent\(projectName\)\}\/revert-file/);
    assert.match(revertSection, /if \(requestSequence !== diffRequestSequence \|\| diffProjectName !== projectName\) return/);
    assert.match(revertSection, /if \(activeProject === projectName\) updateGitStatus\(\)/);
    assert.match(saveSection, /currentFileData\.projectName/);
    assert.match(saveSection, /saveDiffContent\(currentFileData\.projectName, currentFileData\.filename, content/);
    assert.match(saveSection, /function abortActiveDiffSave\(\) \{/);
    assert.match(saveSection, /function cancelActiveDiffSave\(\) \{/);
    assert.match(saveSection, /diffSaveSequence \+= 1/);
    assert.match(saveSection, /abortActiveDiffSave\(\)/);
    assert.match(saveSection, /if \(clearPendingDiffAutoSave\) clearPendingDiffAutoSave\(\)/);
    assert.match(saveSection, /async function saveDiffContent\(projectName, filename, content, options = \{\}\)/);
    assert.match(saveSection, /const saveSequence = Number\.isFinite\(options\.sequence\) \? options\.sequence : \+\+diffSaveSequence/);
    assert.match(saveSection, /if \(saveSequence !== diffSaveSequence\) return/);
    assert.match(saveSection, /abortActiveDiffSave\(\)/);
    assert.match(saveSection, /new AbortController\(\)/);
    assert.match(saveSection, /activeDiffSave = \{ projectName, filename, sequence: saveSequence, controller \}/);
    assert.match(saveSection, /fetchJSON\(`\/api\/projects\/\$\{encodeURIComponent\(projectName\)\}\/file`/);
    assert.match(saveSection, /signal: controller \? controller\.signal : undefined/);
    assert.match(saveSection, /activeDiffSave\.sequence !== saveSequence \|\| diffSaveSequence !== saveSequence/);
    assert.match(saveSection, /currentFileData\.projectName === projectName/);
    assert.match(saveSection, /if \(diffBlameEnabled\) loadCurrentDiffBlame\(\)/);
    assert.match(saveSection, /if \(activeProject === projectName && options\.refreshStatus !== false\) updateGitStatus\(\)/);
    assert.match(saveSection, /controller\.signal\.aborted\) \|\| diffSaveSequence !== saveSequence/);
    assert.match(saveSection, /showToast\('Save failed'/);
});

test('find result silent navigation still marks the active result when preview is dirty', () => {
    const start = appJs.indexOf('function selectFindResult');
    const end = appJs.indexOf('function disposeFindPreviewEditor', start);
    const selectFindResultSection = appJs.slice(start, end);

    assert.match(appJs, /function updateFindActiveResult\(idx\)/);
    assert.match(selectFindResultSection, /if \(!shouldPrompt\) \{\s*updateFindActiveResult\(idx\);\s*return;\s*\}/);
    assert.match(selectFindResultSection, /if \(!\(await confirmDiscardFindPreviewChanges\(\)\)\) return;/);
    assert.match(selectFindResultSection, /updateFindActiveResult\(idx\);\s*\/\/ Show preview\s*showFindPreview\(findResults\[idx\]\);/);
});

test('open modals and overlays block app shortcuts through editing context', () => {
    const modalIDsStart = appJs.indexOf('const shortcutBlockingModalIDs');
    const modalIDsEnd = appJs.indexOf('function isEditingShortcutContext', modalIDsStart);
    const modalIDsSection = appJs.slice(modalIDsStart, modalIDsEnd);
    const editingStart = appJs.indexOf('function isEditingShortcutContext');
    const editingEnd = appJs.indexOf('// ─── Keyboard Shortcuts', editingStart);
    const editingSection = appJs.slice(editingStart, editingEnd);
    const electronStart = appJs.indexOf('if (window.electronShortcutInput)');
    const electronEnd = appJs.indexOf('function isEditingShortcutContext', electronStart);
    const electronSection = appJs.slice(electronStart, electronEnd);
    const keyboardStart = appJs.indexOf("document.addEventListener('keydown'");
    const shortcutStart = appJs.indexOf('if (!Keymap.isPotentialShortcutEvent(ev)) return;', keyboardStart);
    const shortcutEnd = appJs.indexOf('dispatchKeymapAction(ev);', shortcutStart) + 'dispatchKeymapAction(ev);'.length;
    const shortcutSection = appJs.slice(shortcutStart, shortcutEnd);

    [
        'setup-overlay',
        'agent-picker-modal',
        'commit-modal',
        'diff-modal',
        'editor-modal',
        'find-modal',
        'goto-file-overlay',
        'goto-project-overlay',
        'settings-modal',
        'command-palette-modal',
        'job-schedule-modal',
        'job-log-modal',
        'shortcuts-modal',
        'keymap-config-modal',
    ].forEach(id => assert.match(modalIDsSection, new RegExp(`'${id}'`)));

    assert.doesNotMatch(appJs, /function isFindModalOpen/);
    assert.match(modalIDsSection, /function isVisibleElement\(id\)/);
    assert.match(modalIDsSection, /function isModalOrOverlayOpen\(\) \{\s*return shortcutBlockingModalIDs\.some\(isVisibleElement\);/);
    assert.match(editingSection, /if \(isModalOrOverlayOpen\(\)\) return true;/);
    assert.match(editingSection, /\^\(INPUT\|TEXTAREA\|SELECT\)\$/);
    assert.match(electronSection, /if \(isEditingShortcutContext\(\)\) return;[\s\S]*dispatchKeymapAction\(shortcutEventFromElectronInput\(input\)\)/);
    assert.match(shortcutSection, /if \(isEditingShortcutContext\(\)\) return;[\s\S]*dispatchKeymapAction\(ev\)/);
});

test('terminal output is passed to xterm without filtering control sequences', () => {
    const terminalStart = appJs.indexOf('function createTerminal');
    const terminalEnd = appJs.indexOf('function showRestartOverlay', terminalStart);
    const terminalSection = appJs.slice(terminalStart, terminalEnd);

    assert.match(terminalSection, /connectTerminalWs\(term, fitAddon, baseWsUrl/);
    assert.match(terminalTransportJs, /term\.write\(bytes, \(\) => \{/);
    assert.doesNotMatch(appJs, /createAltScreenFilter|filterAltScreen|altFilter/);
});

test('all live terminals share parser-acknowledged reconnect transport', () => {
    const sharedStart = appJs.indexOf('function connectTerminalWs');
    const terminalStart = appJs.indexOf('function createTerminal');
    const sharedSection = appJs.slice(sharedStart, terminalStart);
    const terminalEnd = appJs.indexOf('function showRestartOverlay', terminalStart);
    const terminalSection = appJs.slice(terminalStart, terminalEnd);
    const jobStart = appJs.indexOf('function renderJobLogTerminal');
    const jobEnd = appJs.indexOf('function renderJobLogContent', jobStart);
    const jobSection = appJs.slice(jobStart, jobEnd);

    assert.match(sharedSection, /TerminalTransport\.createTerminalConnection/);
    assert.match(sharedSection, /new ResizeObserver\(scheduleFit\)/);
    assert.match(terminalTransportJs, /url\.searchParams\.set\('protocol', '2'\)/);
    assert.match(terminalTransportJs, /url\.searchParams\.set\('cursor', String\(appliedCursor\)\)/);
    assert.match(terminalTransportJs, /term\.write\(bytes, \(\) => \{[\s\S]*appliedCursor = frameEnd/);
    assert.match(terminalTransportJs, /type: 'ack', cursor: appliedCursor/);
    assert.match(terminalTransportJs, /afterWritesApplied\(\(\) => scheduleReconnect\(epoch\)\)/);
    assert.match(terminalTransportJs, /sessionAlive = await options\.isSessionAlive\(\)/);
    assert.match(terminalTransportJs, /if \(!sessionAlive\) \{[\s\S]*setState\('closed'/);
    assert.match(terminalTransportJs, /dataDisposable\?\.dispose/);
    assert.match(jobSection, /jobLogConnection = connectTerminalWs\(term, fitAddon, baseWsUrl/);
    assert.match(jobSection, /isSessionAlive: async \(\) => \{[\s\S]*\/api\/jobs\//);
    assert.match(jobSection, /\[Job session closed\]/);
    assert.doesNotMatch(jobSection, /cursor=0/);

    assert.match(terminalSection, /const connection = connectTerminalWs\(term, fitAddon, baseWsUrl/);
    assert.match(terminalSection, /get ws\(\) \{ return connection\.socket; \}/);
    assert.doesNotMatch(appJs, /createTerminalScrollController|scrollController/);
});

test('terminal fitting preserves tail distance and refreshes after reflow', () => {
    const fitStart = appJs.indexOf('function safeFit');
    const fitEnd = appJs.indexOf('function fitTab', fitStart);
    const fitSection = appJs.slice(fitStart, fitEnd);

    assert.match(fitSection, /const distanceFromBottom = Math\.max\(0, before\.baseY - before\.viewportY\)/);
    assert.match(fitSection, /const wasAtBottom = distanceFromBottom === 0/);
    assert.match(fitSection, /maxScroll - distanceFromBottom/);
    assert.match(fitSection, /t\.term\.scrollToBottom\(\)/);
    assert.match(fitSection, /t\.term\.refresh\(0, Math\.max\(0, t\.term\.rows - 1\)\)/);
    assert.doesNotMatch(fitSection, /scrollController|userScrolledUp/);
});

test('git status refresh does not render stale tab responses', () => {
    const start = appJs.indexOf('async function updateGitStatus');
    const end = appJs.indexOf('let lastGitHtml', start);
    const statusSection = appJs.slice(start, end);

    assert.match(appJs, /let gitStatusRequestSeq = 0;/);
    assert.match(statusSection, /const projectName = activeProject;/);
    assert.match(statusSection, /const requestSeq = \+\+gitStatusRequestSeq;/);
    assert.match(statusSection, /encodeURIComponent\(projectName\)/);
    assert.match(statusSection, /if \(activeProject !== projectName\) return null;/);
    assert.match(statusSection, /if \(requestSeq !== gitStatusRequestSeq\) return status;\s*renderGitStatus\(status, projectName\)/);
    assert.match(statusSection, /renderGitStatusUnavailable\(projectName\)/);
    assert.match(appJs, /el\.dataset\.loading = 'true'/);
    assert.match(statusSection, /gitStatusStateForProject\(projectName\) === 'loading'/);
    assert.match(appJs, /status unavailable/);
});

test('fresh git status starts fetch without blocking response', () => {
    const start = apiGo.indexOf('func (a *apiHandler) handleProjectStatus');
    const end = apiGo.indexOf('func (a *apiHandler) handleProjectPull', start);
    const statusSection = apiGo.slice(start, end);

    assert.match(statusSection, /go a\.fetcher\.FetchIfStale\(dir\)/);
    assert.ok(statusSection.indexOf('go a.fetcher.FetchIfStale(dir)') < statusSection.indexOf('status := getGitStatus(dir)'));
});

test('git pull and checkout errors do not use blocking alerts and refocus terminal', () => {
    const checkoutStart = appJs.indexOf("document.getElementById('git-checkout-main-btn').onclick");
    const pullStart = appJs.indexOf("document.getElementById('git-pull-btn').onclick");
    const runnerStart = appJs.indexOf('// ─── Command Runner', pullStart);
    const checkoutSection = appJs.slice(checkoutStart, pullStart);
    const pullSection = appJs.slice(pullStart, runnerStart);
    const selectStart = appJs.indexOf('async function selectBranch');
    const selectEnd = appJs.indexOf('function closeBranchDropdown', selectStart);
    const selectSection = appJs.slice(selectStart, selectEnd);
    const commandPullStart = appJs.indexOf('async function pullProject');
    const commandPullEnd = appJs.indexOf('async function switchProject', commandPullStart);
    const commandPullSection = appJs.slice(commandPullStart, commandPullEnd);

    assert.match(appJs, /function focusActiveTerminalSoon\(\)/);
    assert.match(appJs, /function compactErrorMessage/);
    for (const section of [checkoutSection, pullSection, selectSection, commandPullSection]) {
        assert.match(section, /showToast/);
        assert.match(section, /focusActiveTerminalSoon\(\)/);
        assert.doesNotMatch(section, /alert\(/);
    }
});

test('git pull and checkout successes show toasts', () => {
    const checkoutStart = appJs.indexOf("document.getElementById('git-checkout-main-btn').onclick");
    const pullStart = appJs.indexOf("document.getElementById('git-pull-btn').onclick");
    const runnerStart = appJs.indexOf('// ─── Command Runner', pullStart);
    const checkoutSection = appJs.slice(checkoutStart, pullStart);
    const pullSection = appJs.slice(pullStart, runnerStart);
    const selectStart = appJs.indexOf('async function selectBranch');
    const selectEnd = appJs.indexOf('function closeBranchDropdown', selectStart);
    const selectSection = appJs.slice(selectStart, selectEnd);
    const commandPullStart = appJs.indexOf('async function pullProject');
    const commandPullEnd = appJs.indexOf('async function switchProject', commandPullStart);
    const commandPullSection = appJs.slice(commandPullStart, commandPullEnd);
    const overviewStart = appJs.indexOf('async function pullAllProjects');
    const overviewEnd = appJs.indexOf('function isCommandPaletteOpen', overviewStart);
    const overviewSection = appJs.slice(overviewStart, overviewEnd);

    assert.match(appJs, /function showGitSuccessToast/);
    assert.match(appJs, /function summarizePullAllResults/);
    assert.match(checkoutSection, /showGitSuccessToast\('Checkout complete'/);
    assert.match(selectSection, /showGitSuccessToast\('Checkout complete'/);
    assert.match(pullSection, /showGitSuccessToast\('Pull complete'/);
    assert.match(commandPullSection, /showGitSuccessToast\('Pull complete'/);
    assert.match(overviewSection, /Pull all complete/);
    assert.match(overviewSection, /showGitSuccessToast\('Pull complete'/);
});

test('session indicators map agent state onto sidebar dots', () => {
    const start = appJs.indexOf('function sessionStateSuffix');
    const end = appJs.indexOf('async function pollSessionStatuses', start);

    const makeElement = () => {
        const classes = new Set();
        return {
            className: '',
            innerHTML: '',
            title: '',
            dataset: {},
            parentElement: null,
            classList: {
                contains: (name) => classes.has(name),
                add: (name) => classes.add(name),
                toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
            },
        };
    };

    const makeDot = (sessionKey, alive = true) => {
        const dot = makeElement();
        dot.dataset.sessionKey = sessionKey;
        if (alive) dot.classList.add('alive');
        const nameSpan = makeElement();
        nameSpan.alert = null;
        nameSpan.querySelector = (selector) =>
            selector === ':scope > .session-alert' ? nameSpan.alert : null;
        dot.parentElement = nameSpan;
        dot.insertAdjacentElement = (_position, el) => {
            el.parentElement = nameSpan;
            el.remove = () => { nameSpan.alert = null; };
            nameSpan.alert = el;
        };
        return dot;
    };

    const dots = [
        makeDot('busy-proj'),
        makeDot('wait-proj'),
        makeDot('idle-proj'),
        makeDot('dead-proj', false),
        makeDot('split-proj'),
        makeDot('completed-proj'),
    ];
    const context = {
        document: {
            querySelectorAll: () => dots,
            createElement: makeElement,
        },
        iconHTML: (name) => `<svg data-name="${name}"></svg>`,
        unseenCompletedTabs: new Set(['completed-proj']),
        panes: { 'split-proj': ['split-proj', 'split-proj#2'] },
        getPaneKeys: (tabKey) => context.panes[tabKey] || [],
        sessionStatuses: {
            'busy-proj': { state: 'shell' },
            'wait-proj': { state: 'waiting', waiting_for: 'permission prompt', remote_control: true },
            'idle-proj': { state: 'idle' },
            'dead-proj': { state: 'busy' },
            'split-proj': { state: 'idle', remote_control: true },
            'split-proj#2': { state: 'waiting', waiting_for: 'permission prompt' },
            'completed-proj': { state: 'completed' },
        },
    };
    vm.runInNewContext(
        `${appJs.slice(start, end)}\nthis.updateSessionIndicators = updateSessionIndicators;\nthis.sessionStateLabel = sessionStateLabel;\nthis.sessionStateSuffix = sessionStateSuffix;`,
        context,
    );

    assert.equal(context.sessionStateSuffix({ state: 'busy' }), ' busy');
    assert.equal(context.sessionStateSuffix({ state: 'shell' }), ' busy');
    assert.equal(context.sessionStateSuffix({ state: 'waiting' }), ' waiting');
	assert.equal(context.sessionStateSuffix({ state: 'completed' }), ' completed');
	assert.equal(context.sessionStateSuffix({ state: 'idle' }), ' idle');
    assert.equal(context.sessionStateSuffix(null), '');
    assert.equal(
        context.sessionStateLabel({ state: 'waiting', waiting_for: 'input needed' }, 'Session running'),
        'Waiting for you: input needed',
    );
    assert.equal(
        context.sessionStateLabel({ state: 'idle', remote_control: true }, 'Session running'),
		'Agent idle · Remote Control active',
    );

    context.updateSessionIndicators();

    const [busy, waiting, idle, dead, split, completed] = dots;
    assert.ok(busy.classList.contains('busy'));
    assert.equal(busy.title, 'Background command running');
    assert.equal(busy.parentElement.alert, null);

    assert.ok(waiting.classList.contains('waiting'));
    assert.ok(waiting.classList.contains('remote'));
    assert.ok(waiting.parentElement.alert);
    assert.match(waiting.parentElement.alert.innerHTML, /data-name="alert-circle"/);
    assert.equal(waiting.title, 'Waiting for you: permission prompt · Remote Control active');

    assert.ok(!idle.classList.contains('busy'));
    assert.ok(!idle.classList.contains('waiting'));
	assert.ok(idle.classList.contains('idle'));
	assert.equal(idle.title, 'Agent idle');

    assert.ok(!dead.classList.contains('busy'));
    assert.equal(dead.title, '');

    assert.ok(split.classList.contains('waiting'));
    assert.ok(split.classList.contains('remote'));
    assert.ok(split.parentElement.alert);
    assert.equal(split.title, 'Waiting for you: permission prompt · Remote Control active');

    assert.ok(completed.classList.contains('completed'));
    assert.ok(completed.classList.contains('unseen'));
    assert.equal(completed.title, 'Task complete · Not viewed yet');

    context.unseenCompletedTabs.delete('completed-proj');
    context.updateSessionIndicators();
    assert.ok(completed.classList.contains('completed'));
    assert.ok(!completed.classList.contains('unseen'));
    assert.equal(completed.title, 'Task complete');

    context.sessionStatuses['split-proj#2'] = { state: 'idle' };
    context.updateSessionIndicators();
    assert.ok(!split.classList.contains('waiting'));
    assert.ok(split.classList.contains('remote'));
    assert.equal(split.parentElement.alert, null);

    context.sessionStatuses['wait-proj'] = { state: 'busy' };
    context.updateSessionIndicators();
    assert.equal(waiting.parentElement.alert, null);
    assert.ok(!waiting.classList.contains('waiting'));
    assert.ok(!waiting.classList.contains('remote'));
});

test('tab dots report the busiest pane in a split tab', () => {
    const start = appJs.indexOf('function tabDotState');
    const end = appJs.indexOf('function sessionStateLabel', start);

    const context = {
        WebSocket: { OPEN: 1 },
        unseenCompletedTabs: new Set(),
        panes: {},
        sessionStatuses: {},
        getPaneKeys: (tabKey) => context.panes[tabKey] || [],
    };
    vm.runInNewContext(
        `${appJs.slice(start, end)}\nthis.tabDotState = tabDotState;\nthis.tabPaneStatus = tabPaneStatus;`,
        context,
    );

    const live = { ws: { readyState: 1 } };
    context.panes.proj = ['proj', 'proj#2'];

    context.sessionStatuses = { proj: { state: 'idle' }, 'proj#2': { state: 'busy' } };
    assert.equal(context.tabDotState(live, 'proj'), 'alive busy');

    context.sessionStatuses = { proj: { state: 'busy' }, 'proj#2': { state: 'waiting' } };
    assert.equal(context.tabDotState(live, 'proj'), 'alive waiting');

    context.sessionStatuses = { proj: { state: 'idle' }, 'proj#2': { state: 'idle' } };
	assert.equal(context.tabDotState(live, 'proj'), 'alive idle');

	context.sessionStatuses = { proj: { state: 'idle' }, 'proj#2': { state: 'completed' } };
	assert.equal(context.tabDotState(live, 'proj'), 'alive completed');
	context.unseenCompletedTabs.add('proj');
	assert.equal(context.tabDotState(live, 'proj'), 'alive completed unseen');
	context.unseenCompletedTabs.clear();

    context.sessionStatuses = { proj: { state: 'idle', remote_control: true }, 'proj#2': { state: 'shell' } };
    const aggregated = context.tabPaneStatus('proj');
    assert.equal(aggregated.state, 'shell');
    assert.equal(aggregated.remote_control, true);
    assert.equal(context.sessionStatuses['proj#2'].remote_control, undefined);

    context.panes = {};
    context.sessionStatuses = { proj: { state: 'busy' } };
    assert.equal(context.tabDotState(live, 'proj'), 'alive busy');

    context.sessionStatuses = { 'proj#2': { state: 'busy' }, 'proj@wt': { state: 'idle' } };
    assert.equal(context.tabDotState(live, 'proj'), 'alive busy');

    assert.equal(context.tabDotState({ ws: { readyState: 3 } }, 'proj'), 'dead');
    assert.match(appJs, /dot\.setAttribute\('aria-label', dot\.title\)/);
    assert.match(styleCss, /\.terminal-tab \.tab-dot\.alive\s*\{[^}]*background:\s*var\(--accent\)/s);
    assert.match(styleCss, /\.terminal-tab \.tab-dot\.dead\s*\{[^}]*background:\s*var\(--red\)/s);
    assert.match(styleCss, /\.terminal-tab \.tab-dot\.busy\s*\{[^}]*box-shadow:\s*0 0 6px var\(--cyan\)/s);
    assert.match(styleCss, /\.terminal-tab \.tab-dot\.waiting\s*\{[^}]*0 0 7px var\(--yellow\)/s);
    assert.match(styleCss, /\.terminal-tab \.tab-dot\.completed\s*\{[^}]*background:\s*var\(--green\)/s);
    assert.match(styleCss, /\.terminal-tab \.tab-dot\.completed\.unseen\s*\{[^}]*completed-unseen-pulse/s);
    assert.match(styleCss, /\.terminal-tab \.tab-dot\.idle\s*\{[^}]*background:\s*var\(--text-dim\)/s);
});

test('completed tabs stay highlighted until that tab is viewed', () => {
    const start = appJs.indexOf('function sessionStateSuffix');
    const end = appJs.indexOf('function sessionStateLabel', start);
    const context = {
        activeTab: 'active-proj',
        overviewActive: false,
        jobsActive: false,
        databaseActive: false,
        unseenCompletedTabs: new Set(),
        previousTabSessionStates: new Map(),
        panes: {
            'active-proj': ['active-proj'],
            'background-proj': ['background-proj'],
        },
        sessionStatuses: {
            'active-proj': { state: 'busy' },
            'background-proj': { state: 'busy' },
        },
        getTabKeys: () => ['active-proj', 'background-proj'],
        getPaneKeys: (tabKey) => context.panes[tabKey] || [],
    };
    vm.runInNewContext(
        `${appJs.slice(start, end)}\nthis.updateUnseenCompletedTabs = updateUnseenCompletedTabs;\nthis.markTabCompletionSeen = markTabCompletionSeen;\nthis.markVisibleTabCompletionSeen = markVisibleTabCompletionSeen;`,
        context,
    );

    context.updateUnseenCompletedTabs();
    context.sessionStatuses['background-proj'] = { state: 'completed' };
    assert.equal(context.updateUnseenCompletedTabs(), true);
    assert.ok(context.unseenCompletedTabs.has('background-proj'));

    assert.equal(context.markTabCompletionSeen('background-proj'), true);
    assert.ok(!context.unseenCompletedTabs.has('background-proj'));
    assert.equal(context.updateUnseenCompletedTabs(), false);
    assert.ok(!context.unseenCompletedTabs.has('background-proj'));

    context.sessionStatuses['background-proj'] = { state: 'busy' };
    context.updateUnseenCompletedTabs();
    context.sessionStatuses['background-proj'] = { state: 'completed' };
    context.updateUnseenCompletedTabs();
    assert.ok(context.unseenCompletedTabs.has('background-proj'));

    context.activeTab = 'background-proj';
    context.updateUnseenCompletedTabs();
    assert.ok(!context.unseenCompletedTabs.has('background-proj'));

    context.overviewActive = true;
    context.sessionStatuses['background-proj'] = { state: 'busy' };
    context.updateUnseenCompletedTabs();
    context.sessionStatuses['background-proj'] = { state: 'completed' };
    context.updateUnseenCompletedTabs();
    assert.ok(context.unseenCompletedTabs.has('background-proj'));
    assert.equal(context.markVisibleTabCompletionSeen(), false);

    context.overviewActive = false;
    context.updateSessionIndicators = () => { context.indicatorUpdates = (context.indicatorUpdates || 0) + 1; };
    context.renderTabs = () => { context.tabRenders = (context.tabRenders || 0) + 1; };
    assert.equal(context.markVisibleTabCompletionSeen(), true);
    assert.ok(!context.unseenCompletedTabs.has('background-proj'));
    assert.equal(context.indicatorUpdates, 1);
    assert.equal(context.tabRenders, 1);
});

test('leaving auxiliary views immediately marks the revealed terminal tab as seen', () => {
    const databaseToggleStart = appJs.indexOf('function toggleDatabase()');
    const databaseToggle = appJs.slice(
        databaseToggleStart,
        appJs.indexOf('function initDatabase()', databaseToggleStart),
    );
    const jobsToggleStart = appJs.indexOf('function toggleJobs()');
    const jobsToggle = appJs.slice(
        jobsToggleStart,
        appJs.indexOf('function startJobsPoll()', jobsToggleStart),
    );
    const overviewToggleStart = appJs.indexOf('function toggleOverview()');
    const overviewToggle = appJs.slice(
        overviewToggleStart,
        appJs.indexOf("document.getElementById('overview-btn')", overviewToggleStart),
    );
    const escapeHandlerEnd = appJs.indexOf("if (document.getElementById('goto-project-overlay')");
    const escapeHandler = appJs.slice(
        appJs.lastIndexOf('if (overviewActive) {', escapeHandlerEnd),
        escapeHandlerEnd,
    );

    assert.match(databaseToggle, /hideDatabase\(\);\n\s+markVisibleTabCompletionSeen\(\);/);
    assert.match(jobsToggle, /hideJobs\(\);\n\s+markVisibleTabCompletionSeen\(\);/);
    assert.match(overviewToggle, /hideOverview\(\);\n\s+markVisibleTabCompletionSeen\(\);/);
    assert.equal(escapeHandler.match(/markVisibleTabCompletionSeen\(\);/g)?.length, 3);
});

test('tab render metadata changes when the status label changes', () => {
    const start = appJs.indexOf('function tabDotState');
    const end = appJs.indexOf('function updateSessionIndicators', start);
    const context = {
        WebSocket: { OPEN: 1 },
        unseenCompletedTabs: new Set(),
        panes: { proj: ['proj'] },
        sessionStatuses: {
            proj: { state: 'waiting', waiting_for: 'approval', remote_control: false },
        },
        getPaneKeys: (tabKey) => context.panes[tabKey] || [],
    };
    vm.runInNewContext(
        `${appJs.slice(start, end)}\nthis.tabIndicatorState = tabIndicatorState;`,
        context,
    );

    const live = { ws: { readyState: 1 } };
    const before = context.tabIndicatorState(live, 'proj');
    context.sessionStatuses.proj = { state: 'waiting', waiting_for: 'answer', remote_control: true };
    const after = context.tabIndicatorState(live, 'proj');

    assert.equal(before.dotState, after.dotState);
    assert.equal(before.label, 'Waiting for you: approval');
    assert.equal(after.label, 'Waiting for you: answer · Remote Control active');
    assert.match(appJs, /indicator\.dotState, indicator\.label/);

    context.sessionStatuses.proj = { state: 'completed' };
    context.unseenCompletedTabs.add('proj');
    const completed = context.tabIndicatorState(live, 'proj');
    assert.equal(completed.dotState, 'alive completed unseen');
    assert.equal(completed.label, 'Task complete · Not viewed yet');
});

test('sidebar and overview dots read the same aggregated pane status', () => {
    assert.match(appJs, /const tabKey = dot\.dataset\.sessionKey;\n\s+const status = tabPaneStatus\(tabKey\);/);
    assert.equal(apiGo.match(/GetProjectSessionInfo\(p(roj)?\.Name\)/g).length, 3);
    assert.match(ptyManagerGo, /func \(m \*Manager\) GetProjectSessionInfo\(name string\) SessionInfo \{/);
    assert.match(ptyManagerGo, /strings\.HasPrefix\(key, name\+"#"\)/);
    assert.match(
        appJs,
        /const status = p\.session_alive\n\s+\? tabPaneStatus\(p\.name\)\n\s+\|\| \{ state: p\.session_state,/,
    );
    assert.match(styleCss, /\.session-dot\.alive\s*\{[^}]*background:\s*var\(--accent\)/s);
    assert.match(styleCss, /\.overview-dot\.alive\s*\{[^}]*background:\s*var\(--accent\)/s);
    assert.match(styleCss, /\.session-dot\.completed\s*\{[^}]*background:\s*var\(--green\)/s);
    assert.match(styleCss, /\.overview-dot\.completed\s*\{[^}]*background:\s*var\(--green\)/s);
    assert.match(styleCss, /\.session-dot\.completed\.unseen\s*\{[^}]*completed-unseen-pulse/s);
    assert.match(styleCss, /\.overview-dot\.completed\.unseen\s*\{[^}]*completed-unseen-pulse/s);
    assert.match(appJs, /isCompletedTabUnseen\(p\.name, status\) \? ' unseen' : ''/);
});

test('side-panel collapse pillars resize both panels by pointer drag', () => {
    const resizeStart = appJs.indexOf('const SIDE_PANEL_MIN_WIDTH');
    const resizeEnd = appJs.indexOf('// ─── Start', resizeStart);
    const resizeSection = appJs.slice(resizeStart, resizeEnd);

    assert.match(indexHtml, /<button id="sidebar-collapse-btn"[^>]*aria-expanded="true"/);
    assert.match(indexHtml, /<button id="git-panel-collapse-btn"[^>]*aria-expanded="true"/);
    assert.match(styleCss, /#sidebar\s*\{[^}]*width:\s*var\(--side-panel-width, 320px\)/s);
    assert.match(styleCss, /#git-panel\s*\{[^}]*width:\s*var\(--side-panel-width, 360px\)/s);
    assert.match(styleCss, /#sidebar-collapse-btn,\s*#git-panel-collapse-btn\s*\{[^}]*cursor:\s*col-resize/s);
    assert.match(resizeSection, /function bindResizableSidePanel\(/);
    assert.match(resizeSection, /handle\.addEventListener\('pointerdown'/);
    assert.match(resizeSection, /handle\.setPointerCapture\?\.\(ev\.pointerId\)/);
    assert.match(resizeSection, /document\.addEventListener\('pointermove', onPointerMove\)/);
    assert.match(resizeSection, /side === 'left' \? pointerDelta : -pointerDelta/);
    assert.match(resizeSection, /if \(panel\.classList\.contains\('collapsed'\)\) setCollapsed\(false\)/);
    assert.match(resizeSection, /sidePanelResizeStates\.get\(otherPanel\.id\)/);
    assert.match(resizeSection, /otherState\?\.expandedWidth \?\? otherPanel\.getBoundingClientRect\(\)\.width/);
    assert.match(resizeSection, /startWidth: panel\.classList\.contains\('collapsed'\) \? 0 : \(renderedWidth \|\| expandedWidth\)/);
    assert.match(resizeSection, /sidePanelBindings\.forEach\(binding => binding\.initialize\(\)\)/);
    assert.match(appJs.slice(appJs.indexOf('function updateSidePanels'), appJs.indexOf('// ─── GitHub Today')), /reclampSidePanelWidths\(\)/);
    assert.match(resizeSection, /suppressNextClick = ev\.type === 'pointerup'/);
    assert.match(resizeSection, /storageKey: 'sidebar-panel-width'/);
    assert.match(resizeSection, /storageKey: 'git-panel-width'/);
});

test('session status and power state are polled independently of the project list', () => {
    const start = appJs.indexOf('async function pollSessionStatuses');
    const end = appJs.indexOf('function renderTabs', start);
    const pollSection = appJs.slice(start, end);

    assert.match(pollSection, /fetchJSON\('\/api\/sessions\/status'\)/);
    assert.match(pollSection, /const unseenChanged = updateUnseenCompletedTabs\(\)/);
    assert.match(pollSection, /if \(changed \|\| unseenChanged\) renderTabs\(\)/);
    assert.match(pollSection, /fetchJSON\('\/api\/power'\)/);
    assert.match(pollSection, /sleep-blocker-indicator/);
    assert.match(appJs, /setInterval\(pollSessionStatuses, 2000\)/);
    assert.match(appJs, /setInterval\(pollPowerState, 10000\)/);
    assert.match(serverGo, /GET \/api\/sessions\/status/);
    assert.match(serverGo, /GET \/api\/power/);
    assert.match(cmdMainGo, /manager\.StartStatusProbe\(time\.Second\)/);
    assert.match(styleCss, /\.session-dot\.waiting \{/);
	assert.match(styleCss, /\.session-dot\.completed \{/);
    assert.match(styleCss, /\.session-alert \{/);
    assert.match(iconsJs, /'alert-circle':/);
});

test('sleep prevention keeps the system awake without keeping the display on', () => {
    assert.match(electronMainJs, /powerSaveBlocker\.start\("prevent-app-suspension"\)/);
    assert.doesNotMatch(electronMainJs, /prevent-display-sleep/);
    assert.match(electronMainJs, /startPowerPolling\(port\)/);
    assert.match(electronMainJs, /function killGoProcess\(\) \{\n  releasePowerBlocker\(\);/);
    assert.match(electronMainJs, /const POWER_POLL_INTERVAL_MS = 10000;/);
    assert.match(indexHtml, /id="settings-prevent-sleep"/);
    assert.match(appJs, /disable_sleep_prevention: !preventSleepSetting/);
    assert.match(appJs, /preventSleepWhileActive = !\(cfg && cfg\.disable_sleep_prevention\)/);
    assert.match(configGo, /DisableSleepPrevention\s+bool/);
    assert.match(apiGo, /cfg\.DisableSleepPrevention = \*p\.DisableSleepPrevent/);
});

test('the orr routing proxy is gone', () => {
    assert.doesNotMatch(indexHtml, /orr-modal|settings-orr-autostart/);
    assert.doesNotMatch(appJs, /\/api\/orr|orrAutostart|openOrrConsole/);
    assert.doesNotMatch(serverGo, /\/api\/orr/);
    assert.doesNotMatch(configGo, /DisableOrrAutostart/);
});

test('opencode is a built-in provider that custom integrations cannot shadow', () => {
    const providersStart = appJs.indexOf('const BUILT_IN_AI_PROVIDERS');
    const providersEnd = appJs.indexOf('function hasPrimaryModifier', providersStart);
    const cliStart = appJs.indexOf('function normalizeCLI(cli)');
    const cliEnd = appJs.indexOf('function renderTerminalProviderSwitcher', cliStart);
    assert.ok(providersStart >= 0 && providersEnd > providersStart);

    const code = `
        const assert = require('node:assert/strict');
        let currentCLI = 'claude';
        let runtimeCapabilities = null;
        let terminals = {};
        ${appJs.slice(providersStart, providersEnd)}
        ${appJs.slice(cliStart, cliEnd)}

        refreshAIProviders([]);
        const opencode = AI_PROVIDER_BY_VALUE['opencode'];
        assert.ok(opencode, 'opencode missing from the built-in providers');
        assert.equal(opencode.dangerousFlag, '--auto');
        assert.equal(opencode.custom, false);
        assert.equal(normalizeCLI('opencode'), 'opencode');

        refreshAIProviders([{ id: 'opencode', name: 'Hijacked', command: 'hijacked' }]);
        assert.equal(AI_PROVIDER_BY_VALUE['opencode'].dangerousFlag, '--auto');
        assert.equal(AI_PROVIDER_BY_VALUE['opencode'].custom, false);
    `;
    vm.runInNewContext(code, { require, console });
});

function buildAppDialogHarness({ deferTimers = false, terminalVisible = false } = {}) {
    const start = appJs.indexOf('function restoreFocusAfterDialog');
    const end = appJs.indexOf('function stopTerminalSession', start);
    assert.ok(start >= 0 && end > start);

    const nodes = {};
    const documentListeners = {};
    const focused = [];
    const timers = [];
    ['app-dialog-modal', 'app-dialog-backdrop', 'app-dialog-message', 'app-dialog-input', 'app-dialog-cancel', 'app-dialog-confirm']
        .forEach(id => {
            nodes[id] = {
                style: { display: id === 'app-dialog-modal' ? 'none' : '' },
                value: '',
                textContent: '',
                listeners: {},
                addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
                click() { (this.listeners.click || []).forEach(fn => fn({})); },
                focus() { focused.push(id); },
                select() {},
            };
        });
    const context = {
        Promise,
        String,
        document: {
            activeElement: null,
            getElementById: id => nodes[id] || null,
            addEventListener: (type, fn) => { (documentListeners[type] = documentListeners[type] || []).push(fn); },
        },
        window: { setTimeout: fn => { if (deferTimers) timers.push(fn); else fn(); } },
        isTextFocusElement: () => false,
        isTerminalVisible: () => terminalVisible,
        focusActiveTerminal: () => { focused.push('terminal'); },
    };

    vm.runInNewContext(`
        ${appJs.slice(start, end)}
        this.appConfirm = appConfirm;
        this.appPrompt = appPrompt;
    `, context);

    return {
        nodes,
        focused,
        appConfirm: context.appConfirm,
        appPrompt: context.appPrompt,
        pressKey: (key, extra = {}) => {
            const calls = { prevented: 0, stopped: 0 };
            const ev = {
                key,
                ...extra,
                preventDefault() { calls.prevented += 1; },
                stopPropagation() { calls.stopped += 1; },
            };
            (documentListeners.keydown || []).forEach(fn => fn(ev));
            return calls;
        },
        flushTimers: () => { while (timers.length) timers.shift()(); },
    };
}

test('in-app dialog resolves confirm and prompt from its own controls', async () => {
    const { nodes, appConfirm, appPrompt, pressKey } = buildAppDialogHarness();

    const modal = nodes['app-dialog-modal'];
    const accepted = appConfirm('Revert ALL changes in demo?\nThis discards everything.');
    assert.equal(modal.style.display, 'flex');
    assert.equal(nodes['app-dialog-message'].textContent, 'Revert ALL changes in demo?\nThis discards everything.');
    assert.equal(nodes['app-dialog-input'].style.display, 'none');
    nodes['app-dialog-confirm'].click();
    assert.equal(await accepted, true);
    assert.equal(modal.style.display, 'none');

    const dismissed = appConfirm('Delete job "nightly"?');
    nodes['app-dialog-backdrop'].click();
    assert.equal(await dismissed, false);

    const renamed = appPrompt('Rename file:', 'draft.txt');
    assert.equal(nodes['app-dialog-input'].style.display, '');
    assert.equal(nodes['app-dialog-input'].value, 'draft.txt');
    nodes['app-dialog-input'].value = 'notes.md';
    pressKey('Enter');
    assert.equal(await renamed, 'notes.md');

    const abandoned = appPrompt('New file name:', '');
    pressKey('Escape');
    assert.equal(await abandoned, null);
    assert.equal(modal.style.display, 'none');
});

test('in-app dialog leaves keys to an in-flight IME composition', async () => {
    const { nodes, appPrompt, pressKey } = buildAppDialogHarness();

    let settled = false;
    const renamed = appPrompt('Rename file:', '').then(value => { settled = true; return value; });
    nodes['app-dialog-input'].value = 'partial';
    const composedEnter = pressKey('Enter', { isComposing: true });
    const composedEscape = pressKey('Escape', { keyCode: 229 });
    await Promise.resolve();
    assert.equal(settled, false);
    assert.deepEqual(composedEnter, { prevented: 0, stopped: 1 });
    assert.deepEqual(composedEscape, { prevented: 0, stopped: 1 });

    nodes['app-dialog-input'].value = 'final';
    pressKey('Enter');
    assert.equal(await renamed, 'final');
});

test('a dialog opened from a settled dialog keeps focus off the terminal', async () => {
    const { nodes, appConfirm, appPrompt, focused, flushTimers } = buildAppDialogHarness({
        deferTimers: true,
        terminalVisible: true,
    });

    const deleted = appConfirm('Delete worktree?');
    flushTimers();
    nodes['app-dialog-confirm'].click();

    assert.equal(await deleted, true);
    const branch = appPrompt('Also delete branch:', 'feature');
    flushTimers();

    assert.ok(!focused.includes('terminal'));
    assert.equal(focused.at(-1), 'app-dialog-input');
    assert.equal(nodes['app-dialog-modal'].style.display, 'flex');

    nodes['app-dialog-cancel'].click();
    assert.equal(await branch, null);
    flushTimers();
    assert.equal(focused.at(-1), 'terminal');
});

test('overlay modal containers stay fixed full-screen layers', () => {
    const declarationsFor = selector => {
        const bodies = [];
        const rule = /([^{}]+)\{([^{}]*)\}/g;
        let match;
        while ((match = rule.exec(styleCss)) !== null) {
            if (match[1].split(',').some(part => part.trim() === selector)) bodies.push(match[2]);
        }
        return bodies.join('\n');
    };

    // A container that loses `position: fixed` still opens on click, but lays
    // out in normal flow below the fold, which reads as "the button does
    // nothing". Keep every JS-toggled overlay pinned to the viewport.
    for (const id of [
        'command-palette-modal',
        'database-password-modal',
        'shortcuts-modal',
        'keymap-config-modal',
    ]) {
        const declarations = declarationsFor(`#${id}`);
        assert.match(declarations, /position:\s*fixed/, `#${id} must be a fixed overlay`);
        assert.match(declarations, /inset:\s*0/, `#${id} must cover the viewport`);
    }

    for (const id of [
        'command-palette-content',
        'shortcuts-modal-content',
        'keymap-config-content',
    ]) {
        const declarations = declarationsFor(`#${id}`);
        assert.match(declarations, /position:\s*relative/, `#${id} must sit above its backdrop`);
        assert.match(declarations, /max-height:/, `#${id} must bound its height`);
    }

    for (const id of ['command-palette-backdrop', 'shortcuts-modal-backdrop', 'keymap-config-backdrop']) {
        assert.match(declarationsFor(`#${id}`), /position:\s*absolute/, `#${id} must fill its overlay`);
    }
});
