(function () {
    'use strict';

 const Icons = window.AgentDeckIcons;
 if (!Icons) throw new Error('Icons module missing');
 const iconHTML = Icons.iconHTML;
 const hydrateIcons = Icons.hydrateIcons;

    const terminals = {};   // session key → terminal-backed pane or special-tab entry
    const tabState = {};    // tab key → { panes: [sessionKey], focusedPane: sessionKey }
    const tabOrder = [];    // tab keys in their visible and persisted order
    const DEFAULT_TERMINAL_FONT_SIZE = 13;
    const MIN_TERMINAL_FONT_SIZE = 8;
    const MAX_TERMINAL_FONT_SIZE = 32;
    let projects = [];
    let activeProject = null; // repository shown by Git, editor, and project actions
    let activeTab = null;     // tab owning the focused terminal session
    let tabSwitchRequestSeq = 0;
    let workspaces = [];
    let workspaceEditingID = null;
    let workspaceDraftProjects = new Set();
    let workspaceChoiceAnchor = null; // last clicked project key, for Shift-click ranges
    let workspaceSaveQueue = Promise.resolve();
    let workspaceSaving = false;
    let currentCLI = 'claude';
    let gitPollTimer = null;
    let gitPollIntervalMs = 0;
    let badgePollTimer = null;
    let badges = {};        // name → { dirty_count }
    let searchFilter = '';
    let expandedProjects = {};  // name → true if expanded
    let worktreeCache = {};     // name → [{ name, branch, path }]
    let overviewFilter = 'all';
    let jobsActive = false;
    let databaseActive = false;
    let jobsPollTimer = null;
    let jobsLoadedOnce = false;
    let jobStatusSnapshots = {};
    let pendingJobNotifications = {};
    let jobEditingID = '';
    let jobLogTerm = null;
    let jobLogConnection = null;
    let jobLogFit = null;
    let jobLogMode = 'terminal';
    let jobLogInfo = null;
    let jobSchedulePreviewTimer = null;
    let jobSchedulePreviewSeq = 0;
    let jobScheduleValid = true;
    let jobSchedulePreviewBlocksSave = false;
    let jobScheduleValidationMessage = '';
    let jobSaving = false;
    let activityPollTimer = null;
    let activityPollKey = '';
    let usagePollTimer = null;
    let settingsCapabilities = null;
    let runtimeCapabilities = null;
    let providerSwitchInFlight = false;
    let dangerousPermissions = {};
    // The code host whose activity the right panel shows ('' for none). Each
    // id matches its backend route, GET /api/<id>/activity/today.
    const ACTIVITY_PROVIDERS = {
        github: { name: 'GitHub', pullRequests: 'PR' },
        gitlab: { name: 'GitLab', pullRequests: 'MR' },
    };
    let activityProvider = '';
    let gitlabHost = '';
    // Each entry is one CLI whose usage the right panel can show: the usage box
    // gets a tab per enabled provider and Settings a set of rows per provider.
    // The id matches the backend's usageProvider name (GET /api/<id>/usage)
    // and prefixes its config fields (show_<id>_usage, <id>_billing,
    // <id>_monthly_budget). dependency is its key in /api/capabilities.
    const USAGE_PROVIDERS = [
        {
            id: 'claude',
            label: 'Claude',
            cliName: 'Claude Code',
            dependency: 'claude',
            description: 'Estimated API cost of your Claude Code sessions in the right panel.',
            subscription: 'Subscription (Pro, Max)',
            limitsHint: 'Plan limits: open Claude Code to sign in',
        },
        {
            id: 'codex',
            label: 'Codex',
            cliName: 'Codex CLI',
            dependency: 'openai',
            description: 'Token use and estimated cost in the right panel.',
            subscription: 'Subscription (ChatGPT)',
        },
    ];
    // Per provider: its settings from config, the last response, and the
    // load in flight.
    const usageState = Object.fromEntries(USAGE_PROVIDERS.map(provider => [provider.id, {
        show: false,
        billing: '',
        budget: 0,
        data: null,
        error: '',
        loadPromise: null,
        loadIsFresh: false,
    }]));
    let startupGitPullFFOnly = false;
    let preventSleepWhileActive = true;
    let sessionStatuses = {};  // session key → { state, waiting_for, remote_control }
    const unseenCompletedTabs = new Set();
    const previousTabSessionStates = new Map();
    let terminalFontSize = DEFAULT_TERMINAL_FONT_SIZE;
    let projectTags = {};
    let databaseConnections = [];
    let databaseOrphanedQueries = [];
    let settingsDatabaseConnections = [];
    let settingsDatabaseEditingID = '';
    let selectedDatabaseID = '';
    let expandedDatabaseConnectionID = '';
    let databaseConnectionTreeTouched = false;
    let collapsedDatabaseTreeSections = {};
    let databaseSchemaCacheByConnection = {};
    let databaseSchemaLoadingByConnection = {};
    let databaseSchemaErrorByConnection = {};
let databaseSchemaRequestSeqByConnection = {};
let databaseSchemaConnectionSignatures = {};
let databaseConnectedByConnection = {};
let databaseConnectedAtByConnection = {};
let databaseConnectedExpiryTimers = {};
let databaseQueryTabs = [];
    let databaseQueryTabsLoaded = false;
    let databaseActiveQueryTabID = '';
    let databaseResultTabs = [];
    let databaseActiveResultTabID = '';
    let databaseActiveTabKind = 'query';
    let databaseLastResult = null;
    let databaseQueryInFlight = false;
    let databaseQueryStartedAt = 0;
    let databaseQueryProgressTimer = null;
    let databaseQueryAbortController = null;
    let databaseQueryCancelRequested = false;
    let databaseQueryProgressLabel = '';
    let databasePasswordPrompt = null;
    let textInputRequest = null;
    let databaseTableCountStatus = null;
    let databaseQueryEditor = null;
    let databaseQueryEditorSyncing = false;
    let databaseSQLCompletionRegistered = false;
    let databaseWhereEditor = null;
    let databaseWhereEditorSyncing = false;
    let databaseWhereCompletionModels = new WeakMap();
    let settingsProjectTags = {};
    let settingsDangerousPermissions = {};
    let settingsPendingCLIRenames = [];
    let commandPaletteItems = [];
    let commandPaletteIndex = 0;
    let keymapState = null;
    let keymapDraftState = null;
    let keymapSearchQuery = '';
    let keymapCaptureCommandID = '';
    let keymapSaveInFlight = false;
    let sessionRestartInFlight = false;
    let projectRescanInFlight = false;
    let devReloadTimer = null;
    const COMMAND_PALETTE_RENDER_LIMIT = 80;
    const CONFIG_SAVE_TIMEOUT_MS = 10000;
const DATABASE_CONNECTION_STATUS_TTL_MS = 5 * 60 * 1000;
const SQL_FORMATTER_LOCAL_SRC = '/vendor/sql-formatter/sql-formatter.min.js';
let sqlFormatterLoadPromise = null;
    const isMacOS = (() => {
        const platform = navigator.userAgentData?.platform || navigator.platform || '';
        return /Mac|iPhone|iPad|iPod/i.test(platform);
    })();
    const PRIMARY_MODIFIER_LABEL = isMacOS ? 'Cmd' : 'Ctrl';
    const Keymap = window.AgentDeckKeymap;
    if (!Keymap) throw new Error('Keymap module missing');
    keymapState = Keymap.normalizeConfig({}, { isMacOS });
const BUILT_IN_AI_PROVIDERS = [
	{
		value: 'claude',
		shortLabel: 'Claude',
            settingsLabel: 'Claude (claude)',
            dangerousLabel: 'Claude permission bypass',
            dangerousFlag: '--dangerously-skip-permissions',
        },
        {
            value: 'cursor',
            shortLabel: 'Cursor CLI',
            settingsLabel: 'Cursor CLI (cursor-agent)',
            dangerousLabel: 'Cursor force mode',
            dangerousFlag: '-f',
        },
        {
            value: 'openai',
            shortLabel: 'OpenAI Codex',
            settingsLabel: 'OpenAI Codex (codex)',
            dangerousLabel: 'Codex approval/sandbox bypass',
            dangerousFlag: '--dangerously-bypass-approvals-and-sandbox',
        },
	{
		value: 'gemini',
		shortLabel: 'Gemini',
		settingsLabel: 'Gemini (gemini)',
		dangerousLabel: 'Gemini yolo mode',
		dangerousFlag: '--yolo',
	},
	{
		value: 'opencode',
		shortLabel: 'opencode',
		settingsLabel: 'opencode (opencode)',
		dangerousLabel: 'opencode auto-approve',
		dangerousFlag: '--auto',
	},
	{
		value: 'kimi',
		shortLabel: 'Kimi',
		settingsLabel: 'Kimi (kimi)',
		dangerousLabel: 'Kimi never-ask mode',
		dangerousFlag: '--auto',
	},
];
let customCLIIntegrations = [];
let AI_PROVIDERS = [];
let AI_PROVIDER_BY_VALUE = {};

function normalizeCLIIntegration(integration) {
	if (!integration || typeof integration !== 'object') return null;
	const id = String(integration.id || '').trim();
	const command = String(integration.command || '').trim();
	if (!id || !command) return null;
	const name = String(integration.name || '').trim() || id;
	return {
		id,
		name,
		command,
		resume_command: String(integration.resume_command || '').trim(),
		check_command: String(integration.check_command || '').trim(),
	};
}

function normalizeCLIIntegrations(integrations) {
	if (!Array.isArray(integrations)) return [];
	const byID = new Map();
	integrations.forEach(integration => {
		const normalized = normalizeCLIIntegration(integration);
		if (normalized && !BUILT_IN_AI_PROVIDERS.some(provider => provider.value === normalized.id)) byID.set(normalized.id, normalized);
	});
	return Array.from(byID.values());
}

function providerFromIntegration(integration) {
	const suffix = integration.command ? ` (${integration.command})` : '';
	return {
		value: integration.id,
		shortLabel: integration.name,
		settingsLabel: `${integration.name}${suffix}`,
		dangerousLabel: '',
		dangerousFlag: '',
		custom: true,
	};
}

function buildAIProviderState(integrations) {
	const normalizedIntegrations = normalizeCLIIntegrations(integrations);
	const providers = BUILT_IN_AI_PROVIDERS.map(provider => ({ ...provider, custom: false }));
	normalizedIntegrations.forEach(integration => {
		const provider = providerFromIntegration(integration);
		const idx = providers.findIndex(item => item.value === provider.value);
		if (idx >= 0) providers[idx] = provider;
		else providers.push(provider);
	});
	return { providers, integrations: normalizedIntegrations };
}

function refreshAIProviders(integrations) {
	const state = buildAIProviderState(integrations);
	customCLIIntegrations = state.integrations;
	AI_PROVIDERS = state.providers;
	AI_PROVIDER_BY_VALUE = AI_PROVIDERS.reduce((acc, provider) => {
		acc[provider.value] = provider;
		return acc;
	}, {});
}

refreshAIProviders([]);

    function hasPrimaryModifier(ev) {
        return Keymap.hasPrimaryModifier(ev, keymapOptions());
    }

    function matchesPrimaryShortcut(ev, { keys, shift = false, alt = false } = {}) {
        const keyList = Array.isArray(keys) ? keys : [keys];
        return keyList.some(key => {
            const parts = ['Primary'];
            if (shift) parts.push('Shift');
            if (alt) parts.push('Alt');
            parts.push(key);
            return Keymap.eventMatchesShortcut(parts.join('+'), ev, keymapOptions());
        });
    }

    function formatShortcut(parts) {
        return Keymap.shortcutLabel(parts.filter(Boolean).join('+'), keymapOptions());
    }

    function titleWithShortcut(label, shortcut) {
        return shortcut ? `${label} (${shortcut})` : label;
    }

    function keymapOptions() {
        return { isMacOS, primaryLabel: PRIMARY_MODIFIER_LABEL };
    }

    function commandShortcutLabel(commandID, state = keymapState) {
        return Keymap.commandShortcutLabel(state, commandID, keymapOptions());
    }

    // The version, such as 1.2.0 or 1.2.0-dev+abc1234 for a dev build, with the
    // commit date in the tooltip. Builds without a version show the date.
    function renderBuildInfo(info) {
        const el = document.getElementById('build-info');
        if (!el) return;
        const version = info && info.version ? String(info.version) : '';
        const commitDate = info && info.commit_date ? String(info.commit_date) : '';
        el.textContent = version || commitDate || 'unknown';
        el.title = [version && `Version ${version}`, commitDate && `committed ${commitDate}`]
            .filter(Boolean).join(', ') || 'unknown';
    }

    async function loadBuildInfo() {
        try {
            renderBuildInfo(await fetchJSON('/api/build'));
        } catch {
            renderBuildInfo(null);
        }
    }

    function shouldBlockTerminalShortcut(ev) {
        if (isAgentPickerOpen()) return true;
        if (!Keymap.isPotentialShortcutEvent(ev)) return false;
        if (isTerminalCopyShortcut(ev)) return false;
        return !!keymapCommandForEvent(ev);
    }

    function isTerminalCopyShortcut(ev) {
        return matchesPrimaryShortcut(ev, { keys: ['C', 'c'], shift: true });
    }

    function updateShortcutLabels() {
        const labels = {
            toggleSidebar: commandShortcutLabel('app.toggleSidebar'),
            toggleRightPanel: commandShortcutLabel('app.toggleRightPanel'),
            overview: commandShortcutLabel('app.toggleOverview'),
            jobs: commandShortcutLabel('app.openJobs'),
            database: commandShortcutLabel('app.openDatabase'),
            settings: commandShortcutLabel('app.openSettings'),
            rescanProjects: commandShortcutLabel('app.rescanProjects'),
            commandPalette: commandShortcutLabel('app.openCommandPalette'),
            shortcuts: commandShortcutLabel('app.openShortcuts'),
            diffViewed: commandShortcutLabel('diff.toggleViewed'),
            diffSave: Keymap.shortcutLabel('Primary+S', keymapOptions()),
            editorSave: Keymap.shortcutLabel('Primary+S', keymapOptions()),
        };

        document.getElementById('sidebar-collapse-btn')?.setAttribute('data-tooltip', `${labels.toggleSidebar} · drag to resize`);
        document.getElementById('git-panel-collapse-btn')?.setAttribute('data-tooltip', `${labels.toggleRightPanel} · drag to resize`);
        document.getElementById('overview-btn')?.setAttribute('title', titleWithShortcut('Overview', labels.overview));
        document.getElementById('jobs-btn')?.setAttribute('title', titleWithShortcut('Jobs', labels.jobs));
        document.getElementById('database-btn')?.setAttribute('title', titleWithShortcut('Database', labels.database));
        document.getElementById('settings-btn')?.setAttribute('title', titleWithShortcut('Settings', labels.settings));
        document.getElementById('rescan-projects-btn')?.setAttribute('title', titleWithShortcut('Rescan projects', labels.rescanProjects));
        document.getElementById('command-palette-btn')?.setAttribute('title', titleWithShortcut('Open commands', labels.commandPalette));
        document.getElementById('shortcuts-btn')?.setAttribute('title', titleWithShortcut('Open keyboard shortcuts', labels.shortcuts));
        const diffViewedBtn = document.getElementById('diff-viewed-toggle');
        if (diffViewedBtn) {
            diffViewedBtn.title = titleWithShortcut(
                diffViewedBtn.classList.contains('active') ? 'Mark file as not viewed' : 'Mark file as viewed',
                labels.diffViewed
            );
        }
        document.getElementById('diff-save-btn')?.setAttribute('title', titleWithShortcut('Save file', labels.diffSave));
        document.getElementById('editor-save-btn')?.setAttribute('title', titleWithShortcut('Save', labels.editorSave));
    }

    function normalizeCLI(cli) {
        const value = cli || currentCLI || 'claude';
        return AI_PROVIDER_BY_VALUE[value] ? value : 'claude';
    }

function normalizeDangerousPermissions(flags, providers = AI_PROVIDERS) {
	const next = {};
	providers.filter(provider => provider.dangerousFlag).forEach(provider => {
		next[provider.value] = !!(flags && flags[provider.value]);
	});
	return next;
}

function isCustomCLIProvider(value) {
	const provider = AI_PROVIDER_BY_VALUE[value];
	return !!(provider && provider.custom);
}

function providerValueSet(integrations = customCLIIntegrations) {
	const values = new Set(BUILT_IN_AI_PROVIDERS.map(provider => provider.value));
	normalizeCLIIntegrations(integrations).forEach(integration => values.add(integration.id));
	return values;
}

function buildCLITransition(options = {}) {
	const previousIntegrations = normalizeCLIIntegrations(options.previousIntegrations || []);
	const nextIntegrations = normalizeCLIIntegrations(options.nextIntegrations || []);
	const fallback = options.fallback || 'claude';
	const previousIDs = new Set(previousIntegrations.map(integration => integration.id));
	const nextProviderValues = providerValueSet(nextIntegrations);
	const renameMap = new Map();

	(options.renames || []).forEach(rename => {
		const from = String(rename && rename.from || '').trim();
		const to = String(rename && rename.to || '').trim();
		if (from && to && from !== to) renameMap.set(from, to);
	});

	const trackedIDs = new Set([...previousIDs, ...renameMap.keys(), ...renameMap.values()]);
	const resolveRenameTarget = (id) => {
		let next = id;
		const seen = new Set();
		while (renameMap.has(next) && !seen.has(next)) {
			seen.add(next);
			next = renameMap.get(next);
		}
		return next;
	};

	const entries = new Map();
	trackedIDs.forEach(id => {
		const target = resolveRenameTarget(id);
		if (nextProviderValues.has(target)) {
			if (target !== id) entries.set(id, { to: target, reason: 'rename' });
			return;
		}
		entries.set(id, { to: fallback, reason: 'removed' });
	});

	return {
		entries,
		fallback,
		nextProviderValues,
		changed: entries.size > 0,
	};
}

function applyCLITransition(value, transition) {
	const raw = String(value || '').trim();
	const entry = transition && transition.entries ? transition.entries.get(raw) : null;
	const candidate = entry ? entry.to : raw;
	if (candidate && transition && transition.nextProviderValues && transition.nextProviderValues.has(candidate)) return candidate;
	return transition && transition.fallback ? transition.fallback : normalizeCLI(candidate);
}

function remapDangerousPermissions(flags, transition, providers = AI_PROVIDERS) {
	const providerValues = new Set(providers.filter(provider => provider.dangerousFlag).map(provider => provider.value));
	const next = {};
	Object.entries(flags || {}).forEach(([key, enabled]) => {
		if (!enabled) return;
		const entry = transition && transition.entries ? transition.entries.get(key) : null;
		if (entry && entry.reason === 'removed') return;
		const target = entry ? entry.to : key;
		if (providerValues.has(target)) next[target] = true;
	});
	return next;
}

function migrateTerminalCLIs(transition) {
	if (!transition || !transition.changed) return false;
	let changed = false;
	Object.values(terminals).forEach(pane => {
		if (!pane || pane.kind || !pane.cli) return;
		const nextCLI = applyCLITransition(pane.cli, transition);
		if (nextCLI === pane.cli) return;
		pane.cli = nextCLI;
		changed = true;
	});
	return changed;
}

function capableProviders() {
	const deps = runtimeCapabilities && runtimeCapabilities.dependencies;
	if (!deps) return [];
	return AI_PROVIDERS.filter(provider => deps[provider.value] && deps[provider.value].available);
}

function resolveRuntimeCLI(cli) {
	const normalized = normalizeCLI(cli);
	if (isCustomCLIProvider(normalized)) return normalized;
	const capable = capableProviders();
	if (capable.length === 0) return normalized;
	if (capable.some(provider => provider.value === normalized)) return normalized;
	return capable[0].value;
}

    function providerDependencyLabel(key) {
        const provider = AI_PROVIDER_BY_VALUE[key];
        if (provider) return provider.shortLabel;
        if (key === 'gh') return 'GitHub CLI';
        if (key === 'glab') return 'GitLab CLI';
        if (key === 'docker') return 'Docker';
        return key;
    }

function currentPaneProviderValue() {
	if (!activeTab) return '';
	const sessionKey = getFocusedPaneKey(activeTab);
	const pane = terminals[sessionKey];
	if (pane && pane.cli) return normalizeCLI(pane.cli);
	return resolveRuntimeCLI(currentCLI);
}

function providerOptionsWithSelection(selectedCLI, providers = capableProviders()) {
	const selected = normalizeCLI(selectedCLI);
	if (!isCustomCLIProvider(selected) || providers.some(provider => provider.value === selected)) {
		return providers;
	}
	const provider = AI_PROVIDER_BY_VALUE[selected];
	return provider ? [...providers, provider] : providers;
}

function renderTerminalProviderSwitcher() {
	const baseProviders = capableProviders();
	const activeTabKey = activeTab;
	const panesNeedingFit = [];

	Object.values(terminals).forEach((pane) => {
		if (!pane || !pane.providerWrap || !pane.providerSelect) return;
		const isActivePane = !!activeTabKey && pane.tabKey === activeTabKey;
		const paneValue = pane.cli ? normalizeCLI(pane.cli) : resolveRuntimeCLI(currentCLI);
		const providers = providerOptionsWithSelection(paneValue, baseProviders);
		const visible = !overviewActive && activeTab && providers.length > 1;
		const shouldShow = visible && isActivePane && !pane.kind;
		const nextDisplay = shouldShow ? 'flex' : 'none';
		if (pane.providerWrap.style.display !== nextDisplay) {
			panesNeedingFit.push(pane);
		}
            pane.providerWrap.style.display = nextDisplay;
            if (!shouldShow) return;

            const priorValue = pane.providerSelect.value;
            pane.providerSelect.innerHTML = '';
            providers.forEach(provider => {
                const option = document.createElement('option');
                option.value = provider.value;
		option.textContent = provider.shortLabel;
		pane.providerSelect.appendChild(option);
	});

	const fallback = providers[0].value;
	const nextValue = providers.some(provider => provider.value === paneValue)
		? paneValue
		: (providers.some(provider => provider.value === priorValue) ? priorValue : fallback);
            pane.providerSelect.value = nextValue;
            pane.providerSelect.disabled = providerSwitchInFlight;
            pane.providerSelect.dataset.sessionKey = pane.sessionKey || '';
        });

        if (panesNeedingFit.length > 0) {
            requestAnimationFrame(() => panesNeedingFit.forEach(safeFit));
        }
    }

    async function loadRuntimeCapabilities() {
        try {
            runtimeCapabilities = await fetchJSON('/api/capabilities');
        } catch {
            runtimeCapabilities = null;
        }
        renderTerminalProviderSwitcher();
        syncUsage();
        return runtimeCapabilities;
    }

    async function switchFocusedPaneProvider(providerValue, preferredSessionKey = '') {
        if (providerSwitchInFlight) return;
        if (!activeTab) return;

        const tabKey = activeTab;
        let sessionKey = preferredSessionKey || getFocusedPaneKey(tabKey);
        let pane = terminals[sessionKey];
        if (!pane || pane.tabKey !== tabKey) {
            sessionKey = getFocusedPaneKey(tabKey);
            pane = terminals[sessionKey];
        }
        if (!pane || pane.kind) return;

        const paneOrder = [...getPaneKeys(tabKey)];
        const paneIndex = paneOrder.indexOf(sessionKey);
        const insertBeforeEl = pane.wrapper ? pane.wrapper.nextElementSibling : null;

        const targetCLI = resolveRuntimeCLI(providerValue);
        const previousCLI = resolveRuntimeCLI(pane.cli);
        if (targetCLI === previousCLI) {
            setFocusedPane(tabKey, sessionKey, false);
            renderTerminalProviderSwitcher();
            return;
        }

        setFocusedPane(tabKey, sessionKey, false);

        providerSwitchInFlight = true;
        renderTerminalProviderSwitcher();

        const startSession = async (cli) => {
            await fetchJSON(`${terminalAPIBase(tabKey)}/terminal/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session: sessionKey, cli })
            });
            createTerminal(sessionKey, { tabKey, cli, insertBeforeEl });
            if (paneIndex >= 0) {
                const state = ensureTabState(tabKey);
                const currentIndex = state.panes.indexOf(sessionKey);
                if (currentIndex >= 0) {
                    state.panes.splice(currentIndex, 1);
                    const targetIndex = Math.min(paneIndex, state.panes.length);
                    state.panes.splice(targetIndex, 0, sessionKey);
                }
            }
            setTabVisibility(tabKey, activeTab === tabKey);
            setFocusedPane(tabKey, sessionKey);
            refreshTerminalContainerLayout();
            renderTabs();
            saveTabs();
        };

        try {
            await fetchJSON(`${terminalAPIBase(tabKey)}/terminal/stop?session=${encodeURIComponent(sessionKey)}`, {
                method: 'POST',
            });
            disposeTerminalPane(tabKey, sessionKey, { stopBackend: false });
            await startSession(targetCLI);
        } catch (err) {
            showToast('Provider switch failed', (err && err.message) || 'Could not switch provider.', 'error', 4200);
            if (!terminals[sessionKey]) {
                try {
                    await startSession(previousCLI);
                } catch (_) {}
            }
        } finally {
            providerSwitchInFlight = false;
            renderTerminalProviderSwitcher();
        }
    }

    function ensureTabState(name) {
        if (!tabState[name]) {
            tabState[name] = { panes: [], focusedPane: name };
            if (!tabOrder.includes(name)) tabOrder.push(name);
        }
        return tabState[name];
    }

    function getTabKeys() {
        return tabOrder.filter(name => tabState[name]);
    }

    function removeTabState(name) {
        delete tabState[name];
        unseenCompletedTabs.delete(name);
        previousTabSessionStates.delete(name);
        const index = tabOrder.indexOf(name);
        if (index >= 0) tabOrder.splice(index, 1);
    }

    function reorderTab(draggedName, targetName, insertAfter) {
        if (draggedName === targetName) return false;
        const nextOrder = [...tabOrder];
        const draggedIndex = nextOrder.indexOf(draggedName);
        if (draggedIndex < 0 || !nextOrder.includes(targetName)) return false;

        nextOrder.splice(draggedIndex, 1);
        const targetIndex = nextOrder.indexOf(targetName);
        nextOrder.splice(targetIndex + (insertAfter ? 1 : 0), 0, draggedName);
        if (nextOrder.every((name, index) => name === tabOrder[index])) return false;

        tabOrder.splice(0, tabOrder.length, ...nextOrder);
        return true;
    }

    function getPaneKeys(name) {
        return tabState[name]?.panes || [];
    }

    function registerPane(tabKey, sessionKey) {
        const state = ensureTabState(tabKey);
        if (!state.panes.includes(sessionKey)) state.panes.push(sessionKey);
        if (!state.focusedPane || !state.panes.includes(state.focusedPane)) {
            state.focusedPane = sessionKey;
        }
    }

    function unregisterPane(tabKey, sessionKey) {
        const state = tabState[tabKey];
        if (!state) return;
        state.panes = state.panes.filter(key => key !== sessionKey);
        if (state.focusedPane === sessionKey) {
            state.focusedPane = state.panes[0] || null;
        }
        if (state.panes.length === 0) delete tabState[tabKey];
    }

    function getFocusedPaneKey(tabKey) {
        const state = tabState[tabKey];
        if (!state) return tabKey;
        return state.focusedPane || state.panes[0] || tabKey;
    }

    function setFocusedPane(tabKey, sessionKey, shouldFocusTerm = true) {
        const state = ensureTabState(tabKey);
        if (!state.panes.includes(sessionKey)) return;
        state.focusedPane = sessionKey;
        state.panes.forEach(key => {
            const pane = terminals[key];
            if (pane && pane.wrapper) {
                pane.wrapper.classList.toggle('focused', key === sessionKey);
            }
        });
        if (shouldFocusTerm) {
            const pane = terminals[sessionKey];
            if (pane && pane.term) pane.term.focus();
        }
        renderTerminalProviderSwitcher();
    }

    function refreshTerminalContainerLayout() {
        const container = document.getElementById('terminal-container');
        const paneCount = activeTab ? getPaneKeys(activeTab).length : 0;
        container.classList.toggle('split-layout', paneCount > 1);
        if (activeTab) {
            getPaneKeys(activeTab).forEach(key => {
                const pane = terminals[key];
                if (pane && pane.wrapper) {
                    pane.wrapper.classList.toggle('split-pane', paneCount > 1);
                }
            });
        }
    }

    function setTabVisibility(tabKey, isActive) {
        getPaneKeys(tabKey).forEach(key => {
            const pane = terminals[key];
            if (pane && pane.wrapper) {
                pane.wrapper.classList.toggle('active', isActive);
            }
        });
        if (isActive) {
            setFocusedPane(tabKey, getFocusedPaneKey(tabKey), false);
        }
    }

    function getTerminalEntry(name) {
        if (!name) return null;
        const focusedKey = getFocusedPaneKey(name);
        const entry = terminals[focusedKey] || terminals[name];
        return (entry && entry.term && entry.fitAddon) ? entry : null;
    }

    function focusActiveTerminal() {
        if (!activeTab) return;
        const entry = getTerminalEntry(activeTab);
        if (entry && entry.term) entry.term.focus();
    }

    function focusActiveTerminalSoon() {
        window.setTimeout(() => {
            if (appDialog || isModalOrOverlayOpen()) return;
            focusActiveTerminal();
        }, 0);
    }

    function isTextFocusElement(el) {
        if (!el) return false;
        if (/^(INPUT|TEXTAREA|SELECT)$/i.test(el.tagName || '')) return true;
        return !!el.isContentEditable;
    }

    function isTerminalVisible() {
        const container = document.getElementById('terminal-container');
        return !!container && container.style.display !== 'none';
    }

    function restoreFocusAfterDialog(previousActive) {
        window.setTimeout(() => {
            if (appDialog) return;
            if (previousActive && previousActive.isConnected && typeof previousActive.focus === 'function') {
                if (isTextFocusElement(previousActive) || previousActive.closest?.('.xterm') || previousActive.closest?.('.monaco-editor')) {
                    previousActive.focus();
                    return;
                }
            }
            if (isTerminalVisible()) focusActiveTerminal();
        }, 0);
    }

    let appDialog = null;

    function appDialogNodes() {
        return {
            modal: document.getElementById('app-dialog-modal'),
            message: document.getElementById('app-dialog-message'),
            input: document.getElementById('app-dialog-input'),
            confirmBtn: document.getElementById('app-dialog-confirm'),
        };
    }

    function settleAppDialog(result) {
        if (!appDialog) return;
        const pending = appDialog;
        appDialog = null;
        const { modal } = appDialogNodes();
        if (modal) modal.style.display = 'none';
        restoreFocusAfterDialog(pending.previousActive);
        pending.resolve(result);
    }

    function acceptAppDialog() {
        if (!appDialog) return;
        const { input } = appDialogNodes();
        settleAppDialog(appDialog.wantsInput ? String(input?.value ?? '') : true);
    }

    function cancelAppDialog() {
        if (!appDialog) return;
        settleAppDialog(appDialog.wantsInput ? null : false);
    }

    function openAppDialog(message, options = {}) {
        const wantsInput = !!options.input;
        const { modal, message: messageEl, input, confirmBtn } = appDialogNodes();
        if (!modal || !messageEl || !input || !confirmBtn) return Promise.resolve(wantsInput ? null : false);
        cancelAppDialog();
        const previousActive = document.activeElement;
        messageEl.textContent = message;
        input.style.display = wantsInput ? '' : 'none';
        input.value = wantsInput ? String(options.defaultValue ?? '') : '';
        modal.style.display = 'flex';
        window.setTimeout(() => {
            if (!wantsInput) {
                confirmBtn.focus();
                return;
            }
            input.focus();
            input.select();
        }, 0);
        return new Promise(resolve => { appDialog = { resolve, previousActive, wantsInput }; });
    }

    function requestTextInput({ title, subtitle = '', defaultValue = '', submitLabel = 'OK' }) {
        const modal = document.getElementById('text-prompt-modal');
        const input = document.getElementById('text-prompt-input');
        const submit = document.getElementById('text-prompt-submit');
        if (!modal || !input || !submit) return Promise.resolve(null);

        cancelTextInputRequest();

        document.getElementById('text-prompt-title').textContent = title;
        document.getElementById('text-prompt-subtitle').textContent = subtitle;
        submit.textContent = submitLabel;
        input.value = defaultValue == null ? '' : String(defaultValue);
        modal.style.display = 'flex';

        const previousActive = document.activeElement;
        const promise = new Promise(resolve => {
            textInputRequest = { resolve, previousActive };
        });
        setTimeout(() => {
            input.focus();
            input.select();
        }, 0);
        return promise;
    }

    function settleTextInputRequest(value) {
        if (!textInputRequest) return;
        const request = textInputRequest;
        textInputRequest = null;
        const modal = document.getElementById('text-prompt-modal');
        if (modal) modal.style.display = 'none';
        restoreFocusAfterDialog(request.previousActive);
        request.resolve(value);
    }

    function cancelTextInputRequest() {
        settleTextInputRequest(null);
    }

    function submitTextInputRequest() {
        const input = document.getElementById('text-prompt-input');
        settleTextInputRequest(String(input?.value || ''));
    }

    function appConfirm(message) {
        return openAppDialog(message);
    }

    function appPrompt(message, defaultValue) {
        return openAppDialog(message, { input: true, defaultValue });
    }

    document.getElementById('app-dialog-backdrop')?.addEventListener('click', cancelAppDialog);
    document.getElementById('app-dialog-cancel')?.addEventListener('click', cancelAppDialog);
    document.getElementById('app-dialog-confirm')?.addEventListener('click', acceptAppDialog);
    document.addEventListener('keydown', (ev) => {
        if (!appDialog) return;
        if (ev.key !== 'Escape' && ev.key !== 'Enter') return;
        ev.stopPropagation();
        // keyCode 229 is the IME placeholder where isComposing is unavailable
        if (ev.isComposing || ev.keyCode === 229) return;
        ev.preventDefault();
        if (ev.key === 'Escape') cancelAppDialog();
        else acceptAppDialog();
    }, true);

    function stopTerminalSession(tabKey, sessionKey) {
        if (!tabKey || !sessionKey) return Promise.resolve();
        return fetch(`${terminalAPIBase(tabKey)}/terminal/stop?session=${encodeURIComponent(sessionKey)}`, {
            method: 'POST',
        }).catch(() => {});
    }

    function disposeTerminalPane(tabKey, sessionKey, options = {}) {
        const t = terminals[sessionKey];
        if (!t) return;
        if (t._cleanup) t._cleanup(); else if (t.ws) t.ws.close();
        if (t.term) t.term.dispose();
        if (t.wrapper) t.wrapper.remove();
        delete terminals[sessionKey];
        unregisterPane(tabKey, sessionKey);
        if (options.stopBackend) stopTerminalSession(tabKey, sessionKey);
    }

    function removeTerminalPane(tabKey, sessionKey) {
        disposeTerminalPane(tabKey, sessionKey, { stopBackend: true });
    }

    function showToast(title, body, kind = 'info', timeout = 2600) {
        const region = document.getElementById('toast-region');
        if (!region) return;
        const toast = document.createElement('div');
        toast.className = `toast ${kind}`;
        toast.innerHTML = `<div class="toast-title">${esc(title)}</div><div class="toast-body">${esc(body)}</div>`;
        region.appendChild(toast);
        window.setTimeout(() => toast.remove(), timeout);
    }

    function compactErrorMessage(message, fallback = 'Operation failed.') {
        const text = String(message || fallback).trim() || fallback;
        return text.length > 700 ? text.slice(0, 700).trimEnd() + '...' : text;
    }

    function compactSuccessMessage(message, fallback = 'Operation completed.') {
        const text = String(message || fallback).replace(/\s+/g, ' ').trim() || fallback;
        return text.length > 220 ? text.slice(0, 220).trimEnd() + '...' : text;
    }

    function showGitSuccessToast(title, data, fallback, timeout = 3200) {
        showToast(title, compactSuccessMessage(data && data.output, fallback), 'success', timeout);
    }

    function pluralize(count, singular, plural = `${singular}s`) {
        return count === 1 ? singular : plural;
    }

    function summarizePullAllResults(results) {
        const entries = Object.entries(results || {});
        const failed = entries.filter(([, result]) => result && result.error);
        if (failed.length === 0) {
            const count = entries.length;
            return {
                ok: true,
                message: count > 0
                    ? `${count} ${pluralize(count, 'project')} pulled successfully.`
                    : 'No projects to pull.',
            };
        }

        const sample = failed.slice(0, 3).map(([name, result]) => {
            const message = compactSuccessMessage(result.output || result.error, 'Pull failed.');
            return `${name}: ${message}`;
        }).join('\n');
        const remaining = failed.length > 3 ? `\n${failed.length - 3} more failed.` : '';
        return {
            ok: false,
            message: compactErrorMessage(sample + remaining, `${failed.length} ${pluralize(failed.length, 'project')} failed to pull.`),
        };
    }

function applyConfigState(cfg) {
	refreshAIProviders(cfg && cfg.cli_integrations);
	currentCLI = normalizeCLI(cfg && cfg.cli);
	dangerousPermissions = normalizeDangerousPermissions(cfg && cfg.dangerous_permissions);
        activityProvider = normalizeActivityProvider(cfg && cfg.activity_provider);
        gitlabHost = (cfg && cfg.gitlab_host) || '';
        applyUsageConfig(cfg);
        startupGitPullFFOnly = Boolean(cfg && cfg.startup_git_pull_ff_only);
        preventSleepWhileActive = !(cfg && cfg.disable_sleep_prevention);
        setTerminalFontSize(cfg && cfg.terminal_font_size);
        projectTags = (cfg && cfg.project_tags) ? { ...cfg.project_tags } : {};
        keymapState = Keymap.normalizeConfig(cfg || {}, keymapOptions());
        updateShortcutLabels();
        renderTerminalProviderSwitcher();
        syncActivity();
        syncUsage();
        if (isCommandPaletteOpen()) renderCommandPalette();
        if (isShortcutsOpen()) renderShortcutsModalContent();
        if (isKeymapConfigOpen()) renderKeymapConfig();
    }

function applyDatabaseState(data) {
    databaseConnections = normalizeDatabaseConnections(data && data.connections);
    databaseOrphanedQueries = normalizeDatabaseSavedQueries(data && data.orphaned_queries);
    applyDatabaseConnectionStatuses(data && data.connected);
        if (!selectedDatabaseID && databaseConnections.length > 0) selectedDatabaseID = databaseConnections[0].id;
        if (selectedDatabaseID && !databaseConnections.some(conn => conn.id === selectedDatabaseID)) {
            selectedDatabaseID = databaseConnections[0]?.id || '';
        }
        syncDatabaseSchemaCachesWithConnections();
        if (settingsModalIsOpen()) {
            settingsDatabaseConnections = normalizeDatabaseConnections(databaseConnections);
            renderSettingsDatabases();
        }
        renderDatabaseConnections();
        if (data && data.password_warning) {
            showToast('Password not saved', compactErrorMessage(data.password_warning, 'Stored for this session only.'), 'error', 5200);
        }
        return databaseConnections;
    }

    async function patchConfig(partial, options = {}) {
        const requestOptions = {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(partial),
        };
        if (options.timeoutMs != null) requestOptions.timeoutMs = options.timeoutMs;
        if (options.timeoutMessage) requestOptions.timeoutMessage = options.timeoutMessage;

        const next = await fetchJSON('/api/config', requestOptions);
        applyConfigState(next);
        return next;
    }

    function projectTagList(name) {
        return Array.isArray(projectTags[name]) ? projectTags[name] : [];
    }

    function updateModeButtons() {
        document.getElementById('overview-btn')?.classList.toggle('active', overviewActive);
        document.getElementById('jobs-btn')?.classList.toggle('active', jobsActive);
        document.getElementById('database-btn')?.classList.toggle('active', databaseActive);
    }

    function updateSidebarMode() {
        const title = document.getElementById('sidebar-title');
        const projectBody = document.getElementById('project-sidebar-body');
        const databaseSidebar = document.getElementById('database-sidebar');
        const rescanBtn = document.getElementById('rescan-projects-btn');
        if (title) title.textContent = databaseActive ? 'Database' : 'Projects';
        if (projectBody) projectBody.style.display = databaseActive ? 'none' : 'flex';
        if (databaseSidebar) databaseSidebar.style.display = databaseActive ? 'flex' : 'none';
        if (rescanBtn) rescanBtn.style.display = databaseActive ? 'none' : '';
    }

    function updateStatusContext() {
        const el = document.getElementById('status-context');
        if (!el) return;
        if (overviewActive) {
            el.textContent = 'Overview';
        } else if (jobsActive) {
            el.textContent = 'Jobs';
        } else if (databaseActive) {
            el.textContent = 'Database';
        } else if (workspaceForTab(activeTab)) {
            el.textContent = workspaceForTab(activeTab).name + (activeProject ? ' · ' + commandProjectLabel(activeProject) : '');
        } else if (activeProject) {
            el.textContent = activeProject;
        } else {
            el.textContent = 'No active project';
        }
        updateModeButtons();
        updateSidebarMode();
        renderTerminalProviderSwitcher();
    }

    // ─── Theme ──────────────────────────────────────────────────────
    const FALLBACK_THEME = {
        id: 'dark',
        name: 'Dark',
        css: {},
        terminal: {
            background: '#1a1b26',
            foreground: '#c0caf5',
            cursor: '#c0caf5',
            selectionBackground: '#33467c',
        },
        monaco: {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: { 'editor.background': '#1a1b26' },
        },
    };

    const AUTO_THEME_ID = 'auto';
    let themeDefinitions = [FALLBACK_THEME];
    let themeByID = { dark: FALLBACK_THEME };
    let appliedThemeVars = new Set();
    let currentThemeMode = localStorage.getItem('theme-mode') || 'dark';

    function themeCacheKey(themeID) {
        return `theme-css-${themeID}`;
    }

    function normalizeThemeMode(mode) {
        if (mode === AUTO_THEME_ID) return AUTO_THEME_ID;
        return themeByID[mode] ? mode : 'dark';
    }

    function normalizeThemeDefinition(theme) {
        if (!theme || typeof theme !== 'object' || !theme.id || !theme.name) return null;
        return {
            ...theme,
            css: theme.css && typeof theme.css === 'object' ? theme.css : {},
            terminal: theme.terminal && typeof theme.terminal === 'object' ? theme.terminal : FALLBACK_THEME.terminal,
            monaco: theme.monaco && typeof theme.monaco === 'object' ? theme.monaco : FALLBACK_THEME.monaco,
        };
    }

    async function loadThemeDefinitionsFromStaticManifest() {
        const files = await fetchJSON('/themes/index.json', { cache: 'no-store' });
        if (!Array.isArray(files)) return [];
        const themes = await Promise.all(files.map(async file => {
            if (typeof file !== 'string' || !file.endsWith('.json') || file.includes('/') || file.includes('\\')) {
                return null;
            }
            return fetchJSON(`/themes/${encodeURIComponent(file)}`, { cache: 'no-store' }).catch(() => null);
        }));
        return themes;
    }

    async function loadThemeDefinitions() {
        let loaded = null;
        try {
            loaded = await fetchJSON('/api/themes', { cache: 'no-store' });
        } catch (err) {
            loaded = await loadThemeDefinitionsFromStaticManifest().catch(() => null);
        }

        const normalized = Array.isArray(loaded)
            ? loaded.map(normalizeThemeDefinition).filter(Boolean)
            : [];
        if (normalized.length > 0) {
            themeDefinitions = normalized;
            themeByID = Object.fromEntries(themeDefinitions.map(theme => [theme.id, theme]));
        } else {
            showToast('Themes unavailable', 'Using fallback theme.', 'error', 4200);
        }
        currentThemeMode = normalizeThemeMode(currentThemeMode);
        localStorage.setItem('theme-mode', currentThemeMode);
        renderThemeOptions();
        applyTheme();
    }

    function getEffectiveTheme() {
        if (currentThemeMode === 'auto') {
            return window.matchMedia('(prefers-color-scheme: light)').matches && themeByID.light ? 'light' : 'dark';
        }
        return normalizeThemeMode(currentThemeMode);
    }

    function getThemeDefinition() {
        return themeByID[getEffectiveTheme()] || FALLBACK_THEME;
    }

    function getTermTheme() {
        return getThemeDefinition().terminal || FALLBACK_THEME.terminal;
    }

    function getMonacoThemeName() {
        return getThemeDefinition().id;
    }

    function applyThemeVariables(theme) {
        const css = theme.css || {};
        appliedThemeVars.forEach(name => {
            if (!(name in css)) document.documentElement.style.removeProperty(name);
        });
        appliedThemeVars = new Set(Object.keys(css));
        Object.entries(css).forEach(([name, value]) => {
            if (name.startsWith('--')) document.documentElement.style.setProperty(name, String(value));
        });
        try {
            localStorage.setItem(themeCacheKey(theme.id), JSON.stringify(css));
        } catch {}
    }

    function defineMonacoThemes() {
        if (typeof monaco === 'undefined') return;
        themeDefinitions.forEach(theme => {
            if (theme.monaco) monaco.editor.defineTheme(theme.id, theme.monaco);
        });
    }

    function applyTheme() {
        const theme = getThemeDefinition();
        document.documentElement.setAttribute('data-theme', theme.id);
        applyThemeVariables(theme);

        // Update all xterm instances
        const termTheme = getTermTheme();
        for (const name of Object.keys(terminals)) {
            const t = terminals[name];
            if (t && t.term) t.term.options.theme = termTheme;
        }

        // Update monaco editor theme
        if (typeof monaco !== 'undefined') {
            defineMonacoThemes();
            monaco.editor.setTheme(getMonacoThemeName());
        }
    }

    function setThemeMode(mode) {
        currentThemeMode = normalizeThemeMode(mode);
        localStorage.setItem('theme-mode', currentThemeMode);
        applyTheme();
    }

    function normalizeTerminalFontSize(size) {
        const parsed = Math.round(Number(size));
        if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TERMINAL_FONT_SIZE;
        return Math.min(Math.max(parsed, MIN_TERMINAL_FONT_SIZE), MAX_TERMINAL_FONT_SIZE);
    }

    // Refitting is what resizes the PTY: fitAddon.fit() recomputes cols/rows for
    // the new cell size and term.onResize forwards them over the socket.
    function applyTerminalFontSize() {
        for (const key of Object.keys(terminals)) {
            const pane = terminals[key];
            if (!pane || !pane.term) continue;
            pane.term.options.fontSize = terminalFontSize;
            safeFit(pane);
        }
        if (jobLogTerm) {
            jobLogTerm.options.fontSize = terminalFontSize;
            jobLogFit?.fit();
        }
    }

    function setTerminalFontSize(size) {
        const next = normalizeTerminalFontSize(size);
        if (next === terminalFontSize) return;
        terminalFontSize = next;
        applyTerminalFontSize();
    }

    function renderThemeOptions() {
        const sel = document.getElementById('settings-theme-select');
        if (!sel) return;
        sel.innerHTML = '';
        themeDefinitions.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.name;
            sel.appendChild(option);
        });
        const auto = document.createElement('option');
        auto.value = AUTO_THEME_ID;
        auto.textContent = 'Auto (system)';
        sel.appendChild(auto);
        sel.value = currentThemeMode;
    }

    async function initTheme() {
        await loadThemeDefinitions();
        const sel = document.getElementById('settings-theme-select');
        sel.onchange = () => setThemeMode(sel.value);
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
            if (currentThemeMode === 'auto') applyTheme();
        });
    }

    function initTerminalProviderSwitcher() {
        const container = document.getElementById('terminal-container');
        if (!container) return;
        container.addEventListener('change', async (ev) => {
            const select = ev.target?.closest('.terminal-provider-select');
            if (!select) return;
            try {
                await switchFocusedPaneProvider(select.value, select.dataset.sessionKey || '');
            } finally {
                // Keep the select value aligned with runtime-resolved CLI even on no-op/error paths.
                renderTerminalProviderSwitcher();
            }
        });
    }

    function setWindowMaximizedVisual(maximized) {
        const btn = document.getElementById('window-max-btn');
        if (!btn) return;
        btn.innerHTML = iconHTML(maximized ? 'restore' : 'maximize');
        btn.title = maximized ? 'Restore' : 'Maximize';
        btn.setAttribute('aria-label', maximized ? 'Restore window' : 'Maximize window');
    }

    function initWindowChrome() {
        const titlebar = document.getElementById('window-titlebar');
        if (!titlebar || typeof window.electronWindowControl !== 'function') return;
        const isMac = window.electronPlatform === 'darwin';
        document.body.classList.add('electron-custom-chrome');
        if (isMac) document.body.classList.add('electron-mac-chrome');
        titlebar.style.display = 'flex';
        hydrateIcons(titlebar);

        const applyState = (state) => {
            if (!state) return;
            if (typeof state.maximized === 'boolean') {
                setWindowMaximizedVisual(state.maximized);
            }
            if (isMac && typeof state.fullscreen === 'boolean') {
                // Traffic lights auto-hide in fullscreen; drop the left inset.
                document.body.classList.toggle('mac-fullscreen', state.fullscreen);
            }
        };

        // On macOS the native traffic lights handle min/max/close, so the
        // custom buttons stay hidden (via CSS) and we skip wiring them.
        if (!isMac) {
            const runControl = async (action) => {
                try {
                    const state = await window.electronWindowControl(action);
                    applyState(state);
                } catch (err) {
                    showToast('Window control failed', (err && err.message) || 'Unable to control window.', 'error', 4200);
                }
            };

            document.getElementById('window-min-btn')?.addEventListener('click', () => {
                runControl('minimize');
            });
            document.getElementById('window-max-btn')?.addEventListener('click', () => {
                runControl('toggle-maximize');
            });
            document.getElementById('window-close-btn')?.addEventListener('click', () => {
                runControl('close');
            });
        }

        if (typeof window.electronOnWindowState === 'function') {
            window.electronOnWindowState(applyState);
        }
        if (typeof window.electronGetWindowState === 'function') {
            window.electronGetWindowState().then(applyState).catch(() => {});
        }
    }

    // ─── Init ───────────────────────────────────────────────────────
    // xterm measures cell size once at open(), so the vendored JetBrains Mono
    // has to be resolved before any terminal is built — otherwise it locks onto
    // fallback metrics. Bounded so a missing font file can't stall startup.
    async function ensureTerminalFontLoaded() {
        if (!document.fonts) return;
        const loaded = document.fonts.load(`${DEFAULT_TERMINAL_FONT_SIZE}px "JetBrains Mono"`);
        const deadline = new Promise(resolve => setTimeout(resolve, 2000));
        await Promise.race([loaded.catch(() => {}), deadline]);
    }

    async function init() {
        initWindowChrome();
        initWorkspaces();
        hydrateIcons();
        await ensureTerminalFontLoaded();
        await initTheme();
        initTerminalProviderSwitcher();
        updateShortcutLabels();
        initSettings();
        initDatabase();
        initCommandPalette();
        initTextPrompt();
        initOverviewFilters();
        initSearch();
        initNotificationHandlers();
        loadBuildInfo();
        initActivity();
        initUsage();
        initDevReload();

        try {
            const cfg = await fetchJSON('/api/config');
            if (!cfg || !Array.isArray(cfg.scan_paths) || cfg.scan_paths.length === 0) {
                showSetup();
                return;
            }
        } catch {
            showSetup();
            return;
        }

        projects = await fetchJSON('/api/projects');
        renderProjectList();
        updateBadges();
        startJobsPoll();

        // Restore theme and tabs from config
        const cfgData = await fetchJSON('/api/config');
        applyConfigState(cfgData);
        await loadRuntimeCapabilities();
        if (cfgData.theme) {
            setThemeMode(cfgData.theme);
        }
        workspaces = Array.isArray(cfgData.workspaces) ? cfgData.workspaces : [];
        renderWorkspaceList();
        const savedTabs = cfgData.open_tabs || [];
        const savedActive = cfgData.active_tab || '';
        const savedLayouts = cfgData.tab_layouts || {};
        const projectNames = new Set(projects.map(p => p.name));

        // For worktree tabs, verify the worktree itself still exists — a parent
        // project alone is not enough. Restoring a stale tab would keep the UI
        // stuck reconnecting a WebSocket that the backend can never resolve.
        const wtParents = new Set();
        const trackedProjects = workspaces.flatMap(workspace => workspace.projects || []);
        for (const t of [...savedTabs, ...trackedProjects]) {
            if (t.includes('@')) {
                const parentName = t.split('@', 2)[0];
                if (projectNames.has(parentName)) wtParents.add(parentName);
            }
        }
        await Promise.all([...wtParents].map(name => fetchWorktrees(name)));

        const validTabs = savedTabs.filter(t => {
            if (isWorkspaceTab(t)) return !!workspaceForTab(t);
            if (projectNames.has(t)) return true;
            if (t.includes('@')) {
                const [parentName, wtName] = t.split('@', 2);
                if (!projectNames.has(parentName)) return false;
                const wts = worktreeCache[parentName] || [];
                return wts.some(wt => wt.name === wtName);
            }
            return false;
        });

        if (validTabs.length > 0) {
            const restoreTarget = validTabs.includes(savedActive) ? savedActive : validTabs[0];
            for (const name of validTabs) {
                const initialCLI = savedLayouts[name]?.panes?.[0]?.cli || currentCLI;
                await switchProject(name, { initialCLI });
                await restoreTabLayout(name, savedLayouts[name]);
                if (name !== restoreTarget) {
                    setTabVisibility(name, false);
                }
            }
            // Switch to the saved active tab, or fall back to the first valid tab.
            if (restoreTarget && terminals[restoreTarget]) {
                activeTab = null; // force switch
                await switchProject(restoreTarget);
            }
        } else if (projects.length > 0) {
            switchProject(projects[0].name);
        }

        if (shouldRestoreDatabaseView()) {
            showDatabase();
        }

        // Poll badges every 15 seconds
        badgePollTimer = setInterval(updateBadges, 15000);

        // Poll project list every 10 seconds (for session status)
        setInterval(refreshProjectList, 10000);

        pollSessionStatuses();
        setInterval(pollSessionStatuses, 2000);
        pollPowerState();
        setInterval(pollPowerState, 10000);

        initBackgroundIdle();

        // On wake from sleep, nudge WebSockets to reconnect faster
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                Object.values(terminals).forEach(t => {
                    if (t.ws && t.ws.readyState !== WebSocket.OPEN && t.ws.readyState !== WebSocket.CONNECTING) {
                        // Force close to trigger onclose → reconnect logic
                        try { t.ws.close(); } catch {}
                    }
                });
                updateGitStatus({ fresh: true });
            }
        });
    }

    // While the window is unfocused nothing on screen is being read, but the
    // status-dot animations keep repainting at display refresh rate, which
    // recomposites the whole window every frame. Flag the blurred state so
    // style.css can stop the long-lived ones (see "Background repaint
    // suppression" there).
    //
    // The xterm cursor needs no handling here: xterm only applies its
    // .xterm-cursor-blink class when coreBrowserService.isFocused, which is
    // gated on ownerDocument.hasFocus(), so the blink already stops on window
    // blur. Toggling term.options.cursorBlink would be a no-op that costs a
    // renderer refresh per pane — and it could not disable a blink set by the
    // program via DECSCUSR anyway, since decPrivateModes.cursorBlink wins over
    // the option.
    function initBackgroundIdle() {
        window.addEventListener('blur', () => {
            document.body.classList.add('window-blurred');
        });
        window.addEventListener('focus', () => {
            document.body.classList.remove('window-blurred');
        });

        if (!document.hasFocus()) {
            document.body.classList.add('window-blurred');
        }
    }

    function initDevReload() {
        if (devReloadTimer) return;

        let lastStamp = '';
        const stop = () => {
            if (devReloadTimer) window.clearInterval(devReloadTimer);
            devReloadTimer = null;
        };
        const check = async () => {
            try {
                const data = await fetchJSON('/api/dev/reload-stamp', { cache: 'no-store' });
                if (!data || !data.enabled) {
                    stop();
                    return;
                }
                const stamp = String(data.stamp || '');
                if (!lastStamp) {
                    lastStamp = stamp;
                    return;
                }
                if (stamp && stamp !== lastStamp) {
                    lastStamp = stamp;
                    window.location.reload();
                }
            } catch {
                stop();
            }
        };

        check();
        devReloadTimer = window.setInterval(check, 1000);
    }

    // ─── Setup ──────────────────────────────────────────────────────
    function showSetup() {
        document.getElementById('setup-overlay').style.display = 'flex';
    }

    window.saveSetup = async function () {
        const dir = document.getElementById('setup-dir').value.trim();
        if (!dir) return;

        await fetchJSON('/api/config', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scan_paths: [dir] }),
        });

        document.getElementById('setup-overlay').style.display = 'none';
        projects = await fetchJSON('/api/projects');
        await loadRuntimeCapabilities();
        renderProjectList();
        startJobsPoll();
        if (projects.length > 0) {
            switchProject(projects[0].name);
        }
    };

    // ─── Search ────────────────────────────────────────────────────
    function initSearch() {
        const input = document.getElementById('search-input');
        input.addEventListener('input', () => {
            searchFilter = input.value.trim().toLowerCase();
            renderProjectList();
        });
    }

    // ─── Project List ───────────────────────────────────────────────
    function sortedProjects() {
        return [...projects].sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return 0;
        });
    }

    function filteredProjects() {
        const sorted = sortedProjects();
        if (!searchFilter) return sorted;
        return sorted.filter(p => {
            const tags = projectTagList(p.name).join(' ').toLowerCase();
            return p.name.toLowerCase().includes(searchFilter) || tags.includes(searchFilter);
        });
    }

    async function refreshProjectList() {
        try {
            projects = await fetchJSON('/api/projects');
            renderProjectList();
        } catch {
            // ignore
        }
    }

    async function rescanProjects(btn = null) {
        if (projectRescanInFlight) return;
        projectRescanInFlight = true;
        if (btn) btn.classList.add('busy');
        try {
            projects = await fetchJSON('/api/rescan', { method: 'POST' });
            renderProjectList();
            updateBadges();
            if (overviewActive) loadOverview();
            if (isCommandPaletteOpen()) renderCommandPalette();
            showToast('Projects rescanned', `${projects.length} ${pluralize(projects.length, 'project')} available.`, 'success', 2600);
        } catch (err) {
            showToast('Rescan failed', compactErrorMessage(err && err.message, 'Unable to rescan projects.'), 'error', 4200);
        } finally {
            projectRescanInFlight = false;
            if (btn) btn.classList.remove('busy');
        }
    }

    let lastProjectListKey = '';

    function renderProjectList() {
        const list = document.getElementById('project-list');

        const fp = filteredProjects();
        const key = fp.map(p => {
            const b = badges[p.name];
            const dc = (b && b.dirty_count > 0) ? b.dirty_count : 0;
            const exp = expandedProjects[p.name] ? 1 : 0;
            const wtKey = (worktreeCache[p.name] || []).map(w => w.name).join(',');
            return `${p.name}:${p.pinned?1:0}:${p.name===activeProject?1:0}:${p.has_session?1:0}:${p.session_alive?1:0}:${dc}:${exp}:${projectTagList(p.name).join(',')}:${wtKey}`;
        }).join('|');
        if (key === lastProjectListKey) return;
        lastProjectListKey = key;

        list.innerHTML = '';
        fp.forEach(p => {
            const el = document.createElement('div');
            el.className = 'project-item' + (p.pinned ? ' pinned' : '') + (p.name === activeProject ? ' active' : '');
            el.dataset.name = p.name;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'project-name';

            // Chevron for expand/collapse
            const chevron = document.createElement('span');
            chevron.className = 'worktree-chevron' + (expandedProjects[p.name] ? ' expanded' : '');
            chevron.innerHTML = iconHTML('chevron-right');
            chevron.onclick = (ev) => {
                ev.stopPropagation();
                toggleWorktreeExpand(p.name);
            };
            nameSpan.appendChild(chevron);

            // Session indicator dot
            if (p.has_session) {
                const dot = document.createElement('span');
                dot.className = 'session-dot ' + (p.session_alive ? 'alive' : 'dead');
                dot.title = p.session_alive ? 'Session running' : 'Session ended';
                dot.dataset.sessionKey = p.name;
                nameSpan.appendChild(dot);
            }

            const nameText = document.createElement('span');
            nameText.textContent = p.name;
            nameText.style.overflow = 'hidden';
            nameText.style.textOverflow = 'ellipsis';
            nameSpan.appendChild(nameText);

            const tags = projectTagList(p.name);
            if (tags.length > 0) {
                const tag = document.createElement('span');
                tag.className = 'project-tag';
                tag.textContent = tags[0];
                tag.title = tags.join(', ');
                nameSpan.appendChild(tag);
            }

            const actions = document.createElement('span');
            actions.className = 'project-actions';

            const b = badges[p.name];
            if (b && b.dirty_count > 0) {
                const badge = document.createElement('span');
                badge.className = 'dirty-badge';
                badge.textContent = b.dirty_count;
                badge.title = b.dirty_count + (b.is_git_repo ? ' changed file' : ' project file') + (b.dirty_count > 1 ? 's' : '');
                actions.appendChild(badge);
            }

            if (p.pinned) {
                const pinBtn = document.createElement('span');
                pinBtn.className = 'pin-btn active';
                pinBtn.innerHTML = iconHTML('star');
                pinBtn.title = 'Pinned';
                actions.appendChild(pinBtn);
            }

            const moreBtn = document.createElement('span');
            moreBtn.className = 'more-btn';
            moreBtn.innerHTML = iconHTML('more-horizontal');
            moreBtn.title = 'More actions';
            moreBtn.onclick = (ev) => {
                ev.stopPropagation();
                showProjectContextMenu(ev, p, moreBtn);
            };
            actions.appendChild(moreBtn);

            el.oncontextmenu = (ev) => showProjectContextMenu(ev, p);

            el.appendChild(nameSpan);
            el.appendChild(actions);

            el.onclick = () => switchProject(p.name);
            list.appendChild(el);

            // Worktree sub-list (when expanded)
            if (expandedProjects[p.name]) {
                const wts = worktreeCache[p.name] || [];
                wts.forEach(wt => {
                    const wtEl = document.createElement('div');
                    wtEl.className = 'worktree-item';
                    const wtKey = p.name + '@' + wt.name;
                    if (wtKey === activeProject) wtEl.classList.add('active');
                    wtEl.dataset.key = wtKey;

                    const wtNameSpan = document.createElement('span');
                    wtNameSpan.className = 'worktree-name';

                    // Session dot for worktree
                    const wtInfo = terminals[wtKey];
                    if (wtInfo) {
                        const dot = document.createElement('span');
                        const alive = wtInfo.ws && wtInfo.ws.readyState === WebSocket.OPEN;
                        dot.className = 'session-dot ' + (alive ? 'alive' : 'dead');
                        dot.dataset.sessionKey = wtKey;
                        wtNameSpan.appendChild(dot);
                    }

                    const wtText = document.createElement('span');
                    const displayBranch = wt.branch && wt.branch !== wt.name ? ` (${wt.branch})` : '';
                    wtText.textContent = wt.name + displayBranch;
                    wtText.style.overflow = 'hidden';
                    wtText.style.textOverflow = 'ellipsis';
                    wtNameSpan.appendChild(wtText);

                    const wtActions = document.createElement('span');
                    wtActions.className = 'worktree-actions';

                    const deleteBtn = document.createElement('span');
                    deleteBtn.className = 'worktree-delete-btn';
                    deleteBtn.innerHTML = iconHTML('x');
                    deleteBtn.title = 'Remove worktree';
                    deleteBtn.onclick = (ev) => {
                        ev.stopPropagation();
                        confirmDeleteWorktree(p.name, wt);
                    };
                    wtActions.appendChild(deleteBtn);

                    wtEl.appendChild(wtNameSpan);
                    wtEl.appendChild(wtActions);
                    wtEl.onclick = () => switchProject(wtKey);
                    list.appendChild(wtEl);
                });

                // Add worktree row
                const addRow = document.createElement('div');
                addRow.className = 'worktree-add-row';

                const input = document.createElement('input');
                input.className = 'worktree-add-input worktree-branch-input';
                input.type = 'text';
                input.placeholder = 'branch name...';
                input.dataset.project = p.name;
                input.onclick = (ev) => ev.stopPropagation();
                input.onkeydown = (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        activateBranchAutocomplete(p.name, input);
                    } else if (ev.key === 'ArrowDown') {
                        ev.preventDefault();
                        moveBranchAutocompleteHighlight(1);
                    } else if (ev.key === 'ArrowUp') {
                        ev.preventDefault();
                        moveBranchAutocompleteHighlight(-1);
                    } else if (ev.key === 'Escape') {
                        hideBranchAutocomplete();
                    }
                };

                // Autocomplete setup
                input.onfocus = () => showBranchAutocomplete(p.name, input);
                input.oninput = () => updateBranchAutocomplete(p.name, input);
                input.onblur = () => setTimeout(() => hideBranchAutocomplete(), 200);

                const addBtn = document.createElement('span');
                addBtn.className = 'worktree-add-btn';
                addBtn.innerHTML = iconHTML('plus');
                addBtn.title = 'Add worktree';
                addBtn.onclick = (ev) => {
                    ev.stopPropagation();
                    activateBranchAutocomplete(p.name, input);
                };

                addRow.appendChild(input);
                addRow.appendChild(addBtn);
                list.appendChild(addRow);
            }
        });

        updateSessionIndicators();
    }

    async function updateBadges() {
        try {
            badges = await fetchJSON('/api/badges');
            renderProjectList();
            renderWorkspaceControls();
        } catch {
            // ignore
        }
    }

    async function fetchWorktrees(projectName) {
        try {
            const wts = await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/worktrees`);
            worktreeCache[projectName] = wts || [];
        } catch {
            worktreeCache[projectName] = [];
        }
        return worktreeCache[projectName];
    }

    async function toggleWorktreeExpand(projectName) {
        if (expandedProjects[projectName]) {
            delete expandedProjects[projectName];
        } else {
            expandedProjects[projectName] = true;
            await fetchWorktrees(projectName);
        }
        lastProjectListKey = ''; // force re-render
        renderProjectList();
    }

    async function createWorktreeFromInput(projectName, input) {
        const branch = input.value.trim();
        if (!branch) return;

        try {
            await createWorktree(projectName, branch);
            input.value = '';
        } catch (err) {
            console.error('Failed to create worktree:', err);
            showToast('Worktree failed', compactErrorMessage(err && err.message), 'error', 5200);
        }
    }

    function normalizedBranchName(value) {
        return String(value || '').trim().toLowerCase();
    }

    async function createWorktree(projectName, branch, options = {}) {
        const baseBranch = String(options.baseBranch || '').trim();
        let selectedBranch = branch;
        // Check if it matches an existing branch
        let isNew = true;
        if (!baseBranch) {
            try {
                const data = await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/branches`);
                const allBranches = data.branches || [];
                const existingBranch = allBranches.find(b => normalizedBranchName(b) === normalizedBranchName(selectedBranch));
                if (existingBranch) {
                    selectedBranch = existingBranch;
                    isNew = false;
                }
            } catch {}
        }

        const payload = { branch: selectedBranch, isNew };
        if (baseBranch) payload.baseBranch = baseBranch;
        const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/worktrees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const msg = (await res.text().catch(() => '')) || res.statusText;
            throw new Error(msg);
        }
        const wt = await res.json().catch(() => null);
        await fetchWorktrees(projectName);
        lastProjectListKey = '';
        renderProjectList();
        return wt;
    }

    async function promptCreateWorktree(projectName = activeCommandProject()) {
        if (!projectName) return;
        const branch = await requestTextInput({
            title: 'Create worktree',
            subtitle: `${projectName} — new or existing branch`,
            submitLabel: 'Create',
        });
        if (!branch || !branch.trim()) return;
        try {
            const wt = await createWorktree(projectName, branch.trim());
            showToast('Worktree created', wt && wt.name ? `${projectName}@${wt.name}` : projectName, 'success');
        } catch (err) {
            showToast('Worktree failed', compactErrorMessage(err && err.message), 'error', 5200);
        }
    }

    async function worktreesForCommand(projectName) {
        const wts = await fetchWorktrees(projectName);
        if (!wts || wts.length === 0) {
            showToast('No worktrees', `${projectName} has no worktrees.`, 'info', 3200);
            return [];
        }
        return wts;
    }

    function worktreeChoiceLabel(wt) {
        return wt.branch && wt.branch !== wt.name ? `${wt.name} (${wt.branch})` : wt.name;
    }

    function normalizedWorktreeChoice(value) {
        return String(value || '').trim().toLowerCase();
    }

    function worktreeChoiceCandidates(wt) {
        return [wt.name, wt.branch, worktreeChoiceLabel(wt)].filter(Boolean);
    }

    function findWorktreeChoice(worktrees, choice) {
        const q = normalizedWorktreeChoice(choice);
        if (!q) return null;
        return worktrees.find(wt => worktreeChoiceCandidates(wt).some(candidate => normalizedWorktreeChoice(candidate) === q))
            || worktrees.find(wt => worktreeChoiceCandidates(wt).some(candidate => normalizedWorktreeChoice(candidate).includes(q)))
            || null;
    }

    async function promptOpenWorktree(projectName = activeCommandProject()) {
        if (!projectName) return;
        const wts = await worktreesForCommand(projectName);
        if (wts.length === 0) return;
        const names = wts.map(worktreeChoiceLabel).join(', ');
        const choice = await requestTextInput({
            title: `Open worktree for ${projectName}`,
            subtitle: names,
            defaultValue: worktreeChoiceLabel(wts[0]),
            submitLabel: 'Open',
        });
        const wt = findWorktreeChoice(wts, choice);
        if (!wt) return;
        await switchProject(`${projectName}@${wt.name}`);
    }

    async function promptRemoveWorktree(projectName = activeCommandProject()) {
        if (!projectName) return;
        const wts = await worktreesForCommand(projectName);
        if (wts.length === 0) return;
        const names = wts.map(worktreeChoiceLabel).join(', ');
        const choice = await requestTextInput({
            title: `Remove worktree for ${projectName}`,
            subtitle: names,
            defaultValue: worktreeChoiceLabel(wts[0]),
            submitLabel: 'Continue',
        });
        const wt = findWorktreeChoice(wts, choice);
        if (!wt) return;
        await confirmDeleteWorktree(projectName, wt);
    }

    async function confirmDeleteWorktree(projectName, wt) {
        if (!(await appConfirm(`Remove worktree "${wt.name}"?`))) return;
        const deleteBranch = wt.branch
            ? await appConfirm(`Also delete branch "${wt.branch}"?`)
            : false;

        const url = `/api/projects/${encodeURIComponent(projectName)}/worktrees/${encodeURIComponent(wt.name)}?deleteBranch=${deleteBranch}`;
        try {
            const res = await fetch(url, { method: 'DELETE' });
            if (!res.ok) {
                const msg = (await res.text().catch(() => '')) || res.statusText;
                throw new Error(msg);
            }
            const wtKey = projectName + '@' + wt.name;
            if (terminals[wtKey]) {
                closeTab(wtKey);
            }
            await fetchWorktrees(projectName);
            lastProjectListKey = '';
            renderProjectList();
        } catch (err) {
            console.error('Failed to remove worktree:', err);
            showToast('Worktree failed', compactErrorMessage(err && err.message), 'error', 5200);
        }
    }

    let _autocompleteDropdown = null;
    let _autocompleteRequestId = 0;
    let _autocompleteState = null;

    async function showBranchAutocomplete(projectName, input) {
        // Drop stale responses: request N's result must not replace a later
        // focus/input dropdown if responses arrive out of order.
        const reqId = ++_autocompleteRequestId;
        try {
            const data = await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/branches`);
            if (reqId !== _autocompleteRequestId) return;
            if (document.activeElement !== input) return;
            _autocompleteState = {
                projectName,
                input,
                branches: data.branches || [],
                highlightedIndex: input.value.trim() ? 0 : -1,
                items: [],
            };
            renderBranchAutocomplete();
        } catch {
            hideBranchAutocomplete();
        }
    }

    function updateBranchAutocomplete(projectName, input) {
        if (!_autocompleteState || _autocompleteState.projectName !== projectName || _autocompleteState.input !== input) {
            showBranchAutocomplete(projectName, input);
            return;
        }
        _autocompleteState.highlightedIndex = input.value.trim() ? 0 : -1;
        renderBranchAutocomplete();
    }

    function branchAutocompleteItems(branches, query) {
        const maxItems = 8;
        const normalizedQuery = normalizedBranchName(query);
        const exact = query ? branches.some(b => normalizedBranchName(b) === normalizedQuery) : false;
        const matches = query
            ? branches.filter(b => normalizedBranchName(b).includes(normalizedQuery))
            : branches;
        const items = [];
        if (query && !exact) {
            items.push({ type: 'create', branch: query, label: `Create "${query}"` });
        }
        matches.slice(0, maxItems - items.length).forEach(branch => {
            items.push({ type: 'branch', branch, label: branch });
        });
        return items;
    }

    function renderBranchAutocomplete() {
        if (!_autocompleteState) return;
        const { input, branches } = _autocompleteState;
        const query = input.value.trim();
        const items = branchAutocompleteItems(branches, query);
        _autocompleteState.items = items;
        if (items.length === 0) {
            hideBranchAutocomplete();
            return;
        }
        if (_autocompleteState.highlightedIndex < -1 || _autocompleteState.highlightedIndex >= items.length) {
            _autocompleteState.highlightedIndex = query ? 0 : -1;
        }

        removeBranchAutocompleteDropdown();
        const dropdown = document.createElement('div');
        dropdown.className = 'branch-autocomplete';
        const rect = input.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = rect.bottom + 'px';
        dropdown.style.width = rect.width + 'px';

        items.forEach((itemData, idx) => {
            const item = document.createElement('div');
            item.className = 'branch-autocomplete-item'
                + (idx === _autocompleteState.highlightedIndex ? ' highlighted' : '')
                + (itemData.type === 'create' ? ' create' : '');
            item.textContent = itemData.label;
            item.onmousedown = (ev) => {
                ev.preventDefault();
                applyBranchAutocompleteItem(itemData);
            };
            dropdown.appendChild(item);
        });

        document.body.appendChild(dropdown);
        _autocompleteDropdown = dropdown;
    }

    function moveBranchAutocompleteHighlight(delta) {
        if (!_autocompleteState || !_autocompleteState.items || _autocompleteState.items.length === 0) {
            return;
        }
        const count = _autocompleteState.items.length;
        if (_autocompleteState.highlightedIndex < 0) {
            _autocompleteState.highlightedIndex = delta > 0 ? 0 : count - 1;
            renderBranchAutocomplete();
            return;
        }
        _autocompleteState.highlightedIndex = (_autocompleteState.highlightedIndex + delta + count) % count;
        renderBranchAutocomplete();
    }

    function activateBranchAutocomplete(projectName, input) {
        if (_autocompleteState && _autocompleteState.projectName === projectName && _autocompleteState.input === input) {
            const item = _autocompleteState.items && _autocompleteState.items[_autocompleteState.highlightedIndex];
            if (item) {
                applyBranchAutocompleteItem(item);
                return;
            }
        }
        createWorktreeFromInput(projectName, input);
    }

    function applyBranchAutocompleteItem(item) {
        if (!_autocompleteState || !item) return;
        const { projectName, input } = _autocompleteState;
        input.value = item.branch;
        hideBranchAutocomplete();
        createWorktreeFromInput(projectName, input);
    }

    function removeBranchAutocompleteDropdown() {
        if (_autocompleteDropdown) {
            _autocompleteDropdown.remove();
            _autocompleteDropdown = null;
        }
    }

    function hideBranchAutocomplete() {
        removeBranchAutocompleteDropdown();
        _autocompleteState = null;
    }

    async function togglePin(name) {
        await fetch(`/api/projects/${encodeURIComponent(name)}/pin`, { method: 'POST' });
        const proj = projects.find(p => p.name === name);
        if (proj) proj.pinned = !proj.pinned;
        renderProjectList();
    }

    function projectForKey(key) {
        if (!key) return null;
        if (!key.includes('@')) return projects.find(p => p.name === key) || null;
        const [projectName, worktreeName] = key.split('@', 2);
        const wt = (worktreeCache[projectName] || []).find(item => item.name === worktreeName);
        if (wt && wt.path) return { name: key, path: wt.path };
        return projects.find(p => p.name === projectName) || null;
    }

    async function openProjectFolder(project) {
        const projectPath = project && project.path ? String(project.path).trim() : '';
        if (!projectPath) {
            showToast('Folder unavailable', 'Project path is missing.', 'error', 3200);
            return;
        }
        if (!window.electronOpenFolder) {
            showToast('Unsupported', 'Opening folders is available in the Electron app only.', 'error', 3800);
            return;
        }
        try {
            const result = await window.electronOpenFolder(projectPath);
            if (!result || !result.ok) {
                const message = (result && result.error) || 'Unable to open folder.';
                showToast('Open folder failed', message, 'error', 4200);
            }
        } catch (err) {
            showToast('Open folder failed', (err && err.message) || 'Unable to open folder.', 'error', 4200);
        }
    }

    async function restartTerminalSession(tabKey, sessionKey, cli, options = {}) {
        await fetch(`${terminalAPIBase(tabKey)}/restart?session=${encodeURIComponent(sessionKey)}`, { method: 'POST' });
        const runtimeCLI = resolveRuntimeCLI(cli);

        const existing = terminals[sessionKey];
        if (existing) {
            if (existing._cleanup) existing._cleanup(); else if (existing.ws) existing.ws.close();
            if (existing.term) existing.term.dispose();
            if (existing.wrapper) existing.wrapper.remove();
            delete terminals[sessionKey];
            unregisterPane(tabKey, sessionKey);
        }

        renderTabs();

        await fetchJSON(`${terminalAPIBase(tabKey)}/terminal/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: sessionKey, cli: runtimeCLI, resume_last: !!options.resumeLast })
        });

        createTerminal(sessionKey, { tabKey, cli: runtimeCLI });
    }

    async function restartSessionInTab(tabKey, sessionKey, options = {}) {
        const existing = terminals[sessionKey];
        if (!existing) return false;

        const cli = normalizeCLI(existing.cli);
        await restartTerminalSession(tabKey, sessionKey, cli, options);

        const isActive = activeTab === tabKey;
        setTabVisibility(tabKey, isActive);
        if (options.focusAfterRestart && isActive) {
            setFocusedPane(tabKey, sessionKey);
        }
        refreshTerminalContainerLayout();
        return true;
    }

    async function restartProject(name) {
        const sessionKey = getFocusedPaneKey(name);
        const existing = terminals[sessionKey];
        if (!existing) {
            if (activeTab === name) activeTab = null;
            await switchProject(name);
            return;
        }

        await restartSessionInTab(name, sessionKey, { focusAfterRestart: true });
    }

    function canResumeActiveSession() {
        if (!activeTab) return false;
        const pane = terminals[getFocusedPaneKey(activeTab)];
        if (!pane || pane.kind) return false;
        const cli = normalizeCLI(pane.cli);
        return cli === 'openai' || cli === 'opencode' || !!customCLIIntegrations.find(item => item.id === cli)?.resume_command?.trim();
    }

    async function restartAndResumeActiveSession() {
        if (sessionRestartInFlight || !canResumeActiveSession()) return;
        const tabKey = activeTab;
        const sessionKey = getFocusedPaneKey(tabKey);
        sessionRestartInFlight = true;
        try {
            await restartSessionInTab(tabKey, sessionKey, { focusAfterRestart: true, resumeLast: true });
        } catch (err) {
            showToast('Session resume failed', compactErrorMessage(err && err.message), 'error', 5200);
        } finally {
            sessionRestartInFlight = false;
        }
    }

    async function pullProject(name) {
        if (!name) return;
        try {
            const data = await fetchJSON(`/api/projects/${encodeURIComponent(name)}/pull`, { method: 'POST' });
            if (data.error) {
                showToast('Pull failed', compactErrorMessage(data.output || data.error), 'error', 6200);
            } else {
                showGitSuccessToast('Pull complete', data, `${name} pulled successfully.`);
            }
            updateGitStatus();
            updateBadges();
            if (overviewActive) loadOverview();
        } catch (err) {
            showToast('Pull failed', compactErrorMessage(err && err.message), 'error', 6200);
        } finally {
            focusActiveTerminalSoon();
        }
    }

    async function switchProject(name, options = {}) {
        const requestSeq = ++tabSwitchRequestSeq;
        if (overviewActive) hideOverview();
        if (jobsActive) hideJobs();
        if (databaseActive) hideDatabase();
        if (isWorkspaceTab(name)) return openWorkspaceTab(name, { ...options, requestSeq });
        if (activeTab === name) {
            if (markTabCompletionSeen(name)) {
                updateSessionIndicators();
                renderTabs();
            }
            return;
        }
        closeDiffModal();

        if (activeTab) setTabVisibility(activeTab, false);
        document.querySelectorAll('.project-item').forEach(el => {
            el.classList.toggle('active', el.dataset.name === name);
        });
        document.querySelectorAll('.worktree-item').forEach(el => {
            el.classList.toggle('active', el.dataset.key === name);
        });

        activeTab = name;
        activeProject = name;
        markTabCompletionSeen(name);
        if (name.includes('@')) {
            const [proj, wt] = name.split('@', 2);
            document.getElementById('status-project').textContent = proj + ' (' + wt + ')';
        } else {
        document.getElementById('status-project').textContent = name;
        }
        renderTabs();
        updateSessionIndicators();

        ensureTabState(name);
        if (getPaneKeys(name).length === 0) {
            createTerminal(name, { tabKey: name, cli: normalizeCLI(options.initialCLI) });
        } else {
            setTabVisibility(name, true);
            getPaneKeys(name).forEach(key => safeFit(terminals[key]));
            const terminalEntry = getTerminalEntry(name);
            if (terminalEntry) terminalEntry.term.focus();
        }
        refreshTerminalContainerLayout();

        // Start git status polling. The first hit nudges a background fetch so
        // ahead/behind counts refresh without delaying tab switches.
        resetGitStatusForProject(name);
        updateGitStatus({ fresh: true });
        setGitStatusPollInterval(GIT_STATUS_POLL_INTERVAL_MS);

        // Docker section
        updateDockerSection();
        updateSidePanels();
        renderWorkspaceControls();
        renderWorkspaceList();
    }


    // ─── Multi-project workspaces ───────────────────────────────────
    function isWorkspaceTab(key) {
        return typeof key === 'string' && key.startsWith('workspace:');
    }

    function workspaceForTab(key = activeTab) {
        if (!isWorkspaceTab(key)) return null;
        return workspaces.find(workspace => 'workspace:' + workspace.id === key) || null;
    }

    function terminalAPIBase(tabKey) {
        return isWorkspaceTab(tabKey)
            ? '/api/workspaces/' + encodeURIComponent(tabKey.slice('workspace:'.length))
            : '/api/projects/' + encodeURIComponent(tabKey);
    }

    function saveWorkspacePatch(id, patch) {
        // Serialize metadata writes so rapid project switches persist in order.
        // These requests never send input to or restart the terminal.
        const request = workspaceSaveQueue.catch(() => {}).then(() => fetchJSON('/api/workspaces/' + encodeURIComponent(id), {
            method: 'PATCH',
            timeoutMs: CONFIG_SAVE_TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        }));
        workspaceSaveQueue = request;
        return request;
    }

    function storeWorkspace(workspace) {
        const index = workspaces.findIndex(item => item.id === workspace.id);
        if (index < 0) workspaces.push(workspace);
        else workspaces[index] = workspace;
    }

    function workspaceProjectAvailable(key) {
        if (!key.includes('@')) return projects.some(project => project.name === key);
        const [parent, worktree] = key.split('@', 2);
        return projects.some(project => project.name === parent)
            && (worktreeCache[parent] || []).some(item => item.name === worktree);
    }

    function renderWorkspaceList() {
        const list = document.getElementById('workspace-list');
        if (!list) return;
        list.innerHTML = '';
        for (const workspace of workspaces) {
            const tabKey = 'workspace:' + workspace.id;
            const row = document.createElement('div');
            row.className = 'workspace-item' + (tabKey === activeTab ? ' active' : '');
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'workspace-open';
            open.title = workspace.working_directory;
            open.textContent = workspace.name;
            open.onclick = () => switchProject(tabKey);
            const count = document.createElement('span');
            count.className = 'workspace-project-count';
            count.textContent = String((workspace.projects || []).length);
            count.title = 'Tracked projects';
            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'workspace-edit';
            edit.innerHTML = iconHTML('settings');
            edit.title = 'Manage ' + workspace.name;
            edit.setAttribute('aria-label', edit.title);
            edit.onclick = () => openWorkspaceDialog(workspace.id);
            row.append(open, count, edit);
            list.appendChild(row);
        }
    }

    function renderWorkspaceControls() {
        const controls = document.getElementById('workspace-git-controls');
        if (!controls) return;
        const workspace = workspaceForTab();
        controls.style.display = workspace && !databaseActive && !jobsActive && !overviewActive ? 'flex' : 'none';
        if (!workspace) return;
        const select = document.getElementById('workspace-project-select');
        const entries = workspace.projects || [];
        const fingerprint = JSON.stringify(entries.map(key => [key, badges[key]?.dirty_count, workspaceProjectAvailable(key)]));
        if (select.dataset.options !== fingerprint) {
            select.dataset.options = fingerprint;
            select.innerHTML = '';
            if (entries.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'No tracked projects';
                select.appendChild(option);
            }
            for (const key of entries) {
                const option = document.createElement('option');
                option.value = key;
                const count = badges[key]?.dirty_count;
                const suffix = !workspaceProjectAvailable(key) ? ' · unavailable'
                    : typeof count === 'number' ? ' · ' + count + ' changed' : '';
                option.textContent = commandProjectLabel(key) + suffix;
                select.appendChild(option);
            }
        }
        select.value = workspace.active_project || '';
        select.disabled = entries.length === 0;
        select.title = workspace.active_project || 'Choose a tracked project';
    }

    function refreshWorkspaceGitContext() {
        const workspace = workspaceForTab();
        if (!workspace) return;
        closeDiffModal();
        closeBranchDropdown();
        closeCommitModal();
        activeProject = (workspace.projects || []).includes(workspace.active_project) ? workspace.active_project : null;
        if (activeProject) {
            resetGitStatusForProject(activeProject);
            updateGitStatus({ fresh: true });
            setGitStatusPollInterval(GIT_STATUS_POLL_INTERVAL_MS);
        } else {
            showNoProjectGitState();
        }
        renderWorkspaceControls();
        renderProjectList();
        updateDockerSection();
        updateStatusContext();
    }

    async function selectWorkspaceProject(projectName) {
        const workspace = workspaceForTab();
        if (!workspace || !(workspace.projects || []).includes(projectName) || workspace.active_project === projectName) return;
        const previous = workspace.active_project;
        workspace.active_project = projectName;
        refreshWorkspaceGitContext();
        try {
            await saveWorkspacePatch(workspace.id, { active_project: projectName });
        } catch (err) {
            if (workspace.active_project === projectName) {
                workspace.active_project = previous;
                if (workspaceForTab()?.id === workspace.id) refreshWorkspaceGitContext();
            }
            showToast('Project selection not saved', compactErrorMessage(err && err.message), 'error', 4200);
        }
    }

    async function openWorkspaceTab(tabKey, options = {}) {
        const workspace = workspaceForTab(tabKey);
        if (!workspace) return;
        if (activeTab === tabKey) {
            markTabCompletionSeen(tabKey);
            renderTabs();
            return;
        }
        const cli = normalizeCLI(options.initialCLI || currentCLI);
        if (getPaneKeys(tabKey).length === 0) {
            try {
                await fetchJSON(terminalAPIBase(tabKey) + '/terminal/start', {
                    method: 'POST',
                    timeoutMs: CONFIG_SAVE_TIMEOUT_MS,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cli: resolveRuntimeCLI(cli) }),
                });
            } catch (err) {
                showToast('Workspace session unavailable', compactErrorMessage(err && err.message), 'error', 5000);
                return;
            }
            if (getPaneKeys(tabKey).length === 0) createTerminal(tabKey, { tabKey, cli });
        }
        if (options.requestSeq !== tabSwitchRequestSeq) {
            setTabVisibility(tabKey, activeTab === tabKey);
            renderTabs();
            refreshTerminalContainerLayout();
            focusActiveTerminalSoon();
            return;
        }
        closeDiffModal();
        if (activeTab) setTabVisibility(activeTab, false);
        activeTab = tabKey;
        setTabVisibility(tabKey, true);
        markTabCompletionSeen(tabKey);
        document.getElementById('status-project').textContent = workspace.name;
        refreshWorkspaceGitContext();
        renderWorkspaceList();
        renderTabs();
        updateSidePanels();
        refreshTerminalContainerLayout();
        getPaneKeys(tabKey).forEach(key => safeFit(terminals[key]));
        focusActiveTerminalSoon();
    }

    function workspaceProjectChoices() {
        const choices = [];
        for (const project of projects) {
            choices.push({ key: project.name, label: project.name, path: project.path });
            for (const worktree of worktreeCache[project.name] || []) {
                choices.push({ key: project.name + '@' + worktree.name, label: project.name + ' (' + worktree.name + ')', path: worktree.path });
            }
        }
        for (const key of workspaceDraftProjects) {
            if (!choices.some(choice => choice.key === key)) choices.push({ key, label: key + ' · unavailable', path: '' });
        }
        return choices;
    }

    function updateWorkspaceSelectedCount() {
        document.getElementById('workspace-selected-count').textContent = workspaceDraftProjects.size + ' selected';
    }

    // Shift-click gives every visible row from the last clicked one to this
    // one the state the clicked row is switching to, so it can select or clear
    // a range. Returns false when there is no visible anchor to extend from.
    function toggleWorkspaceChoiceRange(keys, key) {
        const from = keys.indexOf(workspaceChoiceAnchor);
        const to = keys.indexOf(key);
        if (from < 0 || to < 0) return false;
        const checked = !workspaceDraftProjects.has(key);
        for (const item of keys.slice(Math.min(from, to), Math.max(from, to) + 1)) {
            if (checked) workspaceDraftProjects.add(item);
            else workspaceDraftProjects.delete(item);
        }
        return true;
    }

    function renderWorkspaceProjectChoices() {
        const list = document.getElementById('workspace-project-choices');
        const filter = document.getElementById('workspace-project-filter').value.trim().toLowerCase();
        list.innerHTML = '';
        const choices = workspaceProjectChoices().filter(choice => !filter || (choice.label + ' ' + choice.path).toLowerCase().includes(filter));
        const keys = choices.map(choice => choice.key);
        for (const choice of choices) {
            const row = document.createElement('label');
            row.className = 'workspace-project-choice';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = choice.key;
            checkbox.checked = workspaceDraftProjects.has(choice.key);
            checkbox.onchange = () => {
                if (checkbox.checked) workspaceDraftProjects.add(choice.key);
                else workspaceDraftProjects.delete(choice.key);
                updateWorkspaceSelectedCount();
            };
            row.addEventListener('click', ev => {
                if (ev.shiftKey && toggleWorkspaceChoiceRange(keys, choice.key)) {
                    ev.preventDefault();
                    // A cancelled checkbox click restores its old state after
                    // dispatch, so sync the boxes once the click is over.
                    setTimeout(() => {
                        list.querySelectorAll('input[type="checkbox"]').forEach(input => {
                            input.checked = workspaceDraftProjects.has(input.value);
                        });
                    });
                    updateWorkspaceSelectedCount();
                }
                workspaceChoiceAnchor = choice.key;
            });
            const name = document.createElement('span');
            name.className = 'workspace-choice-name';
            name.textContent = choice.label;
            name.title = choice.path || choice.label;
            row.append(checkbox, name);
            if (choice.path) {
                // The folder the project lives in, cut from the left when long
                // so the part nearest the project stays readable.
                const folder = document.createElement('span');
                folder.className = 'workspace-choice-folder';
                folder.title = choice.path;
                const text = document.createElement('bdi');
                text.textContent = choice.path.replace(/\/+[^/]+\/*$/, '') || '/';
                folder.appendChild(text);
                row.append(folder);
            }
            list.appendChild(row);
        }
        if (!choices.length) list.textContent = 'No matching projects';
        updateWorkspaceSelectedCount();
    }

    async function openWorkspaceDialog(id = '') {
        if (workspaceSaving) return;
        const workspace = workspaces.find(item => item.id === id);
        workspaceEditingID = workspace ? id : '';
        workspaceDraftProjects = new Set(workspace?.projects || []);
        workspaceChoiceAnchor = null;
        const modal = document.getElementById('workspace-modal');
        document.getElementById('workspace-modal-title').textContent = workspace ? 'Manage workspace' : 'New workspace';
        document.getElementById('workspace-name').value = workspace?.name || '';
        const folder = document.getElementById('workspace-folder');
        folder.value = workspace?.working_directory || settingsScanPaths[0] || '';
        folder.readOnly = !!workspace;
        document.getElementById('workspace-folder-browse').disabled = !!workspace;
        document.getElementById('workspace-delete').style.display = workspace ? '' : 'none';
        document.getElementById('workspace-save').textContent = workspace ? 'Save' : 'Create workspace';
        document.getElementById('workspace-error').textContent = '';
        document.getElementById('workspace-project-filter').value = '';
        modal.style.display = 'flex';
        renderWorkspaceProjectChoices();
        document.getElementById(workspace ? 'workspace-project-filter' : 'workspace-name').focus();
        // Scan paths are configuration, not necessarily opened in Settings yet.
        if (!workspace && !folder.value) {
            try {
                const cfg = await fetchJSON('/api/config');
                if (workspaceEditingID === '' && !folder.value) folder.value = cfg.scan_paths?.[0] || '';
            } catch { /* Manual path entry remains available. */ }
        }
        // Worktrees are normally loaded when a project is expanded in the sidebar.
        // Load them here too, with bounded concurrency, so the picker is complete.
        const queue = [...projects];
        await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
            while (queue.length && workspaceEditingID !== null) {
                const project = queue.shift();
                await fetchWorktrees(project.name);
            }
        }));
        if (workspaceEditingID !== null) renderWorkspaceProjectChoices();
    }

    function closeWorkspaceDialog() {
        if (workspaceSaving) return;
        workspaceEditingID = null;
        document.getElementById('workspace-modal').style.display = 'none';
        focusActiveTerminalSoon();
    }

    async function saveWorkspaceDialog(ev) {
        ev.preventDefault();
        if (workspaceSaving || workspaceEditingID === null) return;
        const id = workspaceEditingID;
        const name = document.getElementById('workspace-name').value.trim();
        const tracked = [...workspaceDraftProjects];
        const folder = document.getElementById('workspace-folder').value.trim();
        if (!name || (!id && !folder)) {
            document.getElementById('workspace-error').textContent = 'Enter a name and session folder.';
            return;
        }
        workspaceSaving = true;
        document.getElementById('workspace-save').disabled = true;
        document.getElementById('workspace-delete').disabled = true;
        try {
            const saved = id ? await saveWorkspacePatch(id, { name, projects: tracked }) : await fetchJSON('/api/workspaces', {
                method: 'POST',
                timeoutMs: CONFIG_SAVE_TIMEOUT_MS,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, working_directory: folder, projects: tracked, active_project: tracked[0] || '' }),
            });
            storeWorkspace(saved);
            workspaceSaving = false;
            closeWorkspaceDialog();
            renderWorkspaceList();
            renderTabs();
            if (!id) await switchProject('workspace:' + saved.id);
            else if (activeTab === 'workspace:' + id) {
                document.getElementById('status-project').textContent = saved.name;
                refreshWorkspaceGitContext();
            }
            updateBadges();
        } catch (err) {
            document.getElementById('workspace-error').textContent = compactErrorMessage(err && err.message, 'Could not save workspace.');
        } finally {
            workspaceSaving = false;
            document.getElementById('workspace-save').disabled = false;
            document.getElementById('workspace-delete').disabled = false;
        }
    }

    async function deleteWorkspaceFromDialog() {
        if (!workspaceEditingID || workspaceSaving) return;
        const id = workspaceEditingID;
        const workspace = workspaces.find(item => item.id === id);
        if (!workspace || !(await appConfirm('Delete workspace "' + workspace.name + '" and stop its session? Your repositories and files will be kept.'))) return;
        workspaceSaving = true;
        try {
            await workspaceSaveQueue.catch(() => {});
            await fetchJSON('/api/workspaces/' + encodeURIComponent(id), { method: 'DELETE', timeoutMs: CONFIG_SAVE_TIMEOUT_MS });
            closeTab('workspace:' + id);
            workspaces = workspaces.filter(item => item.id !== id);
            workspaceSaving = false;
            closeWorkspaceDialog();
            renderWorkspaceList();
            renderWorkspaceControls();
            renderTabs();
        } catch (err) {
            document.getElementById('workspace-error').textContent = compactErrorMessage(err && err.message, 'Could not delete workspace.');
        } finally {
            workspaceSaving = false;
        }
    }

    function initWorkspaces() {
        document.getElementById('new-workspace-btn')?.addEventListener('click', () => openWorkspaceDialog());
        document.getElementById('workspace-manage-btn')?.addEventListener('click', () => {
            const workspace = workspaceForTab();
            if (workspace) openWorkspaceDialog(workspace.id);
        });
        document.getElementById('workspace-project-select')?.addEventListener('change', ev => selectWorkspaceProject(ev.target.value));
        document.getElementById('workspace-form')?.addEventListener('submit', saveWorkspaceDialog);
        document.getElementById('workspace-cancel')?.addEventListener('click', closeWorkspaceDialog);
        document.getElementById('workspace-backdrop')?.addEventListener('click', closeWorkspaceDialog);
        document.getElementById('workspace-delete')?.addEventListener('click', deleteWorkspaceFromDialog);
        document.getElementById('workspace-project-filter')?.addEventListener('input', renderWorkspaceProjectChoices);
        document.getElementById('workspace-folder-browse')?.addEventListener('click', async () => {
            const folder = document.getElementById('workspace-folder');
            const path = await selectDirectory({ title: 'Select workspace session folder', defaultPath: folder.value });
            if (path && workspaceEditingID === '') folder.value = path;
        });
    }

    function showNoProjectGitState() {
        clearInterval(gitPollTimer);
        gitPollTimer = null;
        gitStatusRequestSeq++;
        setCurrentGitFiles(null, [], 'idle');
        setGitRepositoryActionsVisible(false);
        lastGitHtml = '';
        const content = document.getElementById('git-content');
        if (content) {
            content.dataset.project = '';
            content.dataset.loading = 'false';
            content.innerHTML = '<div class="git-clean">' + (workspaceForTab() ? 'Add projects to track their changes.' : 'No project selected') + '</div>';
        }
    }


    // ─── Tab Persistence ───────────────────────────────────────────
    let _saveTabsTimer = null;
function buildTabLayoutsPayload(cliTransition = null) {
	const layouts = {};
	getTabKeys().forEach(tabKey => {
		const panes = getPaneKeys(tabKey)
			.map(sessionKey => {
				const t = terminals[sessionKey];
				if (!t || t.kind) return null;
				return {
					session: sessionKey,
					cli: cliTransition ? applyCLITransition(t.cli, cliTransition) : normalizeCLI(t.cli),
				};
			})
			.filter(Boolean);
            if (panes.length === 0) return;
            layouts[tabKey] = {
                focused_pane: getFocusedPaneKey(tabKey),
                panes,
            };
        });
        return layouts;
    }

    function saveTabs() {
        // Debounce saves to avoid spamming the API
        clearTimeout(_saveTabsTimer);
        _saveTabsTimer = setTimeout(() => {
            saveTabsNow().catch(() => {});
        }, 500);
    }

function saveTabsNow(cliTransition = null) {
	clearTimeout(_saveTabsTimer);
	const names = getTabKeys();
	return fetch('/api/tabs', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			open_tabs: names,
			active_tab: activeTab || '',
			tab_layouts: buildTabLayoutsPayload(cliTransition)
		})
	});
}

    // ─── Terminal Tabs ──────────────────────────────────────────────
    let lastTabsKey = '';
    let draggedTabKey = '';

    function clearTabDropIndicators(tabBar) {
        tabBar.querySelectorAll('.terminal-tab').forEach(tab => {
            tab.classList.remove('drop-before', 'drop-after');
        });
    }

    function clearTabDragStyles(tabBar) {
        clearTabDropIndicators(tabBar);
        tabBar.querySelector('.terminal-tab.dragging')?.classList.remove('dragging');
    }

    function bindTabDrag(tabBar, tab, name) {
        tab.draggable = true;
        tab.ondragstart = (ev) => {
            if (ev.target.closest?.('.tab-close')) {
                ev.preventDefault();
                return;
            }
            draggedTabKey = name;
            tab.classList.add('dragging');
            if (ev.dataTransfer) {
                ev.dataTransfer.effectAllowed = 'move';
                ev.dataTransfer.setData('text/plain', name);
            }
        };
        tab.ondragover = (ev) => {
            if (!draggedTabKey) return;
            if (draggedTabKey === name) {
                clearTabDropIndicators(tabBar);
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
            const rect = tab.getBoundingClientRect();
            const insertAfter = ev.clientX >= rect.left + rect.width / 2;
            clearTabDropIndicators(tabBar);
            tab.classList.add(insertAfter ? 'drop-after' : 'drop-before');
        };
        tab.ondragleave = (ev) => {
            if (tab.contains(ev.relatedTarget)) return;
            tab.classList.remove('drop-before', 'drop-after');
        };
        tab.ondrop = (ev) => {
            if (!draggedTabKey || draggedTabKey === name) return;
            ev.preventDefault();
            ev.stopPropagation();
            const rect = tab.getBoundingClientRect();
            const insertAfter = ev.clientX >= rect.left + rect.width / 2;
            const sourceName = draggedTabKey;
            draggedTabKey = '';
            clearTabDragStyles(tabBar);
            if (reorderTab(sourceName, name, insertAfter)) renderTabs();
        };
        tab.ondragend = () => {
            draggedTabKey = '';
            clearTabDragStyles(tabBar);
            renderTabs();
        };
    }

    function tabDotState(tab, tabKey) {
        if (!tab) return 'dead';
        const connected = tab.ws && tab.ws.readyState === WebSocket.OPEN;
        if (!connected) return 'dead';
        const status = tabPaneStatus(tabKey);
        return 'alive' + sessionStateSuffix(status) + (isCompletedTabUnseen(tabKey, status) ? ' unseen' : '');
    }

    function sessionStateSuffix(status) {
        const state = status && status.state;
        if (state === 'waiting') return ' waiting';
        if (state === 'busy' || state === 'shell') return ' busy';
        if (state === 'completed') return ' completed';
        if (state === 'idle') return ' idle';
        return '';
    }

    // Waiting outranks busy here, unlike the probe's own precedence: a blocked
    // pane needs the user, a busy one clears on its own.
    const PANE_STATE_RANK = { unknown: 0, idle: 1, completed: 2, shell: 3, busy: 4, waiting: 5 };

    // One dot stands for every pane under a tab, so it reports the most
    // attention-worthy pane rather than whichever one has focus.
    function tabPaneStatus(tabKey) {
        const paneKeys = getPaneKeys(tabKey);
        // Tabs open elsewhere have no pane registry here, so fall back to the
        // session names the server reports for this key.
        const keys = paneKeys.length > 0
            ? paneKeys
            : Object.keys(sessionStatuses).filter(key => key === tabKey || key.startsWith(tabKey + '#'));
        let best = null;
        let remote = false;
        keys.forEach(key => {
            const status = sessionStatuses[key];
            if (!status) return;
            if (status.remote_control) remote = true;
            if (!best || (PANE_STATE_RANK[status.state] || 0) > (PANE_STATE_RANK[best.state] || 0)) best = status;
        });
        if (!best) return null;
        return best.remote_control === remote ? best : Object.assign({}, best, { remote_control: remote });
    }

    function isTabCurrentlyViewed(tabKey) {
        return activeTab === tabKey && !overviewActive && !jobsActive && !databaseActive;
    }

    function isCompletedTabUnseen(tabKey, status = tabPaneStatus(tabKey)) {
        return Boolean(status && status.state === 'completed' && unseenCompletedTabs.has(tabKey));
    }

    function markTabCompletionSeen(tabKey) {
        return Boolean(tabKey && unseenCompletedTabs.delete(tabKey));
    }

    function markVisibleTabCompletionSeen() {
        const tabKey = activeTab;
        if (!tabKey || !isTabCurrentlyViewed(tabKey) || !markTabCompletionSeen(tabKey)) return false;
        updateSessionIndicators();
        renderTabs();
        return true;
    }

    function updateUnseenCompletedTabs() {
        let changed = false;
        const tabKeys = getTabKeys();
        const currentTabKeys = new Set(tabKeys);

        tabKeys.forEach(tabKey => {
            const status = tabPaneStatus(tabKey);
            const state = status ? status.state : '';
            const previousState = previousTabSessionStates.get(tabKey);

            if (state !== 'completed' || isTabCurrentlyViewed(tabKey)) {
                changed = unseenCompletedTabs.delete(tabKey) || changed;
            } else if (previousState !== 'completed' && !unseenCompletedTabs.has(tabKey)) {
                unseenCompletedTabs.add(tabKey);
                changed = true;
            }
            previousTabSessionStates.set(tabKey, state);
        });

        [...previousTabSessionStates.keys()].forEach(tabKey => {
            if (currentTabKeys.has(tabKey)) return;
            previousTabSessionStates.delete(tabKey);
            changed = unseenCompletedTabs.delete(tabKey) || changed;
        });
        return changed;
    }

    function sessionStateLabel(status, fallback, completionUnseen = false) {
        if (!status) return fallback;
        let label = fallback;
        if (status.state === 'busy') label = 'Agent working';
        else if (status.state === 'shell') label = 'Background command running';
        else if (status.state === 'waiting') label = 'Waiting for you' + (status.waiting_for ? ': ' + status.waiting_for : '');
        else if (status.state === 'completed') label = 'Task complete';
        else if (status.state === 'idle') label = 'Agent idle';
        if (status.state === 'completed' && completionUnseen) label += ' · Not viewed yet';
        if (status.remote_control) label += ' · Remote Control active';
        return label;
    }

    function tabIndicatorState(tab, tabKey) {
        const dotState = tabDotState(tab, tabKey);
        const connected = tab && tab.ws && tab.ws.readyState === WebSocket.OPEN;
        const status = tabPaneStatus(tabKey);
        const label = connected
            ? sessionStateLabel(status, 'Session online', isCompletedTabUnseen(tabKey, status))
            : 'Session offline';
        return { dotState, label };
    }

    // Applied outside renderProjectList so a status change repaints the dots
    // without rebuilding the sidebar.
    function updateSessionIndicators() {
        document.querySelectorAll('.session-dot[data-session-key]').forEach(dot => {
            const tabKey = dot.dataset.sessionKey;
            const status = tabPaneStatus(tabKey);
            const alive = dot.classList.contains('alive');
            const state = alive && status ? status.state : '';
            dot.classList.toggle('busy', state === 'busy' || state === 'shell');
            dot.classList.toggle('waiting', state === 'waiting');
            dot.classList.toggle('completed', state === 'completed');
            dot.classList.toggle('unseen', alive && isCompletedTabUnseen(tabKey, status));
            dot.classList.toggle('idle', state === 'idle');
            dot.classList.toggle('remote', Boolean(alive && status && status.remote_control));
            if (alive) {
                dot.title = sessionStateLabel(status, 'Session running', isCompletedTabUnseen(tabKey, status));
            }

            const nameSpan = dot.parentElement;
            if (!nameSpan) return;
            let alert = nameSpan.querySelector(':scope > .session-alert');
            if (state === 'waiting') {
                if (!alert) {
                    alert = document.createElement('span');
                    alert.className = 'session-alert';
                    alert.innerHTML = iconHTML('alert-circle');
                    dot.insertAdjacentElement('afterend', alert);
                }
                alert.title = dot.title;
            } else if (alert) {
                alert.remove();
            }
        });
    }

    async function pollSessionStatuses() {
        try {
            const next = await fetchJSON('/api/sessions/status');
            const changed = JSON.stringify(next) !== JSON.stringify(sessionStatuses);
            sessionStatuses = next && typeof next === 'object' ? next : {};
            const unseenChanged = updateUnseenCompletedTabs();
            updateSessionIndicators();
            if (changed || unseenChanged) renderTabs();
        } catch (err) {
            // Transient failures leave the previous indicators in place.
        }
    }

    async function pollPowerState() {
        const indicator = document.getElementById('sleep-blocker-indicator');
        if (!indicator) return;
        try {
            const state = await fetchJSON('/api/power');
            indicator.style.display = state && state.inhibit ? '' : 'none';
            indicator.title = state && state.reason ? 'Keeping the system awake — ' + state.reason : '';
        } catch (err) {
            indicator.style.display = 'none';
        }
    }

    function renderTabs() {
        if (draggedTabKey) {
            updateStatusContext();
            return;
        }
        saveTabs();
        const tabBar = document.getElementById('terminal-tabs');
        const names = getTabKeys();
        const hideTabs = names.length <= 1 && !isWorkspaceTab(names[0]);

        // Build fingerprint to skip unnecessary DOM rebuilds
        const key = hideTabs ? '' : JSON.stringify(names.map(n => {
            const t = terminals[getFocusedPaneKey(n)] || terminals[n];
            const indicator = tabIndicatorState(t, n);
            return [n, n === activeTab, indicator.dotState, indicator.label, workspaceForTab(n)?.name];
        }));
        if (key === lastTabsKey) {
            updateStatusContext();
            return;
        }
        lastTabsKey = key;

        tabBar.innerHTML = '';
        if (hideTabs) {
            updateStatusContext();
            return;
        } // hide tabs when only one terminal

        names.forEach(name => {
            const tab = document.createElement('div');
            tab.className = 'terminal-tab' + (name === activeTab ? ' active' : '');

            const t = terminals[getFocusedPaneKey(name)] || terminals[name];
            const indicator = tabIndicatorState(t, name);
            const dot = document.createElement('span');
            dot.className = 'tab-dot ' + indicator.dotState;
            dot.title = indicator.label;
            dot.setAttribute('aria-label', dot.title);
            tab.appendChild(dot);

            const label = document.createElement('span');
            label.className = 'tab-label';
            if (isWorkspaceTab(name)) {
                label.textContent = workspaceForTab(name)?.name || 'Workspace';
                tab.classList.add('workspace-tab');
            } else if (name.includes('@')) {
                const [proj, wt] = name.split('@', 2);
                const shortProj = proj.includes('/') ? proj.split('/').pop() : proj;
                const projLine = document.createElement('span');
                projLine.className = 'tab-project';
                projLine.textContent = shortProj;
                const wtLine = document.createElement('span');
                wtLine.className = 'tab-worktree';
                wtLine.textContent = wt;
                label.appendChild(projLine);
                label.appendChild(wtLine);
            } else {
                label.textContent = name;
            }
            tab.appendChild(label);

            const close = document.createElement('span');
            close.className = 'tab-close';
            close.innerHTML = iconHTML('x');
            close.onclick = (ev) => {
                ev.stopPropagation();
                closeTab(name);
            };
            tab.appendChild(close);

            tab.onclick = () => switchProject(name);
            bindTabDrag(tabBar, tab, name);
            tabBar.appendChild(tab);
        });
        scrollActiveTabIntoView(tabBar);
        updateStatusContext();
    }

    function scrollActiveTabIntoView(tabBar) {
        const activeTabEl = tabBar.querySelector('.terminal-tab.active');
        if (!activeTabEl) return;
        const tabRect = activeTabEl.getBoundingClientRect();
        const barRect = tabBar.getBoundingClientRect();
        if (tabRect.left < barRect.left) {
            tabBar.scrollLeft += tabRect.left - barRect.left;
        } else if (tabRect.right > barRect.right) {
            tabBar.scrollLeft += tabRect.right - barRect.right;
        }
    }

    function closeTab(name) {
        const paneKeys = [...getPaneKeys(name)];
        if (paneKeys.length === 0) return;
        paneKeys.forEach(key => {
            disposeTerminalPane(name, key, { stopBackend: true });
        });
        removeTabState(name);

        // Switch to another tab if we closed the active one
        if (activeTab === name) {
            activeTab = null;
            activeProject = null;
            const remaining = getTabKeys();
            if (remaining.length > 0) {
                switchProject(remaining[remaining.length - 1]);
            } else {
                updateSidePanels();
                refreshTerminalContainerLayout();
                showNoProjectGitState();
            }
        }
        renderWorkspaceControls();
        renderWorkspaceList();
        renderTabs();
    }

    function closePane(tabKey, sessionKey) {
        const paneKeys = getPaneKeys(tabKey);
        if (paneKeys.length <= 1) {
            closeTab(tabKey);
            return;
        }

        const t = terminals[sessionKey];
        if (!t) return;
        disposeTerminalPane(tabKey, sessionKey, { stopBackend: true });

        if (activeTab === tabKey) {
            setTabVisibility(tabKey, true);
            refreshTerminalContainerLayout();
            const focused = getTerminalEntry(tabKey);
            if (focused) {
                safeFit(focused);
                focused.term.focus();
            }
        }
        renderTabs();
    }

    function closeActivePaneOrTab() {
        if (!activeTab) return;
        const paneKeys = getPaneKeys(activeTab);
        if (paneKeys.length > 1) closePane(activeTab, getFocusedPaneKey(activeTab));
        else closeTab(activeTab);
    }

    // ─── Terminal helpers ──────────────────────────────────────────
    // Terminal theme is resolved dynamically via getTermTheme()

    function terminalHasSelection(term) {
        if (!term) return false;
        if (typeof term.hasSelection === 'function') return term.hasSelection();
        return !!(typeof term.getSelection === 'function' && term.getSelection());
    }

    function hideTerminalContextMenu() {
        const menu = document.getElementById('terminal-context-menu');
        if (menu) menu.style.display = 'none';
    }

    function hideDatabaseResultContextMenu() {
        const menu = document.getElementById('database-result-context-menu');
        if (menu) menu.style.display = 'none';
    }

    function hideProjectContextMenu() {
        const menu = document.getElementById('project-context-menu');
        if (menu) menu.style.display = 'none';
        document.querySelectorAll('.more-btn.menu-open').forEach(el => el.classList.remove('menu-open'));
    }

    function showProjectContextMenu(ev, project, anchorEl) {
        ev.preventDefault();
        ev.stopPropagation();
        hideTerminalContextMenu();
        hideDatabaseResultContextMenu();
        const editorMenu = document.getElementById('editor-context-menu');
        if (editorMenu) editorMenu.style.display = 'none';
        hideProjectContextMenu();

        const menu = document.getElementById('project-context-menu');
        if (!menu) return;

        const items = [
            { label: 'Open project folder', action: () => openProjectFolder(project) },
            { label: 'Restart session', action: () => restartProject(project.name) },
            { separator: true },
            {
                label: project.pinned ? 'Unpin' : 'Pin to top',
                action: () => togglePin(project.name),
            },
        ];

        menu.innerHTML = '';
        items.forEach(item => {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'project-context-separator';
                menu.appendChild(sep);
                return;
            }
            const el = document.createElement('div');
            el.className = 'terminal-context-item';
            el.textContent = item.label;
            el.addEventListener('click', () => {
                hideProjectContextMenu();
                item.action();
            });
            menu.appendChild(el);
        });

        let x = ev.clientX;
        let y = ev.clientY;
        if (anchorEl) {
            const rect = anchorEl.getBoundingClientRect();
            x = rect.left;
            y = rect.bottom + 4;
            anchorEl.classList.add('menu-open');
        }
        positionFixedMenu(menu, x, y);
    }

    function positionFixedMenu(menu, x, y) {
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.display = 'block';

        const rect = menu.getBoundingClientRect();
        const nextLeft = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
        const nextTop = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
        menu.style.left = nextLeft + 'px';
        menu.style.top = nextTop + 'px';
    }

    function canReadClipboardText() {
        return typeof window.electronClipboard?.readText === 'function'
            || typeof navigator?.clipboard?.readText === 'function';
    }

    function canWriteClipboardText() {
        return typeof window.electronClipboard?.writeText === 'function'
            || typeof navigator?.clipboard?.writeText === 'function';
    }

    async function readClipboardText() {
        if (typeof window.electronClipboard?.readText === 'function') {
            return await window.electronClipboard.readText();
        }
        const browserClipboard = navigator?.clipboard;
        if (typeof browserClipboard?.readText === 'function') {
            return await browserClipboard.readText();
        }
        return '';
    }

    async function writeClipboardText(text) {
        if (typeof window.electronClipboard?.writeText === 'function') {
            await window.electronClipboard.writeText(text);
            return;
        }
        const browserClipboard = navigator?.clipboard;
        if (typeof browserClipboard?.writeText === 'function') {
            await browserClipboard.writeText(text);
        }
    }

    async function runTerminalContextAction(action, term, url) {
        if (!term) return;
        try {
            if (action === 'copy') {
                const selection = term.getSelection();
                if (selection && canWriteClipboardText()) {
                    await writeClipboardText(selection);
                }
            } else if (action === 'paste') {
                if (!canReadClipboardText()) return;
                const text = await readClipboardText();
                if (!text) return;
                if (typeof term.paste === 'function') {
                    term.paste(text);
                }
            } else if (action === 'select-all') {
                term.selectAll();
            } else if (action === 'open-selected-link') {
                await openExternal(url || term.getSelection());
            }
        } catch (err) {
            showToast('Terminal action failed', (err && err.message) || 'The terminal action could not be completed.', 'error', 4200);
        } finally {
            term.focus();
        }
    }

    function showTerminalContextMenu(ev, term) {
        ev.preventDefault();
        ev.stopPropagation();
        hideTerminalContextMenu();
        hideDatabaseResultContextMenu();
        document.getElementById('editor-context-menu').style.display = 'none';

        const menu = document.getElementById('terminal-context-menu');
        const helpers = window.TerminalInteractions;
        if (!menu || !helpers) return;

        const items = helpers.getTerminalContextMenuItems({
            hasSelection: terminalHasSelection(term),
            selection: term.getSelection(),
            canPaste: canReadClipboardText(),
        });

        menu.innerHTML = '';
        items.forEach(item => {
            const el = document.createElement('div');
            el.className = 'terminal-context-item' + (item.enabled ? '' : ' disabled');
            el.textContent = item.label;
            el.dataset.action = item.action;
            if (item.url) el.dataset.url = item.url;
            if (item.enabled) {
                el.addEventListener('click', () => {
                    hideTerminalContextMenu();
                    runTerminalContextAction(item.action, term, item.url);
                });
            }
            menu.appendChild(el);
        });

        positionFixedMenu(menu, ev.clientX, ev.clientY);
        term.focus();
    }

    function droppedFilePath(file) {
        if (typeof window.electronGetPathForFile !== 'function') return '';
        return window.electronGetPathForFile(file) || '';
    }

    function handleTerminalDrop(ev, term) {
        const helpers = window.TerminalInteractions;
        const dt = ev.dataTransfer;
        if (!helpers || !dt) return;

        let paths = Array.from(dt.files || []).map(droppedFilePath).filter(Boolean);
        if (!paths.length) paths = helpers.parseUriList(dt.getData('text/uri-list'));

        const insertion = helpers.buildDropInsertion({ paths, text: dt.getData('text/plain') });
        if (!insertion) return;
        if (typeof term.paste === 'function') term.paste(insertion);
        term.focus();
    }

    // Without a window-level guard, dropping a file anywhere else navigates the renderer to it.
    // Drops the browser can handle natively — text into a form field — are left alone.
    const guardStrayDrop = (ev) => {
        // getData is blocked during dragover, so the URI list only arrives on drop.
        const uriList = ev.dataTransfer?.getData('text/uri-list') || '';
        if (window.TerminalInteractions?.acceptsTextDrop(ev.target, ev.dataTransfer?.types, uriList)) return;
        ev.preventDefault();
    };
    document.addEventListener('dragover', guardStrayDrop);
    document.addEventListener('drop', guardStrayDrop);

    document.addEventListener('mousedown', (ev) => {
        const tm = document.getElementById('terminal-context-menu');
        if (tm && tm.style.display !== 'none' && !tm.contains(ev.target)) {
            hideTerminalContextMenu();
        }
        const pm = document.getElementById('project-context-menu');
        if (pm && pm.style.display !== 'none' && !pm.contains(ev.target)) {
            hideProjectContextMenu();
        }
        const dm = document.getElementById('database-result-context-menu');
        if (dm && dm.style.display !== 'none' && !dm.contains(ev.target)) {
            hideDatabaseResultContextMenu();
        }
    });
    window.addEventListener('resize', () => {
        hideTerminalContextMenu();
        hideProjectContextMenu();
        hideDatabaseResultContextMenu();
    });
    document.addEventListener('keydown', () => {
        hideTerminalContextMenu();
        hideProjectContextMenu();
        hideDatabaseResultContextMenu();
    });

    function makeTerminalInstance(parentEl, insertBeforeEl = null) {
        const wrapper = document.createElement('div');
        wrapper.className = 'terminal-wrapper active';
        if (insertBeforeEl && insertBeforeEl.parentNode === parentEl) {
            parentEl.insertBefore(wrapper, insertBeforeEl);
        } else {
            parentEl.appendChild(wrapper);
        }

        const providerWrap = document.createElement('div');
        providerWrap.className = 'terminal-pane-provider';
        const providerSelect = document.createElement('select');
        providerSelect.className = 'terminal-provider-select';
        providerWrap.appendChild(providerSelect);
        wrapper.appendChild(providerWrap);

        const paneBody = document.createElement('div');
        paneBody.className = 'terminal-pane-body';
        wrapper.appendChild(paneBody);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'terminal-pane-close';
        closeBtn.innerHTML = iconHTML('x');
        wrapper.appendChild(closeBtn);

        const term = new Terminal({
            scrollback: 10000,
            fontSize: terminalFontSize,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
            theme: getTermTheme(),
            cursorBlink: true,
            scrollOnUserInput: true,
            allowProposedApi: true,
            linkHandler: {
                activate(_event, text) {
                    void openExternal(text);
                },
                allowNonHttpProtocols: false,
            },
        });

        const fitAddon = new FitAddon.FitAddon();
        const unicodeGraphemesAddon = new UnicodeGraphemesAddon.UnicodeGraphemesAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(unicodeGraphemesAddon);
        term.unicode.activeVersion = '15';

        term.open(paneBody);
        fitAddon.fit();
        paneBody.addEventListener('contextmenu', (ev) => showTerminalContextMenu(ev, term));
        wrapper.addEventListener('dragover', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
        });
        wrapper.addEventListener('drop', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            handleTerminalDrop(ev, term);
        });

        return { term, fitAddon, wrapper, closeBtn, providerWrap, providerSelect, paneBody };
    }

    function connectTerminalWs(term, fitAddon, baseWsUrl, options = {}) {
        let fitRaf = null;
        let resizeObserver = null;

        function fitTerminal() {
            fitRaf = null;
            const parent = term.element?.parentElement;
            if (!parent || parent.clientWidth <= 0 || parent.clientHeight <= 0) return;
            const entry = typeof options.getEntry === 'function' ? options.getEntry() : null;
            safeFit(entry || { term, fitAddon });
        }

        function scheduleFit() {
            if (fitRaf !== null) return;
            fitRaf = requestAnimationFrame(fitTerminal);
        }

        const parent = term.element?.parentElement;
        if (parent && typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(scheduleFit);
            resizeObserver.observe(parent);
        }

        const connection = window.TerminalTransport.createTerminalConnection({
            term,
            baseUrl: baseWsUrl,
            cli: options.cli,
            isSessionAlive: options.isSessionAlive,
            maxReconnectAttempts: options.maxReconnectAttempts,
            closedMessage: options.closedMessage,
            onSessionClosed: options.onSessionClosed,
            onDataApplied: options.afterWrite,
            onStateChange: options.onStateChange,
            onOpen(info) {
                scheduleFit();
                if (typeof options.onOpen === 'function') options.onOpen(info);
            },
        });

        return {
            get socket() { return connection.socket; },
            get state() { return connection.state; },
            get appliedCursor() { return connection.appliedCursor; },
            get receivedCursor() { return connection.receivedCursor; },
            sendInput(data) { return connection.sendInput(data); },
            sendResize() { return connection.sendResize(); },
            whenIdle() { return connection.whenIdle(); },
            close() {
                if (fitRaf !== null) cancelAnimationFrame(fitRaf);
                fitRaf = null;
                resizeObserver?.disconnect();
                resizeObserver = null;
                connection.close();
            },
        };
    }

    // ─── Terminal ───────────────────────────────────────────────────
    function createTerminal(name, options = {}) {
        const sessionKey = name;
        const tabKey = options.tabKey || sessionKey;
        if (isWorkspaceTab(tabKey) && (sessionKey !== tabKey || getPaneKeys(tabKey).length > 0)) return;
        const cli = resolveRuntimeCLI(options.cli);
        const container = document.getElementById('terminal-container');
        const { term, fitAddon, wrapper, closeBtn, providerWrap, providerSelect } = makeTerminalInstance(container, options.insertBeforeEl || null);
        wrapper.dataset.tabKey = tabKey;
        wrapper.dataset.sessionKey = sessionKey;
        providerSelect.dataset.sessionKey = sessionKey;
        wrapper.addEventListener('mousedown', () => setFocusedPane(tabKey, sessionKey, false));
        closeBtn.onclick = (ev) => {
            ev.stopPropagation();
            closePane(tabKey, sessionKey);
        };

        // Custom link provider that handles URLs wrapped across multiple terminal lines,
        // including URLs broken by programs (like Claude Code) that insert explicit newlines
        // with indentation.
        term.registerLinkProvider({
            provideLinks(bufferLineNumber, callback) {
                const found = window.TerminalInteractions.findTerminalLinks(term.buffer.active, bufferLineNumber - 1, term.cols);
                if (!found.length) {
                    callback(undefined);
                    return;
                }
                callback(found.map(({ url, range }) => ({
                    range,
                    text: url,
                    activate() {
                        void openExternal(url);
                    },
                })));
            }
        });

        // Block app-level shortcuts from reaching PTY
        term.attachCustomKeyEventHandler(ev => {
            // Primary+Shift+C -> copy selection to clipboard
            if (isTerminalCopyShortcut(ev) && ev.type === 'keydown') {
                const sel = term.getSelection();
                if (sel && canWriteClipboardText()) {
                    void writeClipboardText(sel).catch(err => {
                        showToast('Terminal action failed', (err && err.message) || 'The terminal selection could not be copied.', 'error', 4200);
                    });
                }
                return false;
            }
            if (shouldBlockTerminalShortcut(ev)) return false;
            return true;
        });

        // Every terminal uses the same parser-aware transport. Its cursor only
        // advances after xterm has applied a frame, so reconnects cannot skip
        // output that was received by the socket but still queued for parsing.
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const baseWsUrl = `${proto}//${location.host}/ws/${encodeURIComponent(sessionKey)}`;
        const connection = connectTerminalWs(term, fitAddon, baseWsUrl, {
            cli,
            getEntry: () => terminals[sessionKey],
            async isSessionAlive() {
                const info = await fetchJSON(`${terminalAPIBase(tabKey)}/terminal/output?session=${encodeURIComponent(sessionKey)}`);
                return !(info && info.has_session && !info.session_alive);
            },
            closedMessage: '\r\n\x1b[38;5;203m[Session closed]\x1b[0m\r\n',
            onSessionClosed() {
                showRestartOverlay(tabKey, sessionKey, wrapper);
            },
            onStateChange() {
                renderTabs();
            },
        });

        terminals[sessionKey] = {
            term,
            fitAddon,
            get ws() { return connection.socket; },
            wrapper,
            providerWrap,
            providerSelect,
            tabKey,
            sessionKey,
            cli,
            connection,
            _cleanup: () => connection.close(),
        };
        registerPane(tabKey, sessionKey);
        setFocusedPane(tabKey, sessionKey, false);
        term.focus();
        refreshTerminalContainerLayout();
        renderTabs();
    }

    function showRestartOverlay(tabKey, sessionKey, wrapper) {
        const overlay = document.createElement('div');
        overlay.className = 'terminal-restart-overlay';
        const btn = document.createElement('button');
        btn.className = 'terminal-restart-btn';
        btn.textContent = 'Restart Session';
        btn.onclick = () => {
            overlay.remove();
            if (tabKey === sessionKey) {
                restartProject(tabKey);
                return;
            }
            restartPane(tabKey, sessionKey);
        };
        overlay.appendChild(btn);
        wrapper.appendChild(overlay);
    }

    function nextPaneSessionKey(tabKey) {
        let idx = 2;
        while (terminals[`${tabKey}#${idx}`]) idx++;
        return `${tabKey}#${idx}`;
    }

    async function restartPane(tabKey, sessionKey) {
        await restartSessionInTab(tabKey, sessionKey);
    }

    async function restoreTabLayout(tabKey, layout) {
        if (isWorkspaceTab(tabKey)) return; // A workspace always has exactly one pane.
        if (!layout || !Array.isArray(layout.panes) || layout.panes.length === 0) return;
        const savedPanes = layout.panes.filter(pane => pane && pane.session);
        if (savedPanes.length === 0) return;

        const currentPanes = getPaneKeys(tabKey);
        const savedSessions = new Set(savedPanes.map(pane => pane.session));

        // switchProject() always creates a default pane keyed by the tab name.
        // If the saved layout does not include that synthetic pane, replace it
        // with the saved sessions so restore preserves pane identity.
        if (currentPanes.length === 1 && currentPanes[0] === tabKey && !savedSessions.has(tabKey)) {
            removeTerminalPane(tabKey, tabKey);
        }

        for (const pane of savedPanes) {
            if (!pane || !pane.session || terminals[pane.session]) continue;
            const cli = normalizeCLI(pane.cli);
            createTerminal(pane.session, { tabKey, cli });
            setTabVisibility(tabKey, activeTab === tabKey);
        }
        refreshTerminalContainerLayout();
        if (layout.focused_pane && terminals[layout.focused_pane]) {
            setFocusedPane(tabKey, layout.focused_pane, false);
        }
        refreshTerminalContainerLayout();
    }

    let agentPickerState = null;

    function agentPickerOptions() {
        const capable = capableProviders();
        const source = capable.length > 0 ? capable : AI_PROVIDERS;
        return source.map(provider => ({ value: provider.value, label: provider.shortLabel }));
    }

    function isAgentPickerOpen() {
        const modal = document.getElementById('agent-picker-modal');
        return modal && modal.style.display !== 'none';
    }

    function renderAgentPickerOptions() {
        const list = document.getElementById('agent-picker-list');
        if (!list || !agentPickerState) return;
        const options = agentPickerOptions();
        list.innerHTML = '';
        if (options.length === 0) return;
        if (agentPickerState.selectedIndex >= options.length) {
            agentPickerState.selectedIndex = 0;
        }
        options.forEach((option, idx) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'agent-picker-option' + (idx === agentPickerState.selectedIndex ? ' active' : '');
            item.textContent = option.label;
            item.onclick = () => {
                agentPickerState.selectedIndex = idx;
                renderAgentPickerOptions();
            };
            item.ondblclick = () => confirmAgentPicker();
            list.appendChild(item);
        });
    }

    function openAgentPicker() {
        if (!activeTab || isWorkspaceTab(activeTab)) return;
        if (getPaneKeys(activeTab).length >= 2) return;
        const options = agentPickerOptions();
        if (options.length === 0) return;
        const currentProvider = currentPaneProviderValue();
        const selectedIndex = Math.max(0, options.findIndex(option => option.value === currentProvider));

        agentPickerState = {
            tabKey: activeTab,
            selectedIndex,
        };
        document.getElementById('agent-picker-modal').style.display = 'flex';
        renderAgentPickerOptions();
        document.getElementById('agent-picker-title').textContent = `Split ${activeTab}`;
    }

    function closeAgentPicker() {
        agentPickerState = null;
        document.getElementById('agent-picker-modal').style.display = 'none';
    }

    async function confirmAgentPicker() {
        if (!agentPickerState) return;
        const { tabKey, selectedIndex } = agentPickerState;
        if (isWorkspaceTab(tabKey)) return;
        const options = agentPickerOptions();
        const choice = options[selectedIndex];
        if (!choice) return;
        const cli = resolveRuntimeCLI(choice.value);
        const sessionKey = nextPaneSessionKey(tabKey);
        closeAgentPicker();

        await stopTerminalSession(tabKey, sessionKey);
        await fetchJSON(`${terminalAPIBase(tabKey)}/terminal/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: sessionKey, cli })
        });

        createTerminal(sessionKey, { tabKey, cli });
        setTabVisibility(tabKey, activeTab === tabKey);
        setFocusedPane(tabKey, sessionKey);
        refreshTerminalContainerLayout();
    }

    // ─── Git Revert ──────────────────────────────────────────────────
    async function revertFile(file, status) {
        if (!activeProject) return;
        try {
            await fetch(`/api/projects/${encodeURIComponent(activeProject)}/revert-file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file, status }),
            });
            updateGitStatus();
            updateBadges();
        } catch {
            // ignore
        }
    }

    async function revertDirectory(directory) {
        if (!activeProject) return;
        const projectName = activeProject;
        if (!(await appConfirm(`Revert all changes in ${directory}/?\nThis will discard uncommitted changes and remove untracked files in this directory.`))) return;
        try {
            const data = await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/revert-directory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory }),
            });
            if (data && data.error) {
                showToast('Revert failed', compactErrorMessage(data.output || data.error), 'error', 6200);
            }
        } catch (err) {
            showToast('Revert failed', compactErrorMessage(err && err.message), 'error', 6200);
        } finally {
            if (activeProject === projectName) updateGitStatus();
            updateBadges();
        }
    }

    document.getElementById('git-revert-btn').onclick = async () => {
        if (!activeProject) return;
        if (!(await appConfirm('Revert ALL changes in ' + activeProject + '?\nThis will discard all uncommitted changes and remove untracked files.'))) return;
        try {
            await fetch(`/api/projects/${encodeURIComponent(activeProject)}/revert`, { method: 'POST' });
            updateGitStatus();
            updateBadges();
        } catch {
            // ignore
        }
    };

    document.getElementById('git-checkout-main-btn').onclick = async () => {
        if (!activeProject) return;
        const projectName = activeProject;
        try {
            const data = await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/checkout-main`, { method: 'POST' });
            if (data.error) {
                showToast('Checkout failed', compactErrorMessage(data.output || data.error), 'error', 6200);
            } else {
                showGitSuccessToast('Checkout complete', data, `${projectName} is on main/master.`);
            }
        } catch (err) {
            showToast('Checkout failed', compactErrorMessage(err && err.message), 'error', 6200);
        } finally {
            focusActiveTerminalSoon();
        }
        updateGitStatus();
        updateBadges();
    };

    document.getElementById('git-pull-btn').onclick = async () => {
        if (!activeProject) return;
        const projectName = activeProject;
        try {
            const data = await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/pull`, { method: 'POST' });
            if (data.error) {
                showToast('Pull failed', compactErrorMessage(data.output || data.error), 'error', 6200);
            } else {
                showGitSuccessToast('Pull complete', data, `${projectName} pulled successfully.`);
            }
        } catch (err) {
            showToast('Pull failed', compactErrorMessage(err && err.message), 'error', 6200);
        } finally {
            focusActiveTerminalSoon();
        }
        updateGitStatus();
        updateBadges();
    };

    function commandProjectLabel(projectName) {
        if (!projectName) return '';
        if (!projectName.includes('@')) return projectName;
        const [project, worktree] = projectName.split('@', 2);
        return `${project} (${worktree})`;
    }

    function activeCommandProject() {
        if (!activeProject) return '';
        return activeProject.includes('@') ? activeProject.split('@', 2)[0] : activeProject;
    }

    // ─── Docker ─────────────────────────────────────────────────────
    let dockerPollTimer = null;

    function updateDockerSection() {
        const section = document.getElementById('docker-section');
        if (!activeProject) {
            section.style.display = 'none';
            clearInterval(dockerPollTimer);
            dockerPollTimer = null;
            return;
        }
        const proj = projects.find(p => p.name === activeProject);
        if (!proj || !proj.docker_compose_file) {
            section.style.display = 'none';
            clearInterval(dockerPollTimer);
            dockerPollTimer = null;
            return;
        }
        section.style.display = 'block';
        document.getElementById('docker-compose-name').textContent = proj.docker_compose_file;
        pollDockerStatus();
        clearInterval(dockerPollTimer);
        dockerPollTimer = setInterval(pollDockerStatus, 3000);
    }

    async function pollDockerStatus() {
        if (!activeProject) return;
        try {
            const data = await fetchJSON(`/api/projects/${encodeURIComponent(activeProject)}/docker`);
            const dot = document.getElementById('docker-status-dot');
            dot.classList.toggle('running', data.running);
            const outputEl = document.getElementById('docker-output');
            if (data.output) {
                const lines = data.output.split('\n');
                const newText = lines.slice(-50).join('\n');
                if (outputEl.textContent !== newText) {
                    // Auto-scroll only if user is already at the bottom
                    const atBottom = outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight < 30;
                    outputEl.textContent = newText;
                    if (atBottom) {
                        outputEl.scrollTop = outputEl.scrollHeight;
                    }
                }
            } else if (outputEl.textContent) {
                outputEl.textContent = '';
            }
        } catch {
            // ignore
        }
    }

    async function startDockerStack(projectName = activeProject) {
        if (!projectName) return;
        try {
            await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/docker/start`, { method: 'POST' });
            if (projectName === activeProject) setTimeout(pollDockerStatus, 500);
            if (overviewActive) loadOverview();
        } catch (err) {
            showToast('Docker start failed', compactErrorMessage(err && err.message), 'error', 4200);
        }
    }

    async function stopDockerStack(projectName = activeProject) {
        if (!projectName) return;
        // Immediate visual feedback — dot goes grey while stopping
        if (projectName === activeProject) {
            const dot = document.getElementById('docker-status-dot');
            dot.classList.remove('running');
        }
        try {
            await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/docker/stop`, { method: 'POST' });
            if (projectName === activeProject) setTimeout(pollDockerStatus, 500);
            if (overviewActive) loadOverview();
        } catch (err) {
            showToast('Docker stop failed', compactErrorMessage(err && err.message), 'error', 4200);
        }
    }

    document.getElementById('docker-start-btn').onclick = () => startDockerStack(activeProject);
    document.getElementById('docker-stop-btn').onclick = () => stopDockerStack(activeProject);

    // ─── Git Status ─────────────────────────────────────────────────
    const GIT_STATUS_POLL_INTERVAL_MS = 5000;
    const NON_GIT_STATUS_POLL_INTERVAL_MS = 60000;
    const GIT_TRUNK_DIFF_VIEW_KEY = 'git-trunk-diff-view';
    let gitStatusRequestSeq = 0;
    let gitStatusProject = null;
    let gitStatusFiles = [];
    let gitStatusState = 'idle'; // idle | loading | ready | unavailable
    let gitStatusIsGitRepo = null;
    let gitFileTreeView = false;
    const GIT_VIEWED_FILES_KEY = 'git-viewed-files-v1';

    function emptyGitViewedFiles() {
        return Object.create(null);
    }

    function loadGitViewedFiles() {
        try {
            const parsed = JSON.parse(localStorage.getItem(GIT_VIEWED_FILES_KEY) || '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyGitViewedFiles();
            const normalized = emptyGitViewedFiles();
            Object.entries(parsed).forEach(([projectName, files]) => {
                if (!projectName || !files || typeof files !== 'object' || Array.isArray(files)) return;
                const projectFiles = Object.create(null);
                Object.entries(files).forEach(([filename, revision]) => {
                    if (filename && typeof revision === 'string' && revision) projectFiles[filename] = revision;
                });
                if (Object.keys(projectFiles).length > 0) normalized[projectName] = projectFiles;
            });
            return normalized;
        } catch {
            return emptyGitViewedFiles();
        }
    }

    function saveGitViewedFiles() {
        try {
            localStorage.setItem(GIT_VIEWED_FILES_KEY, JSON.stringify(gitViewedFiles));
        } catch { /* ignore */ }
    }

    let gitViewedFiles = loadGitViewedFiles();

    function gitViewedProjectFiles(projectName) {
        if (!projectName || !Object.prototype.hasOwnProperty.call(gitViewedFiles, projectName)) return null;
        const files = gitViewedFiles[projectName];
        return files && typeof files === 'object' && !Array.isArray(files) ? files : null;
    }

    function gitFileIsViewed(projectName, file) {
        if (!file || !file.name || !file.revision) return false;
        const projectFiles = gitViewedProjectFiles(projectName);
        return !!(projectFiles && projectFiles[file.name] === file.revision);
    }

    function reconcileGitViewedFiles(projectName, files, isGitRepo) {
        const projectFiles = gitViewedProjectFiles(projectName);
        if (!projectFiles) return false;
        if (!isGitRepo) {
            delete gitViewedFiles[projectName];
            saveGitViewedFiles();
            return true;
        }

        const currentRevisions = new Map();
        (files || []).forEach(file => {
            if (file && file.name && file.revision) currentRevisions.set(file.name, file.revision);
        });
        let changed = false;
        Object.keys(projectFiles).forEach(filename => {
            if (currentRevisions.get(filename) !== projectFiles[filename]) {
                delete projectFiles[filename];
                changed = true;
            }
        });
        if (Object.keys(projectFiles).length === 0) {
            delete gitViewedFiles[projectName];
            changed = true;
        }
        if (changed) saveGitViewedFiles();
        return changed;
    }

    function setGitFileViewed(projectName, file, viewed) {
        if (!projectName || !file || !file.name || !file.revision) return;
        let projectFiles = gitViewedProjectFiles(projectName);
        if (viewed) {
            if (!projectFiles) {
                projectFiles = Object.create(null);
                gitViewedFiles[projectName] = projectFiles;
            }
            if (projectFiles[file.name] === file.revision) return;
            projectFiles[file.name] = file.revision;
        } else {
            if (!projectFiles || !Object.prototype.hasOwnProperty.call(projectFiles, file.name)) return;
            delete projectFiles[file.name];
            if (Object.keys(projectFiles).length === 0) delete gitViewedFiles[projectName];
        }
        saveGitViewedFiles();
        syncGitViewedUI(projectName);
    }

    let gitTrunkDiffView = loadGitTrunkDiffViewPreference();
    let gitStatusTrunkBranch = '';
    let gitStatusDiffBase = '';

    function loadGitTrunkDiffViewPreference() {
        try {
            return localStorage.getItem(GIT_TRUNK_DIFF_VIEW_KEY) === 'true';
        } catch {
            return false;
        }
    }

    function saveGitTrunkDiffViewPreference() {
        try {
            localStorage.setItem(GIT_TRUNK_DIFF_VIEW_KEY, gitTrunkDiffView ? 'true' : 'false');
        } catch {}
    }

    // The commit the panel is comparing against, empty while comparing to HEAD.
    // Diff views read the original side of every file from it.
    function currentGitDiffBase() {
        return currentGitStatusState() === 'ready' ? gitStatusDiffBase : '';
    }

    function gitStatusStateForProject(projectName) {
        if (!projectName || gitStatusProject !== projectName) return 'unavailable';
        return gitStatusState;
    }

    function currentGitStatusState() {
        return activeProject ? gitStatusStateForProject(activeProject) : 'unavailable';
    }

    function currentGitFiles() {
        if (currentGitStatusState() !== 'ready') return [];
        return gitStatusFiles.map(file => ({ ...file }));
    }

    function currentGitStatusIsRepository() {
        return currentGitStatusState() === 'ready' && gitStatusIsGitRepo === true;
    }

    function setCurrentGitFiles(projectName, files, state = 'ready', isGitRepo = null) {
        gitStatusProject = projectName;
        gitStatusState = state;
        gitStatusIsGitRepo = isGitRepo;
        if (state !== 'ready') {
            gitStatusTrunkBranch = '';
            gitStatusDiffBase = '';
        }
        gitStatusFiles = (files || []).map(file => ({
            name: file.name,
            status: file.status,
            revertible: file.revertible !== false,
            revision: typeof file.revision === 'string' ? file.revision : '',
        }));
    }

    function showCurrentGitStatusNotReadyToast(title) {
        const state = currentGitStatusState();
        if (state === 'loading') {
            showToast(title, 'Git status is still loading for this project.', 'info', 3200);
            return true;
        }
        if (state === 'unavailable') {
            showToast(title, 'Git status is unavailable for this project.', 'info', 3200);
            return true;
        }
        return false;
    }

    function currentGitFilesSubtitle(files) {
        const state = currentGitStatusState();
        if (state === 'loading') return 'Loading changes';
        if (state === 'unavailable') return 'Status unavailable';
        if (gitStatusIsGitRepo === false) return files.length ? `${files.length} files` : 'No files';
        if (currentGitDiffBase()) {
            return files.length ? `${files.length} changed vs ${gitStatusTrunkBranch}` : `No changes vs ${gitStatusTrunkBranch}`;
        }
        return files.length ? `${files.length} changed` : 'No changes';
    }

    function gitStatusCount(value) {
        const count = Number(value);
        return Number.isFinite(count) && count > 0 ? count : 0;
    }

    function gitChangeSummary(files, added, deleted) {
        const lineCount = added + deleted;
        const fileLabel = files === 1 ? 'file' : 'files';
        const lineLabel = lineCount === 1 ? 'line' : 'lines';
        return `${files} ${fileLabel}, ${lineCount} ${lineLabel} changed (+${added} -${deleted})`;
    }

    function projectFileSummary(files, lines) {
        const fileLabel = files === 1 ? 'file' : 'files';
        const lineLabel = lines === 1 ? 'line' : 'lines';
        return `${files} ${fileLabel}, ${lines} ${lineLabel}`;
    }

    function gitFileStatusClass(file) {
        if (file.status === '??') return 'untracked';
        if (file.status.includes('A')) return 'added';
        if (file.status.includes('D')) return 'deleted';
        return 'modified';
    }

    function gitFileRowHTML(file, label, depth = 0) {
        const viewed = !!file.revision && gitStatusIsGitRepo === true && gitFileIsViewed(gitStatusProject, file);
        const revert = file.revertible !== false ? '<span class="git-file-revert" title="Revert this file">revert</span>' : '';
        return `<div class="git-file ${gitFileStatusClass(file)}${viewed ? ' viewed' : ''}" data-file="${esc(file.name)}" data-status="${esc(file.status)}" style="padding-left:${depth * 12}px"><span class="status">${esc(file.status)}</span><span class="git-file-name" title="${esc(file.name)}">${esc(label)}</span>${revert}</div>`;
    }

    function buildGitFileTree(files) {
        const root = { dirs: new Map(), files: [] };
        files.forEach(file => {
            const parts = file.name.split('/').filter(Boolean);
            const fileName = parts.pop() || file.name;
            let node = root;
            let dirPath = '';
            parts.forEach(part => {
                dirPath = dirPath ? `${dirPath}/${part}` : part;
                if (!node.dirs.has(part)) {
                    node.dirs.set(part, { name: part, path: dirPath, revertible: true, dirs: new Map(), files: [] });
                }
                node = node.dirs.get(part);
                node.revertible = node.revertible && file.revertible !== false;
            });
            node.files.push({ file, name: fileName });
        });
        return root;
    }

    function sortedGitFileTreeEntries(entries) {
        return [...entries].sort((a, b) => a.name.localeCompare(b.name));
    }

    function gitFileTreeHTML(node, depth = 0) {
        let html = '';
        sortedGitFileTreeEntries(node.dirs.values()).forEach(dir => {
            const revert = dir.revertible ? '<span class="git-directory-revert" title="Revert this directory">revert</span>' : '';
            html += `<div class="git-tree-dir" data-directory="${esc(dir.path)}" style="padding-left:${depth * 12}px"><span class="git-tree-dir-name" title="${esc(dir.path)}">${esc(dir.name)}/</span>${revert}</div>`;
            html += gitFileTreeHTML(dir, depth + 1);
        });
        sortedGitFileTreeEntries(node.files).forEach(entry => {
            html += gitFileRowHTML(entry.file, entry.name, depth);
        });
        return html;
    }

    function resetGitStatusForProject(projectName) {
        gitStatusRequestSeq++;
        setCurrentGitFiles(projectName, [], 'loading');
        setGitRepositoryActionsVisible(false);
        lastGitHtml = '';
        const el = document.getElementById('git-content');
        if (!el) return;
        el.dataset.project = projectName || '';
        el.dataset.loading = 'true';
        el.innerHTML = '<div class="git-section-title">Changes</div><div class="git-clean">loading...</div>';
        refreshCommandPaletteForGitStatus(projectName);
    }

    function setGitStatusPollInterval(intervalMs) {
        if (gitPollTimer && gitPollIntervalMs === intervalMs) return;
        clearInterval(gitPollTimer);
        gitPollIntervalMs = intervalMs;
        gitPollTimer = setInterval(updateGitStatus, intervalMs);
    }

    function renderGitStatusUnavailable(projectName) {
        setCurrentGitFiles(projectName, [], 'unavailable');
        setGitRepositoryActionsVisible(false);
        const el = document.getElementById('git-content');
        if (!el) return;
        const html = '<div class="git-section-title">Changes</div><div class="git-clean">status unavailable</div>';
        if (html === lastGitHtml && el.dataset.project === projectName) return;
        lastGitHtml = html;
        el.dataset.project = projectName || '';
        el.dataset.loading = 'false';
        el.innerHTML = html;
        refreshCommandPaletteForGitStatus(projectName);
    }

    function refreshCommandPaletteForGitStatus(projectName) {
        if (projectName === activeProject && isCommandPaletteOpen()) {
            renderCommandPalette();
        }
    }

    function openFirstChangedFileDiff() {
        const files = currentGitFiles();
        if (files.length === 0) {
            if (showCurrentGitStatusNotReadyToast('Changes unavailable')) return;
            showToast('No changes', 'There are no changed files to show.', 'info', 2600);
            return;
        }
        showDiffModal(files[0].name);
    }

    async function updateGitStatus(opts = {}) {
        if (!activeProject) return null;
        const projectName = activeProject;
        const requestSeq = ++gitStatusRequestSeq;
        try {
            const params = new URLSearchParams();
            if (opts.fresh) params.set('fresh', '1');
            if (gitTrunkDiffView) params.set('base', 'trunk');
            const qs = params.toString() ? `?${params}` : '';
            const status = await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/status${qs}`);
            if (activeProject !== projectName) return null;
            if (requestSeq !== gitStatusRequestSeq) return status;
            renderGitStatus(status, projectName);
            return status;
        } catch {
            if (activeProject !== projectName || requestSeq !== gitStatusRequestSeq) return null;
            if (gitStatusStateForProject(projectName) === 'loading') {
                renderGitStatusUnavailable(projectName);
            }
            return null;
        }
    }

    let lastGitHtml = '';

    function setGitRepositoryActionsVisible(visible) {
        ['git-checkout-main-btn', 'git-pull-btn', 'git-commit-btn'].forEach(id => {
            document.getElementById(id).style.display = visible ? '' : 'none';
        });
        // Reverting all working changes would read as "undo my branch" while the
        // panel is listing committed work it cannot touch.
        document.getElementById('git-revert-btn').style.display = visible && !gitTrunkDiffView ? '' : 'none';
    }

    function renderGitStatus(status, projectName = activeProject) {
        const el = document.getElementById('git-content');
        const files = Array.isArray(status.files) ? status.files : [];
        const isGitRepo = status.is_git_repo === true;
        setCurrentGitFiles(projectName, files, 'ready', isGitRepo);
        const openDiffChanged = syncOpenDiffFileRevisions(projectName, gitStatusFiles);
        const viewedStateChanged = reconcileGitViewedFiles(projectName, gitStatusFiles, isGitRepo);
        if (openDiffChanged || viewedStateChanged) syncGitViewedUI(projectName);
        gitStatusTrunkBranch = status.trunk_branch || '';
        gitStatusDiffBase = status.diff_base || '';
        setGitRepositoryActionsVisible(isGitRepo);
        setGitStatusPollInterval(isGitRepo ? GIT_STATUS_POLL_INTERVAL_MS : NON_GIT_STATUS_POLL_INTERVAL_MS);
        let html = '';

        if (status.branch) {
            html += `<div class="git-branch" id="git-branch-name">\u2387 ${esc(status.branch)}</div>`;

            let syncClass = 'ok', syncText = 'up to date';
            if (status.ahead > 0 && status.behind > 0) {
                syncClass = 'warn';
                syncText = `\u2191${status.ahead} \u2193${status.behind}`;
            } else if (status.ahead > 0) {
                syncClass = 'warn';
                syncText = `\u2191${status.ahead} ahead`;
            } else if (status.behind > 0) {
                syncClass = 'warn';
                syncText = `\u2193${status.behind} behind`;
            }
            html += `<div class="git-sync ${syncClass}">${syncText}</div>`;
        }

        const linesAdded = gitStatusCount(status.lines_added);
        const linesDeleted = gitStatusCount(status.lines_deleted);
        html += `<div class="git-section-header"><div class="git-section-title">${isGitRepo ? 'Changes' : 'Files'}</div><div class="git-section-actions">`;
        if (isGitRepo && gitStatusTrunkBranch) {
            const trunk = esc(gitStatusTrunkBranch);
            const baseLabel = gitTrunkDiffView ? `vs ${trunk}` : 'uncommitted';
            const baseTitle = gitTrunkDiffView
                ? `Comparing against the ${trunk} fork point — click to show uncommitted changes only`
                : `Comparing against HEAD — click to include committed work vs ${trunk}`;
            const baseClass = gitTrunkDiffView ? ' class="active"' : '';
            html += `<button id="git-diff-base-toggle" type="button"${baseClass} title="${baseTitle}" aria-label="${baseTitle}">${baseLabel}</button>`;
        }
        if (files.length > 0) {
            const toggleTitle = gitFileTreeView ? 'Show flat list' : 'Show tree';
            html += `<button id="git-file-view-toggle" type="button" title="${toggleTitle}" aria-label="${toggleTitle}">${gitFileTreeView ? 'list' : 'tree'}</button>`;
        }
        html += '</div></div>';

        if (files.length === 0) {
            html += `<div class="git-clean">${isGitRepo ? 'clean' : 'no files'}</div>`;
        } else {
            if (gitFileTreeView) {
                html += gitFileTreeHTML(buildGitFileTree(files));
            } else {
                files.forEach(f => {
                    html += gitFileRowHTML(f, f.name);
                });
            }
            const summary = isGitRepo
                ? gitChangeSummary(files.length, linesAdded, linesDeleted)
                : projectFileSummary(files.length, linesAdded);
            html += `<div class="git-change-summary">${esc(summary)}</div>`;
        }

        // Skip DOM update if nothing changed — prevents scroll position reset
        if (html === lastGitHtml && el.dataset.project === projectName) return;
        lastGitHtml = html;

        el.dataset.project = projectName || '';
        el.dataset.loading = 'false';
        el.innerHTML = html;
        const branchEl = document.getElementById('git-branch-name');
        if (branchEl) {
            branchEl.onclick = (ev) => {
                ev.stopPropagation();
                showBranchDropdown(branchEl);
            };
        }
        const fileViewToggle = document.getElementById('git-file-view-toggle');
        if (fileViewToggle) {
            fileViewToggle.onclick = () => {
                gitFileTreeView = !gitFileTreeView;
                renderGitStatus(status, projectName);
            };
        }
        const diffBaseToggle = document.getElementById('git-diff-base-toggle');
        if (diffBaseToggle) {
            diffBaseToggle.onclick = () => {
                gitTrunkDiffView = !gitTrunkDiffView;
                saveGitTrunkDiffViewPreference();
                lastGitHtml = '';
                updateGitStatus();
            };
        }
        el.querySelectorAll('.git-tree-dir[data-directory]').forEach(dirEl => {
            const revert = dirEl.querySelector('.git-directory-revert');
            if (revert) {
                revert.onclick = (ev) => {
                    ev.stopPropagation();
                    revertDirectory(dirEl.dataset.directory);
                };
            }
        });
        el.querySelectorAll('.git-file[data-file]').forEach(fileEl => {
            fileEl.querySelector('.git-file-name').onclick = () => showDiffModal(fileEl.dataset.file);
            const revert = fileEl.querySelector('.git-file-revert');
            if (revert) {
                revert.onclick = (ev) => {
                    ev.stopPropagation();
                    revertFile(fileEl.dataset.file, fileEl.dataset.status);
                };
            }
        });
        refreshCommandPaletteForGitStatus(projectName);
    }

    function syncGitViewedUI(projectName) {
        if (projectName === gitStatusProject) {
            const filesByName = new Map(gitStatusFiles.map(file => [file.name, file]));
            document.querySelectorAll('#git-content .git-file[data-file]').forEach(fileEl => {
                const file = filesByName.get(fileEl.dataset.file);
                const viewed = gitStatusIsGitRepo === true && gitFileIsViewed(projectName, file);
                fileEl.classList.toggle('viewed', viewed);
            });
        }
        if (projectName === diffProjectName) {
            updateDiffViewedButton();
            renderDiffFileSidebar();
        }
    }

    // ─── Branch Dropdown ──────────────────────────────────────────────
    let branchDropdownState = { branches: [], current: '', remotes: [], fetchError: false, filtered: [], highlightIdx: 0, loadingRemotes: false, query: '', reqId: 0 };
    let cleanupState = 'idle'; // 'idle' | 'loading' | 'error'
    let cleanupReqSeq = 0; // invalidates in-flight merged-branches scans

    // A branch name is remote-tracking when its first path segment is a known
    // remote (e.g. "origin/foo"). Local branches may also contain "/" (e.g.
    // "feature/foo"), so the remotes list is needed to tell them apart.
    function branchRemoteName(branch) {
        for (const r of branchDropdownState.remotes) {
            if (branch.startsWith(r + '/')) return r;
        }
        return null;
    }

    async function showBranchDropdown(anchorEl) {
        if (!activeProject) return;
        cleanupReqSeq++; // abandon any scan from a previous open
        cleanupState = 'idle';
        const dropdown = document.getElementById('branch-dropdown');

        // Position near the anchor element, clamped to stay inside the window
        const rect = anchorEl.getBoundingClientRect();
        const margin = 8;
        const availableWidth = Math.max(0, window.innerWidth - margin * 2);
        const minDropdownWidth = Math.min(180, availableWidth);
        const dropdownLeft = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - minDropdownWidth - margin));
        dropdown.style.left = dropdownLeft + 'px';
        dropdown.style.minWidth = minDropdownWidth + 'px';
        dropdown.style.maxWidth = Math.max(0, window.innerWidth - dropdownLeft - margin) + 'px';
        // Open below the anchor by default; flip above only when the space below
        // is cramped and there's more room above. Clamp height to the chosen side
        // so the dropdown never extends past the viewport.
        const spaceBelow = window.innerHeight - rect.bottom - 4 - margin;
        const spaceAbove = rect.top - 4 - margin;
        if (spaceBelow < 160 && spaceAbove > spaceBelow) {
            dropdown.style.top = '';
            dropdown.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
            dropdown.style.maxHeight = Math.min(360, Math.max(0, spaceAbove)) + 'px';
        } else {
            dropdown.style.bottom = '';
            dropdown.style.top = (rect.bottom + 4) + 'px';
            dropdown.style.maxHeight = Math.min(360, Math.max(0, spaceBelow)) + 'px';
        }
        dropdown.innerHTML = '<div style="padding:8px 12px;color:var(--text-dim);font-size:11px">Loading...</div>';
        dropdown.style.display = 'flex';

        const project = activeProject;
        const reqId = ++branchDropdownState.reqId;
        const applyBranches = (data) => {
            branchDropdownState.branches = data.branches || [];
            branchDropdownState.current = data.current || '';
            branchDropdownState.remotes = data.remotes || [];
        };

        // Phase 1: show cached local + remote-tracking branches instantly, with
        // a footer noting that the remote refresh is still in flight.
        try {
            const data = await fetchJSON(`/api/projects/${encodeURIComponent(project)}/branches`);
            if (reqId !== branchDropdownState.reqId) return;
            applyBranches(data);
            branchDropdownState.fetchError = false;
            branchDropdownState.loadingRemotes = true;
            branchDropdownState.query = '';
            branchDropdownState.highlightIdx = 0;
            renderBranchDropdown('');
        } catch {
            if (reqId !== branchDropdownState.reqId) return;
            dropdown.innerHTML = '<div style="padding:8px 12px;color:var(--red);font-size:11px">Failed to load branches</div>';
            return;
        }

        // Phase 2: refresh remote-tracking refs from the remote (skipped server
        // side if fetched within the last minute), then re-render in place.
        try {
            const data = await fetchJSON(`/api/projects/${encodeURIComponent(project)}/branches?fetch=1`);
            if (reqId !== branchDropdownState.reqId) return;
            applyBranches(data);
            branchDropdownState.fetchError = !!data.fetchError;
        } catch {
            if (reqId !== branchDropdownState.reqId) return;
            branchDropdownState.fetchError = true;
        }
        branchDropdownState.loadingRemotes = false;
        renderBranchDropdown(branchDropdownState.query);
    }

    function renderBranchDropdown(query) {
        branchDropdownState.query = query;
        const dropdown = document.getElementById('branch-dropdown');
        // Preserve the caret across an in-place re-render (e.g. when the remote
        // refresh completes while the user is mid-search).
        const prevInput = dropdown.querySelector('.branch-search');
        const caret = prevInput ? prevInput.selectionStart : null;
        dropdown.innerHTML = '';

        const input = document.createElement('input');
        input.className = 'branch-search';
        input.placeholder = 'Search branches…';
        input.value = query;
        dropdown.appendChild(input);

        if (branchDropdownState.fetchError) {
            const note = document.createElement('div');
            note.className = 'branch-fetch-note';
            note.textContent = "Couldn't fetch — showing cached branches";
            dropdown.appendChild(note);
        }

        const list = document.createElement('div');
        list.className = 'branch-list';
        dropdown.appendChild(list);

        const q = query.toLowerCase();
        branchDropdownState.filtered = branchDropdownState.branches.filter(b => b.toLowerCase().includes(q));
        if (branchDropdownState.highlightIdx >= branchDropdownState.filtered.length) {
            branchDropdownState.highlightIdx = 0;
        }

        branchDropdownState.filtered.forEach((branch, idx) => {
            const remote = branchRemoteName(branch);
            const item = document.createElement('div');
            item.className = 'branch-item'
                + (branch === branchDropdownState.current ? ' current' : '')
                + (remote ? ' remote' : '')
                + (idx === branchDropdownState.highlightIdx ? ' highlighted' : '');
            if (remote) {
                const prefix = document.createElement('span');
                prefix.className = 'branch-remote-prefix';
                prefix.textContent = remote + '/';
                item.appendChild(prefix);
                item.appendChild(document.createTextNode(branch.slice(remote.length + 1)));
            } else {
                item.textContent = branch;
            }
            item.onmouseenter = () => {
                branchDropdownState.highlightIdx = idx;
                list.querySelectorAll('.branch-item').forEach((el, i) => el.classList.toggle('highlighted', i === idx));
            };
            item.onclick = () => selectBranch(branch);
            list.appendChild(item);
        });

        if (branchDropdownState.loadingRemotes) {
            const note = document.createElement('div');
            note.className = 'branch-loading-note';
            note.textContent = 'Loading remote branches...';
            dropdown.appendChild(note);
        }

        const footer = document.createElement('div');
        footer.className = 'branch-footer';
        const cleanupBtn = document.createElement('button');
        cleanupBtn.className = 'branch-cleanup-btn';
        if (cleanupState === 'loading') {
            cleanupBtn.classList.add('loading');
            cleanupBtn.disabled = true;
            cleanupBtn.textContent = 'Finding merged branches…';
        } else if (cleanupState === 'error') {
            cleanupBtn.classList.add('danger');
            cleanupBtn.textContent = 'Failed — click to retry';
        } else {
            cleanupBtn.textContent = '🧹 Clean up merged';
        }
        cleanupBtn.onmousedown = (ev) => ev.preventDefault(); // keep focus, avoid blur-close
        cleanupBtn.onclick = () => showMergedCleanup();
        footer.appendChild(cleanupBtn);
        dropdown.appendChild(footer);

        input.focus();
        if (caret != null) {
            try { input.setSelectionRange(caret, caret); } catch {}
        }

        input.oninput = () => {
            branchDropdownState.query = input.value;
            branchDropdownState.highlightIdx = 0;
            renderBranchDropdown(input.value);
        };

        input.onkeydown = (ev) => {
            const len = branchDropdownState.filtered.length;
            if (ev.key === 'ArrowDown') {
                ev.preventDefault();
                branchDropdownState.highlightIdx = (branchDropdownState.highlightIdx + 1) % Math.max(len, 1);
                updateBranchHighlight(list);
            } else if (ev.key === 'ArrowUp') {
                ev.preventDefault();
                branchDropdownState.highlightIdx = (branchDropdownState.highlightIdx - 1 + len) % Math.max(len, 1);
                updateBranchHighlight(list);
            } else if (ev.key === 'Enter') {
                ev.preventDefault();
                if (len > 0) {
                    selectBranch(branchDropdownState.filtered[branchDropdownState.highlightIdx]);
                }
            } else if (ev.key === 'Escape') {
                closeBranchDropdown();
            }
        };
    }

    function updateBranchHighlight(list) {
        const items = list.querySelectorAll('.branch-item');
        items.forEach((el, i) => el.classList.toggle('highlighted', i === branchDropdownState.highlightIdx));
        const active = items[branchDropdownState.highlightIdx];
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    async function selectBranch(branch, action) {
        closeBranchDropdown();
        if (!action && branch === branchDropdownState.current) return;
        const projectName = activeProject;
        if (!projectName) return;

        let data;
        try {
            data = await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branch, action }),
            });
        } catch (err) {
            showToast(`Checkout failed: ${branch}`, compactErrorMessage(err && err.message), 'error', 6200);
            focusActiveTerminalSoon();
            updateGitStatus();
            updateBadges();
            return;
        }

        // A same-name local branch diverges from the remote — let the user choose.
        if (data.conflict) {
            openBranchConflictModal(data.branch, data.remote);
            return;
        }

        if (data.error) {
            showToast(`Checkout failed: ${branch}`, compactErrorMessage(data.output || data.error), 'error', 6200);
        } else {
            showGitSuccessToast('Checkout complete', data, `${projectName} checked out ${branch}.`);
        }
        focusActiveTerminalSoon();
        updateGitStatus();
        updateBadges();
    }

    function openBranchConflictModal(shortName, remoteRef) {
        const modal = document.getElementById('branch-conflict-modal');
        document.getElementById('branch-conflict-text').innerHTML =
            `Local branch <code>${esc(shortName)}</code> differs from <code>${esc(remoteRef)}</code>. ` +
            `How do you want to switch?`;
        const keepBtn = document.getElementById('branch-conflict-keep');
        const resetBtn = document.getElementById('branch-conflict-reset');
        keepBtn.onclick = () => { closeBranchConflictModal(); selectBranch(remoteRef, 'local'); };
        resetBtn.onclick = () => { closeBranchConflictModal(); selectBranch(remoteRef, 'reset-remote'); };
        modal.style.display = 'flex';
        keepBtn.focus();
    }

    function closeBranchConflictModal() {
        document.getElementById('branch-conflict-modal').style.display = 'none';
    }

    function closeBranchDropdown() {
        // Invalidate any in-flight phase-two (?fetch=1) request: bumping reqId
        // makes its completion handler bail at the staleness guard instead of
        // re-rendering the now-closed dropdown and calling input.focus(), which
        // would steal focus back from the terminal after a checkout.
        branchDropdownState.reqId++;
        document.getElementById('branch-dropdown').style.display = 'none';
    }

    // ─── Merged-branch cleanup ─────────────────────────────────────────
    let cleanupBranches = []; // { name, reason }
    let cleanupProject = null; // project the cleanup list was loaded for

    async function showMergedCleanup() {
        if (!activeProject) return;
        if (cleanupState === 'loading') return; // a scan is already running
        const projectName = activeProject;
        const seq = ++cleanupReqSeq;
        cleanupState = 'loading';
        renderBranchDropdown(branchDropdownState.query);
        try {
            const data = await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/merged-branches`);
            if (seq !== cleanupReqSeq) return; // superseded by a newer open/scan
            cleanupState = 'idle';
            closeBranchDropdown();
            openCleanupModal(projectName, data.branches || [], data.main || 'main');
        } catch {
            if (seq !== cleanupReqSeq) {
                // Scan was abandoned (dropdown reopened): don't touch the current
                // dropdown's state, but still surface that the attempt failed.
                showToast('Cleanup failed', `Failed to load merged branches for ${projectName}.`, 'error', 6200);
                return;
            }
            cleanupState = 'error';
            const dropdown = document.getElementById('branch-dropdown');
            if (dropdown.style.display !== 'none') {
                renderBranchDropdown(branchDropdownState.query);
            } else {
                showToast('Cleanup failed', `Failed to load merged branches for ${projectName}.`, 'error', 6200);
            }
        }
    }

    function openCleanupModal(projectName, branches, main) {
        if (branches.length === 0) {
            showToast('Nothing to clean up', `No local branches are fully merged into ${main}.`, 'info', 3000);
            focusActiveTerminalSoon();
            return;
        }
        cleanupBranches = branches;
        cleanupProject = projectName;

        document.getElementById('cleanup-modal-title').textContent = `Delete branches in ${projectName} merged into ${main}`;
        const listEl = document.getElementById('cleanup-modal-list');
        listEl.innerHTML = '';
        branches.forEach((b, idx) => {
            const badgeCls = b.reason === 'squashed' ? 'squashed' : 'merged';
            const row = document.createElement('label');
            row.className = 'cleanup-file';
            row.innerHTML = `<input type="checkbox" id="clb-${idx}" checked><span class="cleanup-row-name">${esc(b.name)}</span><span class="cleanup-badge ${badgeCls}">${esc(b.reason)}</span>`;
            listEl.appendChild(row);
        });
        listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.onchange = updateCleanupConfirmLabel);
        updateCleanupConfirmLabel();
        document.getElementById('cleanup-modal').style.display = 'flex';
    }

    function updateCleanupConfirmLabel() {
        const checks = document.querySelectorAll('#cleanup-modal-list input[type="checkbox"]');
        const n = Array.from(checks).filter(c => c.checked).length;
        const btn = document.getElementById('cleanup-confirm-btn');
        btn.textContent = n === 1 ? 'Delete 1 branch' : `Delete ${n} branches`;
        btn.disabled = n === 0;
    }

    function closeCleanupModal() {
        document.getElementById('cleanup-modal').style.display = 'none';
    }

    document.getElementById('cleanup-modal-backdrop').onclick = closeCleanupModal;
    document.getElementById('cleanup-modal-close').onclick = closeCleanupModal;
    document.getElementById('cleanup-select-all').onclick = () => {
        const checkboxes = document.querySelectorAll('#cleanup-modal-list input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
        updateCleanupConfirmLabel();
    };
    document.getElementById('cleanup-confirm-btn').onclick = () => {
        const checks = document.querySelectorAll('#cleanup-modal-list input[type="checkbox"]');
        const names = [];
        checks.forEach((cb, idx) => { if (cb.checked) names.push(cleanupBranches[idx].name); });
        if (names.length) confirmDeleteBranches(names);
    };

    async function confirmDeleteBranches(names) {
        const projectName = cleanupProject;
        closeCleanupModal();
        if (!projectName) return;
        try {
            const data = await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/delete-branches`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ branches: names }),
            });
            const results = data.results || [];
            const failed = results.filter(r => r.error);
            const deleted = results.filter(r => !r.error);
            const noun = `branch${deleted.length === 1 ? '' : 'es'}`;
            if (failed.length === 0) {
                showToast('Branches cleaned up', `Deleted ${deleted.length} merged ${noun}.`, 'success', 4000);
            } else {
                const detail = failed.map(r => `${r.branch}: ${compactErrorMessage(r.error)}`).join('\n');
                showToast(`Deleted ${deleted.length}, ${failed.length} failed`, detail, 'error', 6200);
            }
        } catch (err) {
            showToast('Cleanup failed', compactErrorMessage(err && err.message), 'error', 6200);
        } finally {
            focusActiveTerminalSoon();
        }
        updateGitStatus();
        updateBadges();
    }

    document.addEventListener('click', (ev) => {
        const dropdown = document.getElementById('branch-dropdown');
        if (dropdown.style.display !== 'none' && !dropdown.contains(ev.target) && !ev.target.classList.contains('git-branch')) {
            closeBranchDropdown();
        }
    });

    // ─── Commit Modal ──────────────────────────────────────────────
    let commitFiles = []; // { name, status }

    document.getElementById('git-commit-btn').onclick = () => openCommitModal();

    function openCommitModal() {
        if (!activeProject) return;
        const modal = document.getElementById('commit-modal');
        const filesEl = document.getElementById('commit-files');
        const msgEl = document.getElementById('commit-msg');

        commitFiles = currentGitFiles();

        if (commitFiles.length === 0) {
            if (showCurrentGitStatusNotReadyToast('Commit unavailable')) return;
            showToast('No changes', 'There are no changed files to commit.', 'info', 2600);
            return;
        }

        filesEl.innerHTML = '';
        commitFiles.forEach((f, idx) => {
            let cls = 'modified';
            if (f.status === '??') cls = 'untracked';
            else if (f.status.includes('A')) cls = 'added';
            else if (f.status.includes('D')) cls = 'deleted';

            const row = document.createElement('div');
            row.className = 'commit-file';
            row.innerHTML = `<input type="checkbox" id="cf-${idx}" checked><span class="status ${cls}">${esc(f.status)}</span><label for="cf-${idx}">${esc(f.name)}</label>`;
            filesEl.appendChild(row);
        });

        msgEl.value = '';
        modal.style.display = 'flex';
        msgEl.focus();
    }

    function closeCommitModal() {
        document.getElementById('commit-modal').style.display = 'none';
    }

    document.getElementById('commit-modal-backdrop').onclick = closeCommitModal;
    document.getElementById('commit-modal-close').onclick = closeCommitModal;

    document.getElementById('branch-conflict-backdrop').onclick = closeBranchConflictModal;
    document.getElementById('branch-conflict-close').onclick = closeBranchConflictModal;

    document.getElementById('commit-select-all').onclick = () => {
        const checkboxes = document.querySelectorAll('#commit-files input[type="checkbox"]');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
    };

    document.getElementById('commit-btn').onclick = async () => {
        const msg = document.getElementById('commit-msg').value.trim();
        if (!msg || !activeProject) return;

        const checkboxes = document.querySelectorAll('#commit-files input[type="checkbox"]');
        const selectedFiles = [];
        checkboxes.forEach((cb, idx) => {
            if (cb.checked) selectedFiles.push(commitFiles[idx].name);
        });

        if (selectedFiles.length === 0) return;

        const btn = document.getElementById('commit-btn');
        btn.disabled = true;
        btn.textContent = 'Committing...';

        try {
            const res = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/commit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: selectedFiles, message: msg }),
            });
            const data = await res.json();
            if (data.error) {
                showToast('Commit failed', compactErrorMessage(data.output || data.error), 'error', 6200);
            } else {
                closeCommitModal();
            }
        } catch (err) {
            showToast('Commit failed', compactErrorMessage(err && err.message), 'error', 4200);
        }

        btn.disabled = false;
        btn.textContent = 'Commit';
        updateGitStatus();
        updateBadges();
    };

    // Primary+Enter to commit from textarea
    document.getElementById('commit-msg').addEventListener('keydown', (ev) => {
        if (hasPrimaryModifier(ev) && ev.key === 'Enter') {
            ev.preventDefault();
            document.getElementById('commit-btn').click();
        }
    });

    // ─── Monaco Editor ──────────────────────────────────────────────
    let monacoReady = false;
    let monacoLoading = false;
    let monacoCallbacks = [];

    function ensureMonaco(callback) {
        if (monacoReady) { callback(); return; }
        monacoCallbacks.push(callback);
        if (monacoLoading) return;
        monacoLoading = true;

        require.config({ paths: { vs: '/vendor/monaco-editor/min/vs' } });
        require(['vs/editor/editor.main'], function () {
            defineMonacoThemes();
            monaco.editor.setTheme(getMonacoThemeName());
            monacoReady = true;
            monacoCallbacks.forEach(cb => cb());
            monacoCallbacks = [];
        });
    }

    function getLangFromFile(filename) {
        const basename = filename.split('/').pop() || '';
        const ext = (basename.split('.').pop() || '').toLowerCase();
        const map = {
            js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
            mjs: 'javascript', cjs: 'javascript',
            go: 'go', py: 'python', rs: 'rust', rb: 'ruby',
            html: 'html', css: 'css', scss: 'scss', less: 'less',
            json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini',
            md: 'markdown', sh: 'shell', bash: 'shell', zsh: 'shell',
            sql: 'sql', xml: 'xml', svg: 'xml',
            java: 'java', kt: 'kotlin', c: 'c', cpp: 'cpp', h: 'c',
            php: 'php', vue: 'html', svelte: 'html',
            twig: 'twig', dockerfile: 'dockerfile',
            graphql: 'graphql', gql: 'graphql',
            tf: 'hcl', tfvars: 'hcl', hcl: 'hcl',
            proto: 'proto',
        };
        return map[ext] || 'plaintext';
    }

    function fetchFileBlame(projectName, filename, ref = 'working') {
        const params = new URLSearchParams({ path: filename });
        if (ref && ref !== 'working') params.set('ref', ref);
        return fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/file/blame?${params.toString()}`);
    }

    function isUncommittedBlame(line) {
        return !line || line.short_commit === 'uncommitted' || /^0+$/.test(line.commit || '');
    }

    function compactBlameAuthor(author) {
        const clean = String(author || 'unknown').replace(/\s+/g, ' ').trim();
        if (clean === 'Not Committed Yet') return 'uncommitted';
        if (clean.length <= 12) return clean;
        const parts = clean.split(' ');
        const last = parts[parts.length - 1] || clean;
        return last.length <= 12 ? last : last.slice(0, 11) + '.';
    }

    function formatBlameDate(line) {
        const seconds = Number(line && line.author_time);
        if (!Number.isFinite(seconds) || seconds <= 0) return '';
        try {
            return new Date(seconds * 1000).toLocaleDateString(undefined, {
                year: '2-digit',
                month: 'short',
                day: '2-digit',
            });
        } catch {
            return '';
        }
    }

    function blameLineLabel(line) {
        const commit = isUncommittedBlame(line) ? 'uncommitted' : (line.short_commit || (line.commit || '').slice(0, 8));
        const author = compactBlameAuthor(line.author);
        return `${commit} ${author}`.trim();
    }

    function formatBlameStatus(line) {
        if (!line) return '';
        const bits = [line.author || 'unknown', isUncommittedBlame(line) ? 'uncommitted' : (line.short_commit || ''), formatBlameDate(line)]
            .filter(Boolean);
        return bits.join('  ');
    }

    function escapeMarkdown(value) {
        return String(value || '').replace(/([\\`*_{}\[\]()#+\-.!|>])/g, '\\$1');
    }

    function blameHoverMessage(line) {
        const author = escapeMarkdown(line.author || 'unknown');
        const date = formatBlameDate(line);
        const commit = isUncommittedBlame(line) ? 'Not committed yet' : `\`${line.commit}\``;
        const summary = line.summary ? `\n\n${escapeMarkdown(line.summary)}` : '';
        const original = line.original_line && line.original_line !== line.line ? `\n\nOriginal line ${line.original_line}` : '';
        return { value: `**${author}**${date ? ` - ${date}` : ''}\n\n${commit}${summary}${original}` };
    }

    function setMonacoBlameClass(editor, enabled) {
        const node = editor && editor.getDomNode && editor.getDomNode();
        if (node) node.classList.toggle('git-blame-enabled', !!enabled);
    }

    function clearMonacoBlame(editor) {
        if (!editor) return;
        const oldDecorations = editor.__gitBlameDecorationIds || [];
        if (editor.deltaDecorations) {
            editor.__gitBlameDecorationIds = editor.deltaDecorations(oldDecorations, []);
        } else {
            editor.__gitBlameDecorationIds = [];
        }
        editor.__gitBlameByLine = null;
        setMonacoBlameClass(editor, false);
        if (editor.updateOptions) {
            editor.updateOptions({ lineNumbers: 'on', lineNumbersMinChars: 5 });
        }
    }

    function monacoBlameModelState(editor) {
        const model = editor && editor.getModel && editor.getModel();
        return {
            model,
            version: model && model.getVersionId ? model.getVersionId() : null,
        };
    }

    function monacoBlameModelUnchanged(editor, state) {
        const model = editor && editor.getModel && editor.getModel();
        if (!state || !model || model !== state.model) return false;
        return state.version === null || !model.getVersionId || model.getVersionId() === state.version;
    }

    function applyMonacoBlame(editor, lines) {
        if (!editor || !Array.isArray(lines)) return;
        const byLine = new Map();
        const decorations = [];
        lines.forEach(line => {
            const lineNumber = Number(line && line.line);
            if (!Number.isFinite(lineNumber) || lineNumber < 1) return;
            byLine.set(lineNumber, line);
            decorations.push({
                range: new monaco.Range(lineNumber, 1, lineNumber, 1),
                options: {
                    isWholeLine: true,
                    className: 'git-blame-line-decoration',
                    hoverMessage: blameHoverMessage(line),
                },
            });
        });
        if (byLine.size === 0) {
            clearMonacoBlame(editor);
            return;
        }
        const oldDecorations = editor.__gitBlameDecorationIds || [];
        editor.__gitBlameDecorationIds = editor.deltaDecorations(oldDecorations, decorations);
        editor.__gitBlameByLine = byLine;
        setMonacoBlameClass(editor, byLine.size > 0);
        editor.updateOptions({
            lineNumbers: lineNumber => {
                const line = byLine.get(lineNumber);
                return line ? blameLineLabel(line) : String(lineNumber);
            },
            lineNumbersMinChars: 24,
        });
    }

    // ─── Diff Modal ──────────────────────────────────────────────────
    let diffAllFiles = [];
    let diffFiles = [];
    let diffFileStatuses = {};
    let diffIndex = 0;
    let diffRequestSequence = 0;
    let diffProjectName = null;
    let diffSideBySide = true;
    let currentDiffEditor = null;
    let cancelDiffAutoSave = null;
    let clearPendingDiffAutoSave = null;
    let activeDiffSave = null;
    let diffSaveSequence = 0;
    let currentFileData = null; // { original, modified, filename, readOnly }
    let diffChanges = [];      // line changes from Monaco
    let diffChangeIndex = -1;  // current change index
    let navigateToLastChange = false; // flag to scroll to last change after loading
    let diffCollapsedDirs = new Set();
    const DIFF_FILE_PANEL_COLLAPSED_KEY = 'diff-file-panel-collapsed';
    let diffFilePanelCollapsed = loadDiffFilePanelCollapsedPreference();
    let diffBlameEnabled = false;
    let diffBlameRequestSequence = 0;
    let diffTestsHidden = false;
    let activeDiffComment = null;

    function buildDiffCommentPrompt(filename, lineNumber, side, comment) {
        return `Please address this git diff comment:\n${JSON.stringify({
            file: String(filename || ''),
            line: Number(lineNumber),
            side: side === 'original' ? 'HEAD' : 'working tree',
            comment: String(comment || '').trim(),
        }, null, 2)}`;
    }

    function sendDiffCommentToAI(projectName, prompt) {
        const tabKey = workspaceForTab(activeTab)?.projects?.includes(projectName) ? activeTab : projectName;
        const terminal = getTerminalEntry(tabKey);
        if (isWorkspaceTab(tabKey)) prompt = 'Project: ' + projectName + '\nPath: ' + (projectForKey(projectName)?.path || projectName) + '\n' + prompt;
        if (!terminal || !terminal.connection || terminal.connection.state !== 'open') {
            showToast('Comment not sent', 'The current AI terminal is not connected.', 'error', 3600);
            return false;
        }

        try {
            if (terminal.term && typeof terminal.term.paste === 'function') {
                terminal.term.paste(prompt);
            } else if (!terminal.connection.sendInput(prompt)) {
                throw new Error('terminal input is unavailable');
            }
            if (!terminal.connection.sendInput('\r')) {
                throw new Error('terminal input is unavailable');
            }
        } catch (err) {
            showToast('Comment not sent', (err && err.message) || 'The current AI terminal rejected the comment.', 'error', 3600);
            return false;
        }
        return true;
    }

    function closeActiveDiffComment(options = {}) {
        const draft = activeDiffComment;
        if (!draft) return;
        activeDiffComment = null;
        if (draft.editor && draft.zoneID != null && draft.editor.changeViewZones) {
            draft.editor.changeViewZones(accessor => accessor.removeZone(draft.zoneID));
        }
        if (options.focusEditor !== false && draft.editor && draft.editor.focus) draft.editor.focus();
    }

    function openDiffComment(editor, side, requestedLine) {
        if (!editor || !currentFileData) return;
        const model = editor.getModel && editor.getModel();
        if (!model) return;
        const position = editor.getPosition && editor.getPosition();
        const candidateLine = Number(requestedLine || (position && position.lineNumber) || 1);
        const lineNumber = Math.max(1, Math.min(model.getLineCount(), Number.isFinite(candidateLine) ? candidateLine : 1));
        const projectName = currentFileData.projectName;
        const filename = currentFileData.filename;
        const sideLabel = side === 'original' ? 'HEAD' : 'working tree';

        closeActiveDiffComment({ focusEditor: false });

        const form = document.createElement('form');
        form.className = 'diff-comment-form';
        const zone = document.createElement('div');
        zone.className = 'diff-comment-zone';
        zone.appendChild(form);
        const header = document.createElement('div');
        header.className = 'diff-comment-header';
        const location = document.createElement('span');
        location.className = 'diff-comment-location';
        location.textContent = `${filename}:${lineNumber} · ${sideLabel}`;
        const shortcut = document.createElement('span');
        shortcut.className = 'diff-comment-shortcut';
        shortcut.textContent = `${PRIMARY_MODIFIER_LABEL}+Enter to send`;
        header.appendChild(location);
        header.appendChild(shortcut);

        const textarea = document.createElement('textarea');
        textarea.className = 'diff-comment-input';
        textarea.placeholder = 'Write a comment for the current AI...';
        textarea.setAttribute('aria-label', `Comment on ${filename}, line ${lineNumber}`);

        const actions = document.createElement('div');
        actions.className = 'diff-comment-actions';
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = 'Cancel';
        const sendButton = document.createElement('button');
        sendButton.type = 'submit';
        sendButton.className = 'primary';
        sendButton.textContent = 'Send to AI';
        actions.appendChild(cancelButton);
        actions.appendChild(sendButton);

        form.appendChild(header);
        form.appendChild(textarea);
        form.appendChild(actions);

        const send = () => {
            const comment = textarea.value.trim();
            if (!comment) {
                textarea.focus();
                return;
            }
            const prompt = buildDiffCommentPrompt(filename, lineNumber, side, comment);
            if (!sendDiffCommentToAI(projectName, prompt)) return;
            closeActiveDiffComment();
            showToast('Comment sent', `${filename}:${lineNumber} was sent to the current AI.`, 'success', 2600);
        };

        form.addEventListener('submit', ev => {
            ev.preventDefault();
            send();
        });
        cancelButton.onclick = () => closeActiveDiffComment();
        textarea.addEventListener('keydown', ev => {
            ev.stopPropagation();
            if (ev.isComposing || ev.keyCode === 229) return;
            if (ev.key === 'Escape') {
                ev.preventDefault();
                closeActiveDiffComment();
            } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
                ev.preventDefault();
                send();
            }
        });

        let zoneID = null;
        editor.changeViewZones(accessor => {
            zoneID = accessor.addZone({
                afterLineNumber: lineNumber,
                heightInPx: 138,
                domNode: zone,
                suppressMouseDown: false,
            });
        });
        activeDiffComment = { editor, zoneID, textarea };
        if (editor.revealLineInCenterIfOutsideViewport) editor.revealLineInCenterIfOutsideViewport(lineNumber);
        requestAnimationFrame(() => {
            if (activeDiffComment && activeDiffComment.textarea === textarea) textarea.focus();
        });
    }

    function setDiffCommentGlyph(editor, lineNumber) {
        if (!editor || !editor.deltaDecorations || editor.__diffCommentGlyphLine === lineNumber) return;
        const previous = editor.__diffCommentGlyphDecorationIDs || [];
        const decorations = lineNumber ? [{
            range: new monaco.Range(lineNumber, 1, lineNumber, 1),
            options: {
                glyphMarginClassName: 'diff-comment-glyph',
                glyphMarginHoverMessage: { value: 'Comment to current AI' },
            },
        }] : [];
        editor.__diffCommentGlyphDecorationIDs = editor.deltaDecorations(previous, decorations);
        editor.__diffCommentGlyphLine = lineNumber || null;
    }

    function registerDiffCommentEditor(editor, side) {
        editor.addAction({
            id: `diff.comment-to-ai.${side}`,
            label: 'Comment to current AI',
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 0,
            run: () => openDiffComment(editor, side),
        });
        editor.onMouseMove(ev => {
            const lineNumber = ev.target && ev.target.position && ev.target.position.lineNumber;
            setDiffCommentGlyph(editor, lineNumber || null);
        });
        editor.onMouseLeave(() => setDiffCommentGlyph(editor, null));
        editor.onMouseDown(ev => {
            const element = ev.target && ev.target.element;
            const commentGlyph = element && (
                (element.classList && element.classList.contains('diff-comment-glyph'))
                || (element.closest && element.closest('.diff-comment-glyph'))
            );
            if (!commentGlyph || !ev.target.position) return;
            openDiffComment(editor, side, ev.target.position.lineNumber);
        });
    }

    function diffEntryName(entry) {
        return entry.filename || entry.new_path || entry.old_path || '';
    }

    function diffEntryIsTest(entry) {
        const parts = diffEntryName(entry).split('/').filter(Boolean);
        const filename = (parts.pop() || '').toLowerCase();
        const testDirectories = new Set(['__tests__', 'tests', 'test', '__test__']);
        if (parts.some(part => testDirectories.has(part.toLowerCase()))) return true;
        return /(^|[._-])tests?([._-]|$)/.test(filename);
    }

    function diffEntryReadOnly(entry) {
        return !!(entry && entry.readOnly);
    }

    function diffEntryCanBeViewed(entry) {
        return !!(
            entry
            && entry.kind === 'local'
            && entry.revision
            && diffProjectName
            && diffProjectName === gitStatusProject
            && gitStatusIsGitRepo === true
        );
    }

    function diffEntryIsViewed(entry) {
        if (!diffEntryCanBeViewed(entry)) return false;
        return gitFileIsViewed(diffProjectName, { name: diffEntryName(entry), revision: entry.revision });
    }

    function updateDiffViewedButton() {
        const btn = document.getElementById('diff-viewed-toggle');
        if (!btn) return;
        const entry = diffFiles[diffIndex];
        const canMarkViewed = diffEntryCanBeViewed(entry);
        const viewed = canMarkViewed && diffEntryIsViewed(entry);
        btn.style.display = canMarkViewed ? '' : 'none';
        btn.classList.toggle('active', viewed);
        btn.textContent = viewed ? 'viewed' : 'mark viewed';
        btn.title = titleWithShortcut(
            viewed ? 'Mark file as not viewed' : 'Mark file as viewed',
            commandShortcutLabel('diff.toggleViewed')
        );
        btn.setAttribute('aria-pressed', viewed ? 'true' : 'false');
    }

    async function toggleCurrentDiffViewed() {
        const entry = diffFiles[diffIndex];
        if (!diffEntryCanBeViewed(entry)) return false;
        const projectName = diffProjectName;
        const filename = diffEntryName(entry);
        if (diffEntryIsViewed(entry)) {
            setGitFileViewed(projectName, { name: filename, revision: entry.revision }, false);
            return true;
        }

        const editingCurrentFile = !!(
            currentFileData
            && currentFileData.projectName === projectName
            && currentFileData.filename === filename
            && !currentFileData.readOnly
        );
        if (editingCurrentFile && getCurrentContent() !== currentFileData.modified) {
            const saved = await saveCurrentFile({ refreshStatus: false });
            if (!saved) return false;
        }

        const status = await updateGitStatus();
        if (!status || status.is_git_repo !== true || diffProjectName !== projectName) return false;
        const refreshedFile = (Array.isArray(status.files) ? status.files : [])
            .find(file => file && file.name === filename && file.revision);
        if (!refreshedFile) return false;
        if (
            editingCurrentFile
            && currentFileData
            && currentFileData.projectName === projectName
            && currentFileData.filename === filename
            && getCurrentContent() !== currentFileData.modified
        ) {
            return false;
        }

        const refreshedEntry = diffAllFiles.find(candidate => candidate.kind === 'local' && diffEntryName(candidate) === filename);
        if (!refreshedEntry) return false;
        refreshedEntry.revision = refreshedFile.revision;
        const shouldAdvance = diffFiles[diffIndex] === refreshedEntry && diffIndex < diffFiles.length - 1;
        setGitFileViewed(projectName, { name: filename, revision: refreshedFile.revision }, true);
        if (shouldAdvance) diffNavigate(1);
        return true;
    }

    function syncOpenDiffFileRevisions(projectName, files) {
        if (!projectName || projectName !== diffProjectName || diffAllFiles.length === 0) return false;
        const revisions = new Map((files || []).map(file => [file.name, file.revision || '']));
        let changed = false;
        diffAllFiles.forEach(entry => {
            if (entry.kind !== 'local') return;
            const revision = revisions.get(diffEntryName(entry)) || '';
            if ((entry.revision || '') === revision) return;
            entry.revision = revision;
            changed = true;
        });
        return changed;
    }

    function showDiffModal(filename) {
        if (!activeProject) return;
        diffProjectName = activeProject;
        const files = currentGitFiles();
        const baseCommit = currentGitDiffBase();
        diffAllFiles = files.map(file => ({
            kind: 'local',
            filename: file.name,
            status: file.status,
            readOnly: false,
            revertible: file.revertible,
            revision: file.revision,
            baseCommit,
        }));
        diffFiles = [...diffAllFiles];
        diffFileStatuses = {};
        files.forEach(file => { diffFileStatuses[file.name] = file.status; });
        diffCollapsedDirs = new Set();
        diffTestsHidden = false;
        updateDiffTestsButton();
        if (diffFiles.length === 0) {
            if (showCurrentGitStatusNotReadyToast('Diff unavailable')) return;
            showToast('No changes', 'There are no changed files to show.', 'info', 2600);
            return;
        }
        diffIndex = diffFiles.findIndex(entry => entry.filename === filename);
        if (diffIndex < 0) diffIndex = 0;
        loadDiff(diffFiles[diffIndex]);
    }

    function disposeEditors() {
        closeActiveDiffComment({ focusEditor: false });
        if (cancelDiffAutoSave) {
            cancelDiffAutoSave();
            cancelDiffAutoSave = null;
        }
        diffBlameRequestSequence++;
        clearDiffBlameDecorations();
        cancelActiveDiffSave();
        if (currentDiffEditor) { currentDiffEditor.dispose(); currentDiffEditor = null; }
    }

    function updateDiffBlameButton() {
        const btn = document.getElementById('diff-blame-btn');
        if (!btn) return;
        btn.classList.toggle('active', diffBlameEnabled);
    }

    function clearDiffBlameDecorations() {
        if (!currentDiffEditor) return;
        clearMonacoBlame(currentDiffEditor.getOriginalEditor && currentDiffEditor.getOriginalEditor());
        clearMonacoBlame(currentDiffEditor.getModifiedEditor && currentDiffEditor.getModifiedEditor());
    }

    function diffModelHasContent(model) {
        return !!(model && (model.getLineCount() > 1 || model.getLineContent(1) !== ''));
    }

    function currentDiffBlameTarget() {
        if (!currentDiffEditor || !currentFileData) return null;
        const modifiedEditor = currentDiffEditor.getModifiedEditor && currentDiffEditor.getModifiedEditor();
        const originalEditor = currentDiffEditor.getOriginalEditor && currentDiffEditor.getOriginalEditor();
        const modifiedModel = modifiedEditor && modifiedEditor.getModel();
        const originalModel = originalEditor && originalEditor.getModel();
        if (diffModelHasContent(modifiedModel)) {
            return { editor: modifiedEditor, ref: 'working' };
        }
        if (diffModelHasContent(originalModel)) {
            return { editor: originalEditor, ref: 'head' };
        }
        return null;
    }

    function otherDiffBlameEditor(editor) {
        if (!currentDiffEditor || !editor) return null;
        const modifiedEditor = currentDiffEditor.getModifiedEditor && currentDiffEditor.getModifiedEditor();
        const originalEditor = currentDiffEditor.getOriginalEditor && currentDiffEditor.getOriginalEditor();
        if (editor === modifiedEditor) return originalEditor;
        if (editor === originalEditor) return modifiedEditor;
        return null;
    }

    async function loadCurrentDiffBlame() {
        if (!diffBlameEnabled || !currentFileData) return;
        const target = currentDiffBlameTarget();
        if (!target) {
            clearDiffBlameDecorations();
            return;
        }
        const projectName = currentFileData.projectName;
        const filename = currentFileData.filename;
        const modelState = monacoBlameModelState(target.editor);
        if (!modelState.model) return;
        const requestSequence = ++diffBlameRequestSequence;
        try {
            const data = await fetchFileBlame(projectName, filename, target.ref);
            if (
                requestSequence !== diffBlameRequestSequence
                || !diffBlameEnabled
                || !currentFileData
                || currentFileData.projectName !== projectName
                || currentFileData.filename !== filename
                || !monacoBlameModelUnchanged(target.editor, modelState)
            ) return;
            clearMonacoBlame(otherDiffBlameEditor(target.editor));
            applyMonacoBlame(target.editor, data.lines || []);
        } catch (err) {
            if (requestSequence !== diffBlameRequestSequence) return;
            diffBlameEnabled = false;
            clearDiffBlameDecorations();
            updateDiffBlameButton();
            showToast('Blame unavailable', (err && err.message) || 'Could not load git blame.', 'error', 3200);
        }
    }

    function toggleDiffBlame() {
        diffBlameEnabled = !diffBlameEnabled;
        updateDiffBlameButton();
        if (diffBlameEnabled) loadCurrentDiffBlame();
        else {
            diffBlameRequestSequence++;
            clearDiffBlameDecorations();
        }
    }

    async function loadDiff(entry) {
        const projectName = diffProjectName || activeProject;
        if (!projectName) return;
        const requestSequence = ++diffRequestSequence;
        const modal = document.getElementById('diff-modal');
        const title = document.getElementById('diff-modal-title');
        const body = document.getElementById('diff-modal-body');
        const viewToggle = document.getElementById('diff-view-toggle');
        const blameBtn = document.getElementById('diff-blame-btn');
        const saveBtn = document.getElementById('diff-save-btn');
        const revertBtn = document.getElementById('diff-revert-btn');

        disposeEditors();
        diffChanges = [];
        diffChangeIndex = -1;
        updateChangeCounter();
        const filename = diffEntryName(entry);
        title.textContent = isWorkspaceTab(activeTab) ? commandProjectLabel(projectName) + ' / ' + filename : filename;
        body.innerHTML = '<div style="padding:12px 16px;color:var(--text-dim)">Loading...</div>';
        modal.style.display = 'flex';
        updateDiffFilePanelState();
        renderDiffFileSidebar();
        updateDiffFileNavigation();
        updateDiffViewedButton();

        saveBtn.style.display = 'none';
        revertBtn.style.display = 'none';
        blameBtn.style.display = 'none';
        updateDiffBlameButton();

        const baseCommit = entry.baseCommit || '';
        const baseParam = baseCommit ? `&base=${encodeURIComponent(baseCommit)}` : '';

        try {
            const data = await fetchJSON(
                `/api/projects/${encodeURIComponent(projectName)}/file?path=${encodeURIComponent(filename)}${baseParam}`
            );
            if (requestSequence !== diffRequestSequence || diffProjectName !== projectName) return;
            const type = ['text', 'image', 'binary'].includes(data.type) ? data.type : 'text';
            const readOnly = diffEntryReadOnly(entry);

            if (type === 'text') {
                viewToggle.style.display = '';
                blameBtn.style.display = '';
                saveBtn.style.display = readOnly ? 'none' : '';
                revertBtn.style.display = entry.kind === 'local' && !readOnly && entry.revertible !== false ? '' : 'none';
                currentFileData = { original: data.original, modified: data.modified, filename, readOnly, projectName };
                ensureMonaco(() => {
                    if (!currentFileData || currentFileData.filename !== filename || currentFileData.projectName !== projectName) return;
                    body.innerHTML = '';
                    createDiffEditor(body);
                    if (diffBlameEnabled) loadCurrentDiffBlame();
                });
            } else {
                // Non-text: no Monaco, no save, no revert, no inline toggle.
                viewToggle.style.display = 'none';
                blameBtn.style.display = 'none';
                saveBtn.style.display = 'none';
                revertBtn.style.display = 'none';
                currentFileData = null;
                navigateToLastChange = false;

                if (type === 'image') {
                    renderImageDiff(body, filename, data, baseCommit);
                } else {
                    renderBinaryMessage(body, data);
                }
            }
        } catch {
            body.innerHTML = '<div style="padding:12px 16px;color:var(--red)">Failed to load file</div>';
            currentFileData = null;
            navigateToLastChange = false;
            blameBtn.style.display = 'none';
            saveBtn.style.display = 'none';
            revertBtn.style.display = 'none';
        }
    }

    function formatBytes(n) {
        if (!n) return '0 B';
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    }

    function blobUrl(filename, ref, baseCommit = '') {
        const base = baseCommit ? `&base=${encodeURIComponent(baseCommit)}` : '';
        return `/api/projects/${encodeURIComponent(activeProject)}/file/blob`
            + `?path=${encodeURIComponent(filename)}&ref=${ref}${base}`;
    }

    const IMAGE_ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8];
    const IMAGE_ZOOM_FIT_INDEX = IMAGE_ZOOM_LEVELS.indexOf(1);
    const IMAGE_ZOOM_WHEEL_THRESHOLD = 30;
    const IMAGE_ZOOM_WHEEL_COOLDOWN_MS = 220;

    function buildImageZoomControls(stage, img) {
        const controls = document.createElement('div');
        controls.className = 'image-zoom-controls';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', 'Image zoom controls');

        const zoomOut = document.createElement('button');
        zoomOut.type = 'button';
        zoomOut.className = 'image-zoom-step';
        zoomOut.title = 'Zoom out (Ctrl/Cmd + scroll)';
        zoomOut.setAttribute('aria-label', 'Zoom out');
        zoomOut.innerHTML = iconHTML('minus');

        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'image-zoom-level';
        reset.title = 'Reset zoom to fit';
        reset.setAttribute('aria-label', 'Reset zoom to fit');

        const zoomIn = document.createElement('button');
        zoomIn.type = 'button';
        zoomIn.className = 'image-zoom-step';
        zoomIn.title = 'Zoom in (Ctrl/Cmd + scroll)';
        zoomIn.setAttribute('aria-label', 'Zoom in');
        zoomIn.innerHTML = iconHTML('plus');

        let zoomIndex = IMAGE_ZOOM_FIT_INDEX;
        let fittedWidth = 0;
        let fittedHeight = 0;
        let wheelDelta = 0;
        let lastWheelZoomAt = -Infinity;

        const imageReady = () => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;

        function updateControls() {
            const atFit = zoomIndex === IMAGE_ZOOM_FIT_INDEX;
            reset.textContent = atFit ? 'Fit' : `${Math.round(IMAGE_ZOOM_LEVELS[zoomIndex] * 100)}%`;
            zoomOut.disabled = !imageReady() || zoomIndex === 0;
            reset.disabled = !imageReady() || atFit;
            zoomIn.disabled = !imageReady() || zoomIndex === IMAGE_ZOOM_LEVELS.length - 1;
        }

        function setZoom(nextIndex, anchorX = stage.clientWidth / 2, anchorY = stage.clientHeight / 2) {
            if (!imageReady() || nextIndex === zoomIndex || nextIndex < 0 || nextIndex >= IMAGE_ZOOM_LEVELS.length) return;

            const previousScrollWidth = Math.max(stage.scrollWidth, 1);
            const previousScrollHeight = Math.max(stage.scrollHeight, 1);
            const scrollRatioX = (stage.scrollLeft + anchorX) / previousScrollWidth;
            const scrollRatioY = (stage.scrollTop + anchorY) / previousScrollHeight;

            if (!fittedWidth || !fittedHeight) {
                const bounds = img.getBoundingClientRect();
                fittedWidth = bounds.width;
                fittedHeight = bounds.height;
            }

            zoomIndex = nextIndex;
            if (zoomIndex === IMAGE_ZOOM_FIT_INDEX) {
                img.style.removeProperty('width');
                img.style.removeProperty('height');
                img.style.removeProperty('max-width');
                img.style.removeProperty('max-height');
                fittedWidth = 0;
                fittedHeight = 0;
            } else {
                const zoom = IMAGE_ZOOM_LEVELS[zoomIndex];
                img.style.width = `${fittedWidth * zoom}px`;
                img.style.height = `${fittedHeight * zoom}px`;
                img.style.maxWidth = 'none';
                img.style.maxHeight = 'none';
            }

            updateControls();
            stage.scrollLeft = scrollRatioX * stage.scrollWidth - anchorX;
            stage.scrollTop = scrollRatioY * stage.scrollHeight - anchorY;
        }

        zoomOut.onclick = () => setZoom(zoomIndex - 1);
        reset.onclick = () => setZoom(IMAGE_ZOOM_FIT_INDEX);
        zoomIn.onclick = () => setZoom(zoomIndex + 1);
        stage.addEventListener('wheel', (ev) => {
            if ((!ev.ctrlKey && !ev.metaKey) || !imageReady()) {
                wheelDelta = 0;
                return;
            }
            ev.preventDefault();

            const now = performance.now();
            if (now - lastWheelZoomAt < IMAGE_ZOOM_WHEEL_COOLDOWN_MS) return;

            const deltaMultiplier = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? stage.clientHeight : 1;
            const delta = ev.deltaY * deltaMultiplier;
            if (!delta) return;
            if (wheelDelta && Math.sign(wheelDelta) !== Math.sign(delta)) wheelDelta = 0;
            wheelDelta += delta;
            if (Math.abs(wheelDelta) < IMAGE_ZOOM_WHEEL_THRESHOLD) return;

            const bounds = stage.getBoundingClientRect();
            const nextIndex = zoomIndex + (wheelDelta < 0 ? 1 : -1);
            wheelDelta = 0;
            lastWheelZoomAt = now;
            setZoom(nextIndex, ev.clientX - bounds.left, ev.clientY - bounds.top);
        }, { passive: false });
        img.addEventListener('load', updateControls);
        img.addEventListener('error', updateControls);

        controls.appendChild(zoomOut);
        controls.appendChild(reset);
        controls.appendChild(zoomIn);
        updateControls();
        return controls;
    }

    function renderImageDiff(body, filename, data, baseCommit = '') {
        const view = document.createElement('div');
        view.className = 'diff-image-view';

        if (data.originalExists) {
            const originalCaption = baseCommit ? baseCommit.slice(0, 7) : 'HEAD';
            const caption = data.modifiedExists ? originalCaption : 'deleted';
            const status = data.modifiedExists ? '' : 'deleted';
            view.appendChild(buildImagePane(caption, blobUrl(filename, 'head', baseCommit), data.originalSize, status));
        }
        if (data.modifiedExists) {
            const caption = data.originalExists ? 'working tree' : 'new';
            const status = data.originalExists ? '' : 'added';
            view.appendChild(buildImagePane(caption, blobUrl(filename, 'working'), data.modifiedSize, status));
        }

        body.innerHTML = '';
        body.appendChild(view);
    }

    function buildImagePane(caption, src, size, status) {
        const pane = document.createElement('div');
        pane.className = 'diff-image-pane';

        const paneHeader = document.createElement('div');
        paneHeader.className = 'diff-image-pane-header';
        const cap = document.createElement('div');
        cap.className = 'diff-image-pane-caption' + (status ? ' ' + status : '');
        cap.textContent = caption;

        const paneBody = document.createElement('div');
        paneBody.className = 'diff-image-pane-body';
        const img = document.createElement('img');
        img.alt = caption;
        paneBody.appendChild(img);
        const zoomControls = buildImageZoomControls(paneBody, img);
        img.src = src;

        const sizeEl = document.createElement('div');
        sizeEl.className = 'diff-image-pane-size';
        sizeEl.textContent = formatBytes(size);

        img.onerror = () => {
            img.style.display = 'none';
            sizeEl.textContent = '(image not available)';
        };

        paneHeader.appendChild(cap);
        paneHeader.appendChild(zoomControls);
        pane.appendChild(paneHeader);
        pane.appendChild(paneBody);
        pane.appendChild(sizeEl);
        return pane;
    }

    function renderBinaryMessage(body, data) {
        const size = data.modifiedExists ? data.modifiedSize : data.originalSize;
        body.innerHTML = '';
        const msg = document.createElement('div');
        msg.className = 'diff-binary-message';
        const title = document.createElement('strong');
        title.textContent = `Binary file — ${formatBytes(size)}`;
        const sub = document.createElement('div');
        sub.textContent = 'Cannot display.';
        msg.appendChild(title);
        msg.appendChild(sub);
        body.appendChild(msg);
    }

    function createDiffEditor(container) {
        const lang = getLangFromFile(currentFileData.filename);
        // When one side is empty (a brand-new or fully-deleted file) the 50/50
        // split wastes half the modal on a blank pane. Skew the split so the
        // empty side collapses and the actual content gets nearly all the width.
        // splitViewDefaultRatio is original-width / total; Monaco clamps it to a
        // small minimum pane width, which still leaves a thin sliver to grab.
        const originalEmpty = !(currentFileData.original && currentFileData.original.length);
        const modifiedEmpty = !(currentFileData.modified && currentFileData.modified.length);
        let splitViewDefaultRatio = 0.5;
        if (originalEmpty && !modifiedEmpty) splitViewDefaultRatio = 0.2;
        else if (modifiedEmpty && !originalEmpty) splitViewDefaultRatio = 0.8;
        currentDiffEditor = monaco.editor.createDiffEditor(container, {
            theme: getMonacoThemeName(),
            originalEditable: false,
            renderSideBySide: diffSideBySide,
            splitViewDefaultRatio,
            // The hunk discard glyph is easy to hit while placing the cursor and can replace several lines at once.
            renderMarginRevertIcon: false,
            glyphMargin: true,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
        });
        currentDiffEditor.setModel({
            original: monaco.editor.createModel(currentFileData.original || '', lang),
            modified: monaco.editor.createModel(currentFileData.modified || '', lang),
        });
        const modifiedEditor = currentDiffEditor.getModifiedEditor();
        const originalEditor = currentDiffEditor.getOriginalEditor();
        const modifiedModel = modifiedEditor.getModel();
        registerDiffCommentEditor(originalEditor, 'original');
        registerDiffCommentEditor(modifiedEditor, 'modified');
        modifiedEditor.updateOptions({ readOnly: !!currentFileData.readOnly });
        if (!currentFileData.readOnly) {
            // Monaco standalone editors share one global keybinding service, so a
            // command registered with addCommand fires in EVERY editor instance
            // unless it is gated by a `when` context. Scope these to this diff
            // editor so its Backspace/Delete overrides don't leak into the plain
            // editor modal (which broke delete keys there).
            const diffScope = 'diffModifiedEditorFocused';
            modifiedEditor.createContextKey(diffScope, true);
            // Ctrl+S saves from diff editor's modified side
            modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                saveCurrentFile();
            }, diffScope);
            modifiedEditor.addCommand(monaco.KeyCode.Delete, () => {
                runSingleCharacterDiffDelete(modifiedEditor, false);
            }, diffScope);
            modifiedEditor.addCommand(monaco.KeyCode.Backspace, () => {
                runSingleCharacterDiffDelete(modifiedEditor, true);
            }, diffScope);
            const projectName = currentFileData.projectName;
            const filename = currentFileData.filename;
            let autoSaveTimer = null;
            const clearPendingAutoSave = () => {
                clearTimeout(autoSaveTimer);
                autoSaveTimer = null;
            };
            clearPendingDiffAutoSave = clearPendingAutoSave;
        const changeDisposable = modifiedModel.onDidChangeContent(() => {
            clearPendingAutoSave();
            if (diffBlameEnabled) clearMonacoBlame(modifiedEditor);
            const viewedEntry = diffAllFiles.find(entry => entry.kind === 'local' && diffEntryName(entry) === filename);
            if (viewedEntry && diffEntryIsViewed(viewedEntry)) {
                setGitFileViewed(projectName, { name: filename, revision: viewedEntry.revision }, false);
            }
            const content = modifiedModel.getValue();
            const saveSequence = ++diffSaveSequence;
                abortActiveDiffSave();
                autoSaveTimer = setTimeout(() => {
                    if (saveSequence === diffSaveSequence && currentFileData && currentFileData.projectName === projectName && currentFileData.filename === filename) {
                        saveDiffContent(projectName, filename, content, { auto: true, sequence: saveSequence });
                    }
                }, 250);
            });
            let autoSaveCleanedUp = false;
            const cleanupDiffAutoSave = () => {
                if (autoSaveCleanedUp) return;
                autoSaveCleanedUp = true;
                clearPendingAutoSave();
                changeDisposable.dispose();
                if (clearPendingDiffAutoSave === clearPendingAutoSave) {
                    clearPendingDiffAutoSave = null;
                }
            };
            cancelDiffAutoSave = cleanupDiffAutoSave;
            currentDiffEditor.onDidDispose(() => {
                cleanupDiffAutoSave();
                if (cancelDiffAutoSave === cleanupDiffAutoSave) {
                    cancelDiffAutoSave = null;
                }
            });
        }
        // Wait for diff computation, then populate changes and scroll
        let initialDiffLoad = true;
        currentDiffEditor.onDidUpdateDiff(() => {
            diffChanges = currentDiffEditor.getLineChanges() || [];
            if (diffChanges.length > 0) {
                diffChangeIndex = navigateToLastChange ? diffChanges.length - 1 : 0;
                if (initialDiffLoad) scrollToChange(diffChangeIndex);
                initialDiffLoad = false;
                navigateToLastChange = false;
            } else {
                diffChangeIndex = -1;
                navigateToLastChange = false;
            }
            updateChangeCounter();
        });
    }

    function defaultDiffDelete(editor, backwards) {
        if (!editor || !editor.trigger) return;
        editor.trigger('keyboard', backwards ? 'deleteLeft' : 'deleteRight', null);
    }

    function diffSingleCharacterDeleteRange(model, position, backwards) {
        if (!model || !position) return null;
        const line = position.lineNumber;
        const column = position.column;
        if (backwards) {
            if (column > 1) return new monaco.Range(line, column - 1, line, column);
            if (line > 1) return new monaco.Range(line - 1, model.getLineMaxColumn(line - 1), line, 1);
            return null;
        }
        const maxColumn = model.getLineMaxColumn(line);
        if (column < maxColumn) return new monaco.Range(line, column, line, column + 1);
        if (line < model.getLineCount()) return new monaco.Range(line, maxColumn, line + 1, 1);
        return null;
    }

    function runSingleCharacterDiffDelete(editor, backwards) {
        const model = editor && editor.getModel();
        const selections = editor && editor.getSelections ? editor.getSelections() : null;
        if (!model || !selections || selections.length === 0) {
            defaultDiffDelete(editor, backwards);
            return;
        }
        const selection = (editor.getSelection && editor.getSelection()) || selections[0];
        const unsafeSelection = selections.length > 1
            || (selection && !selection.isEmpty() && selection.startLineNumber !== selection.endLineNumber);
        if (!unsafeSelection) {
            defaultDiffDelete(editor, backwards);
            return;
        }

        const position = selection && typeof selection.getPosition === 'function'
            ? selection.getPosition()
            : editor.getPosition();
        if (!position) {
            defaultDiffDelete(editor, backwards);
            return;
        }
        const range = diffSingleCharacterDeleteRange(model, position, backwards);
        if (!range) {
            editor.setSelection(new monaco.Selection(position.lineNumber, position.column, position.lineNumber, position.column));
            return;
        }

        const nextPosition = backwards
            ? { lineNumber: range.startLineNumber, column: range.startColumn }
            : position;
        editor.executeEdits('diff-single-character-delete', [{ range, text: '', forceMoveMarkers: true }], [
            new monaco.Selection(nextPosition.lineNumber, nextPosition.column, nextPosition.lineNumber, nextPosition.column),
        ]);
    }

    function diffEditorHasKeyboardFocus(ev) {
        if (!currentDiffEditor) return false;
        const target = ev && ev.target;
        const body = document.getElementById('diff-modal-body');
        if (target && body && body.contains(target) && target.closest && target.closest('.monaco-editor, .monaco-diff-editor')) {
            return true;
        }

        const editors = [
            currentDiffEditor.getOriginalEditor && currentDiffEditor.getOriginalEditor(),
            currentDiffEditor.getModifiedEditor && currentDiffEditor.getModifiedEditor(),
        ].filter(Boolean);
        return editors.some(editor =>
            (editor.hasTextFocus && editor.hasTextFocus())
            || (editor.hasWidgetFocus && editor.hasWidgetFocus())
        );
    }

    function modifiedDiffEditorHasTextFocus(ev) {
        if (!currentDiffEditor) return false;
        const modifiedEditor = currentDiffEditor.getModifiedEditor && currentDiffEditor.getModifiedEditor();
        if (!modifiedEditor) return false;
        if (modifiedEditor.hasTextFocus && modifiedEditor.hasTextFocus()) return true;

        const target = ev && ev.target;
        if (target && target.closest && target.closest('.diff-comment-input')) return false;
        const node = modifiedEditor.getDomNode && modifiedEditor.getDomNode();
        return !!(target && node && node.contains(target) && target.closest && target.closest('textarea'));
    }

    function isPlainDiffContentEditKey(ev) {
        if (!ev || ev.ctrlKey || ev.metaKey || ev.altKey) return false;
        if (ev.key === 'Backspace' || ev.key === 'Delete' || ev.key === 'Enter') return true;
        return typeof ev.key === 'string' && ev.key.length === 1;
    }

    function collapseUnsafeDiffEditorSelectionForPlainInput(ev) {
        if (!isPlainDiffContentEditKey(ev) || !modifiedDiffEditorHasTextFocus(ev)) return false;
        const modifiedEditor = currentDiffEditor.getModifiedEditor && currentDiffEditor.getModifiedEditor();
        if (!modifiedEditor || !modifiedEditor.getSelections || currentFileData?.readOnly) return false;
        const selections = modifiedEditor.getSelections() || [];
        const selection = (modifiedEditor.getSelection && modifiedEditor.getSelection()) || selections[0];
        const unsafeSelection = selections.length > 1
            || (selection && !selection.isEmpty() && selection.startLineNumber !== selection.endLineNumber);
        if (!unsafeSelection) return false;

        const position = selection && typeof selection.getPosition === 'function'
            ? selection.getPosition()
            : modifiedEditor.getPosition && modifiedEditor.getPosition();
        if (!position) return false;
        modifiedEditor.setSelection(new monaco.Selection(position.lineNumber, position.column, position.lineNumber, position.column));
        return true;
    }

    function scrollToChange(index) {
        if (!currentDiffEditor || index < 0 || index >= diffChanges.length) return;
        const change = diffChanges[index];
        const line = change.modifiedStartLineNumber || 1;
        currentDiffEditor.getModifiedEditor().revealLineInCenter(line);
    }

    function updateChangeCounter() {
        const counter = document.getElementById('diff-change-counter');
        const prevBtn = document.getElementById('diff-change-prev');
        const nextBtn = document.getElementById('diff-change-next');
        const nav = document.getElementById('diff-change-nav');
        if (diffChanges.length === 0) {
            nav.style.display = 'none';
            return;
        }
        nav.style.display = 'flex';
        counter.textContent = `${diffChangeIndex + 1} / ${diffChanges.length}`;
        prevBtn.classList.toggle('disabled', diffChangeIndex <= 0 && diffIndex <= 0);
        nextBtn.classList.toggle('disabled', diffChangeIndex >= diffChanges.length - 1 && diffIndex >= diffFiles.length - 1);
    }

    function diffChangeNavigate(direction) {
        const newIndex = diffChangeIndex + direction;
        if (newIndex >= 0 && newIndex < diffChanges.length) {
            diffChangeIndex = newIndex;
            scrollToChange(diffChangeIndex);
            updateChangeCounter();
        } else if (direction > 0 && diffIndex < diffFiles.length - 1) {
            // Next file, scroll to first change
            navigateToLastChange = false;
            diffNavigate(1);
        } else if (direction < 0 && diffIndex > 0) {
            // Previous file, scroll to last change
            navigateToLastChange = true;
            diffNavigate(-1);
        }
    }

    function getCurrentContent() {
        if (currentDiffEditor) return currentDiffEditor.getModifiedEditor().getValue();
        return null;
    }

    async function saveCurrentFile(options = {}) {
        if (!currentFileData || !currentFileData.projectName || currentFileData.readOnly) return false;
        const content = getCurrentContent();
        if (content === null) return false;
        if (clearPendingDiffAutoSave) clearPendingDiffAutoSave();
        return saveDiffContent(currentFileData.projectName, currentFileData.filename, content, {
            sequence: ++diffSaveSequence,
            refreshStatus: options.refreshStatus,
        });
    }

    function abortActiveDiffSave() {
        if (activeDiffSave && activeDiffSave.controller) {
            activeDiffSave.controller.abort();
        }
        activeDiffSave = null;
    }

    function cancelActiveDiffSave() {
        diffSaveSequence += 1;
        abortActiveDiffSave();
    }

    async function saveDiffContent(projectName, filename, content, options = {}) {
        if (!projectName || !filename) return false;
        const saveSequence = Number.isFinite(options.sequence) ? options.sequence : ++diffSaveSequence;
        if (saveSequence !== diffSaveSequence) return false;
        abortActiveDiffSave();
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        activeDiffSave = { projectName, filename, sequence: saveSequence, controller };
        try {
            await fetchJSON(`/api/projects/${encodeURIComponent(projectName)}/file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filename, content }),
                signal: controller ? controller.signal : undefined,
            });
            if (!activeDiffSave || activeDiffSave.sequence !== saveSequence || diffSaveSequence !== saveSequence) return false;
            if (currentFileData && currentFileData.projectName === projectName && currentFileData.filename === filename) {
                currentFileData.modified = content;
                if (diffBlameEnabled) loadCurrentDiffBlame();
            }
            if (activeProject === projectName && options.refreshStatus !== false) updateGitStatus();
            updateBadges();
            return true;
        } catch (err) {
            if ((controller && controller.signal.aborted) || diffSaveSequence !== saveSequence) return false;
            showToast('Save failed', (err && err.message) || 'Could not save file.', 'error', options.auto ? 2600 : 4200);
            return false;
        } finally {
            if (activeDiffSave && activeDiffSave.sequence === saveSequence) {
                activeDiffSave = null;
            }
        }
    }

    function diffNavigate(direction) {
        const newIndex = diffIndex + direction;
        if (newIndex < 0 || newIndex >= diffFiles.length) return;
        diffIndex = newIndex;
        loadDiff(diffFiles[diffIndex]);
    }

    function updateDiffFileNavigation() {
        const nav = document.getElementById('diff-modal-nav');
        if (diffFiles.length <= 1) {
            nav.style.display = 'none';
            return;
        }
        document.getElementById('diff-modal-counter').textContent = `${diffIndex + 1} / ${diffFiles.length}`;
        document.getElementById('diff-modal-prev').classList.toggle('disabled', diffIndex === 0);
        document.getElementById('diff-modal-next').classList.toggle('disabled', diffIndex === diffFiles.length - 1);
        nav.style.display = 'flex';
    }

    function updateDiffTestsButton() {
        const btn = document.getElementById('diff-tests-toggle');
        if (!btn) return;
        btn.classList.toggle('active', diffTestsHidden);
        btn.textContent = diffTestsHidden ? 'show tests' : 'hide tests';
        btn.title = diffTestsHidden ? 'Show test files' : 'Hide test files';
        btn.setAttribute('aria-pressed', diffTestsHidden ? 'true' : 'false');
    }

    function showEmptyDiffFilterState() {
        diffRequestSequence++;
        disposeEditors();
        currentFileData = null;
        diffChanges = [];
        diffChangeIndex = -1;
        navigateToLastChange = false;
        document.getElementById('diff-modal-title').textContent = 'No non-test files';
        document.getElementById('diff-modal-body').innerHTML = '<div style="padding:12px 16px;color:var(--text-dim)">All changed files are hidden by the test filter.</div>';
        document.getElementById('diff-view-toggle').style.display = 'none';
        document.getElementById('diff-blame-btn').style.display = 'none';
        document.getElementById('diff-save-btn').style.display = 'none';
        document.getElementById('diff-revert-btn').style.display = 'none';
        document.getElementById('diff-viewed-toggle').style.display = 'none';
        updateDiffFileNavigation();
        updateChangeCounter();
        renderDiffFileSidebar();
    }

    function setDiffTestsHidden(hidden) {
        const currentEntry = diffFiles[diffIndex];
        const previousIndex = diffIndex;
        diffTestsHidden = hidden;
        diffFiles = diffTestsHidden ? diffAllFiles.filter(entry => !diffEntryIsTest(entry)) : [...diffAllFiles];
        updateDiffTestsButton();

        const currentIndex = diffFiles.indexOf(currentEntry);
        if (currentIndex >= 0) {
            diffIndex = currentIndex;
            updateDiffFileNavigation();
            updateChangeCounter();
            renderDiffFileSidebar();
            if (currentDiffEditor && currentDiffEditor.layout) currentDiffEditor.layout();
            return;
        }
        if (diffFiles.length === 0) {
            diffIndex = 0;
            showEmptyDiffFilterState();
            return;
        }
        diffIndex = Math.min(previousIndex, diffFiles.length - 1);
        navigateToLastChange = false;
        loadDiff(diffFiles[diffIndex]);
    }

    function diffFileStatus(entry) {
        const file = diffEntryName(entry);
        return entry.status || diffFileStatuses[file] || '';
    }

    function diffFileStatusClass(status) {
        if (status === '??') return 'untracked';
        if (status.includes('A')) return 'added';
        if (status.includes('D')) return 'deleted';
        return 'modified';
    }

    function buildDiffFileTree() {
        const root = { dirs: new Map(), files: [] };
        diffFiles.forEach((entry, index) => {
            const filename = diffEntryName(entry);
            const parts = filename.split('/').filter(Boolean);
            const fileName = parts.pop() || filename;
            let node = root;
            let dirPath = '';
            parts.forEach(part => {
                dirPath = dirPath ? `${dirPath}/${part}` : part;
                if (!node.dirs.has(part)) {
                    node.dirs.set(part, { name: part, path: dirPath, dirs: new Map(), files: [] });
                }
                node = node.dirs.get(part);
            });
            node.files.push({ entry, index, name: fileName });
        });
        return root;
    }

    function sortedDiffTreeEntries(entries) {
        return [...entries].sort((a, b) => a.name.localeCompare(b.name));
    }

    function expandActiveDiffFileParents() {
        const entry = diffFiles[diffIndex];
        if (!entry) return;
        const parts = diffEntryName(entry).split('/').filter(Boolean);
        parts.pop();
        let dirPath = '';
        parts.forEach(part => {
            dirPath = dirPath ? `${dirPath}/${part}` : part;
            diffCollapsedDirs.delete(dirPath);
        });
    }

    function appendDiffTreeNodes(list, node, depth) {
        sortedDiffTreeEntries(node.dirs.values()).forEach(dir => {
            const collapsed = diffCollapsedDirs.has(dir.path);
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'diff-tree-row diff-dir-row' + (collapsed ? ' collapsed' : '');
            row.style.paddingLeft = `${8 + depth * 14}px`;
            row.title = dir.path;

            const chevron = document.createElement('span');
            chevron.className = 'diff-dir-chevron';
            chevron.innerHTML = iconHTML(collapsed ? 'chevron-right' : 'chevron-down');

            const nameEl = document.createElement('span');
            nameEl.className = 'diff-dir-name';
            nameEl.textContent = `${dir.name}/`;

            row.appendChild(chevron);
            row.appendChild(nameEl);
            row.onclick = () => {
                if (collapsed) diffCollapsedDirs.delete(dir.path);
                else diffCollapsedDirs.add(dir.path);
                renderDiffFileSidebar();
            };
            list.appendChild(row);

            if (!collapsed) appendDiffTreeNodes(list, dir, depth + 1);
        });

        sortedDiffTreeEntries(node.files).forEach(file => {
            const filename = diffEntryName(file.entry);
            const status = diffFileStatus(file.entry);
            const viewed = diffEntryIsViewed(file.entry);
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `diff-tree-row diff-file-item ${diffFileStatusClass(status)}${viewed ? ' viewed' : ''}`;
            item.style.paddingLeft = `${8 + depth * 14}px`;
            item.title = filename;
            if (file.index === diffIndex) {
                item.classList.add('active');
                item.setAttribute('aria-current', 'true');
            }

            const statusEl = document.createElement('span');
            statusEl.className = 'diff-file-status';
            statusEl.textContent = status;

            const viewedEl = document.createElement('span');
            viewedEl.className = 'diff-file-viewed-indicator';
            viewedEl.setAttribute('aria-hidden', 'true');
            if (viewed) {
                viewedEl.innerHTML = iconHTML('check');
                viewedEl.title = 'Viewed';
            }

            const nameEl = document.createElement('span');
            nameEl.className = 'diff-file-name';
            nameEl.textContent = file.name;

            item.appendChild(statusEl);
            item.appendChild(viewedEl);
            item.appendChild(nameEl);
            item.onclick = () => selectDiffFile(file.index);
            list.appendChild(item);
        });
    }

    function renderDiffFileSidebar() {
        const list = document.getElementById('diff-file-list');
        if (!list) return;
        list.innerHTML = '';
        expandActiveDiffFileParents();
        appendDiffTreeNodes(list, buildDiffFileTree(), 0);

        const activeItem = list.querySelector('.diff-file-item.active');
        if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
    }

    function selectDiffFile(index) {
        if (index === diffIndex || index < 0 || index >= diffFiles.length) return;
        diffIndex = index;
        navigateToLastChange = false;
        loadDiff(diffFiles[diffIndex]);
    }

    function loadDiffFilePanelCollapsedPreference() {
        try {
            return localStorage.getItem(DIFF_FILE_PANEL_COLLAPSED_KEY) === 'true';
        } catch {
            return false;
        }
    }

    function saveDiffFilePanelCollapsedPreference() {
        try {
            localStorage.setItem(DIFF_FILE_PANEL_COLLAPSED_KEY, diffFilePanelCollapsed ? 'true' : 'false');
        } catch {}
    }

    function updateDiffFilePanelState() {
        const main = document.getElementById('diff-modal-main');
        const toggle = document.getElementById('diff-file-panel-toggle');
        if (main) main.classList.toggle('diff-file-panel-collapsed', diffFilePanelCollapsed);
        if (!toggle) return;
        toggle.classList.toggle('collapsed', diffFilePanelCollapsed);
        toggle.innerHTML = iconHTML(diffFilePanelCollapsed ? 'chevron-right' : 'chevron-left');
        toggle.title = diffFilePanelCollapsed ? 'Show changed files' : 'Hide changed files';
        toggle.setAttribute('data-tooltip', toggle.title);
        toggle.setAttribute('aria-label', toggle.title);
        toggle.setAttribute('aria-expanded', diffFilePanelCollapsed ? 'false' : 'true');
    }

    function setDiffFilePanelCollapsed(collapsed) {
        diffFilePanelCollapsed = collapsed;
        updateDiffFilePanelState();
        saveDiffFilePanelCollapsedPreference();
        if (currentDiffEditor && currentDiffEditor.layout) {
            setTimeout(() => currentDiffEditor && currentDiffEditor.layout(), 180);
        }
    }

    function closeDiffModal() {
        diffRequestSequence += 1;
        document.getElementById('diff-modal').style.display = 'none';
        const list = document.getElementById('diff-file-list');
        if (list) list.innerHTML = '';
        disposeEditors();
        currentFileData = null;
        diffAllFiles = [];
        diffFiles = [];
        diffFileStatuses = {};
        diffProjectName = null;
        diffIndex = 0;
        diffChanges = [];
        diffChangeIndex = -1;
        navigateToLastChange = false;
        diffCollapsedDirs = new Set();
        diffTestsHidden = false;
        updateDiffViewedButton();
    }

    async function diffRevertCurrent() {
        if (!activeProject || diffFiles.length === 0) return;
        const entry = diffFiles[diffIndex];
        if (entry.kind !== 'local' || diffEntryReadOnly(entry)) return;
        const projectName = diffProjectName || activeProject;
        const requestSequence = diffRequestSequence;
        const file = entry.filename;
        const status = diffFileStatuses[file] || '';
        if (cancelDiffAutoSave) {
            cancelDiffAutoSave();
            cancelDiffAutoSave = null;
        }
        cancelActiveDiffSave();
        await fetch(`/api/projects/${encodeURIComponent(projectName)}/revert-file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file, status }),
        });
        if (requestSequence !== diffRequestSequence || diffProjectName !== projectName) return;
        if (activeProject === projectName) updateGitStatus();
        updateBadges();
        const allIndex = diffAllFiles.indexOf(entry);
        if (allIndex >= 0) diffAllFiles.splice(allIndex, 1);
        diffFiles.splice(diffIndex, 1);
        delete diffFileStatuses[file];
        if (diffFiles.length === 0) {
            if (diffTestsHidden && diffAllFiles.length > 0) {
                diffIndex = 0;
                showEmptyDiffFilterState();
                return;
            }
            closeDiffModal();
            return;
        }
        if (diffIndex >= diffFiles.length) diffIndex = diffFiles.length - 1;
        loadDiff(diffFiles[diffIndex]);
    }

    document.getElementById('diff-modal-backdrop').onclick = closeDiffModal;
    document.getElementById('diff-modal-close').onclick = closeDiffModal;
    document.getElementById('diff-file-panel-toggle').onclick = () => setDiffFilePanelCollapsed(!diffFilePanelCollapsed);
    document.getElementById('diff-modal-prev').onclick = () => diffNavigate(-1);
    document.getElementById('diff-modal-next').onclick = () => diffNavigate(1);
    document.getElementById('diff-viewed-toggle').onclick = () => toggleCurrentDiffViewed();
    document.getElementById('diff-revert-btn').onclick = () => diffRevertCurrent();
    document.getElementById('diff-save-btn').onclick = () => saveCurrentFile();
    document.getElementById('diff-tests-toggle').onclick = () => setDiffTestsHidden(!diffTestsHidden);
    document.getElementById('diff-blame-btn').onclick = () => toggleDiffBlame();
    document.getElementById('diff-change-prev').onclick = () => diffChangeNavigate(-1);
    document.getElementById('diff-change-next').onclick = () => diffChangeNavigate(1);
    document.getElementById('diff-view-toggle').onclick = () => {
        closeActiveDiffComment({ focusEditor: false });
        diffSideBySide = !diffSideBySide;
        document.getElementById('diff-view-toggle').textContent = diffSideBySide ? 'inline' : 'side-by-side';
        if (currentDiffEditor) {
            currentDiffEditor.updateOptions({ renderSideBySide: diffSideBySide });
        }
    };

    // ─── Editor Modal ────────────────────────────────────────────────
    // editorOpenFiles[path] is either
    //   { kind: 'text',  model, viewState, originalContent }
    //   { kind: 'image', mime, size }
    let editorOpenFiles = {};
    let editorActiveFile = null;
    let editorInstance = null;
    let editorFileTree = [];
    let editorIgnoredFilesShown = false;
    let editorFileTreeRequestSequence = 0;
    let editorSearchTimer = null;
    let editorDirtyFiles = new Set();
    let editorBlameEnabled = false;
    let editorBlameRequestSequence = 0;

    document.getElementById('git-editor-btn').onclick = () => openEditorModal();

    function editorFileIsDirty(path) {
        return !!(path && editorDirtyFiles.has(path));
    }

    function disableEditorBlame() {
        editorBlameEnabled = false;
        editorBlameRequestSequence++;
        clearEditorBlameDecorations();
        updateEditorBlameButton();
    }

    function updateEditorBlameButton() {
        const btn = document.getElementById('editor-blame-btn');
        if (!btn) return;
        const canBlame = !!(editorActiveFile && editorOpenFiles[editorActiveFile]?.kind === 'text');
        btn.style.display = canBlame ? '' : 'none';
        btn.classList.toggle('active', editorBlameEnabled && canBlame);
    }

    function updateEditorBlameStatus() {
        const el = document.getElementById('editor-status-blame');
        if (!el) return;
        if (!editorBlameEnabled || !editorInstance || !editorInstance.__gitBlameByLine) {
            el.textContent = '';
            el.title = '';
            return;
        }
        const position = editorInstance.getPosition && editorInstance.getPosition();
        const line = position && editorInstance.__gitBlameByLine.get(position.lineNumber);
        const status = formatBlameStatus(line);
        el.textContent = status;
        el.title = status;
    }

    function clearEditorBlameDecorations() {
        if (editorInstance) clearMonacoBlame(editorInstance);
        updateEditorBlameStatus();
    }

    async function loadEditorBlameForCurrentFile() {
        const path = editorActiveFile;
        const projectName = activeProject;
        const entry = path ? editorOpenFiles[path] : null;
        if (!editorBlameEnabled || !projectName || !path || !entry || entry.kind !== 'text' || !editorInstance || editorFileIsDirty(path)) {
            if (editorFileIsDirty(path)) editorBlameEnabled = false;
            clearEditorBlameDecorations();
            updateEditorBlameButton();
            return;
        }
        const modelState = monacoBlameModelState(editorInstance);
        if (!modelState.model) return;
        const requestSequence = ++editorBlameRequestSequence;
        updateEditorBlameButton();
        try {
            const data = await fetchFileBlame(projectName, path, 'working');
            if (
                requestSequence !== editorBlameRequestSequence
                || !editorBlameEnabled
                || activeProject !== projectName
                || editorActiveFile !== path
                || !editorInstance
                || !monacoBlameModelUnchanged(editorInstance, modelState)
            ) return;
            applyMonacoBlame(editorInstance, data.lines || []);
            updateEditorBlameStatus();
        } catch (err) {
            if (requestSequence !== editorBlameRequestSequence) return;
            editorBlameEnabled = false;
            clearEditorBlameDecorations();
            updateEditorBlameButton();
            showToast('Blame unavailable', (err && err.message) || 'Could not load git blame.', 'error', 3200);
        }
    }

    function toggleEditorBlame() {
        if (editorBlameEnabled) {
            disableEditorBlame();
            return;
        }
        if (editorFileIsDirty(editorActiveFile)) {
            showToast('Blame unavailable', 'Save the file before enabling blame.', 'info', 3200);
            disableEditorBlame();
            return;
        }
        editorBlameEnabled = true;
        updateEditorBlameButton();
        loadEditorBlameForCurrentFile();
    }

    async function editorOpenBlame(path) {
        const opened = await editorOpenFile(path);
        if (!opened || editorFileIsDirty(path)) {
            if (opened && editorFileIsDirty(path)) {
                showToast('Blame unavailable', 'Save the file before enabling blame.', 'info', 3200);
            }
            disableEditorBlame();
            return;
        }
        editorBlameEnabled = true;
        updateEditorBlameButton();
        loadEditorBlameForCurrentFile();
    }

    function openEditorModal() {
        if (!activeProject) return;
        editorIgnoredFilesShown = false;
        updateEditorIgnoredButton();
        const modal = document.getElementById('editor-modal');
        modal.style.display = 'flex';
        document.getElementById('editor-modal-title').textContent = 'Editor - ' + activeProject;
        loadFileTree();
    }

    function closeEditorModal() {
        document.getElementById('editor-modal').style.display = 'none';
        editorFileTreeRequestSequence++;
        editorIgnoredFilesShown = false;
        updateEditorIgnoredButton();
        editorBlameRequestSequence++;
        editorBlameEnabled = false;
        clearEditorBlameDecorations();
        // Clean up models
        Object.keys(editorOpenFiles).forEach(detachFindPreviewFromEditorModel);
        Object.values(editorOpenFiles).forEach(f => { if (f.model) f.model.dispose(); });
        editorOpenFiles = {};
        editorActiveFile = null;
        editorFileTree = [];
        editorDirtyFiles.clear();
        if (editorInstance) { editorInstance.dispose(); editorInstance = null; }
        document.getElementById('editor-tabs').innerHTML = '';
        document.getElementById('editor-body').innerHTML = '';
        document.getElementById('editor-tree').innerHTML = '';
        document.getElementById('editor-file-filter').value = '';
        document.getElementById('editor-status-blame').textContent = '';
    }

    document.getElementById('editor-modal-backdrop').onclick = closeEditorModal;
    document.getElementById('editor-modal-close').onclick = closeEditorModal;
    document.getElementById('editor-save-btn').onclick = () => editorSaveCurrentFile();
    document.getElementById('editor-blame-btn').onclick = () => toggleEditorBlame();
    document.getElementById('editor-ignored-toggle').onclick = () => {
        editorIgnoredFilesShown = !editorIgnoredFilesShown;
        updateEditorIgnoredButton();
        loadFileTree();
    };

    function updateEditorIgnoredButton() {
        const btn = document.getElementById('editor-ignored-toggle');
        if (!btn) return;
        btn.classList.toggle('active', editorIgnoredFilesShown);
        btn.textContent = editorIgnoredFilesShown ? 'hide ignored' : 'show ignored';
        btn.title = editorIgnoredFilesShown ? 'Hide ignored files' : 'Show ignored files';
        btn.setAttribute('aria-pressed', editorIgnoredFilesShown ? 'true' : 'false');
    }

    async function loadFileTree() {
        if (!activeProject) return;
        const projectName = activeProject;
        const requestSequence = ++editorFileTreeRequestSequence;
        const url = `/api/projects/${encodeURIComponent(projectName)}/tree`;
        try {
            const requests = [fetchJSON(url)];
            if (editorIgnoredFilesShown) requests.push(fetchJSON(`${url}?ignored=true`));
            const results = await Promise.all(requests);
            if (requestSequence !== editorFileTreeRequestSequence || activeProject !== projectName) return;
            gotoProjectFiles = results[0].files || [];
            gotoFileProject = projectName;
            const expandedDirs = new Set(Array.from(document.querySelectorAll('#editor-tree .editor-tree-dir:not(.collapsed)'), el => el.dataset.dir));
            editorFileTree = [...new Set(results.flatMap(data => data.files || []))];
            renderEditorTree(editorFileTree, expandedDirs);
        } catch {
            if (requestSequence !== editorFileTreeRequestSequence || activeProject !== projectName) return;
            editorFileTree = [];
            document.getElementById('editor-tree').innerHTML = '<div style="padding:8px;color:var(--red);font-size:11px">Failed to load files</div>';
        }
    }

    function buildTree(files) {
        const root = {};
        files.forEach(f => {
            const parts = f.split('/');
            let node = root;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!node[parts[i]]) node[parts[i]] = {};
                node = node[parts[i]];
            }
            node[parts[parts.length - 1]] = null; // null = file
        });
        return root;
    }

    function renderEditorTree(files, expandedDirs = new Set()) {
        const filter = document.getElementById('editor-file-filter').value.trim().toLowerCase();
        const tree = buildTree(filter ? files.filter(f => f.toLowerCase().includes(filter)) : files);
        const container = document.getElementById('editor-tree');
        container.innerHTML = '';
        renderTreeNode(container, tree, '', true, expandedDirs);
    }

    function renderTreeNode(container, node, prefix, collapsed, expandedDirs = new Set()) {
        // Sort: directories first, then files
        const entries = Object.entries(node);
        const dirs = entries.filter(([, v]) => v !== null).sort((a, b) => a[0].localeCompare(b[0]));
        const fileEntries = entries.filter(([, v]) => v === null).sort((a, b) => a[0].localeCompare(b[0]));

        dirs.forEach(([name, children]) => {
            const fullPath = prefix ? prefix + '/' + name : name;
            const dirEl = document.createElement('div');
            dirEl.className = 'editor-tree-dir' + (collapsed && !expandedDirs.has(fullPath) ? ' collapsed' : '');
            dirEl.dataset.dir = fullPath;
            dirEl.innerHTML = `<span class="arrow">${iconHTML('chevron-down')}</span>${esc(name)}/`;
            dirEl.onclick = (ev) => {
                ev.stopPropagation();
                if (!dirEl.classList.toggle('collapsed') && !childContainer.childElementCount) {
                    renderTreeNode(childContainer, children, fullPath, collapsed, expandedDirs);
                }
            };
            dirEl.oncontextmenu = (ev) => showEditorContextMenu(ev, 'dir', fullPath);
            container.appendChild(dirEl);

            const childContainer = document.createElement('div');
            childContainer.className = 'editor-tree-dir-children';
            childContainer.style.paddingLeft = '12px';
            if (!dirEl.classList.contains('collapsed')) {
                renderTreeNode(childContainer, children, fullPath, collapsed, expandedDirs);
            }
            container.appendChild(childContainer);
        });

        fileEntries.forEach(([name]) => {
            const fullPath = prefix ? prefix + '/' + name : name;
            const fileEl = document.createElement('div');
            fileEl.className = 'editor-tree-file';
            fileEl.textContent = name;
            fileEl.title = fullPath;
            fileEl.dataset.path = fullPath;
            if (fullPath === editorActiveFile) fileEl.classList.add('active');
            fileEl.onclick = () => editorOpenFile(fullPath);
            fileEl.oncontextmenu = (ev) => showEditorContextMenu(ev, 'file', fullPath);
            container.appendChild(fileEl);
        });
    }

    // Expand parent directories of a file and scroll to it in the tree
    function revealFileInTree(filePath) {
        if (!filePath) return;
        const parts = filePath.split('/');
        // Expand each parent directory
        let dirPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
            dirPath = dirPath ? dirPath + '/' + parts[i] : parts[i];
            const dirEl = document.querySelector(`#editor-tree .editor-tree-dir[data-dir="${dirPath}"]`);
            if (dirEl && dirEl.classList.contains('collapsed')) dirEl.click();
        }
        // Scroll to the file
        const fileEl = document.querySelector(`#editor-tree .editor-tree-file[data-path="${filePath}"]`);
        if (fileEl) {
            fileEl.scrollIntoView({ block: 'nearest' });
        }
    }

    // Right-click on empty area of tree panel = new file at root
    document.getElementById('editor-tree-panel').addEventListener('contextmenu', (ev) => {
        if (ev.target.id === 'editor-tree-panel' || ev.target.id === 'editor-tree') {
            showEditorContextMenu(ev, 'dir', '');
        }
    });

    // File filter
    document.getElementById('editor-file-filter').addEventListener('input', (ev) => {
        const filter = ev.target.value.trim().toLowerCase();
        if (!filter) {
            renderEditorTree(editorFileTree);
            return;
        }
        const filtered = editorFileTree.filter(f => f.toLowerCase().includes(filter));
        // When filtering, show dirs expanded
        const tree = buildTree(filtered);
        const container = document.getElementById('editor-tree');
        container.innerHTML = '';
        renderTreeNode(container, tree, '', false);
    });

    async function editorOpenFile(path, line) {
        if (!activeProject) return false;

        // If already open, just switch to it
        if (editorOpenFiles[path]) {
            editorSwitchTab(path, line);
            return editorOpenFiles[path].kind === 'text';
        }

        return new Promise(resolve => {
            ensureMonaco(async () => {
            try {
                const data = await fetchJSON(
                    `/api/projects/${encodeURIComponent(activeProject)}/file?path=${encodeURIComponent(path)}`
                );
                if (data.type === 'image') {
                    const size = data.modifiedExists ? data.modifiedSize : data.originalSize;
                    editorOpenFiles[path] = { kind: 'image', mime: data.mime || '', size: size || 0 };
                    renderEditorTabs();
                    editorSwitchTab(path);
                    resolve(false);
                    return;
                }
                if (data.type && data.type !== 'text') {
                    showToast('Editor unavailable', `Cannot open ${path}: file is ${data.type}.`, 'error', 4200);
                    resolve(false);
                    return;
                }
                const content = data.modified !== undefined ? data.modified : data.original || '';
                const lang = getLangFromFile(path);
                const model = monaco.editor.createModel(content, lang);

                // Track dirty state
                model.onDidChangeContent(() => {
                    editorDirtyFiles.add(path);
                    if (editorBlameEnabled && editorActiveFile === path && editorInstance && editorInstance.getModel() === model) {
                        disableEditorBlame();
                    }
                    renderEditorTabs();
                });

                editorOpenFiles[path] = { kind: 'text', model, viewState: null, originalContent: content };
                renderEditorTabs();
                editorSwitchTab(path, line);
                resolve(true);
            } catch {
                resolve(false);
            }
            });
        });
    }

    function editorSwitchTab(path, line) {
        const entry = editorOpenFiles[path];
        if (!entry) return;

        // Save current view state when leaving a text file
        const leavingEntry = editorActiveFile ? editorOpenFiles[editorActiveFile] : null;
        if (leavingEntry && leavingEntry.kind === 'text' && editorInstance) {
            leavingEntry.viewState = editorInstance.saveViewState();
        }

        editorActiveFile = path;
        const body = document.getElementById('editor-body');
        const saveBtn = document.getElementById('editor-save-btn');
        const statusPos = document.getElementById('editor-status-pos');
        const statusLang = document.getElementById('editor-status-lang');

        // Always remove any existing image preview before switching
        const stalePreview = body.querySelector('.editor-image-preview');
        if (stalePreview) stalePreview.remove();

        if (entry.kind === 'image') {
            if (saveBtn) saveBtn.style.display = 'none';
            clearEditorBlameDecorations();
            updateEditorBlameButton();
            // Hide Monaco (if any) while image is shown
            const editorNode = editorInstance && editorInstance.getDomNode();
            if (editorNode) editorNode.style.visibility = 'hidden';

            const preview = buildEditorImagePreview(path, entry);
            body.appendChild(preview);

            statusPos.textContent = '';
            const ext = (path.split('.').pop() || '').toLowerCase();
            statusLang.textContent = ext === 'svg' ? 'svg' : 'image';

            renderEditorTabs();
            updateEditorTreeActive();
            return;
        }

        // Text path
        if (saveBtn) saveBtn.style.display = '';

        if (!editorInstance) {
            body.innerHTML = '';
            editorInstance = monaco.editor.create(body, {
                model: entry.model,
                theme: getMonacoThemeName(),
                automaticLayout: true,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
                wordWrap: 'off',
                renderLineHighlight: 'all',
                lineNumbers: 'on',
                glyphMargin: false,
                folding: true,
                bracketPairColorization: { enabled: true },
            });

            // Ctrl+S save — scoped to this editor so it doesn't leak into other
            // Monaco instances via the shared global keybinding service.
            const editorScope = 'plainEditorFocused';
            editorInstance.createContextKey(editorScope, true);
            editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                editorSaveCurrentFile();
            }, editorScope);

            // Track cursor position
            editorInstance.onDidChangeCursorPosition((e) => {
                const pos = e.position;
                document.getElementById('editor-status-pos').textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
                updateEditorBlameStatus();
            });
        } else {
            editorInstance.setModel(entry.model);
        }
        editorInstance.getDomNode().style.visibility = '';

        // Restore view state
        if (entry.viewState) {
            editorInstance.restoreViewState(entry.viewState);
        }

        // Go to line if specified
        if (line) {
            editorInstance.revealLineInCenter(line);
            editorInstance.setPosition({ lineNumber: line, column: 1 });
        }

        editorInstance.focus();

        // Update language in status bar
        const lang = getLangFromFile(path);
        statusLang.textContent = lang;
        updateEditorBlameButton();
        clearEditorBlameDecorations();
        if (editorBlameEnabled) loadEditorBlameForCurrentFile();

        renderEditorTabs();
        updateEditorTreeActive();
    }

    function buildEditorImagePreview(path, entry) {
        const wrap = document.createElement('div');
        wrap.className = 'editor-image-preview';

        const header = document.createElement('div');
        header.className = 'editor-image-preview-header';
        const name = document.createElement('span');
        name.className = 'editor-image-preview-name';
        name.textContent = path;
        const meta = document.createElement('span');
        meta.className = 'editor-image-preview-meta';
        const sizeText = entry.size ? formatBytes(entry.size) : '';
        meta.textContent = sizeText;

        const stage = document.createElement('div');
        stage.className = 'editor-image-preview-stage';
        const img = document.createElement('img');
        img.alt = path;
        img.onload = () => {
            if (img.naturalWidth && img.naturalHeight) {
                const dim = `${img.naturalWidth} × ${img.naturalHeight}`;
                meta.textContent = sizeText ? `${dim} • ${sizeText}` : dim;
            }
        };
        img.onerror = () => {
            stage.innerHTML = '';
            const err = document.createElement('div');
            err.className = 'editor-image-preview-error';
            err.textContent = 'Image not available';
            stage.appendChild(err);
        };
        stage.appendChild(img);
        const zoomControls = buildImageZoomControls(stage, img);
        const details = document.createElement('div');
        details.className = 'editor-image-preview-details';
        details.appendChild(meta);
        details.appendChild(zoomControls);
        header.appendChild(name);
        header.appendChild(details);
        img.src = `/api/projects/${encodeURIComponent(activeProject)}/file/blob`
            + `?path=${encodeURIComponent(path)}&ref=working&t=${Date.now()}`;

        wrap.appendChild(header);
        wrap.appendChild(stage);
        return wrap;
    }

    function renderEditorTabs() {
        const tabBar = document.getElementById('editor-tabs');
        tabBar.innerHTML = '';
        Object.keys(editorOpenFiles).forEach(path => {
            const tab = document.createElement('div');
            tab.className = 'editor-tab' + (path === editorActiveFile ? ' active' : '');
            if (editorDirtyFiles.has(path)) tab.classList.add('dirty');

            const name = document.createElement('span');
            name.className = 'editor-tab-name';
            name.textContent = path.split('/').pop();
            name.title = path;
            tab.appendChild(name);

            const close = document.createElement('span');
            close.className = 'editor-tab-close';
            close.innerHTML = iconHTML('x');
            close.onclick = (ev) => {
                ev.stopPropagation();
                editorCloseTab(path);
            };
            tab.appendChild(close);

            tab.onclick = () => editorSwitchTab(path);
            tabBar.appendChild(tab);
        });
    }

    function editorCloseTab(path) {
        const entry = editorOpenFiles[path];
        if (entry) {
            if (entry.kind === 'text') {
                detachFindPreviewFromEditorModel(path);
                entry.model.dispose();
            }
            delete editorOpenFiles[path];
            editorDirtyFiles.delete(path);
        }

        const body = document.getElementById('editor-body');
        const remaining = Object.keys(editorOpenFiles);
        if (remaining.length === 0) {
            editorActiveFile = null;
            if (editorInstance) { editorInstance.dispose(); editorInstance = null; }
            body.innerHTML = '';
            document.getElementById('editor-status-pos').textContent = '';
            document.getElementById('editor-status-blame').textContent = '';
            document.getElementById('editor-status-lang').textContent = '';
            const saveBtn = document.getElementById('editor-save-btn');
            if (saveBtn) saveBtn.style.display = '';
            updateEditorBlameButton();
        } else if (path === editorActiveFile) {
            editorSwitchTab(remaining[remaining.length - 1]);
        } else {
            // Active tab unchanged; just clean up any stale image preview if the closed tab was the image one
            const stalePreview = body.querySelector('.editor-image-preview');
            if (stalePreview && editorActiveFile && editorOpenFiles[editorActiveFile]?.kind !== 'image') {
                stalePreview.remove();
            }
        }
        renderEditorTabs();
        updateEditorTreeActive();
    }

    function updateEditorTreeActive() {
        document.querySelectorAll('#editor-tree .editor-tree-file').forEach(el => {
            el.classList.toggle('active', el.dataset.path === editorActiveFile);
        });
        revealFileInTree(editorActiveFile);
    }

    // ─── Editor Context Menu (New File / Rename / Delete) ────────
    let contextTarget = null; // { type: 'file'|'dir', path: string }

    function showEditorContextMenu(ev, type, path) {
        ev.preventDefault();
        ev.stopPropagation();
        contextTarget = { type, path };
        const menu = document.getElementById('editor-context-menu');
        menu.style.left = ev.clientX + 'px';
        menu.style.top = ev.clientY + 'px';
        menu.style.display = 'block';

        // Show/hide items based on target type
        menu.querySelector('[data-action="blame"]').style.display = type === 'file' ? '' : 'none';
        menu.querySelector('[data-action="rename"]').style.display = type === 'file' ? '' : 'none';
        menu.querySelector('[data-action="delete"]').style.display = type === 'file' ? '' : 'none';
    }

    document.addEventListener('mousedown', (ev) => {
        const menu = document.getElementById('editor-context-menu');
        if (menu.style.display !== 'none' && !menu.contains(ev.target)) {
            menu.style.display = 'none';
        }
    });

    document.getElementById('editor-context-menu').addEventListener('click', (ev) => {
        const item = ev.target.closest('.editor-context-item');
        if (!item) return;
        document.getElementById('editor-context-menu').style.display = 'none';
        if (!contextTarget || !activeProject) return;
        const action = item.dataset.action;
        if (action === 'new-file') editorNewFile(contextTarget);
        else if (action === 'blame') editorOpenBlame(contextTarget.path);
        else if (action === 'rename') editorRenameFile(contextTarget.path);
        else if (action === 'delete') editorDeleteFile(contextTarget.path);
    });

    async function editorNewFile(target) {
        const dirPath = target.type === 'dir' ? target.path : target.path.substring(0, target.path.lastIndexOf('/'));
        const name = await requestTextInput({
            title: 'New file name',
            subtitle: dirPath ? `${dirPath}/` : activeProject,
            submitLabel: 'Create',
        });
        if (!name || !name.trim()) return;
        const newPath = dirPath ? dirPath + '/' + name.trim() : name.trim();

        fetch(`/api/projects/${encodeURIComponent(activeProject)}/file/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: newPath, content: '' }),
        }).then(r => {
            if (!r.ok) throw new Error('Failed to create file');
            loadFileTree();
            editorOpenFile(newPath);
        }).catch(() => {});
    }

    async function editorRenameFile(oldPath) {
        const parts = oldPath.split('/');
        const oldName = parts.pop();
        const dir = parts.join('/');
        const newName = await requestTextInput({
            title: 'Rename file',
            subtitle: oldPath,
            defaultValue: oldName,
            submitLabel: 'Rename',
        });
        if (!newName || !newName.trim() || newName.trim() === oldName) return;
        const newPath = dir ? dir + '/' + newName.trim() : newName.trim();

        fetch(`/api/projects/${encodeURIComponent(activeProject)}/file/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
        }).then(r => {
            if (!r.ok) throw new Error('Failed to rename file');
            // Update open tabs
            if (editorOpenFiles[oldPath]) {
                editorOpenFiles[newPath] = editorOpenFiles[oldPath];
                delete editorOpenFiles[oldPath];
                if (editorDirtyFiles.has(oldPath)) {
                    editorDirtyFiles.delete(oldPath);
                    editorDirtyFiles.add(newPath);
                }
                if (editorActiveFile === oldPath) {
                    editorActiveFile = newPath;
                    // Image previews cache the URL by path; force a re-render.
                    if (editorOpenFiles[newPath]?.kind === 'image') {
                        editorActiveFile = null;
                        editorSwitchTab(newPath);
                    }
                }
                renderEditorTabs();
            }
            loadFileTree();
            updateGitStatus();
            updateBadges();
        }).catch(() => {});
    }

    async function editorDeleteFile(path) {
        if (!(await appConfirm(`Delete "${path}"?`))) return;

        fetch(`/api/projects/${encodeURIComponent(activeProject)}/file/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        }).then(r => {
            if (!r.ok) throw new Error('Failed to delete file');
            // Close tab if open
            if (editorOpenFiles[path]) editorCloseTab(path);
            loadFileTree();
            updateGitStatus();
            updateBadges();
        }).catch(() => {});
    }

    async function editorSaveCurrentFile() {
        if (!editorActiveFile || !activeProject || !editorInstance) return;
        const path = editorActiveFile;
        const openFile = editorOpenFiles[path];
        if (!openFile || openFile.kind !== 'text') return;
        const model = openFile.model;
        const content = model.getValue();
        try {
            const res = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content }),
            });
            if (!res.ok) throw new Error('Failed to save file');
            if (editorOpenFiles[path]) {
                editorOpenFiles[path].originalContent = content;
                if (editorOpenFiles[path].model.getValue() === content) {
                    editorDirtyFiles.delete(path);
                } else {
                    editorDirtyFiles.add(path);
                }
            }
            if (findPreviewFile === path && findPreviewEditor && findPreviewEditor.getModel() === model) {
                findPreviewDirty = findPreviewEditor.getValue() !== content;
                updateFindPreviewHeader(path);
            }
            renderEditorTabs();
            updateGitStatus();
            updateBadges();
            if (editorBlameEnabled) loadEditorBlameForCurrentFile();
        } catch {
            // ignore
        }
    }

    // ─── Find in Files Modal (Ctrl+Shift+F) ────────────────────────
    const searchOpts = { caseSensitive: false, wholeWord: false, regex: false };
    let findSearchTimer = null;
    let findPreviewEditor = null;
    let findPreviewChangeDisposable = null;
    let findPreviewOwnsModel = false;
    let findPreviewFile = null;
    let findPreviewDirty = false;
    let findPreviewSaving = false;
    let findPreviewRequestId = 0;
    let findResults = [];
    let findActiveIdx = -1;

    function openFindModal() {
        if (!activeProject) return;
        document.getElementById('find-modal').style.display = 'flex';
        document.getElementById('find-modal-title').textContent = 'Find in Files \u2014 ' + activeProject;
        document.getElementById('find-search-input').focus();
    }

    async function closeFindModal() {
        if (!(await confirmDiscardFindPreviewChanges())) return false;
        document.getElementById('find-modal').style.display = 'none';
        findPreviewRequestId++;
        disposeFindPreviewEditor();
        document.getElementById('find-preview-body').innerHTML = '';
        document.getElementById('find-preview-header').innerHTML = '';
        document.getElementById('find-results-list').innerHTML = '';
        document.getElementById('find-modal-summary').textContent = '';
        findResults = [];
        findActiveIdx = -1;
        return true;
    }

    document.getElementById('find-modal-backdrop').onclick = closeFindModal;
    document.getElementById('find-modal-close').onclick = closeFindModal;

    // Draggable resizer between results and preview
    (function () {
        const resizer = document.getElementById('find-preview-resizer');
        const panel = document.getElementById('find-preview-panel');
        const body = document.getElementById('find-modal-body');
        let startY, startH;

        resizer.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            startY = ev.clientY;
            startH = panel.offsetHeight;
            resizer.classList.add('dragging');
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', onUp);
        });

        function onDrag(ev) {
            const delta = startY - ev.clientY;
            const newH = Math.max(80, Math.min(startH + delta, body.offsetHeight - 80));
            panel.style.height = newH + 'px';
        }

        function onUp() {
            resizer.classList.remove('dragging');
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', onUp);
            // Re-layout monaco if preview editor exists
            if (findPreviewEditor) findPreviewEditor.layout();
        }
    })();

    // Search toggles
    document.getElementById('search-toggle-case').onclick = function() {
        searchOpts.caseSensitive = !searchOpts.caseSensitive;
        this.classList.toggle('active', searchOpts.caseSensitive);
        triggerFindSearch();
    };
    document.getElementById('search-toggle-word').onclick = function() {
        searchOpts.wholeWord = !searchOpts.wholeWord;
        this.classList.toggle('active', searchOpts.wholeWord);
        triggerFindSearch();
    };
    document.getElementById('search-toggle-regex').onclick = function() {
        searchOpts.regex = !searchOpts.regex;
        this.classList.toggle('active', searchOpts.regex);
        triggerFindSearch();
    };

    const findSearchInput = document.getElementById('find-search-input');
    const findInclude = document.getElementById('find-include');
    const findExclude = document.getElementById('find-exclude');

    function clearFindResults() {
        document.getElementById('find-results-list').innerHTML = '';
        document.getElementById('find-modal-summary').textContent = '';
        findResults = [];
        findActiveIdx = -1;
    }

    function triggerFindSearch() {
        clearTimeout(findSearchTimer);
        const query = findSearchInput.value.trim();
        if (!query || query.length < 2) {
            findPreviewRequestId++;
            clearFindResults();
            if (hasFindPreviewUnsavedChanges()) {
                updateFindPreviewHeader(findPreviewFile);
                return;
            }
            document.getElementById('find-preview-header').innerHTML = '';
            document.getElementById('find-preview-body').innerHTML = '';
            disposeFindPreviewEditor();
            return;
        }
        findSearchTimer = setTimeout(() => runFindSearch(query), 300);
    }

    findSearchInput.addEventListener('input', triggerFindSearch);
    findInclude.addEventListener('input', triggerFindSearch);
    findExclude.addEventListener('input', triggerFindSearch);

    findSearchInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            clearTimeout(findSearchTimer);
            const query = findSearchInput.value.trim();
            if (query) runFindSearch(query);
        }
        if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            if (findResults.length > 0) selectFindResult(Math.min(findActiveIdx + 1, findResults.length - 1), { prompt: false });
        }
        if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            if (findResults.length > 0) selectFindResult(Math.max(findActiveIdx - 1, 0), { prompt: false });
        }
    });

    function highlightMatches(text, query, caseSensitive, useRegex) {
        const escaped = esc(text);
        try {
            let pattern;
            if (useRegex) {
                pattern = query;
            } else {
                pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }
            const flags = caseSensitive ? 'g' : 'gi';
            const re = new RegExp(`(${pattern})`, flags);
            return escaped.replace(re, '<span class="search-highlight">$1</span>');
        } catch {
            return escaped;
        }
    }

    async function runFindSearch(query) {
        if (!activeProject) return;
        try {
            const params = new URLSearchParams({ q: query });
            if (searchOpts.caseSensitive) params.set('caseSensitive', 'true');
            if (searchOpts.wholeWord) params.set('wholeWord', 'true');
            if (searchOpts.regex) params.set('regex', 'true');
            const include = findInclude.value.trim();
            const exclude = findExclude.value.trim();
            if (include) params.set('include', include);
            if (exclude) params.set('exclude', exclude);

            const data = await fetchJSON(
                `/api/projects/${encodeURIComponent(activeProject)}/search?${params}`
            );
            findResults = data.results || [];
            const list = document.getElementById('find-results-list');
            list.innerHTML = '';

            const totalFiles = new Set(findResults.map(r => r.file)).size;
            document.getElementById('find-modal-summary').textContent = findResults.length === 0
                ? 'No results'
                : `${findResults.length} match${findResults.length !== 1 ? 'es' : ''} in ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`;

            findResults.forEach((r, idx) => {
                const item = document.createElement('div');
                item.className = 'find-result-item';
                const highlighted = highlightMatches(r.content, query, searchOpts.caseSensitive, searchOpts.regex);
                const fileName = r.file.split('/').pop();
                item.innerHTML = `<span class="find-result-content">${highlighted}</span><span class="find-result-file"><span class="find-result-filename">${esc(fileName)}</span> <span class="find-result-line">${r.line}</span></span>`;
                item.onclick = () => selectFindResult(idx);
                item.ondblclick = async () => {
                    if (!(await closeFindModal())) return;
                    openEditorModal();
                    // small delay for editor modal to init
                    setTimeout(() => editorOpenFile(r.file, r.line), 100);
                };
                list.appendChild(item);
            });

            findActiveIdx = -1;
            if (findResults.length > 0) selectFindResult(0, { prompt: false });
        } catch {
            // ignore
        }
    }

    function updateFindActiveResult(idx) {
        findActiveIdx = idx;
        const items = document.querySelectorAll('.find-result-item');
        items.forEach((el, i) => el.classList.toggle('active', i === idx));
        // Scroll active into view
        if (items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
    }

    async function selectFindResult(idx, options = {}) {
        if (idx < 0 || idx >= findResults.length) return;
        const shouldPrompt = options.prompt !== false;
        if (findPreviewFile && findPreviewFile !== findResults[idx].file && hasFindPreviewUnsavedChanges()) {
            if (!shouldPrompt) {
                updateFindActiveResult(idx);
                return;
            }
            if (!(await confirmDiscardFindPreviewChanges())) return;
        }
        updateFindActiveResult(idx);
        // Show preview
        showFindPreview(findResults[idx]);
    }

    function disposeFindPreviewEditor() {
        if (findPreviewChangeDisposable) {
            findPreviewChangeDisposable.dispose();
            findPreviewChangeDisposable = null;
        }
        if (findPreviewEditor) {
            const model = findPreviewEditor.getModel();
            findPreviewEditor.dispose();
            if (findPreviewOwnsModel && model) model.dispose();
            findPreviewEditor = null;
        }
        findPreviewOwnsModel = false;
        findPreviewFile = null;
        findPreviewDirty = false;
        findPreviewSaving = false;
    }

    function detachFindPreviewFromEditorModel(path) {
        if (!findPreviewEditor || findPreviewFile !== path || !editorOpenFiles[path]) return;
        const sharedModel = editorOpenFiles[path].model;
        if (!sharedModel || findPreviewEditor.getModel() !== sharedModel) return;

        const detachedModel = monaco.editor.createModel(sharedModel.getValue(), getLangFromFile(path));
        if (findPreviewChangeDisposable) {
            findPreviewChangeDisposable.dispose();
            findPreviewChangeDisposable = null;
        }
        findPreviewEditor.setModel(detachedModel);
        findPreviewOwnsModel = true;
        findPreviewChangeDisposable = detachedModel.onDidChangeContent(() => {
            findPreviewDirty = true;
            updateFindPreviewHeader(path);
        });
    }

    function hasFindPreviewUnsavedChanges() {
        return !!(findPreviewEditor && findPreviewFile && findPreviewDirty);
    }

    async function confirmDiscardFindPreviewChanges() {
        if (!hasFindPreviewUnsavedChanges()) return true;
        return appConfirm(`Discard unsaved changes to "${findPreviewFile}"?`);
    }

    function updateFindPreviewHeader(filePath, canSave = !!findPreviewEditor) {
        const fileName = filePath.split('/').pop();
        const dirPath = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '';
        const status = findPreviewSaving ? 'saving' : (findPreviewDirty ? 'modified' : '');
        const saveClass = findPreviewDirty && !findPreviewSaving ? '' : ' disabled';
        const saveShortcut = formatShortcut([PRIMARY_MODIFIER_LABEL, 'S']);

        document.getElementById('find-preview-header').innerHTML =
            `<span class="preview-file">${esc(fileName)}</span>` +
            `<span class="preview-dir">${esc(dirPath)}</span>` +
            (status ? `<span class="preview-status">${status}</span>` : '') +
            (canSave ? `<span id="find-preview-save" class="${saveClass}" title="Save (${esc(saveShortcut)})">save</span>` : '');

        const saveBtn = document.getElementById('find-preview-save');
        if (saveBtn) saveBtn.onclick = () => saveFindPreviewFile();
    }

    async function saveFindPreviewFile() {
        if (!activeProject || !findPreviewEditor || !findPreviewFile || findPreviewSaving) return;
        const path = findPreviewFile;
        const previewModel = findPreviewEditor.getModel();
        const content = findPreviewEditor.getValue();

        findPreviewSaving = true;
        updateFindPreviewHeader(path);
        try {
            const res = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content }),
            });
            if (!res.ok) throw new Error('Failed to save file');

            if (editorOpenFiles[path]) {
                const openFile = editorOpenFiles[path];
                if (openFile.model !== previewModel && !editorDirtyFiles.has(path)) {
                    openFile.model.setValue(content);
                }
                if (openFile.model.getValue() === content) {
                    editorDirtyFiles.delete(path);
                } else {
                    editorDirtyFiles.add(path);
                }
                openFile.originalContent = content;
                renderEditorTabs();
            }

            if (findPreviewFile === path && findPreviewEditor && findPreviewEditor.getModel() === previewModel) {
                findPreviewDirty = findPreviewEditor.getValue() !== content;
            }
            updateGitStatus();
            updateBadges();
        } catch {
            // ignore
        } finally {
            findPreviewSaving = false;
            if (findPreviewFile === path) updateFindPreviewHeader(path);
        }
    }

    function showFindPreview(result) {
        if (!activeProject || !result) return;

        if (findPreviewEditor && findPreviewFile === result.file) {
            updateFindPreviewHeader(result.file);
            findPreviewEditor.revealLineInCenter(result.line);
            findPreviewEditor.setPosition({ lineNumber: result.line, column: 1 });
            return;
        }

        const previewRequestId = ++findPreviewRequestId;
        const previewProject = activeProject;
        updateFindPreviewHeader(result.file, false);

        ensureMonaco(async () => {
            try {
                const data = await fetchJSON(
                    `/api/projects/${encodeURIComponent(previewProject)}/file?path=${encodeURIComponent(result.file)}`
                );
                if (previewRequestId !== findPreviewRequestId || previewProject !== activeProject) return;
                const container = document.getElementById('find-preview-body');
                disposeFindPreviewEditor();
                if (data.type && data.type !== 'text') {
                    updateFindPreviewHeader(result.file, false);
                    container.innerHTML = `<div style="padding:12px 16px;color:var(--comment)">Preview unavailable (${esc(data.type)} file)</div>`;
                    return;
                }
                const content = data.modified !== undefined ? data.modified : data.original || '';
                const lang = getLangFromFile(result.file);
                const openFile = editorOpenFiles[result.file];
                const model = openFile
                    ? openFile.model
                    : monaco.editor.createModel(content, lang);
                container.innerHTML = '';
                findPreviewFile = result.file;
                findPreviewOwnsModel = !openFile;
                findPreviewDirty = !!(openFile && editorDirtyFiles.has(result.file));

                findPreviewEditor = monaco.editor.create(container, {
                    model,
                    theme: getMonacoThemeName(),
                    automaticLayout: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
                    lineNumbers: 'on',
                    glyphMargin: false,
                    folding: false,
                    renderLineHighlight: 'all',
                    overviewRulerLanes: 0,
                    scrollbar: { verticalScrollbarSize: 6 },
                });

                findPreviewChangeDisposable = model.onDidChangeContent(() => {
                    findPreviewDirty = true;
                    updateFindPreviewHeader(result.file);
                });
                // Scope Ctrl+S to this editor so it doesn't leak into other
                // Monaco instances via the shared global keybinding service.
                const findPreviewScope = 'findPreviewEditorFocused';
                findPreviewEditor.createContextKey(findPreviewScope, true);
                findPreviewEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                    saveFindPreviewFile();
                }, findPreviewScope);
                updateFindPreviewHeader(result.file);
                findPreviewEditor.revealLineInCenter(result.line);
                findPreviewEditor.setPosition({ lineNumber: result.line, column: 1 });
            } catch {
                // ignore
            }
        });
    }

    // ─── Go to File (Ctrl+Shift+N) ─────────────────────────────────
    let gotoProjectFiles = [];
    let gotoFileList = [];
    let gotoActiveIdx = -1;

    let gotoFileProject = null; // which project the cached tree belongs to

    function openGotoFile() {
        if (!activeProject) return;
        document.getElementById('goto-file-overlay').style.display = 'flex';
        const input = document.getElementById('goto-file-input');
        input.value = '';
        input.focus();
        gotoActiveIdx = -1;

        // Use cache if it's for the current project
        if (gotoProjectFiles.length > 0 && gotoFileProject === activeProject) {
            renderGotoFileList('');
        } else {
            document.getElementById('goto-file-list').innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:12px">Loading...</div>';
            fetchJSON(`/api/projects/${encodeURIComponent(activeProject)}/tree`).then(data => {
                gotoProjectFiles = data.files || [];
                gotoFileProject = activeProject;
                renderGotoFileList('');
            }).catch(() => {});
        }
    }

    function closeGotoFile() {
        document.getElementById('goto-file-overlay').style.display = 'none';
        document.getElementById('goto-file-list').innerHTML = '';
    }

    document.getElementById('goto-file-backdrop').onclick = closeGotoFile;

    document.getElementById('goto-file-input').addEventListener('input', (ev) => {
        const filter = ev.target.value.trim().toLowerCase();
        renderGotoFileList(filter);
    });

    document.getElementById('goto-file-input').addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            closeGotoFile();
            return;
        }
        const items = document.querySelectorAll('.goto-file-item');
        if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            gotoActiveIdx = Math.min(gotoActiveIdx + 1, items.length - 1);
            updateGotoActive(items);
        }
        if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            gotoActiveIdx = Math.max(gotoActiveIdx - 1, 0);
            updateGotoActive(items);
        }
        if (ev.key === 'Enter') {
            ev.preventDefault();
            if (gotoActiveIdx >= 0 && gotoActiveIdx < gotoFileList.length) {
                const file = gotoFileList[gotoActiveIdx];
                closeGotoFile();
                // If editor modal is open, open file there; otherwise open editor
                if (document.getElementById('editor-modal').style.display !== 'none') {
                    editorOpenFile(file);
                } else {
                    openEditorModal();
                    setTimeout(() => editorOpenFile(file), 100);
                }
            }
        }
    });

    function updateGotoActive(items) {
        items.forEach((el, i) => el.classList.toggle('active', i === gotoActiveIdx));
        if (items[gotoActiveIdx]) items[gotoActiveIdx].scrollIntoView({ block: 'nearest' });
    }

    function renderGotoFileList(filter) {
        const list = document.getElementById('goto-file-list');
        list.innerHTML = '';
        gotoFileList = [];
        gotoActiveIdx = -1;

        let files = gotoProjectFiles;
        if (filter) {
            // Fuzzy-ish: match files containing all filter parts
            const parts = filter.split(/\s+/);
            files = files.filter(f => parts.every(p => f.toLowerCase().includes(p)));
        }

        // Limit display
        const show = files.slice(0, 80);
        gotoFileList = show;

        show.forEach((file, idx) => {
            const item = document.createElement('div');
            item.className = 'goto-file-item';
            const name = file.split('/').pop();
            const dir = file.includes('/') ? file.substring(0, file.lastIndexOf('/')) : '';
            item.innerHTML = `<span class="goto-file-name">${esc(name)}</span><span class="goto-file-path">${esc(dir)}</span>`;
            item.onclick = () => {
                closeGotoFile();
                if (document.getElementById('editor-modal').style.display !== 'none') {
                    editorOpenFile(file);
                } else {
                    openEditorModal();
                    setTimeout(() => editorOpenFile(file), 100);
                }
            };
            list.appendChild(item);
        });

        if (show.length > 0) {
            gotoActiveIdx = 0;
            list.children[0].classList.add('active');
        }
    }

    // ─── Go to Project (Ctrl+Shift+M) ───────────────────────────────
    let gotoProjectList = [];
    let gotoProjectActiveIdx = -1;

    function openGotoProject() {
        document.getElementById('goto-project-overlay').style.display = 'flex';
        const input = document.getElementById('goto-project-input');
        input.value = '';
        input.focus();
        gotoProjectActiveIdx = -1;
        renderGotoProjectList('');
    }

    function closeGotoProject() {
        document.getElementById('goto-project-overlay').style.display = 'none';
        document.getElementById('goto-project-list').innerHTML = '';
    }

    document.getElementById('goto-project-backdrop').onclick = closeGotoProject;

    document.getElementById('goto-project-input').addEventListener('input', (ev) => {
        const filter = ev.target.value.trim().toLowerCase();
        renderGotoProjectList(filter);
    });

    document.getElementById('goto-project-input').addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            closeGotoProject();
            return;
        }
        const items = document.querySelectorAll('.goto-project-item');
        if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            gotoProjectActiveIdx = Math.min(gotoProjectActiveIdx + 1, items.length - 1);
            updateGotoProjectActive(items);
        }
        if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            gotoProjectActiveIdx = Math.max(gotoProjectActiveIdx - 1, 0);
            updateGotoProjectActive(items);
        }
        if (ev.key === 'Enter') {
            ev.preventDefault();
            if (gotoProjectActiveIdx >= 0 && gotoProjectActiveIdx < gotoProjectList.length) {
                const proj = gotoProjectList[gotoProjectActiveIdx];
                closeGotoProject();
                switchProject(proj.name);
            }
        }
    });

    function updateGotoProjectActive(items) {
        items.forEach((el, i) => el.classList.toggle('active', i === gotoProjectActiveIdx));
        if (items[gotoProjectActiveIdx]) items[gotoProjectActiveIdx].scrollIntoView({ block: 'nearest' });
    }

    function renderGotoProjectList(filter) {
        const list = document.getElementById('goto-project-list');
        list.innerHTML = '';
        gotoProjectList = [];
        gotoProjectActiveIdx = -1;

        let sorted = sortedProjects();
        if (filter) {
            const parts = filter.split(/\s+/);
            sorted = sorted.filter(p => parts.every(part => p.name.toLowerCase().includes(part)));
        }

        gotoProjectList = sorted;

        sorted.forEach((p, idx) => {
            const item = document.createElement('div');
            item.className = 'goto-project-item';
            let html = `<span class="goto-project-name">${esc(p.name)}</span>`;
            if (p.path) html += `<span class="goto-project-path">${esc(p.path)}</span>`;
            if (p.pinned) html += `<span class="goto-project-pin">${iconHTML('star')}</span>`;
            item.innerHTML = html;
            item.onclick = () => {
                closeGotoProject();
                switchProject(p.name);
            };
            list.appendChild(item);
        });

        if (sorted.length > 0) {
            gotoProjectActiveIdx = 0;
            list.children[0].classList.add('active');
        }
    }

    // ─── Settings Modal (#21) ────────────────────────────────────────
let settingsScanPaths = [];
let settingsExtraProjects = [];
let settingsCLIIntegrations = [];
let settingsEditingCLIIntegrationID = '';
// Settings save as they change. The sequence numbers count user edits, so a
// change made while a save is in flight is saved afterwards, while values the
// server normalizes do not trigger another save on their own.
let settingsSavedSnapshot = '';
let settingsChangeSeq = 0;
let settingsSavedSeq = 0;
let settingsAutosaveTimer = null;
let settingsSaveChain = Promise.resolve();
let settingsSaveStatusTimer = null;
const SETTINGS_TEXT_AUTOSAVE_DELAY_MS = 600;
const SETTINGS_CLI_INTEGRATION_INPUT_IDS = [
	'settings-cli-integration-name',
	'settings-cli-integration-id',
	'settings-cli-integration-command',
	'settings-cli-integration-resume',
	'settings-cli-integration-check',
];

function settingsAIProviders() {
	return buildAIProviderState(settingsCLIIntegrations).providers;
}

// CLIs the install check reported missing are left out, except the selected
// one, so the dropdown never hides what is currently set. CLIs without a check
// result, such as a custom integration before its first save, stay listed.
function settingsCLIChoices(providers, capabilities, selected) {
	const dependencies = (capabilities && capabilities.dependencies) || {};
	return providers.filter(provider => {
		const dep = dependencies[provider.value];
		return provider.value === selected || !dep || dep.available;
	});
}

function renderSettingsCLIOptions(selectedCLI) {
	const select = document.getElementById('settings-cli-select');
	if (!select) return;
	const providers = settingsModalIsOpen() ? settingsAIProviders() : AI_PROVIDERS;
	const selected = providers.some(provider => provider.value === selectedCLI) ? selectedCLI : normalizeCLI(selectedCLI);
	select.innerHTML = '';
	settingsCLIChoices(providers, settingsCapabilities || runtimeCapabilities, selected).forEach(provider => {
		const option = document.createElement('option');
		option.value = provider.value;
		option.textContent = provider.settingsLabel;
		select.appendChild(option);
	});
	select.value = selected;
}

function cliIntegrationIDFromName(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
}

function setSettingsCLIIntegrationFormMode(editing) {
	const addBtn = document.getElementById('settings-cli-integration-add-btn');
	const title = document.getElementById('settings-cli-integration-title');
	if (addBtn) addBtn.textContent = editing ? 'Save integration' : 'Add integration';
	if (title) title.textContent = editing ? 'Edit integration' : 'Add integration';
}

function settingsCLIIntegrationModalIsOpen() {
	return document.getElementById('settings-cli-integration-modal')?.style.display !== 'none';
}

function openSettingsCLIIntegrationModal() {
	clearSettingsCLIIntegrationForm();
	document.getElementById('settings-cli-integration-modal').style.display = 'flex';
	document.getElementById('settings-cli-integration-name')?.focus();
}

function closeSettingsCLIIntegrationModal() {
	document.getElementById('settings-cli-integration-modal').style.display = 'none';
	clearSettingsCLIIntegrationForm();
}

function clearSettingsCLIIntegrationForm() {
	SETTINGS_CLI_INTEGRATION_INPUT_IDS.forEach(id => {
		const input = document.getElementById(id);
		if (input) input.value = '';
	});
	settingsEditingCLIIntegrationID = '';
	setSettingsCLIIntegrationFormMode(false);
}

function fillSettingsCLIIntegrationForm(integration) {
	const values = {
		'settings-cli-integration-name': integration.name || '',
		'settings-cli-integration-id': integration.id || '',
		'settings-cli-integration-command': integration.command || '',
		'settings-cli-integration-resume': integration.resume_command || '',
		'settings-cli-integration-check': integration.check_command || '',
	};
	SETTINGS_CLI_INTEGRATION_INPUT_IDS.forEach(id => {
		const input = document.getElementById(id);
		if (input) input.value = values[id] || '';
	});
}

function editSettingsCLIIntegration(integration) {
	fillSettingsCLIIntegrationForm(integration);
	settingsEditingCLIIntegrationID = integration.id;
	setSettingsCLIIntegrationFormMode(true);
	document.getElementById('settings-cli-integration-modal').style.display = 'flex';
	document.getElementById('settings-cli-integration-name')?.focus();
}

function renderSettingsCLIIntegrations() {
	const list = document.getElementById('settings-cli-integrations-list');
	if (!list) return;
	list.innerHTML = '';
	if (settingsCLIIntegrations.length === 0) {
		list.innerHTML = '<div class="settings-note">No custom integrations.</div>';
		return;
	}
	settingsCLIIntegrations.forEach(integration => {
		const item = document.createElement('div');
		item.className = 'settings-cli-integration-item';
		const commandParts = [integration.command];
		if (integration.resume_command) commandParts.push(`resume: ${integration.resume_command}`);
		if (integration.check_command) commandParts.push(`check: ${integration.check_command}`);
		item.innerHTML = `<div class="settings-cli-integration-top"><div><strong>${esc(integration.name)}</strong><span>${esc(integration.id)}</span></div><div class="settings-cli-integration-actions"><button type="button" class="settings-icon-btn settings-cli-integration-edit" title="Edit custom integration" aria-label="Edit custom integration">${iconHTML('pencil')}</button><button type="button" class="settings-icon-btn settings-cli-integration-remove" title="Remove custom integration" aria-label="Remove custom integration">${iconHTML('x')}</button></div></div><div class="settings-cli-integration-command">${esc(commandParts.join(' · '))}</div>`;
		const editBtn = item.querySelector('.settings-cli-integration-edit');
		editBtn.onclick = () => editSettingsCLIIntegration(integration);
		const removeBtn = item.querySelector('.settings-cli-integration-remove');
		removeBtn.onclick = () => {
			const selected = document.getElementById('settings-cli-select')?.value || '';
			settingsCLIIntegrations = settingsCLIIntegrations.filter(item => item.id !== integration.id);
			if (settingsEditingCLIIntegrationID === integration.id) clearSettingsCLIIntegrationForm();
			renderSettingsCLIOptions(selected === integration.id ? 'claude' : selected);
			renderSettingsCLIIntegrations();
			settingsDangerousPermissions = normalizeDangerousPermissions(settingsDangerousPermissions, settingsAIProviders());
			renderSettingsCapabilities();
		};
		list.appendChild(item);
	});
}

function readSettingsCLIIntegrationForm() {
	const nameInput = document.getElementById('settings-cli-integration-name');
	const idInput = document.getElementById('settings-cli-integration-id');
	const commandInput = document.getElementById('settings-cli-integration-command');
	const resumeInput = document.getElementById('settings-cli-integration-resume');
	const checkInput = document.getElementById('settings-cli-integration-check');
	const name = (nameInput?.value || '').trim();
	const id = (idInput?.value || cliIntegrationIDFromName(name)).trim();
	const command = (commandInput?.value || '').trim();
	if (!id) throw new Error('Integration id is required.');
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Integration id can use letters, numbers, underscores, and hyphens.');
	if (BUILT_IN_AI_PROVIDERS.some(provider => provider.value === id)) throw new Error(`Integration id "${id}" is reserved by a built-in CLI.`);
	if (!command) throw new Error('Integration command is required.');
	return {
		id,
		name: name || id,
		command,
		resume_command: (resumeInput?.value || '').trim(),
		check_command: (checkInput?.value || '').trim(),
	};
}

    function addOrUpdateSettingsCLIIntegration() {
        try {
            const integration = readSettingsCLIIntegrationForm();
	const editingID = settingsEditingCLIIntegrationID;
	const selectedCLI = document.getElementById('settings-cli-select')?.value || '';
	const duplicate = settingsCLIIntegrations.find(item => item.id === integration.id && item.id !== editingID);
	if (duplicate) {
		throw new Error(`Integration id "${integration.id}" is already used.`);
	}
            let replaced = false;
            const nextIntegrations = settingsCLIIntegrations.map(item => {
                if ((editingID && item.id === editingID) || (!editingID && item.id === integration.id)) {
                    replaced = true;
                    return integration;
                }
                return item;
            });
            if (!replaced) nextIntegrations.push(integration);
            settingsCLIIntegrations = normalizeCLIIntegrations(nextIntegrations);
            if (editingID && editingID !== integration.id) {
                settingsPendingCLIRenames.push({ from: editingID, to: integration.id });
            }
            const nextSelectedCLI = editingID && selectedCLI === editingID ? integration.id : selectedCLI;
            renderSettingsCLIOptions(nextSelectedCLI);
            renderSettingsCLIIntegrations();
            const nextDangerousPermissions = { ...settingsDangerousPermissions };
            if (editingID && editingID !== integration.id && nextDangerousPermissions[editingID]) {
                nextDangerousPermissions[integration.id] = true;
            }
            settingsDangerousPermissions = normalizeDangerousPermissions(nextDangerousPermissions, settingsAIProviders());
            closeSettingsCLIIntegrationModal();
            renderSettingsCapabilities();
        } catch (err) {
		showToast('Integration not saved', (err && err.message) || 'Check the integration fields.', 'error', 4200);
	}
}

function settingsDangerousInputID(providerValue) {
	return `settings-dangerous-${providerValue}`;
}

    function settingsDangerousToggleHTML(provider) {
        const inputID = settingsDangerousInputID(provider.value);
        const checked = settingsDangerousPermissions[provider.value] ? ' checked' : '';
        const labelID = `${inputID}-label`;
        return `<span class="settings-health-toggle" title="${esc(provider.dangerousFlag)}"><span id="${esc(labelID)}">${esc(provider.dangerousLabel)}</span><label class="settings-switch"><input type="checkbox" id="${esc(inputID)}" aria-labelledby="${esc(labelID)}"${checked}><span class="settings-switch-track"></span></label></span>`;
    }

    function bindSettingsDangerousToggle(provider) {
        const input = document.getElementById(settingsDangerousInputID(provider.value));
        if (!input) return;
        input.onchange = () => {
            settingsDangerousPermissions[provider.value] = input.checked;
        };
    }

function readSettingsDangerousPermissions() {
	const providers = settingsAIProviders();
	const normalized = normalizeDangerousPermissions(settingsDangerousPermissions, providers);
	providers.forEach(provider => {
		const input = document.getElementById(settingsDangerousInputID(provider.value));
		if (input) normalized[provider.value] = input.checked;
	});
	const next = {};
	providers.forEach(provider => {
		if (normalized[provider.value]) next[provider.value] = true;
	});
	return next;
}

    async function selectDirectory(options = {}) {
        if (typeof window.electronSelectFolder !== 'function') {
            showToast('Directory picker unavailable', 'Use manual path entry outside the Electron app.', 'info', 3800);
            return '';
        }

        try {
            const result = await window.electronSelectFolder({
                title: options.title || 'Select directory',
                defaultPath: options.defaultPath || '',
            });
            if (!result || result.canceled) return '';
            if (result.ok && result.path) return String(result.path);
            showToast('Directory selection failed', (result && result.error) || 'Unable to select directory.', 'error', 4200);
        } catch (err) {
            showToast('Directory selection failed', (err && err.message) || 'Unable to select directory.', 'error', 4200);
        }
        return '';
    }

    async function selectSetupDirectory() {
        const input = document.getElementById('setup-dir');
        if (!input) return;
        const selected = await selectDirectory({
            title: 'Select services directory',
            defaultPath: input.value.trim(),
        });
        if (selected) input.value = selected;
    }

    async function selectSettingsScanPath() {
        const input = document.getElementById('settings-scan-input');
        if (!input) return;
        const selected = await selectDirectory({
            title: 'Select projects scan path',
            defaultPath: input.value.trim() || settingsScanPaths[0] || '',
        });
        if (selected) {
            addScanPath(selected);
            noteSettingsChange();
        }
    }

    async function selectSettingsExtraProject() {
        const input = document.getElementById('settings-extra-input');
        const selected = await selectDirectory({
            title: 'Select extra project directory',
            defaultPath: (input && input.value.trim()) || settingsScanPaths[0] || '',
        });
        if (selected) {
            addExtraProject(selected);
            noteSettingsChange();
        }
    }

    function initSettings() {
        document.getElementById('settings-btn').onclick = openSettings;
        document.getElementById('rescan-projects-btn').onclick = () => rescanProjects(document.getElementById('rescan-projects-btn'));
        document.getElementById('settings-modal-backdrop').onclick = () => closeSettings();
        document.getElementById('settings-modal-close').onclick = () => closeSettings();
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            item.onclick = () => showSettingsPage(item.dataset.settingsPage);
        });
        initSettingsUsageRows();
        document.getElementById('settings-activity-provider')?.addEventListener('change', syncSettingsGitLabHostRow);
        // Clicks and changes run after the control's own handler has updated
        // the settings state; typing waits for a pause.
        ['settings-modal-content', 'settings-cli-integration-modal'].forEach(id => {
            const root = document.getElementById(id);
            if (!root) return;
            root.addEventListener('click', () => noteSettingsChange());
            root.addEventListener('change', () => noteSettingsChange());
            root.addEventListener('input', () => noteSettingsChange(SETTINGS_TEXT_AUTOSAVE_DELAY_MS));
        });
        document.getElementById('setup-dir-select-btn').onclick = selectSetupDirectory;
        document.getElementById('settings-scan-select-btn').onclick = selectSettingsScanPath;
        document.getElementById('settings-scan-add-btn').onclick = addScanPath;
        document.getElementById('settings-scan-input').addEventListener('keydown', ev => {
            if (ev.key === 'Enter') addScanPath();
        });
        document.getElementById('settings-extra-select-btn').onclick = selectSettingsExtraProject;
        document.getElementById('settings-extra-add-btn').onclick = addExtraProject;
        document.getElementById('settings-extra-input').addEventListener('keydown', ev => {
            if (ev.key === 'Enter') addExtraProject();
        });
	document.getElementById('settings-cli-integration-add-btn').onclick = addOrUpdateSettingsCLIIntegration;
	document.getElementById('settings-cli-integration-open-btn').onclick = openSettingsCLIIntegrationModal;
	document.getElementById('settings-cli-integration-cancel-btn').onclick = closeSettingsCLIIntegrationModal;
	document.getElementById('settings-cli-integration-close').onclick = closeSettingsCLIIntegrationModal;
	document.getElementById('settings-cli-integration-backdrop').onclick = closeSettingsCLIIntegrationModal;
	SETTINGS_CLI_INTEGRATION_INPUT_IDS.forEach(id => {
		document.getElementById(id).addEventListener('keydown', ev => {
			if (ev.key === 'Enter') addOrUpdateSettingsCLIIntegration();
		});
	});
	document.getElementById('settings-tags-add-btn').onclick = addProjectTags;
        const labelProjectInput = document.getElementById('settings-tags-project');
        labelProjectInput.addEventListener('focus', () => showProjectLabelSuggestions());
        labelProjectInput.addEventListener('input', () => showProjectLabelSuggestions(!!labelProjectInput.value.trim()));
        // Clicking the box around the chips focuses the field, like an input.
        document.getElementById('settings-tags-projects').addEventListener('mousedown', ev => {
            if (ev.target !== ev.currentTarget) return;
            ev.preventDefault();
            labelProjectInput.focus();
        });
        labelProjectInput.addEventListener('keydown', handleProjectLabelSuggestionKeydown);
        labelProjectInput.addEventListener('blur', hideProjectLabelSuggestions);
        // The list is placed under the field once, so close it when Settings
        // scrolls instead of leaving it behind; scrolling the list itself is fine.
        document.addEventListener('scroll', ev => {
            if (projectLabelSuggest && ev.target !== projectLabelSuggest.dropdown) hideProjectLabelSuggestions();
        }, true);
        document.getElementById('settings-tags-value').addEventListener('keydown', ev => {
            if (ev.key === 'Enter') addProjectTags();
        });
        document.getElementById('settings-database-driver').onchange = renderSettingsDatabaseDriverFields;
        document.getElementById('settings-database-add-btn').onclick = addOrUpdateSettingsDatabase;
		document.getElementById('settings-database-open-btn').onclick = openSettingsDatabaseModal;
		document.getElementById('settings-database-cancel-btn').onclick = closeSettingsDatabaseModal;
		document.getElementById('settings-database-close').onclick = closeSettingsDatabaseModal;
		document.getElementById('settings-database-backdrop').onclick = closeSettingsDatabaseModal;
        document.getElementById('settings-database-file-select-btn').onclick = selectSettingsDatabaseFile;
        renderSettingsCLIOptions(currentCLI);
    }

    function showSettingsPage(page) {
        const pages = [...document.querySelectorAll('.settings-page')];
        const target = pages.some(panel => panel.dataset.settingsPage === page) ? page : 'general';
        pages.forEach(panel => {
            panel.hidden = panel.dataset.settingsPage !== target;
        });
        document.querySelectorAll('.settings-nav-item').forEach(item => {
            const active = item.dataset.settingsPage === target;
            item.classList.toggle('active', active);
            item.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }

    async function openSettings() {
        if (!(await loadSettingsForm())) return;
        showSettingsPage('general');
        document.getElementById('settings-modal').style.display = 'flex';
        setSettingsSaveStatus('');
    }

    // Fills the form from the server. Also used to undo a change that failed
    // to save, so the form never shows a value that isn't stored.
    async function loadSettingsForm() {
        let cfg;
        let capabilities;
        let databases;
        try {
            [cfg, capabilities, databases] = await Promise.all([
                fetchJSON('/api/config'),
                fetchJSON('/api/capabilities').catch(() => null),
                fetchJSON('/api/databases').catch(() => null),
            ]);
        } catch (err) {
            showToast('Settings unavailable', compactErrorMessage(err, 'Could not load settings.'), 'error', 5200);
            return false;
        }
        applyConfigState(cfg);
        if (databases) applyDatabaseState(databases);
        settingsPendingCLIRenames = [];
        document.getElementById('settings-theme-select').value = currentThemeMode;
        document.getElementById('settings-terminal-font-size').value = String(terminalFontSize);
        settingsCLIIntegrations = normalizeCLIIntegrations(cfg.cli_integrations);
        clearSettingsCLIIntegrationForm();
        settingsCapabilities = capabilities;
        if (capabilities) runtimeCapabilities = capabilities;
        renderSettingsCLIOptions(cfg.cli || currentCLI);
        document.getElementById('settings-activity-provider').value = activityProvider;
        document.getElementById('settings-gitlab-host').value = gitlabHost;
        syncSettingsGitLabHostRow();
        writeSettingsUsage();
        document.getElementById('settings-startup-git-pull-ff-only').checked = startupGitPullFFOnly;
        document.getElementById('settings-prevent-sleep').checked = preventSleepWhileActive;
        settingsDangerousPermissions = normalizeDangerousPermissions(cfg.dangerous_permissions, settingsAIProviders());
        settingsScanPaths = Array.isArray(cfg.scan_paths) ? [...cfg.scan_paths] : [];
        settingsExtraProjects = cfg.extra_projects ? [...cfg.extra_projects] : [];
        settingsProjectTags = cfg.project_tags ? JSON.parse(JSON.stringify(cfg.project_tags)) : {};
        labelDraftProjects = [];
        settingsDatabaseConnections = normalizeDatabaseConnections(databaseConnections);
        settingsDatabaseEditingID = '';
	renderScanPaths();
	renderExtraProjects();
	renderSettingsCLIIntegrations();
	renderProjectTags();
        renderLabelProjectChips();
        renderSettingsDatabases();
        renderDatabaseDiscoveryProjectOptions();
        resetSettingsDatabaseForm();
        renderSettingsCapabilities();
        renderTerminalProviderSwitcher();
        settingsSavedSnapshot = currentSettingsSnapshot();
        settingsSavedSeq = settingsChangeSeq;
        return true;
    }

    function currentSettingsSnapshot() {
        const theme = document.getElementById('settings-theme-select')?.value || '';
        const terminalFont = normalizeTerminalFontSize(document.getElementById('settings-terminal-font-size')?.value);
        const cli = document.getElementById('settings-cli-select')?.value || '';
        const activity = document.getElementById('settings-activity-provider')?.value || '';
        const gitlabHostSetting = document.getElementById('settings-gitlab-host')?.value.trim() || '';
        const startupPullFFOnly = Boolean(document.getElementById('settings-startup-git-pull-ff-only')?.checked);
        const preventSleep = Boolean(document.getElementById('settings-prevent-sleep')?.checked);
        return JSON.stringify({
            scanPaths: settingsScanPaths,
            theme,
            terminalFont,
            cli,
            activity,
            gitlabHost: gitlabHostSetting,
            usage: readSettingsUsage(),
		startupPullFFOnly,
		preventSleep,
		dangerous: readSettingsDangerousPermissions(),
		integrations: settingsCLIIntegrations,
		extra: settingsExtraProjects,
            tags: settingsProjectTags,
        });
    }

    function settingsModalIsOpen() {
        const modal = document.getElementById('settings-modal');
        return !!(modal && modal.style.display !== 'none');
    }

    function noteSettingsChange(delayMs = 0) {
        if (!settingsModalIsOpen()) return;
        settingsChangeSeq++;
        clearTimeout(settingsAutosaveTimer);
        settingsAutosaveTimer = setTimeout(flushSettingsAutosave, delayMs);
    }

    function flushSettingsAutosave() {
        clearTimeout(settingsAutosaveTimer);
        settingsAutosaveTimer = null;
        settingsSaveChain = settingsSaveChain.then(async () => {
            while (settingsSavedSeq < settingsChangeSeq) {
                const seq = settingsChangeSeq;
                if (currentSettingsSnapshot() !== settingsSavedSnapshot && !(await saveSettings())) {
                    settingsSavedSeq = settingsChangeSeq;
                    break;
                }
                settingsSavedSeq = Math.max(settingsSavedSeq, seq);
            }
        }).catch(err => {
            // Keep the queue usable for the next change.
            settingsSavedSeq = settingsChangeSeq;
            setSettingsSaveStatus('');
            console.error('Settings autosave failed:', err);
        });
        return settingsSaveChain;
    }

    function setSettingsSaveStatus(text) {
        const el = document.getElementById('settings-save-status');
        if (!el) return;
        clearTimeout(settingsSaveStatusTimer);
        el.textContent = text;
        if (text === 'Saved') {
            settingsSaveStatusTimer = setTimeout(() => { el.textContent = ''; }, 1600);
        }
    }

    function closeSettings() {
        const modal = document.getElementById('settings-modal');
        if (!modal || modal.style.display === 'none') return;
        if (settingsCLIIntegrationModalIsOpen()) closeSettingsCLIIntegrationModal();
        if (settingsDatabaseModalIsOpen()) closeSettingsDatabaseModal();
        if (settingsAutosaveTimer) flushSettingsAutosave();
        modal.style.display = 'none';
    }

    function renderScanPaths() {
        const list = document.getElementById('settings-scan-list');
        list.innerHTML = '';
        if (settingsScanPaths.length === 0) {
            list.innerHTML = '<div class="settings-note warn">At least one scan path is required.</div>';
            return;
        }
        const statuses = Array.isArray(settingsCapabilities?.scan_paths) ? settingsCapabilities.scan_paths : [];
        settingsScanPaths.forEach((path, idx) => {
            const item = document.createElement('div');
            item.className = 'settings-extra-item';

            const pathEl = document.createElement('span');
            pathEl.className = 'settings-scan-path';
            pathEl.textContent = path;

            const savedStatus = statuses.find(status => status.path === path);
            const statusEl = document.createElement('span');
            statusEl.className = 'settings-scan-status';
            if (!settingsCapabilities) {
                statusEl.classList.add('warn');
                statusEl.textContent = 'Not checked';
            } else if (!savedStatus) {
                statusEl.classList.add('warn');
                statusEl.textContent = 'Checking...';
            } else if (savedStatus.exists) {
                statusEl.classList.add('good');
                statusEl.textContent = 'Ready';
            } else {
                statusEl.classList.add('error');
                statusEl.textContent = 'Missing';
            }

            const removeBtn = document.createElement('span');
            removeBtn.className = 'settings-extra-remove';
            removeBtn.innerHTML = iconHTML('x');
            removeBtn.title = 'Remove';
            removeBtn.onclick = () => {
                if (settingsScanPaths.length <= 1) {
                    showToast('Scan path required', 'Add another folder before removing the last one.', 'error', 3800);
                    return;
                }
                settingsScanPaths.splice(idx, 1);
                renderScanPaths();
            };

            item.appendChild(pathEl);
            item.appendChild(statusEl);
            item.appendChild(removeBtn);
            list.appendChild(item);
        });
    }

    function addScanPath(selectedPath) {
        const input = document.getElementById('settings-scan-input');
        const path = String(typeof selectedPath === 'string' ? selectedPath : input.value).trim();
        if (!path) return;
        if (settingsScanPaths.includes(path)) {
            input.value = '';
            showToast('Scan path already added', path, 'info', 2600);
            return;
        }
        settingsScanPaths.push(path);
        input.value = '';
        renderScanPaths();
    }

    function renderExtraProjects() {
        const list = document.getElementById('settings-extra-list');
        list.innerHTML = '';
        settingsExtraProjects.forEach((path, idx) => {
            const item = document.createElement('div');
            item.className = 'settings-extra-item';

            const span = document.createElement('span');
            span.textContent = path;

            const removeBtn = document.createElement('span');
            removeBtn.className = 'settings-extra-remove';
            removeBtn.innerHTML = iconHTML('x');
            removeBtn.title = 'Remove';
            removeBtn.onclick = () => {
                settingsExtraProjects.splice(idx, 1);
                renderExtraProjects();
            };

            item.appendChild(span);
            item.appendChild(removeBtn);
            list.appendChild(item);
        });
    }

    function addExtraProject(selectedPath) {
        const input = document.getElementById('settings-extra-input');
        const path = String(typeof selectedPath === 'string' ? selectedPath : input.value).trim();
        if (!path) return;
        if (settingsExtraProjects.includes(path)) {
            input.value = '';
            showToast('Project already added', path, 'info', 2600);
            return;
        }
        settingsExtraProjects.push(path);
        input.value = '';
        renderExtraProjects();
    }

    function renderSettingsCapabilities() {
        const healthEl = document.getElementById('settings-health-list');
        if (!healthEl) return;
        renderScanPaths();
        syncSettingsUsageToggles();
        if (!settingsCapabilities) {
            healthEl.innerHTML = '<div class="settings-note warn">Could not load dependency checks.</div>';
            return;
        }
	healthEl.innerHTML = '';
	const dependencies = settingsCapabilities.dependencies || {};
	const dependencyKeys = Object.keys(dependencies);
	settingsAIProviders().forEach(provider => {
		if (!dependencyKeys.includes(provider.value)) dependencyKeys.push(provider.value);
	});
	dependencyKeys.forEach(key => {
		const dep = dependencies[key] || { available: false, error: 'Checking...' };
		const item = document.createElement('div');
		item.className = 'settings-health-item';
		const detail = dep.available ? dep.path : (dep.error || 'not found');
		const provider = settingsAIProviders().find(item => item.value === key) || AI_PROVIDER_BY_VALUE[key];
		const label = provider ? provider.shortLabel : providerDependencyLabel(key);
		const toggleHTML = provider && provider.dangerousFlag ? settingsDangerousToggleHTML(provider) : '';
		item.innerHTML = `<div class="settings-health-top"><span class="settings-health-name">${esc(label)}</span><div class="settings-health-actions">${toggleHTML}<span class="settings-health-pill ${dep.available ? 'good' : 'warn'}">${dep.available ? 'ready' : 'missing'}</span></div></div><div class="settings-health-detail">${esc(detail)}</div>`;
		healthEl.appendChild(item);
            if (provider && provider.dangerousFlag) bindSettingsDangerousToggle(provider);
        });
    }

    function renderProjectTags() {
        const list = document.getElementById('settings-tags-list');
        if (!list) return;
        list.innerHTML = '';
        Object.entries(settingsProjectTags).sort((a, b) => a[0].localeCompare(b[0])).forEach(([project, tags]) => {
            const item = document.createElement('div');
            item.className = 'settings-docker-item';
            const value = Array.isArray(tags) ? tags.join(', ') : '';
            item.innerHTML = `<span class="docker-map-project">${esc(project)}</span><span class="docker-map-arrow">${iconHTML('arrow-right')}</span><span class="docker-map-service">${esc(value)}</span>`;
            const removeBtn = document.createElement('span');
            removeBtn.className = 'settings-extra-remove';
            removeBtn.innerHTML = iconHTML('x');
            removeBtn.onclick = () => {
                delete settingsProjectTags[project];
                renderProjectTags();
            };
            item.appendChild(removeBtn);
            list.appendChild(item);
        });
    }

    // Suggest scanned projects in the label form's name field, each with its
    // current labels, so a label can't be attached to a mistyped name. It
    // reuses the branch autocomplete's look and keys rather than a <datalist>,
    // whose popup the browser draws outside the theme.
    let projectLabelSuggest = null; // { items, highlightedIndex, dropdown }
    let labelDraftProjects = [];    // projects picked as chips, in the order picked

    function projectLabelSuggestionItems(query) {
        const needle = query.trim().toLowerCase();
        return projects.map(project => project.name)
            .filter(name => !labelDraftProjects.includes(name))
            .filter(name => !needle || name.toLowerCase().includes(needle))
            .sort((a, b) => a.localeCompare(b));
    }

    function showProjectLabelSuggestions(highlightFirst = false) {
        const input = document.getElementById('settings-tags-project');
        if (!input) return;
        const items = projectLabelSuggestionItems(input.value);
        if (items.length === 0) {
            hideProjectLabelSuggestions();
            return;
        }
        const previous = projectLabelSuggest;
        let highlightedIndex = highlightFirst ? 0 : (previous ? previous.highlightedIndex : -1);
        if (highlightedIndex >= items.length) highlightedIndex = items.length - 1;
        previous?.dropdown?.remove();

        const dropdown = document.createElement('div');
        dropdown.className = 'branch-autocomplete';
        const rect = (document.getElementById('settings-tags-projects') || input).getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = rect.bottom + 'px';
        dropdown.style.width = rect.width + 'px';
        items.forEach((name, index) => {
            const item = document.createElement('div');
            item.className = 'branch-autocomplete-item project-label-suggestion' + (index === highlightedIndex ? ' highlighted' : '');
            const nameText = document.createElement('span');
            nameText.className = 'project-label-suggestion-name';
            nameText.textContent = name;
            item.appendChild(nameText);
            const labels = settingsProjectTags[name];
            if (Array.isArray(labels) && labels.length) {
                const labelText = document.createElement('span');
                labelText.className = 'project-label-suggestion-labels';
                labelText.textContent = labels.join(', ');
                item.appendChild(labelText);
            }
            item.onmousedown = ev => {
                ev.preventDefault(); // keep focus in the field
                applyProjectLabelSuggestion(name);
            };
            dropdown.appendChild(item);
        });
        document.body.appendChild(dropdown);
        dropdown.children[highlightedIndex]?.scrollIntoView({ block: 'nearest' });
        projectLabelSuggest = { items, highlightedIndex, dropdown };
    }

    function moveProjectLabelSuggestion(delta) {
        if (!projectLabelSuggest) {
            showProjectLabelSuggestions(true);
            return;
        }
        const count = projectLabelSuggest.items.length;
        const current = projectLabelSuggest.highlightedIndex;
        projectLabelSuggest.highlightedIndex = current < 0
            ? (delta > 0 ? 0 : count - 1)
            : (current + delta + count) % count;
        showProjectLabelSuggestions();
    }

    // Picking a project turns it into a chip and keeps the list open, so several
    // can be picked in a row.
    function applyProjectLabelSuggestion(name) {
        if (!labelDraftProjects.includes(name)) labelDraftProjects.push(name);
        document.getElementById('settings-tags-project').value = '';
        renderLabelProjectChips();
        showProjectLabelSuggestions();
    }

    function removeLabelProject(name) {
        labelDraftProjects = labelDraftProjects.filter(item => item !== name);
        renderLabelProjectChips();
        document.getElementById('settings-tags-project').focus();
    }

    function renderLabelProjectChips() {
        const picker = document.getElementById('settings-tags-projects');
        const input = document.getElementById('settings-tags-project');
        if (!picker || !input) return;
        picker.querySelectorAll('.label-project-chip').forEach(chip => chip.remove());
        labelDraftProjects.forEach(name => {
            const chip = document.createElement('span');
            chip.className = 'keymap-shortcut-chip label-project-chip';
            const label = document.createElement('span');
            label.textContent = name;
            chip.appendChild(label);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.setAttribute('aria-label', 'Remove ' + name);
            remove.title = 'Remove ' + name;
            remove.innerHTML = iconHTML('x');
            remove.onclick = () => removeLabelProject(name);
            chip.appendChild(remove);
            picker.insertBefore(chip, input);
        });
        input.placeholder = labelDraftProjects.length ? '' : 'project names';
    }

    function hideProjectLabelSuggestions() {
        projectLabelSuggest?.dropdown?.remove();
        projectLabelSuggest = null;
    }

    function handleProjectLabelSuggestionKeydown(ev) {
        const input = document.getElementById('settings-tags-project');
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            moveProjectLabelSuggestion(ev.key === 'ArrowDown' ? 1 : -1);
        } else if (ev.key === 'Enter') {
            const highlighted = projectLabelSuggest?.items[projectLabelSuggest.highlightedIndex];
            const typed = input.value.trim();
            const exact = projects.find(project => project.name === typed)?.name;
            ev.preventDefault();
            if (highlighted || exact) {
                applyProjectLabelSuggestion(highlighted || exact);
            } else if (!typed && labelDraftProjects.length) {
                hideProjectLabelSuggestions();
                document.getElementById('settings-tags-value').focus();
            }
        } else if (ev.key === 'Backspace' && !input.value && labelDraftProjects.length) {
            ev.preventDefault();
            labelDraftProjects = labelDraftProjects.slice(0, -1);
            renderLabelProjectChips();
            if (projectLabelSuggest) showProjectLabelSuggestions();
        } else if (ev.key === 'Escape' && projectLabelSuggest) {
            // Close the list, not the Settings window behind it.
            ev.preventDefault();
            ev.stopPropagation();
            hideProjectLabelSuggestions();
        } else if (ev.key === 'Tab') {
            hideProjectLabelSuggestions();
        }
    }

    // Adds the labels to every picked project, plus a name still typed in the
    // field. It adds rather than replaces, so labelling several projects at
    // once never drops labels they already had.
    function addProjectTags() {
        const projInput = document.getElementById('settings-tags-project');
        const valueInput = document.getElementById('settings-tags-value');
        const typed = projInput.value.trim();
        const targets = typed && !labelDraftProjects.includes(typed) ? [...labelDraftProjects, typed] : [...labelDraftProjects];
        const tags = valueInput.value.split(',').map(s => s.trim()).filter(Boolean);
        if (targets.length === 0 || tags.length === 0) return;
        targets.forEach(project => {
            const current = Array.isArray(settingsProjectTags[project]) ? settingsProjectTags[project] : [];
            settingsProjectTags[project] = [...new Set([...current, ...tags])];
        });
        labelDraftProjects = [];
        projInput.value = '';
        valueInput.value = '';
        renderLabelProjectChips();
        renderProjectTags();
        // Enter in the labels field fires no click or input event, which is
        // what Settings autosave listens for.
        noteSettingsChange();
    }

    function renderSettingsDatabases() {
        const list = document.getElementById('settings-database-list');
        if (!list) return;
        list.innerHTML = '';
        if (settingsDatabaseConnections.length === 0) {
            list.innerHTML = '<div class="settings-note">No database connections yet.</div>';
            return;
        }
        settingsDatabaseConnections.forEach(conn => {
            const item = document.createElement('div');
            item.className = 'settings-database-item';
            item.innerHTML = `<div class="settings-database-summary"><strong>${esc(conn.name)}</strong><span>${esc(databaseDriverLabel(conn.driver))} · ${esc(databaseConnectionSubtitle(conn))}</span><small>${esc(databasePasswordLabel(conn))}</small></div>`;
            const actions = document.createElement('div');
            actions.className = 'settings-database-item-actions';
            const testBtn = document.createElement('button');
            testBtn.type = 'button';
            testBtn.textContent = 'test';
            testBtn.onclick = async () => {
                testBtn.disabled = true;
                const old = testBtn.textContent;
                testBtn.textContent = 'testing...';
                try {
                    const result = await testDatabaseConnection(conn);
                    showToast(result.ok ? 'Connection OK' : 'Connection failed', result.message || conn.name, result.ok ? 'success' : 'error', result.ok ? 2600 : 5200);
                } catch (err) {
                    showToast('Connection failed', compactErrorMessage(err && err.message, 'Unable to test connection.'), 'error', 5200);
                } finally {
                    testBtn.disabled = false;
                    testBtn.textContent = old;
                }
            };
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.textContent = 'edit';
            editBtn.onclick = () => editSettingsDatabase(conn.id);
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.textContent = 'remove';
            removeBtn.className = 'danger';
            removeBtn.onclick = async () => {
                const previous = settingsDatabaseConnections;
                settingsDatabaseConnections = settingsDatabaseConnections.filter(item => item.id !== conn.id);
                if (settingsDatabaseEditingID === conn.id) closeSettingsDatabaseModal();
                renderSettingsDatabases();
                try {
                    await deleteDatabaseConnection(conn.id);
                    showToast('Connection removed', conn.name, 'success', 2200);
                } catch (err) {
                    settingsDatabaseConnections = previous;
                    renderSettingsDatabases();
                    showToast('Connection remove failed', compactErrorMessage(err && err.message, 'Unable to save database connections.'), 'error', 4200);
                }
            };
            actions.appendChild(testBtn);
            actions.appendChild(editBtn);
            actions.appendChild(removeBtn);
            item.appendChild(actions);
            list.appendChild(item);
        });
    }

    async function createDatabaseConnection(conn) {
        const data = await fetchJSON('/api/databases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeoutMs: CONFIG_SAVE_TIMEOUT_MS,
            timeoutMessage: 'Database connection save timed out. Please try again.',
            body: JSON.stringify({ connection: conn }),
        });
        applyDatabaseState(data);
        return databaseConnectionByID(conn.id) || databaseConnections[databaseConnections.length - 1] || null;
    }

    async function updateDatabaseConnection(id, conn, options = {}) {
        const data = await fetchJSON(`/api/databases/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            timeoutMs: CONFIG_SAVE_TIMEOUT_MS,
            timeoutMessage: 'Database connection save timed out. Please try again.',
            body: JSON.stringify({ connection: conn, clear_password: Boolean(options.clearPassword) }),
        });
        applyDatabaseState(data);
        return databaseConnectionByID(id);
    }

    async function deleteDatabaseConnection(id) {
        const data = await fetchJSON(`/api/databases/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            timeoutMs: CONFIG_SAVE_TIMEOUT_MS,
            timeoutMessage: 'Database connection remove timed out. Please try again.',
        });
        applyDatabaseState(data);
        return databaseConnections;
    }

    async function saveDatabaseSavedQuery(connID, query, existingID = '') {
        const id = String(existingID || '').trim();
        const url = id
            ? `/api/databases/${encodeURIComponent(connID)}/saved-queries/${encodeURIComponent(id)}`
            : `/api/databases/${encodeURIComponent(connID)}/saved-queries`;
        const data = await fetchJSON(url, {
            method: id ? 'PATCH' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeoutMs: CONFIG_SAVE_TIMEOUT_MS,
            timeoutMessage: 'Saved query update timed out. Please try again.',
            body: JSON.stringify(query),
        });
        applyDatabaseState(data);
        return data;
    }

    async function deleteDatabaseSavedQuery(connID, queryID) {
        const data = await fetchJSON(`/api/databases/${encodeURIComponent(connID)}/saved-queries/${encodeURIComponent(queryID)}`, {
            method: 'DELETE',
            timeoutMs: CONFIG_SAVE_TIMEOUT_MS,
            timeoutMessage: 'Saved query delete timed out. Please try again.',
        });
        applyDatabaseState(data);
        return data;
    }

    async function deleteDatabaseOrphanedQuery(queryID) {
        const data = await fetchJSON(`/api/databases/orphaned-queries/${encodeURIComponent(queryID)}`, {
            method: 'DELETE',
            timeoutMs: CONFIG_SAVE_TIMEOUT_MS,
            timeoutMessage: 'Saved query delete timed out. Please try again.',
        });
        applyDatabaseState(data);
        return data;
    }

    function renderSettingsDatabaseDriverFields() {
        const driver = normalizeDatabaseDriver(document.getElementById('settings-database-driver')?.value);
        document.querySelectorAll('.settings-database-sqlite').forEach(el => {
            el.style.display = driver === 'sqlite' ? '' : 'none';
        });
        document.querySelectorAll('.settings-database-remote').forEach(el => {
            el.style.display = driver === 'sqlite' ? 'none' : '';
        });
        document.querySelectorAll('.settings-database-postgres').forEach(el => {
            el.style.display = driver === 'postgres' ? '' : 'none';
        });
        const port = document.getElementById('settings-database-port');
        if (port && !port.value) {
            port.placeholder = driver === 'mysql' ? '3306' : '5432';
        }
        const database = document.getElementById('settings-database-dbname');
        if (database) {
            database.placeholder = driver === 'mysql' ? 'optional; all visible databases are listed' : 'app';
        }
    }

    function resetSettingsDatabaseForm() {
        settingsDatabaseEditingID = '';
        document.getElementById('settings-database-name').value = '';
        document.getElementById('settings-database-driver').value = 'sqlite';
        document.getElementById('settings-database-sqlite-path').value = '';
        document.getElementById('settings-database-host').value = '';
        document.getElementById('settings-database-port').value = '';
        document.getElementById('settings-database-dbname').value = '';
        document.getElementById('settings-database-user').value = '';
        document.getElementById('settings-database-password').value = '';
        document.getElementById('settings-database-password').placeholder = 'local password';
        document.getElementById('settings-database-sslmode').value = '';
        document.getElementById('settings-database-add-btn').textContent = 'Add connection';
		document.getElementById('settings-database-title').textContent = 'Add connection';
        renderSettingsDatabaseDriverFields();
    }

	function settingsDatabaseModalIsOpen() {
		return document.getElementById('settings-database-modal')?.style.display !== 'none';
	}

	function openSettingsDatabaseModal() {
		resetSettingsDatabaseForm();
		document.getElementById('settings-database-modal').style.display = 'flex';
		document.getElementById('settings-database-name')?.focus();
	}

	function closeSettingsDatabaseModal() {
		document.getElementById('settings-database-modal').style.display = 'none';
		resetSettingsDatabaseForm();
	}

    function editSettingsDatabase(id) {
        const conn = settingsDatabaseConnections.find(item => item.id === id);
        if (!conn) return;
        settingsDatabaseEditingID = id;
        document.getElementById('settings-database-name').value = conn.name || '';
        document.getElementById('settings-database-driver').value = conn.driver || 'sqlite';
        document.getElementById('settings-database-sqlite-path').value = conn.sqlite_path || '';
        document.getElementById('settings-database-host').value = conn.host || '';
        document.getElementById('settings-database-port').value = conn.port ? String(conn.port) : '';
        document.getElementById('settings-database-dbname').value = conn.database || '';
        document.getElementById('settings-database-user').value = conn.user || '';
        const passwordInput = document.getElementById('settings-database-password');
        passwordInput.value = '';
        passwordInput.placeholder = conn.has_password ? 'saved - leave blank to keep' : 'local password';
        document.getElementById('settings-database-sslmode').value = conn.sslmode || '';
        document.getElementById('settings-database-add-btn').textContent = 'Save connection';
		document.getElementById('settings-database-title').textContent = 'Edit connection';
        renderSettingsDatabaseDriverFields();
		document.getElementById('settings-database-modal').style.display = 'flex';
		document.getElementById('settings-database-name')?.focus();
    }

    function readSettingsDatabaseForm() {
        const existing = settingsDatabaseConnections.find(item => item.id === settingsDatabaseEditingID);
        const driver = normalizeDatabaseDriver(document.getElementById('settings-database-driver').value);
        const conn = {
            id: settingsDatabaseEditingID || stableDatabaseClientID('db'),
            name: document.getElementById('settings-database-name').value.trim(),
            driver,
            sqlite_path: document.getElementById('settings-database-sqlite-path').value.trim(),
            host: document.getElementById('settings-database-host').value.trim(),
            port: Number.parseInt(document.getElementById('settings-database-port').value, 10) || 0,
            database: document.getElementById('settings-database-dbname').value.trim(),
            user: document.getElementById('settings-database-user').value.trim(),
            password: document.getElementById('settings-database-password').value,
            has_password: Boolean(existing && existing.has_password),
            project: existing ? existing.project || '' : '',
            sslmode: document.getElementById('settings-database-sslmode').value.trim(),
            params: existing ? { ...(existing.params || {}) } : {},
            saved_queries: existing ? normalizeDatabaseSavedQueries(existing.saved_queries) : [],
        };
        if (!conn.name) throw new Error('Connection name is required.');
        if (!conn.driver) throw new Error('Driver is required.');
        if (conn.driver === 'sqlite') {
            if (!conn.sqlite_path) throw new Error('SQLite path is required.');
            conn.host = '';
            conn.port = 0;
            conn.database = '';
            conn.user = '';
            conn.password = '';
            conn.sslmode = '';
        } else {
            if (!conn.host) throw new Error('Host is required.');
            if (conn.driver === 'postgres' && !conn.database) throw new Error('Database is required for Postgres.');
            conn.sqlite_path = '';
        }
        return conn;
    }

    async function addOrUpdateSettingsDatabase() {
        let previous = settingsDatabaseConnections;
        try {
            const conn = readSettingsDatabaseForm();
            const idx = settingsDatabaseConnections.findIndex(item => item.id === conn.id);
            if (idx >= 0) settingsDatabaseConnections.splice(idx, 1, conn);
            else settingsDatabaseConnections.push(conn);
            settingsDatabaseConnections = normalizeDatabaseConnections(settingsDatabaseConnections);
            renderSettingsDatabases();
            if (idx >= 0) await updateDatabaseConnection(conn.id, conn);
            else await createDatabaseConnection(conn);
            closeSettingsDatabaseModal();
            renderSettingsDatabases();
            showToast('Connection saved', conn.name, 'success', 2200);
        } catch (err) {
            settingsDatabaseConnections = previous;
            renderSettingsDatabases();
            showToast('Connection save failed', (err && err.message) || 'Check database connection fields.', 'error', 4200);
        }
    }

    async function selectSettingsDatabaseFile() {
        if (typeof window.electronSelectFile !== 'function') {
            showToast('File picker unavailable', 'Use manual path entry outside the Electron app.', 'info', 3800);
            return;
        }
        const input = document.getElementById('settings-database-sqlite-path');
        try {
            const result = await window.electronSelectFile({
                title: 'Select SQLite database',
                defaultPath: input.value.trim(),
            });
            if (result && result.ok && result.path) input.value = result.path;
            else if (result && !result.canceled && result.error) showToast('File selection failed', result.error, 'error', 4200);
        } catch (err) {
            showToast('File selection failed', (err && err.message) || 'Unable to select file.', 'error', 4200);
        }
    }

    // Saves the whole form and reports whether it worked. On failure the form
    // is reloaded from the server, so the changed field shows its old value.
    async function saveSettings() {
        if (settingsScanPaths.length === 0) {
            showToast('Scan path required', 'Add at least one directory to scan for projects.', 'error', 3800);
            return false;
        }
        const sentSnapshot = currentSettingsSnapshot();
        const previous = JSON.parse(settingsSavedSnapshot || '{}');
        const sent = JSON.parse(sentSnapshot);

        const theme = document.getElementById('settings-theme-select').value;
        const terminalFont = normalizeTerminalFontSize(document.getElementById('settings-terminal-font-size').value);
        const cli = document.getElementById('settings-cli-select').value;
	const activityProviderSetting = normalizeActivityProvider(document.getElementById('settings-activity-provider')?.value);
	const gitlabHostSetting = document.getElementById('settings-gitlab-host')?.value.trim() || '';
	const startupGitPullFFOnlySetting = Boolean(document.getElementById('settings-startup-git-pull-ff-only')?.checked);
	const preventSleepSetting = Boolean(document.getElementById('settings-prevent-sleep')?.checked);
	const nextCLIIntegrations = normalizeCLIIntegrations(settingsCLIIntegrations);
	const nextCLIProviders = buildAIProviderState(nextCLIIntegrations).providers;
	const cliTransition = buildCLITransition({
		previousIntegrations: customCLIIntegrations,
		nextIntegrations: nextCLIIntegrations,
		renames: settingsPendingCLIRenames,
	});
	const nextCLI = applyCLITransition(cli, cliTransition);
	const nextDangerousPermissions = remapDangerousPermissions(readSettingsDangerousPermissions(), cliTransition, nextCLIProviders);
	settingsDangerousPermissions = normalizeDangerousPermissions(nextDangerousPermissions, nextCLIProviders);
	const cfg = {
		scan_paths: settingsScanPaths,
		extra_projects: settingsExtraProjects,
		project_tags: settingsProjectTags,
		cli_integrations: nextCLIIntegrations,
		theme: theme,
		terminal_font_size: terminalFont,
		cli: nextCLI,
		activity_provider: activityProviderSetting,
		gitlab_host: gitlabHostSetting,
            ...readSettingsUsage(),
            startup_git_pull_ff_only: startupGitPullFFOnlySetting,
            disable_sleep_prevention: !preventSleepSetting,
            dangerous_permissions: nextDangerousPermissions,
        };

        setSettingsSaveStatus('Saving...');
        let saved;
        try {
            saved = await fetchJSON('/api/config', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cfg),
            });
        } catch (err) {
            setSettingsSaveStatus('');
            showToast('Setting not saved', compactErrorMessage(err && err.message, 'Could not save settings.'), 'error', 5200);
            await loadSettingsForm();
            return false;
        }

	applyConfigState(saved);
	const migratedPaneCLI = migrateTerminalCLIs(cliTransition);
	settingsPendingCLIRenames = [];
	setThemeMode(saved.theme || theme);
	await loadRuntimeCapabilities();
	if (cliTransition.changed || migratedPaneCLI) {
		await saveTabsNow(cliTransition);
	}
        settingsSavedSnapshot = sentSnapshot;
        setSettingsSaveStatus('Saved');
        settingsCapabilities = runtimeCapabilities;
        if (settingsModalIsOpen()) renderSettingsCapabilities();

        // Rescanning is slow, so only refresh the project list when the
        // folders it comes from changed.
        if (JSON.stringify([previous.scanPaths, previous.extra]) !== JSON.stringify([sent.scanPaths, sent.extra])) {
            projects = await fetchJSON('/api/projects');
            updateBadges();
        }
        lastProjectListKey = '';
        renderProjectList();
        return true;
    }

    // ─── Side panels ─────────────────────────────────────────────────
    function updateSidePanels() {
        const gitPanel = document.getElementById('git-panel');
        if (gitPanel) gitPanel.classList.toggle('database-mode', databaseActive);
        renderWorkspaceControls();
        if (gitPanel) gitPanel.style.display = !databaseActive && (overviewActive || jobsActive) ? 'none' : '';
        reclampSidePanelWidths();
    }

    document.getElementById('agent-picker-backdrop').onclick = closeAgentPicker;
    document.getElementById('agent-picker-close').onclick = closeAgentPicker;

    // --- Coding activity ---
    function normalizeActivityProvider(value) {
        return Object.hasOwn(ACTIVITY_PROVIDERS, value) ? value : '';
    }

    function activityLevel(total) {
        if (total >= 30) return 4;
        if (total >= 15) return 3;
        if (total >= 5) return 2;
        if (total > 0) return 1;
        return 0;
    }

    function renderActivity(provider, data, error) {
        const body = document.getElementById('activity-body');
        const meta = ACTIVITY_PROVIDERS[provider];
        if (!body || !meta) return;
        if (error) {
            body.innerHTML = `<div class="activity-error">${esc(compactErrorMessage(error, `${meta.name} activity unavailable.`))}</div>`;
            return;
        }

        const total = Number(data && data.total) || 0;
        const level = activityLevel(total);
        const chips = [
            ['push', Number(data && data.pushes) || 0],
            [meta.pullRequests, Number(data && data.pull_requests) || 0],
            ['issue', Number(data && data.issues) || 0],
            ['comment', Number(data && data.comments) || 0],
            ['other', Number(data && data.other) || 0],
        ].filter(([, value], idx) => value > 0 || idx < 4);
        const label = `${meta.name} today`;
        const user = data && data.username ? `@${data.username}` : 'current user';

        body.innerHTML =
            `<div class="activity-main">` +
            `<span class="activity-tile level-${level}"></span>` +
            `<span class="activity-count">${total}</span>` +
            `<span class="activity-label">${esc(label)} · ${esc(user)}</span>` +
            `</div>` +
            `<div class="activity-chips">` +
            chips.map(([name, value]) => `<span class="activity-chip">${esc(name)} ${value}</span>`).join('') +
            `</div>`;
    }

    async function loadActivityToday() {
        const provider = activityProvider;
        if (!provider) return;
        const btn = document.getElementById('activity-refresh');
        if (btn) btn.classList.add('loading');
        try {
            const data = await fetchJSON(`/api/${provider}/activity/today`);
            if (provider === activityProvider) renderActivity(provider, data);
        } catch (err) {
            if (provider === activityProvider) renderActivity(provider, null, err && err.message);
        } finally {
            if (btn) btn.classList.remove('loading');
        }
    }

    // Switching code host, or GitLab instance, shows another account's counts,
    // so the tile reloads at once instead of waiting for the next poll.
    function syncActivity() {
        const section = document.getElementById('activity-section');
        if (!section) return;
        section.style.display = activityProvider ? '' : 'none';
        const key = activityProvider === 'gitlab' ? `gitlab|${gitlabHost}` : activityProvider;
        if (key === activityPollKey) return;
        activityPollKey = key;
        clearInterval(activityPollTimer);
        activityPollTimer = null;
        if (!key) return;
        const body = document.getElementById('activity-body');
        if (body) body.innerHTML = '<div class="activity-loading">loading...</div>';
        loadActivityToday();
        activityPollTimer = setInterval(loadActivityToday, 60000);
    }

    function initActivity() {
        document.getElementById('activity-refresh')?.addEventListener('click', () => {
            loadActivityToday();
        });
        syncActivity();
    }

    function syncSettingsGitLabHostRow() {
        const row = document.getElementById('settings-gitlab-host-row');
        if (row) row.hidden = document.getElementById('settings-activity-provider')?.value !== 'gitlab';
    }

    // --- AI usage ---
    // One box in the right panel shows the usage of the providers enabled in
    // USAGE_PROVIDERS, with a tab for each. It opens on the remembered tab,
    // which starts as whichever provider was turned on first.
    const USAGE_POLL_MS = 5 * 60 * 1000;
    const USAGE_ACTIVE_TAB_KEY = 'usage-active-tab';

    function formatUsageCost(value) {
        const amount = Number(value) || 0;
        return '$' + amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Reset times within a day show as a clock time, later ones with the weekday.
    function formatUsageReset(iso) {
        const at = new Date(iso);
        if (Number.isNaN(at.getTime())) return '';
        const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (at.getTime() - Date.now() < 24 * 60 * 60 * 1000) return time;
        return at.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
    }

    // Minutes under an hour, hours and minutes under a day, then days and hours.
    function formatUsageDuration(minutes) {
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
        const days = Math.floor(hours / 24);
        return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
    }

    // Time left until a window resets. The exact reset time is in the cell's
    // tooltip.
    function formatUsageCountdown(iso, now = Date.now()) {
        const at = new Date(iso).getTime();
        if (Number.isNaN(at)) return '';
        const minutes = Math.ceil((at - now) / 60000);
        return minutes <= 0 ? 'now' : formatUsageDuration(minutes);
    }

    // How long ago an old limits reading was taken: the last live one when the
    // CLI's login has expired, or one from Codex's logs, which can be days old.
    function formatUsageAge(iso, now = Date.now()) {
        const at = new Date(iso).getTime();
        if (Number.isNaN(at)) return '';
        return `updated ${formatUsageDuration(Math.max(0, Math.floor((now - at) / 60000)))} ago`;
    }

    // Usage data reloads every 5 minutes; the countdowns tick in between.
    function refreshUsageCountdowns() {
        document.querySelectorAll('.usage-limit-reset[data-resets-at]').forEach(cell => {
            cell.textContent = formatUsageCountdown(cell.dataset.resetsAt);
        });
        document.querySelectorAll('.usage-limit-note[data-observed-at]').forEach(note => {
            note.textContent = formatUsageAge(note.dataset.observedAt);
        });
    }

    function usageLimitsHTML(limits) {
        const windows = Array.isArray(limits && limits.windows) ? limits.windows : [];
        if (windows.length === 0) return '';
        const observed = new Date(limits.observed_at);
        const stale = !Number.isNaN(observed.getTime()) && Date.now() - observed.getTime() > 15 * 60 * 1000;
        const rows = windows.map(window => {
            const used = Math.max(0, Math.min(100, Number(window.used_percent) || 0));
            const level = used >= 85 ? ' high' : used >= 60 ? ' medium' : '';
            const reset = window.resets_at
                ? `<span class="usage-limit-reset" data-resets-at="${esc(window.resets_at)}" title="Resets ${esc(formatUsageReset(window.resets_at))}">${esc(formatUsageCountdown(window.resets_at))}</span>`
                : '<span class="usage-limit-reset"></span>';
            return '<div class="usage-limit-row">' +
                `<span class="usage-limit-label">${esc(window.label)}</span>` +
                `<span class="usage-limit-bar${level}"><span style="width:${used}%"></span></span>` +
                `<span class="usage-limit-value">${Math.round(used)}%</span>` +
                reset +
                '</div>';
        }).join('');
        const asOf = stale
            ? `<div class="usage-limit-note" data-observed-at="${esc(limits.observed_at)}" title="${esc(observed.toLocaleString())}">${esc(formatUsageAge(limits.observed_at))}</div>`
            : '';
        return `<div class="usage-limits">${rows}${asOf}</div>`;
    }

    function usageBudgetHTML(monthCost, budget) {
        if (!(budget > 0)) return '';
        const ratio = Math.max(0, monthCost) / budget * 100;
        const used = Math.min(100, Math.round(ratio * 10) / 10);
        const level = ratio >= 85 ? ' high' : ratio >= 60 ? ' medium' : '';
        return '<div class="usage-limits usage-budget"><div class="usage-limit-row">' +
            '<span class="usage-limit-label">Budget</span>' +
            `<span class="usage-limit-bar${level}"><span style="width:${used}%"></span></span>` +
            `<span class="usage-limit-value usage-budget-value">${formatUsageCost(monthCost)} / ${formatUsageCost(budget)}</span>` +
            '</div></div>';
    }

    // Billing "api" means paying per token, which has a monthly budget instead
    // of plan windows.
    function usageSummaryHTML(provider, state) {
        const { data, error } = state;
        if (error) {
            return `<div class="usage-error">${esc(compactErrorMessage(error, `${provider.label} usage unavailable.`))}</div>`;
        }
        const periods = Array.isArray(data && data.periods) ? data.periods : [];
        if (periods.length === 0) return '<div class="usage-loading">No usage data.</div>';

        const countPeriods = ['today', 'week', 'month'].map(key => periods.find(period => period && period.key === key));
        const countCell = (period, field) => period && period.total ? String(Number(period.total[field]) || 0) : '—';
        let extras;
        if (state.billing === 'api') {
            const month = countPeriods[2];
            extras = usageBudgetHTML(month && month.total ? Number(month.total.cost) || 0 : 0, state.budget);
        } else {
            extras = usageLimitsHTML(data.limits);
            if (!extras && provider.limitsHint) extras = `<div class="usage-limit-note">${esc(provider.limitsHint)}</div>`;
        }
        return '<table class="usage-summary">' +
            '<thead><tr><th></th><th>Today</th><th>Week</th><th>Month</th></tr></thead>' +
            '<tbody>' +
                '<tr class="usage-cost-row"><th scope="row" title="Estimated at standard API pricing" aria-label="Estimated standard API cost">Est. API cost</th>' + countPeriods.map((period, index) => {
                    if (!period || !period.total) return '<td class="warn">—</td>';
                    let title = period.start && period.end ? `${period.start} - ${period.end}` : '';
                    const primaryClass = index === 0 ? ' class="primary"' : '';
                    // Tokens from a model without a known price aren't in the
                    // cost, so it is only a lower bound.
                    const unpriced = Array.isArray(period.total.unpriced_models) ? period.total.unpriced_models : [];
                    if (unpriced.length > 0) title = `No price known for ${unpriced.join(', ')}; their usage is not counted.`;
                    const mark = unpriced.length > 0 ? '+' : '';
                    return `<td${primaryClass} title="${esc(title)}">${formatUsageCost(period.total.cost)}${mark}</td>`;
                }).join('') + '</tr>' +
                '<tr><th scope="row">messages</th>' + countPeriods.map(period => `<td>${countCell(period, 'messages')}</td>`).join('') + '</tr>' +
            '</tbody>' +
            '</table>' + extras;
    }


    function usageProviderInstalled(provider, capabilities = runtimeCapabilities) {
        const dep = capabilities && capabilities.dependencies && capabilities.dependencies[provider.dependency];
        return !!(dep && dep.available);
    }

    function enabledUsageProviders() {
        return USAGE_PROVIDERS.filter(provider => usageState[provider.id].show && usageProviderInstalled(provider));
    }

    function loadUsageActiveTab() {
        try {
            return localStorage.getItem(USAGE_ACTIVE_TAB_KEY) || '';
        } catch {
            return '';
        }
    }

    function saveUsageActiveTab(id) {
        try {
            if (id) localStorage.setItem(USAGE_ACTIVE_TAB_KEY, id);
            else localStorage.removeItem(USAGE_ACTIVE_TAB_KEY);
        } catch {}
    }

    function activeUsageProvider() {
        const enabled = enabledUsageProviders();
        const stored = loadUsageActiveTab();
        return enabled.find(provider => provider.id === stored) || enabled[0] || null;
    }

    function usageTabsHTML(enabled, active) {
        return enabled.map(provider => {
            const selected = provider === active;
            const classes = ['usage-tab'];
            if (selected) classes.push('active');
            // A single provider's tab is just the box's title.
            if (enabled.length === 1) classes.push('only');
            return `<button type="button" class="${classes.join(' ')}" role="tab" data-usage-tab="${esc(provider.id)}" aria-selected="${selected}">${esc(provider.label)}</button>`;
        }).join('');
    }

    function renderUsageBox() {
        const section = document.getElementById('usage-section');
        if (!section) return;
        const active = activeUsageProvider();
        section.style.display = active ? '' : 'none';
        if (!active) return;
        const state = usageState[active.id];
        const tabs = document.getElementById('usage-tabs');
        if (tabs) tabs.innerHTML = usageTabsHTML(enabledUsageProviders(), active);
        const refresh = document.getElementById('usage-refresh');
        if (refresh) {
            refresh.classList.toggle('loading', Boolean(state.loadPromise));
            refresh.title = `Refresh ${active.label} usage`;
        }
        const body = document.getElementById('usage-body');
        if (body) {
            body.innerHTML = state.data || state.error
                ? usageSummaryHTML(active, state)
                : '<div class="usage-loading">loading...</div>';
        }
    }

    // A fresh load waits for a cached one already in flight, then asks again.
    function loadUsage(provider, { fresh = false } = {}) {
        const state = usageState[provider.id];
        if (state.loadPromise) {
            if (!fresh || state.loadIsFresh) return state.loadPromise;
            return state.loadPromise.then(() => loadUsage(provider, { fresh: true }));
        }
        state.loadIsFresh = fresh;
        state.loadPromise = (async () => {
            const params = new URLSearchParams();
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            if (tz) params.set('tz', tz);
            if (fresh) params.set('fresh', '1');
            const query = params.toString();
            try {
                state.data = await fetchJSON(`/api/${provider.id}/usage${query ? `?${query}` : ''}`);
                state.error = '';
            } catch (err) {
                state.data = null;
                state.error = (err && err.message) || `${provider.label} usage unavailable.`;
            }
        })().finally(() => {
            state.loadPromise = null;
            state.loadIsFresh = false;
            renderUsageBox();
        });
        renderUsageBox();
        return state.loadPromise;
    }

    function refreshActiveUsage({ fresh = false } = {}) {
        const active = activeUsageProvider();
        return active ? loadUsage(active, { fresh }) : Promise.resolve();
    }

    // Only the open tab polls. Switching tabs shows its last result while it
    // reloads, which the server answers from its 5-minute cache.
    function syncUsage() {
        clearInterval(usagePollTimer);
        usagePollTimer = null;
        renderUsageBox();
        if (!activeUsageProvider()) return;
        refreshActiveUsage();
        usagePollTimer = setInterval(refreshActiveUsage, USAGE_POLL_MS);
    }

    function selectUsageTab(id) {
        if (!enabledUsageProviders().some(provider => provider.id === id)) return;
        saveUsageActiveTab(id);
        syncUsage();
    }

    function applyUsageConfig(cfg) {
        USAGE_PROVIDERS.forEach(({ id }) => {
            const state = usageState[id];
            state.show = Boolean(cfg && cfg[`show_${id}_usage`]);
            state.billing = cfg && cfg[`${id}_billing`] === 'api' ? 'api' : '';
            state.budget = Number(cfg && cfg[`${id}_monthly_budget`]) || 0;
        });
    }

    function initUsage() {
        document.getElementById('usage-tabs')?.addEventListener('click', event => {
            const tab = event.target.closest('[data-usage-tab]');
            if (tab) selectUsageTab(tab.dataset.usageTab);
        });
        document.getElementById('usage-refresh')?.addEventListener('click', () => {
            refreshActiveUsage({ fresh: true });
        });
        setInterval(refreshUsageCountdowns, 60000);
        syncUsage();
    }

    // --- AI usage settings ---
    function settingsUsageRowsHTML(provider) {
        const id = esc(provider.id);
        const label = esc(provider.label);
        return `
            <h3 class="settings-section-title">${label} usage</h3>
            <div class="settings-row">
                <div class="settings-row-text">
                    <div class="settings-row-label" id="settings-${id}-usage-label">Show ${label} usage</div>
                    <div class="settings-row-desc">${esc(provider.description)}</div>
                </div>
                <div class="settings-row-control">
                    <label class="settings-switch"><input type="checkbox" id="settings-${id}-usage" aria-labelledby="settings-${id}-usage-label"><span class="settings-switch-track"></span></label>
                </div>
            </div>
            <div class="settings-row">
                <div class="settings-row-text">
                    <div class="settings-row-label" id="settings-${id}-billing-label">${label} billing</div>
                    <div class="settings-row-desc">A subscription shows its 5-hour and weekly limits; an API key shows the month against a budget.</div>
                </div>
                <div class="settings-row-control">
                    <select id="settings-${id}-billing" aria-labelledby="settings-${id}-billing-label">
                        <option value="">${esc(provider.subscription)}</option>
                        <option value="api">API key</option>
                    </select>
                </div>
            </div>
            <div class="settings-row" id="settings-${id}-budget-row">
                <div class="settings-row-text">
                    <div class="settings-row-label" id="settings-${id}-budget-label">${label} monthly budget</div>
                    <div class="settings-row-desc">In US dollars. Leave at 0 for no budget bar.</div>
                </div>
                <div class="settings-row-control">
                    <input type="number" id="settings-${id}-budget" aria-labelledby="settings-${id}-budget-label" min="0" step="1" value="0">
                </div>
            </div>`;
    }

    function initSettingsUsageRows() {
        const root = document.getElementById('settings-usage-rows');
        if (!root) return;
        root.innerHTML = USAGE_PROVIDERS.map(settingsUsageRowsHTML).join('');
        root.addEventListener('change', event => {
            const provider = USAGE_PROVIDERS.find(({ id }) => event.target.id === `settings-${id}-usage`);
            if (provider) noteUsageToggle(provider.id, event.target.checked);
            syncSettingsBillingRows();
        });
    }

    function settingsBudgetValue(id) {
        const value = Number(document.getElementById(id)?.value);
        return Number.isFinite(value) && value > 0 ? value : 0;
    }

    // The usage settings as config fields, for saving and for the change
    // snapshot.
    function readSettingsUsage() {
        return Object.fromEntries(USAGE_PROVIDERS.flatMap(({ id }) => [
            [`show_${id}_usage`, Boolean(document.getElementById(`settings-${id}-usage`)?.checked)],
            [`${id}_billing`, document.getElementById(`settings-${id}-billing`)?.value === 'api' ? 'api' : ''],
            [`${id}_monthly_budget`, settingsBudgetValue(`settings-${id}-budget`)],
        ]));
    }

    function writeSettingsUsage() {
        USAGE_PROVIDERS.forEach(({ id }) => {
            const state = usageState[id];
            const toggle = document.getElementById(`settings-${id}-usage`);
            if (toggle) toggle.checked = state.show;
            const billing = document.getElementById(`settings-${id}-billing`);
            if (billing) billing.value = state.billing;
            const budget = document.getElementById(`settings-${id}-budget`);
            if (budget) budget.value = String(state.budget);
        });
        syncSettingsBillingRows();
    }

    // Only an API key has a monthly budget; a subscription shows plan windows.
    function syncSettingsBillingRows() {
        USAGE_PROVIDERS.forEach(({ id }) => {
            const budgetRow = document.getElementById(`settings-${id}-budget-row`);
            if (budgetRow) budgetRow.hidden = document.getElementById(`settings-${id}-billing`)?.value !== 'api';
        });
    }

    // A provider whose CLI is missing can't be turned on, but can be turned off.
    function syncSettingsUsageToggles() {
        USAGE_PROVIDERS.forEach(provider => {
            const toggle = document.getElementById(`settings-${provider.id}-usage`);
            if (!toggle) return;
            const ready = !settingsCapabilities || usageProviderInstalled(provider, settingsCapabilities);
            toggle.disabled = !ready && !toggle.checked;
            toggle.title = ready ? ''
                : toggle.checked ? `${provider.cliName} is not installed. You can turn this off.`
                : `${provider.cliName} is not installed.`;
        });
    }

    // Turning a provider on makes it the box's default tab unless the current
    // default is still on; turning the default off hands it to one still on.
    function noteUsageToggle(id, on) {
        const othersOn = USAGE_PROVIDERS
            .filter(provider => provider.id !== id && document.getElementById(`settings-${provider.id}-usage`)?.checked)
            .map(provider => provider.id);
        const stored = loadUsageActiveTab();
        if (on && !othersOn.includes(stored)) saveUsageActiveTab(id);
        if (!on && stored === id) saveUsageActiveTab(othersOn[0] || '');
    }

    // ─── External links ─────────────────────────────────────────────
    async function openExternal(url) {
        const helpers = window.TerminalInteractions;
        if (helpers && typeof helpers.openExternalUrl === 'function') {
            return helpers.openExternalUrl(url, {
                electronOpenExternal: window.electronOpenExternal,
                openWindow: window.open.bind(window),
                notify: (message) => showToast('External link failed', compactErrorMessage(message), 'error', 5200),
                console,
            });
        }

        showToast('External link failed', compactErrorMessage(`Unable to open external link.\n\n${url || ''}`), 'error', 5200);
        return { ok: false, error: 'External opener unavailable' };
    }

    // ─── Database Workbench ──────────────────────────────────────────
    const DATABASE_QUERY_TABS_KEY = 'database-query-tabs-v1';
    const DATABASE_HISTORY_KEY = 'database-query-history-v1';
    const DATABASE_SELECTED_CONNECTION_KEY = 'database-selected-connection-v1';
    const DATABASE_ACTIVE_VIEW_KEY = 'database-active-view-v1';

    function normalizeDatabaseSavedQueries(items) {
        if (!Array.isArray(items)) return [];
        return items
            .map(item => ({
                id: String(item && item.id || '').trim(),
                name: String(item && item.name || '').trim(),
                sql: String(item && item.sql || '').trim(),
                connection_id: String(item && item.connection_id || '').trim(),
                connection_name: String(item && item.connection_name || '').trim(),
                created_at: String(item && item.created_at || '').trim(),
                updated_at: String(item && item.updated_at || '').trim(),
            }))
            .filter(item => item.id && item.name && item.sql)
            .slice(0, 100);
    }

    function databaseQueriesOrphanedFromConnection(conn) {
        const now = new Date().toISOString();
        return normalizeDatabaseSavedQueries(conn && conn.saved_queries).map(query => ({
            ...query,
            connection_id: query.connection_id || String(conn && conn.id || ''),
            connection_name: query.connection_name || String(conn && conn.name || ''),
            updated_at: query.updated_at || now,
        }));
    }

    function mergeDatabaseOrphanedQueries(existing, additions) {
        const seen = new Set();
        return [...normalizeDatabaseSavedQueries(additions), ...normalizeDatabaseSavedQueries(existing)]
            .filter(query => {
                if (seen.has(query.id)) return false;
                seen.add(query.id);
                return true;
            })
            .slice(0, 100);
    }

    function normalizeDatabaseConnections(items) {
        if (!Array.isArray(items)) return [];
        return items
            .map((conn) => ({
                id: String(conn && conn.id || '').trim(),
                name: String(conn && conn.name || '').trim(),
                driver: normalizeDatabaseDriver(conn && conn.driver),
                sqlite_path: String(conn && conn.sqlite_path || '').trim(),
                host: String(conn && conn.host || '').trim(),
                port: Number.parseInt(conn && conn.port, 10) || 0,
                database: String(conn && conn.database || '').trim(),
                user: String(conn && conn.user || '').trim(),
                password: String(conn && conn.password || ''),
                has_password: Boolean(conn && conn.has_password),
                project: String(conn && conn.project || '').trim(),
                sslmode: String(conn && conn.sslmode || '').trim(),
                params: conn && conn.params && typeof conn.params === 'object' ? { ...conn.params } : {},
                saved_queries: normalizeDatabaseSavedQueries(conn && conn.saved_queries),
            }))
            .filter(conn => conn.id && conn.name && conn.driver);
    }

    function normalizeDatabaseDriver(driver) {
        const value = String(driver || '').trim().toLowerCase();
        if (['postgresql', 'pgsql', 'pg'].includes(value)) return 'postgres';
        if (value === 'mariadb') return 'mysql';
        if (value === 'sqlite3') return 'sqlite';
        return ['sqlite', 'postgres', 'mysql'].includes(value) ? value : '';
    }

    function databaseDriverLabel(driver) {
        switch (normalizeDatabaseDriver(driver)) {
        case 'sqlite': return 'SQLite';
        case 'postgres': return 'Postgres';
        case 'mysql': return 'MySQL';
        default: return 'Database';
        }
    }

    function databaseTableKindLabel(type) {
        const value = String(type || '').trim().toLowerCase().replace(/_/g, ' ');
        if (!value || value === 'base table') return 'table';
        return value;
    }

    function databaseConnectionByID(id, list = databaseConnections) {
        return list.find(conn => conn.id === id) || null;
    }

    function databaseConnectionSignature(conn) {
        if (!conn) return '';
        const copy = { ...conn };
        delete copy.saved_queries;
        return JSON.stringify(copy);
    }

    function databaseSchemaCacheForConnection(connectionID = selectedDatabaseID) {
        const id = String(connectionID || '');
        return id ? databaseSchemaCacheByConnection[id] || null : null;
    }

    function setDatabaseSchemaCache(connectionID, schema) {
        const id = String(connectionID || '');
        if (!id) return;
        databaseSchemaCacheByConnection[id] = schema;
        databaseSchemaConnectionSignatures[id] = databaseConnectionSignature(databaseConnectionByID(id));
    }

    function clearDatabaseSchemaCache(connectionID) {
        const id = String(connectionID || '');
        if (!id) return;
        delete databaseSchemaCacheByConnection[id];
        delete databaseSchemaLoadingByConnection[id];
        delete databaseSchemaErrorByConnection[id];
        delete databaseSchemaRequestSeqByConnection[id];
        delete databaseSchemaConnectionSignatures[id];
    }

    function databaseSchemaLoadingForConnection(connectionID) {
        return Boolean(databaseSchemaLoadingByConnection[String(connectionID || '')]);
    }

    function setDatabaseSchemaLoading(connectionID, loading) {
        const id = String(connectionID || '');
        if (!id) return;
        if (loading) databaseSchemaLoadingByConnection[id] = true;
        else delete databaseSchemaLoadingByConnection[id];
    }

    function databaseSchemaErrorForConnection(connectionID) {
        return databaseSchemaErrorByConnection[String(connectionID || '')] || '';
    }

    function setDatabaseSchemaError(connectionID, message) {
        const id = String(connectionID || '');
        if (!id) return;
        if (message) databaseSchemaErrorByConnection[id] = message;
        else delete databaseSchemaErrorByConnection[id];
    }

function setDatabaseConnectionConnected(connectionID, connected) {
    const id = String(connectionID || '');
    if (!id) return;
    if (databaseConnectedExpiryTimers[id]) {
        clearTimeout(databaseConnectedExpiryTimers[id]);
        delete databaseConnectedExpiryTimers[id];
    }
    if (connected) {
        databaseConnectedByConnection[id] = true;
        databaseConnectedAtByConnection[id] = Date.now();
        databaseConnectedExpiryTimers[id] = setTimeout(() => {
            delete databaseConnectedByConnection[id];
            delete databaseConnectedAtByConnection[id];
            delete databaseConnectedExpiryTimers[id];
            renderDatabaseConnectionTree();
        }, DATABASE_CONNECTION_STATUS_TTL_MS);
    } else {
        delete databaseConnectedByConnection[id];
        delete databaseConnectedAtByConnection[id];
    }
}

function databaseConnectionConnected(connectionID) {
    const id = String(connectionID || '');
    if (!databaseConnectedByConnection[id]) return false;
    const connectedAt = Number(databaseConnectedAtByConnection[id] || 0);
    if (connectedAt && Date.now() - connectedAt >= DATABASE_CONNECTION_STATUS_TTL_MS) {
        setDatabaseConnectionConnected(id, false);
        return false;
    }
    return true;
}

function normalizeDatabaseConnectionStatuses(value) {
    const out = {};
    if (!value || typeof value !== 'object') return out;
    Object.entries(value).forEach(([id, connected]) => {
        if (connected) out[String(id)] = true;
    });
    return out;
}

function applyDatabaseConnectionStatuses(value) {
    const statuses = normalizeDatabaseConnectionStatuses(value);
    const connectedIDs = new Set(Object.keys(statuses));
    Object.keys(databaseConnectedByConnection).forEach(id => {
        if (!connectedIDs.has(id)) setDatabaseConnectionConnected(id, false);
    });
    connectedIDs.forEach(id => setDatabaseConnectionConnected(id, true));
}

    function syncDatabaseSchemaCachesWithConnections() {
    const valid = new Set(databaseConnections.map(conn => String(conn.id || '')).filter(Boolean));
    [databaseSchemaCacheByConnection, databaseSchemaLoadingByConnection, databaseSchemaErrorByConnection,
        databaseSchemaRequestSeqByConnection, databaseSchemaConnectionSignatures, databaseConnectedByConnection,
        databaseConnectedAtByConnection]
        .forEach(store => {
            Object.keys(store).forEach(id => {
                if (!valid.has(id)) delete store[id];
            });
        });
    Object.keys(databaseConnectedExpiryTimers).forEach(id => {
        if (!valid.has(id)) {
            clearTimeout(databaseConnectedExpiryTimers[id]);
            delete databaseConnectedExpiryTimers[id];
        }
    });
        databaseConnections.forEach(conn => {
            const id = String(conn.id || '');
            if (!id) return;
            const signature = databaseConnectionSignature(conn);
            const cachedSignature = databaseSchemaConnectionSignatures[id];
            if (cachedSignature && cachedSignature !== signature) {
                clearDatabaseSchemaCache(id);
                setDatabaseConnectionConnected(id, false);
            }
        });
    }

    function upsertDatabaseSchemaGroup(connectionID, schema) {
        const id = String(connectionID || '');
        const name = schema?.name || 'main';
        if (!id || !schema) return;
        const cache = databaseSchemaCacheForConnection(id) || { connection: databaseConnectionByID(id), schemas: [] };
        const schemas = Array.isArray(cache.schemas) ? [...cache.schemas] : [];
        const nextSchema = {
            ...schema,
            name,
            tables: (schema.tables || []).map(table => ({ ...table, schema: table.schema || name })),
        };
        const index = schemas.findIndex(item => (item.name || 'main') === name);
        if (index >= 0) schemas[index] = nextSchema;
        else schemas.push(nextSchema);
        schemas.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        setDatabaseSchemaCache(id, { ...cache, connection: databaseConnectionByID(id) || cache.connection, schemas });
    }

    function upsertDatabaseTableSchema(connectionID, table) {
        const id = String(connectionID || '');
        if (!id || !table) return;
        const schemaName = table.schema || 'main';
        const cache = databaseSchemaCacheForConnection(id) || { connection: databaseConnectionByID(id), schemas: [] };
        const schemas = Array.isArray(cache.schemas) ? [...cache.schemas] : [];
        let schema = schemas.find(item => (item.name || 'main') === schemaName);
        if (!schema) {
            schema = { name: schemaName, tables: [] };
            schemas.push(schema);
        }
        const tables = Array.isArray(schema.tables) ? [...schema.tables] : [];
        const nextTable = { ...table, schema: schemaName };
        const index = tables.findIndex(item => item.name === nextTable.name);
        if (index >= 0) tables[index] = nextTable;
        else tables.push(nextTable);
        tables.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        schema.tables = tables;
        schemas.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        setDatabaseSchemaCache(id, { ...cache, connection: databaseConnectionByID(id) || cache.connection, schemas });
    }

    function loadStoredDatabaseState() {
        try {
            selectedDatabaseID = localStorage.getItem(DATABASE_SELECTED_CONNECTION_KEY) || '';
        } catch {}
    }

    function persistSelectedDatabaseConnection() {
        try {
            if (selectedDatabaseID) localStorage.setItem(DATABASE_SELECTED_CONNECTION_KEY, selectedDatabaseID);
            else localStorage.removeItem(DATABASE_SELECTED_CONNECTION_KEY);
        } catch {}
    }

    function persistDatabaseActiveView(active) {
        try {
            if (active) localStorage.setItem(DATABASE_ACTIVE_VIEW_KEY, '1');
            else localStorage.removeItem(DATABASE_ACTIVE_VIEW_KEY);
        } catch {}
    }

    function shouldRestoreDatabaseView() {
        try {
            return localStorage.getItem(DATABASE_ACTIVE_VIEW_KEY) === '1';
        } catch {
            return false;
        }
    }

    function databaseConnectionSubtitle(conn) {
        if (!conn) return '';
        if (conn.driver === 'sqlite') return conn.sqlite_path || 'SQLite';
        const port = conn.port ? `:${conn.port}` : '';
        return `${conn.user ? conn.user + '@' : ''}${conn.host || 'localhost'}${port}/${conn.database || ''}`;
    }

    function databaseConnectionDatabaseName(conn) {
        if (!conn) return '';
        if (conn.database) return conn.database;
        if (conn.driver === 'sqlite' && conn.sqlite_path) {
            const parts = conn.sqlite_path.split(/[\\/]/).filter(Boolean);
            return parts[parts.length - 1] || conn.sqlite_path;
        }
        return '';
    }

    function databaseHeaderTitle() {
        const conn = databaseConnectionByID(selectedDatabaseID);
        if (!conn) return 'Database';
        const details = [conn.name, databaseConnectionDatabaseName(conn)]
            .map(item => String(item || '').trim())
            .filter(Boolean);
        return ['Database', ...details].join(' - ');
    }

    function renderDatabaseHeaderTitle() {
        const title = document.getElementById('database-header-title');
        if (title) title.textContent = databaseHeaderTitle();
    }

    function databasePasswordLabel(conn) {
        if (!conn || conn.driver === 'sqlite') return 'no password';
        return conn.has_password ? 'password saved' : 'no password saved';
    }

    function databaseQueryInput() {
        return document.getElementById('database-query-input');
    }

    function databaseQueryValue() {
        if (databaseQueryEditor) return databaseQueryEditor.getValue();
        return databaseQueryInput()?.value || '';
    }

    function setDatabaseQueryValue(value) {
        const next = String(value || '');
        const input = databaseQueryInput();
        if (input && input.value !== next) input.value = next;
        if (databaseQueryEditor && databaseQueryEditor.getValue() !== next) {
            databaseQueryEditorSyncing = true;
            databaseQueryEditor.setValue(next);
            databaseQueryEditorSyncing = false;
        }
    }

    function focusDatabaseQueryInput() {
        if (databaseQueryEditor) {
            databaseQueryEditor.focus();
            return;
        }
        databaseQueryInput()?.focus();
    }

    function initDatabaseQueryEditor() {
        const host = document.getElementById('database-query-editor');
        const input = databaseQueryInput();
        if (!host || !input || databaseQueryEditor) return;
        ensureMonaco(() => {
            if (databaseQueryEditor || !document.getElementById('database-query-editor')) return;
            registerDatabaseSQLCompletions();
            const tab = activeDatabaseQueryTab();
            const model = monaco.editor.createModel(tab?.sql || input.value || 'select 1;', 'sql');
            databaseQueryEditor = monaco.editor.create(host, {
                model,
                theme: getMonacoThemeName(),
                automaticLayout: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
                lineNumbers: 'off',
                glyphMargin: false,
                folding: false,
                wordWrap: 'on',
                wrappingIndent: 'same',
                renderLineHighlight: 'line',
                bracketPairColorization: { enabled: true },
                fixedOverflowWidgets: true,
                padding: { top: 10, bottom: 10 },
            });
            host.classList.add('active');
            input.classList.add('database-query-input-fallback');
            databaseQueryEditor.onDidChangeModelContent(() => {
                if (databaseQueryEditorSyncing) return;
                updateActiveDatabaseQuerySQL();
            });
            const editorScope = 'databaseQueryEditorFocused';
            databaseQueryEditor.createContextKey(editorScope, true);
            databaseQueryEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                runDatabaseQuery(false);
            }, editorScope);
            host.addEventListener('keydown', ev => {
                consumeDatabaseAutocompleteEscape(ev);
            }, true);
            setDatabaseQueryValue(tab?.sql || input.value || 'select 1;');
            if (databaseActive && databaseActiveTabKind === 'query') databaseQueryEditor.layout();
        });
    }

    function registerDatabaseSQLCompletions() {
        if (databaseSQLCompletionRegistered || typeof monaco === 'undefined') return;
        databaseSQLCompletionRegistered = true;
        monaco.languages.registerCompletionItemProvider('sql', {
            triggerCharacters: [' ', '.', '\n', '\t'],
            provideCompletionItems(model, position) {
                return { suggestions: databaseSQLCompletionItems(model, position) };
            },
        });
    }

    function databaseMonacoCompletionRange(model, position) {
        const word = model.getWordUntilPosition(position);
        return {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
        };
    }

    function databaseSQLCompletionItems(model, position) {
        const range = databaseMonacoCompletionRange(model, position);
        const kind = monaco.languages.CompletionItemKind;
    const whereTab = databaseWhereCompletionModels.get(model);
    if (whereTab) return databaseWhereMonacoCompletionItems(model, position, whereTab, range, kind);
    const context = databaseSQLCompletionContext(model, position);
    if (context.insideQuotedText) return [];
    const tab = activeDatabaseQueryTab();
    const tables = databaseSchemaCompletionTables(tab?.connectionID || selectedDatabaseID);
        const refs = databaseSQLStatementTableRefs(context.fullStatement || context.statement, tables);
        const items = [];
        const seen = new Set();
        const push = item => databaseSQLPushCompletion(items, seen, item);

        if (context.qualifier) {
            databaseSQLQualifiedCompletionItems(context.qualifier, tables, refs, range, kind).forEach(push);
            if (items.length > 0) return items.slice(0, 500);
        }

        if (context.area === 'table') {
            databaseSQLTableCompletionItems(tables, range, kind, '0').forEach(push);
            databaseSQLKeywordCompletionItems(range, kind, DATABASE_SQL_TABLE_CONTEXT_KEYWORDS, '2', { model, position }).forEach(push);
        } else if (context.area === 'column') {
            databaseSQLReferencedColumnCompletionItems(refs, range, kind, '0').forEach(push);
            if (refs.length === 0) databaseSQLAllColumnCompletionItems(tables, range, kind, '1').forEach(push);
            databaseSQLKeywordCompletionItems(range, kind, DATABASE_SQL_COLUMN_CONTEXT_KEYWORDS, '2', { model, position }).forEach(push);
        } else {
            databaseSQLKeywordCompletionItems(range, kind, DATABASE_SQL_COMPLETION_KEYWORDS, '0', { model, position }).forEach(push);
            databaseSQLTableCompletionItems(tables, range, kind, '1').forEach(push);
            databaseSQLReferencedColumnCompletionItems(refs, range, kind, '2').forEach(push);
            if (refs.length === 0) databaseSQLAllColumnCompletionItems(tables, range, kind, '3').forEach(push);
        }
        return items.slice(0, 500);
    }

    function databaseWhereMonacoCompletionItems(model, position, tab, range, kind) {
        const before = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
        });
        const word = model.getWordUntilPosition(position);
        if (databaseSQLCursorInQuotedText(before)) return [];
        const qualifier = databaseSQLCompletionQualifier(before, word.word);
        const refs = [{ table: tab.table, alias: '' }];
        const items = [];
        const seen = new Set();
        const push = item => databaseSQLPushCompletion(items, seen, item);
        if (qualifier) {
            const parts = qualifier.parts || [];
            const tableName = databaseSQLNormalizeName(parts[parts.length - 1]);
            const schemaName = parts.length > 1 ? databaseSQLNormalizeName(parts[parts.length - 2]) : '';
            const tableMatches = tableName === databaseSQLNormalizeName(tab.table?.name)
                && (!schemaName || schemaName === databaseSQLNormalizeName(tab.table?.schema || 'main'));
            if (tableMatches) {
                databaseSQLReferencedColumnCompletionItems(refs, range, kind, '0', { includePrefix: false, insertPrefix: false }).forEach(push);
            }
            return items.slice(0, 200);
        }
        databaseSQLReferencedColumnCompletionItems(refs, range, kind, '0').forEach(push);
        databaseSQLKeywordCompletionItems(range, kind, DATABASE_WHERE_COMPLETION_KEYWORDS, '1', { model, position }).forEach(push);
        return items.slice(0, 200);
    }

    function databaseSQLCompletionContext(model, position) {
        const before = model.getValueInRange({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
        });
        const word = model.getWordUntilPosition(position);
        const statement = databaseSQLCurrentStatement(before);
        const fullStatement = databaseSQLCurrentStatementAtPosition(model, position, statement);
        if (databaseSQLCursorInQuotedText(before)) {
            return {
                statement,
                fullStatement,
                qualifier: null,
                area: 'quoted',
                insideQuotedText: true,
            };
        }
        const qualifier = databaseSQLCompletionQualifier(before, word.word);
        return {
            statement,
            fullStatement,
            qualifier,
            area: qualifier ? 'qualified' : databaseSQLCompletionArea(statement),
            insideQuotedText: false,
        };
    }

    function databaseSQLCurrentStatement(text) {
        const value = String(text || '');
        const index = value.lastIndexOf(';');
        return index >= 0 ? value.slice(index + 1) : value;
    }

    function databaseSQLCurrentStatementAtPosition(model, position, fallback = '') {
        if (!model || !position || typeof model.getValue !== 'function' || typeof model.getOffsetAt !== 'function') return fallback;
        try {
            const value = model.getValue();
            const offset = Math.max(0, Math.min(model.getOffsetAt(position), value.length));
            const start = value.lastIndexOf(';', Math.max(0, offset - 1)) + 1;
            const next = value.indexOf(';', offset);
            const end = next >= 0 ? next : value.length;
            return value.slice(start, end);
        } catch {
            return fallback;
        }
    }

    function databaseSQLCompletionQualifier(before, currentWord = '') {
        const base = String(before || '').slice(0, Math.max(0, String(before || '').length - String(currentWord || '').length));
        const ident = databaseSQLIdentifierPatternSource();
        const match = base.match(new RegExp(`((?:${ident}\\s*\\.\\s*)?${ident})\\s*\\.\\s*$`));
        if (!match) return null;
        const parts = databaseSQLIdentifierParts(match[1]);
        return parts.length > 0 ? { text: match[1], parts } : null;
    }

    function databaseSQLCompletionArea(statement) {
        const text = databaseSQLPlainText(statement).toLowerCase();
        const clauses = [
            { re: /\border\s+by\b/g, area: 'column' },
            { re: /\bgroup\s+by\b/g, area: 'column' },
            { re: /\bwhere\b/g, area: 'column' },
            { re: /\bhaving\b/g, area: 'column' },
            { re: /\bon\b/g, area: 'column' },
            { re: /\bselect\b/g, area: 'column' },
            { re: /\bfrom\b/g, area: 'table' },
            { re: /\bjoin\b/g, area: 'table' },
            { re: /\bupdate\b/g, area: 'table' },
            { re: /\binto\b/g, area: 'table' },
            { re: /\bdescribe\b/g, area: 'table' },
            { re: /\bdesc\b/g, area: 'table' },
        ];
        let latest = { index: -1, area: 'mixed' };
        clauses.forEach(clause => {
            let match;
            while ((match = clause.re.exec(text))) {
                if (match.index >= latest.index) latest = { index: match.index, area: clause.area };
            }
        });
        return latest.area;
    }

    function databaseSQLPlainText(text) {
        return String(text || '')
            .replace(/--.*$/gm, ' ')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/'(?:''|[^'])*'/g, ' ')
            .replace(/"(?:\"\"|[^"])*"/g, ' ')
            .replace(/`[^`]*`/g, ' ');
    }

    function databaseSQLCursorInQuotedText(text, offset = null) {
        const value = String(text || '');
        const end = Number.isInteger(offset) ? Math.max(0, Math.min(offset, value.length)) : value.length;
        let quote = '';
        for (let i = 0; i < end; i++) {
            const ch = value[i];
            const next = value[i + 1] || '';
            if (quote) {
                if (ch === '\\' && quote !== '`') {
                    i++;
                } else if (ch === quote) {
                    if (next === quote) i++;
                    else quote = '';
                }
                continue;
            }
            if (ch === '-' && next === '-') {
                i = value.indexOf('\n', i + 2);
                if (i < 0 || i >= end) break;
                continue;
            }
            if (ch === '/' && next === '*') {
                const close = value.indexOf('*/', i + 2);
                if (close < 0 || close + 2 >= end) break;
                i = close + 1;
                continue;
            }
            if (ch === '\'' || ch === '"' || ch === '`') quote = ch;
        }
        return Boolean(quote);
    }

    function databaseSQLPushCompletion(items, seen, item) {
        if (!item || !item.label) return;
        const key = [item.label, item.insertText || '', item.detail || ''].join('\u001f');
        if (seen.has(key)) return;
        seen.add(key);
        items.push(item);
    }

    function databaseSQLKeywordCompletionItems(range, kind, keywords, sortPrefix, options = {}) {
        return keywords.map(keyword => ({
            label: keyword,
            kind: kind.Keyword,
            insertText: keyword,
            range: databaseSQLKeywordCompletionRange(options.model, options.position, keyword, range),
            sortText: `${sortPrefix}-keyword-${keyword}`,
        }));
    }

    function databaseSQLKeywordCompletionRange(model, position, keyword, fallbackRange) {
        const keywordWords = String(keyword || '').trim().split(/\s+/).filter(Boolean);
        if (keywordWords.length < 2 || !model || !position) return fallbackRange;
        const line = model.getLineContent(position.lineNumber) || '';
        const prefix = line.slice(0, Math.max(0, position.column - 1));
        const tailMatch = prefix.match(/(?:[A-Za-z_][\w$]*\s*)+$/);
        if (!tailMatch) return fallbackRange;
        const tail = tailMatch[0];
        const tailStart = prefix.length - tail.length;
        const trailingWhitespace = /\s$/.test(tail);
        const tokens = [];
        const tokenRE = /[A-Za-z_][\w$]*/g;
        let match;
        while ((match = tokenRE.exec(tail))) {
            tokens.push({
                text: match[0].toLowerCase(),
                start: match.index,
            });
        }
        let best = null;
        for (let start = 0; start < tokens.length; start++) {
            const typed = tokens.slice(start);
            if (typed.length > keywordWords.length) continue;
            let matches = true;
            for (let i = 0; i < typed.length; i++) {
                const expected = keywordWords[i].toLowerCase();
                const actual = typed[i].text;
                const exact = trailingWhitespace || i < typed.length - 1;
                if (exact ? actual !== expected : !expected.startsWith(actual)) {
                    matches = false;
                    break;
                }
            }
            if (matches && (!best || typed.length > best.length)) {
                best = { start: typed[0].start, length: typed.length };
            }
        }
        if (!best) return fallbackRange;
        return {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: tailStart + best.start + 1,
            endColumn: position.column,
        };
    }

    function databaseSQLTableCompletionItems(tables, range, kind, sortPrefix, options = {}) {
        const schemaQualified = options.schemaQualified !== false;
        const insertQualified = options.insertQualified !== false;
        const items = [];
        tables.forEach(table => {
            items.push({
                label: table.name,
                kind: kind.Struct,
                detail: table.schema && table.schema !== 'main' ? table.schema : databaseTableKindLabel(table.type),
                insertText: databaseSQLIdentifierInsert(table.name),
                range,
                sortText: `${sortPrefix}-table-${table.name}`,
            });
            if (schemaQualified && table.schema && table.schema !== 'main') {
                items.push({
                    label: `${table.schema}.${table.name}`,
                    kind: kind.Struct,
                    detail: 'schema-qualified table',
                    insertText: insertQualified
                        ? `${databaseSQLIdentifierInsert(table.schema)}.${databaseSQLIdentifierInsert(table.name)}`
                        : databaseSQLIdentifierInsert(table.name),
                    range,
                    sortText: `${sortPrefix}-table-${table.schema}.${table.name}`,
                });
            }
        });
        return items;
    }

    function databaseSQLReferencedColumnCompletionItems(refs, range, kind, sortPrefix, options = {}) {
        const refsToUse = refs.length > 0 ? refs : [];
        const multipleRefs = refsToUse.length > 1;
        return refsToUse.flatMap(ref => databaseSQLColumnObjects(ref.table).map(column => {
            const prefix = options.includePrefix === false ? '' : (ref.alias || (multipleRefs ? ref.table.name : ''));
            const insertPrefix = options.insertPrefix === false ? '' : prefix;
            const insertText = insertPrefix
                ? `${databaseSQLIdentifierInsert(insertPrefix)}.${databaseSQLIdentifierInsert(column.name)}`
                : databaseSQLIdentifierInsert(column.name);
            const label = prefix
                ? `${databaseSQLIdentifierInsert(prefix)}.${databaseSQLIdentifierInsert(column.name)}`
                : column.name;
            return {
                label,
                kind: kind.Field,
                detail: `${ref.table.name}${column.type ? ' · ' + column.type : ''}`,
                insertText,
                range,
                sortText: `${sortPrefix}-column-${label}`,
            };
        }));
    }

    function databaseSQLAllColumnCompletionItems(tables, range, kind, sortPrefix, options = {}) {
        const maxItems = Number.isFinite(options.maxItems) ? Math.max(0, options.maxItems) : 300;
        const items = [];
        for (const table of tables) {
            for (const column of databaseSQLColumnObjects(table)) {
                items.push({
                    label: column.name,
                    kind: kind.Field,
                    detail: `${table.name}${column.type ? ' · ' + column.type : ''}`,
                    insertText: databaseSQLIdentifierInsert(column.name),
                    range,
                    sortText: `${sortPrefix}-column-${table.name}.${column.name}`,
                });
                if (items.length >= maxItems) return items;
            }
        }
        return items;
    }

    function databaseSQLQualifiedCompletionItems(qualifier, tables, refs, range, kind) {
        const parts = qualifier.parts || [];
        if (parts.length === 0) return [];
        if (parts.length === 1) {
            const name = databaseSQLNormalizeName(parts[0]);
            const schemaTables = tables.filter(table => databaseSQLNormalizeName(table.schema) === name);
            const tableMatches = tables.filter(table => databaseSQLNormalizeName(table.name) === name);
            const refMatches = refs.filter(ref =>
                databaseSQLNormalizeName(ref.alias) === name ||
                databaseSQLNormalizeName(ref.table.name) === name
            );
            return [
                ...databaseSQLTableCompletionItems(schemaTables, range, kind, '0', { schemaQualified: false }),
                ...databaseSQLReferencedColumnCompletionItems(refMatches, range, kind, '1', { includePrefix: false, insertPrefix: false }),
                ...databaseSQLReferencedColumnCompletionItems(tableMatches.map(table => ({ table, alias: '' })), range, kind, '1', { includePrefix: false, insertPrefix: false }),
            ];
        }
        const schema = databaseSQLNormalizeName(parts[parts.length - 2]);
        const tableName = databaseSQLNormalizeName(parts[parts.length - 1]);
        const matches = tables
            .filter(table => databaseSQLNormalizeName(table.schema) === schema && databaseSQLNormalizeName(table.name) === tableName)
            .map(table => ({ table, alias: '' }));
        return databaseSQLReferencedColumnCompletionItems(matches, range, kind, '0', { includePrefix: false, insertPrefix: false });
    }

    function databaseSQLIdentifierInsert(name) {
        const value = String(name || '');
        if (/^[A-Za-z_][\w$]*$/.test(value)) return value;
        return `"${value.replace(/"/g, '""')}"`;
    }

    function databaseSQLIdentifierPatternSource() {
        return '(?:"(?:""|[^"])*"|`[^`]*`|[A-Za-z_][\\w$]*)';
    }

    function databaseSQLIdentifierParts(text) {
        return String(text || '')
            .match(/"(?:""|[^"])*"|`[^`]*`|[A-Za-z_][\w$]*/g)
            ?.map(databaseSQLUnquoteIdentifier)
            .filter(Boolean) || [];
    }

    function databaseSQLUnquoteIdentifier(identifier) {
        const value = String(identifier || '').trim();
        if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1).replace(/""/g, '"');
        if (value.startsWith('`') && value.endsWith('`')) return value.slice(1, -1);
        return value;
    }

    function databaseSQLNormalizeName(name) {
        return String(name || '').toLowerCase();
    }

    function databaseSQLColumnObjects(table) {
        return (Array.isArray(table?.columns) ? table.columns : [])
            .map(column => ({
                name: String(column.name || ''),
                type: String(column.type || ''),
            }))
            .filter(column => column.name);
    }

    function databaseSQLStatementTableRefs(statement, tables) {
        const refs = [];
        const seen = new Set();
        const ident = databaseSQLIdentifierPatternSource();
        const tablePattern = `${ident}(?:\\s*\\.\\s*${ident})?`;
        const stopWords = 'on|where|join|left|right|inner|outer|full|cross|group|order|limit|offset|having|union|set|values|returning';
        const re = new RegExp(`\\b(?:from|join|update|into)\\s+(${tablePattern})(?:\\s+(?:as\\s+)?(?!${stopWords}\\b)(${ident}))?`, 'gi');
        let match;
        while ((match = re.exec(statement))) {
            databaseSQLFindTables(match[1], tables).forEach(table => {
                const alias = match[2] ? databaseSQLUnquoteIdentifier(match[2]) : '';
                const key = [table.schema, table.name, alias].join('\u001f');
                if (seen.has(key)) return;
                seen.add(key);
                refs.push({ table, alias });
            });
        }
        return refs;
    }

    function databaseSQLFindTables(identifier, tables) {
        const parts = databaseSQLIdentifierParts(identifier);
        if (parts.length === 0) return [];
        if (parts.length > 1) {
            const schema = databaseSQLNormalizeName(parts[parts.length - 2]);
            const tableName = databaseSQLNormalizeName(parts[parts.length - 1]);
            return tables.filter(table =>
                databaseSQLNormalizeName(table.schema) === schema &&
                databaseSQLNormalizeName(table.name) === tableName
            );
        }
        const tableName = databaseSQLNormalizeName(parts[0]);
        return tables.filter(table => databaseSQLNormalizeName(table.name) === tableName);
    }

function databaseSchemaCompletionTables(connectionID = selectedDatabaseID) {
    const id = String(connectionID || '');
    const cache = databaseSchemaCacheForConnection(id);
    if (!id || !cache || cache.connection?.id !== id) return [];
        const schemas = Array.isArray(cache.schemas) ? cache.schemas : [];
        return schemas.flatMap(schema => (schema.tables || []).map(table => ({
            ...table,
            schema: table.schema || schema.name || 'main',
        })));
    }

    function defaultDatabaseQueryTab() {
        return {
            id: stableDatabaseClientID('query'),
            title: 'Query 1',
            sql: 'select 1;',
            savedQueryID: '',
            connectionID: selectedDatabaseID || '',
        };
    }

    function ensureDatabaseQueryTabs() {
        if (databaseQueryTabsLoaded) return;
        databaseQueryTabsLoaded = true;
        try {
            const raw = localStorage.getItem(DATABASE_QUERY_TABS_KEY);
            const saved = JSON.parse(raw || '[]');
            if (Array.isArray(saved)) {
                databaseQueryTabs = saved
                    .map(tab => ({
                        id: String(tab.id || ''),
                        title: String(tab.title || ''),
                        sql: String(tab.sql || ''),
                        savedQueryID: String(tab.savedQueryID || ''),
                        connectionID: String(tab.connectionID || ''),
                    }))
                    .filter(tab => tab.id);
            }
        } catch {}
        if (databaseQueryTabs.length === 0) databaseQueryTabs = [defaultDatabaseQueryTab()];
        databaseActiveQueryTabID = databaseActiveQueryTabID || databaseQueryTabs[0]?.id || '';
    }

    function persistDatabaseQueryTabs() {
        try {
            const saved = databaseQueryTabs.slice(0, 20).map(tab => ({
                id: tab.id,
                title: tab.title,
                sql: tab.sql,
                savedQueryID: tab.savedQueryID || '',
                connectionID: tab.connectionID || '',
            }));
            localStorage.setItem(DATABASE_QUERY_TABS_KEY, JSON.stringify(saved));
        } catch {}
    }

    function activeDatabaseQueryTab() {
        ensureDatabaseQueryTabs();
        return databaseQueryTabs.find(tab => tab.id === databaseActiveQueryTabID) || databaseQueryTabs[0];
    }

    function activateDatabaseQueryTab(id) {
        ensureDatabaseQueryTabs();
        const tab = databaseQueryTabs.find(item => item.id === id) || databaseQueryTabs[0];
        if (!tab) {
            databaseActiveTabKind = 'query';
            databaseActiveQueryTabID = '';
            databaseActiveResultTabID = '';
            databaseLastResult = null;
            renderDatabaseInspector(null);
            renderDatabaseQueryTabs();
            renderDatabaseResultTabs();
            renderDatabaseActivePane();
            return;
        }
        databaseActiveTabKind = 'query';
        databaseActiveQueryTabID = tab.id;
        databaseActiveResultTabID = '';
        databaseLastResult = tab.result || null;
        renderDatabaseInspector(null);
        renderDatabaseQueryTabs();
        renderDatabaseResultTabs();
        renderDatabaseActivePane();
    }

    function renderDatabaseActivePane() {
        const workbenchEl = document.getElementById('database-workbench');
        const consoleEl = document.getElementById('database-console');
        const resultsEl = document.getElementById('database-results');
        if (!consoleEl || !resultsEl) return;
        const queryActive = databaseActiveTabKind === 'query';
        const queryTab = queryActive ? activeDatabaseQueryTab() : null;
        let queryEmpty = false;
        consoleEl.style.display = queryActive && queryTab ? 'flex' : 'none';
        if (queryActive) {
            databaseLastResult = queryTab?.result || null;
            queryEmpty = !queryTab?.result && !databaseQueryInFlight;
            setDatabaseQueryValue(queryTab?.sql || '');
            if (databaseQueryEditor) setTimeout(() => databaseQueryEditor.layout(), 0);
        }
        if (workbenchEl) workbenchEl.classList.toggle('database-query-empty', queryEmpty);
        resultsEl.style.display = queryEmpty ? 'none' : 'flex';
        renderDatabaseResult();
    }

    function renderDatabaseQueryTabs() {
        ensureDatabaseQueryTabs();
        const tabs = document.getElementById('database-query-tabs');
        if (!tabs || !databaseQueryInput()) return;
        tabs.innerHTML = '';
        databaseQueryTabs.forEach((tab, idx) => {
            const el = document.createElement('div');
            el.tabIndex = 0;
            el.setAttribute('role', 'button');
            el.className = 'database-tab query-tab' + (databaseActiveTabKind === 'query' && tab.id === databaseActiveQueryTabID ? ' active' : '');
            el.innerHTML = `<span class="database-tab-label">${esc(tab.title || `Query ${idx + 1}`)}</span><button class="database-tab-close" type="button" title="Close query tab">${iconHTML('x')}</button>`;
            el.onclick = () => activateDatabaseQueryTab(tab.id);
            el.onkeydown = (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    activateDatabaseQueryTab(tab.id);
                }
            };
            el.querySelector('.database-tab-close').onclick = (ev) => closeDatabaseQueryTab(tab.id, ev);
            tabs.appendChild(el);
        });
        if (databaseActiveTabKind === 'query') setDatabaseQueryValue(activeDatabaseQueryTab()?.sql || '');
    }

    function addDatabaseQueryTab(sql = '', options = {}) {
        const next = databaseQueryTabs.length + 1;
        const tab = {
            id: stableDatabaseClientID('query'),
            title: String(options.title || '').trim() || `Query ${next}`,
            sql: sql || 'select 1;',
            savedQueryID: String(options.savedQueryID || ''),
            connectionID: String(options.connectionID || selectedDatabaseID || ''),
        };
        databaseQueryTabs.push(tab);
        databaseActiveQueryTabID = tab.id;
        persistDatabaseQueryTabs();
        activateDatabaseQueryTab(tab.id);
        focusDatabaseQueryInput();
    }

    function closeDatabaseQueryTab(id, ev) {
        ev?.preventDefault();
        ev?.stopPropagation();
        updateActiveDatabaseQuerySQL();
        const idx = databaseQueryTabs.findIndex(tab => tab.id === id);
        if (idx < 0) return;
        const wasSelectedQuery = databaseActiveQueryTabID === id;
        const wasActive = databaseActiveTabKind === 'query' && wasSelectedQuery;
        databaseQueryTabs.splice(idx, 1);
        if (databaseQueryTabs.length === 0) {
            databaseQueryTabs.push(defaultDatabaseQueryTab());
        }
        if (wasSelectedQuery) {
            const next = databaseQueryTabs[Math.min(idx, databaseQueryTabs.length - 1)];
            databaseActiveQueryTabID = next?.id || '';
        }
        if (wasActive) {
            databaseActiveTabKind = 'query';
        }
        persistDatabaseQueryTabs();
        renderDatabaseQueryTabs();
        renderDatabaseResultTabs();
        renderDatabaseActivePane();
    }

    function updateActiveDatabaseQuerySQL() {
        if (databaseActiveTabKind !== 'query') return;
        const tab = activeDatabaseQueryTab();
        if (!tab) return;
        tab.sql = databaseQueryValue();
        persistDatabaseQueryTabs();
    }

    function databaseSavedQueryNameFromSQL(sql) {
        const compact = compactSQL(sql);
        if (!compact) return 'Saved query';
        return compact.length > 48 ? compact.slice(0, 45) + '...' : compact;
    }

    function databaseDefaultSavedQueryName(tab, sql, existing = null) {
        if (existing && existing.name) return existing.name;
        const tabTitle = String(tab && tab.title || '').trim();
        if (tabTitle && !/^Query \d+$/i.test(tabTitle)) return tabTitle;
        return databaseSavedQueryNameFromSQL(sql);
    }

    async function saveActiveDatabaseQuery() {
        updateActiveDatabaseQuerySQL();
        const tab = activeDatabaseQueryTab();
        const conn = activeDatabaseQueryConnection(tab);
        const sql = String(tab && tab.sql || '').trim();
        if (!conn) {
            showToast('No connection', 'Select a database connection before saving a query.', 'info', 3200);
            return;
        }
        if (!tab || !sql) {
            showToast('Empty query', 'Enter SQL before saving the query.', 'info', 2600);
            return;
        }
        const savedQueries = normalizeDatabaseSavedQueries(conn.saved_queries);
        const currentSavedID = tab.connectionID === conn.id ? String(tab.savedQueryID || '') : '';
        const existing = currentSavedID ? savedQueries.find(item => item.id === currentSavedID) : null;
        const cleanName = databaseDefaultSavedQueryName(tab, sql, existing).trim();
        if (!cleanName) {
            showToast('Name required', 'Saved queries need a name.', 'info', 2600);
            return;
        }
        openDatabaseSaveQueryForm(cleanName);
    }

    function openDatabaseSaveQueryForm(defaultName) {
        const form = document.getElementById('database-save-query-form');
        const input = document.getElementById('database-save-query-name');
        if (!form || !input) {
            saveActiveDatabaseQueryWithName(defaultName);
            return;
        }
        form.style.display = 'flex';
        input.value = defaultName;
        input.focus();
        input.select();
    }

    function closeDatabaseSaveQueryForm() {
        const form = document.getElementById('database-save-query-form');
        if (form) form.style.display = 'none';
    }

    async function confirmDatabaseSaveQuery(ev) {
        ev?.preventDefault();
        const input = document.getElementById('database-save-query-name');
        const cleanName = String(input?.value || '').trim();
        if (!cleanName) {
            showToast('Name required', 'Saved queries need a name.', 'info', 2600);
            input?.focus();
            return;
        }
        await saveActiveDatabaseQueryWithName(cleanName);
    }

    async function saveActiveDatabaseQueryWithName(cleanName) {
        updateActiveDatabaseQuerySQL();
        const tab = activeDatabaseQueryTab();
        const conn = activeDatabaseQueryConnection(tab);
        const sql = String(tab && tab.sql || '').trim();
        if (!conn) {
            showToast('No connection', 'Select a database connection before saving a query.', 'info', 3200);
            return;
        }
        if (!tab || !sql) {
            showToast('Empty query', 'Enter SQL before saving the query.', 'info', 2600);
            return;
        }
        const savedQueries = normalizeDatabaseSavedQueries(conn.saved_queries);
        const currentSavedID = tab.connectionID === conn.id ? String(tab.savedQueryID || '') : '';
        const existing = currentSavedID ? savedQueries.find(item => item.id === currentSavedID) : null;

        const now = new Date().toISOString();
        const savedQuery = {
            id: existing?.id || stableDatabaseClientID('saved-query'),
            name: cleanName,
            sql,
            created_at: existing?.created_at || now,
            updated_at: now,
        };
        try {
            await saveDatabaseSavedQuery(conn.id, savedQuery, existing ? existing.id : '');
            tab.savedQueryID = savedQuery.id;
            tab.connectionID = conn.id;
            tab.title = cleanName;
            persistDatabaseQueryTabs();
            renderDatabaseQueryTabs();
            renderDatabaseSavedQueries();
            closeDatabaseSaveQueryForm();
            showToast('Query saved', cleanName, 'success', 2200);
        } catch (err) {
            showToast('Query save failed', compactErrorMessage(err && err.message, 'Unable to save query.'), 'error', 4200);
        }
    }

    function openSavedDatabaseQuery(id) {
        const conn = databaseConnectionByID(selectedDatabaseID);
        if (!conn) return;
        const query = normalizeDatabaseSavedQueries(conn.saved_queries).find(item => item.id === id);
        if (!query) return;
        addDatabaseQueryTab(query.sql, {
            title: query.name,
            savedQueryID: query.id,
            connectionID: conn.id,
        });
    }

    async function deleteSavedDatabaseQuery(id) {
        const conn = databaseConnectionByID(selectedDatabaseID);
        if (!conn) return;
        const savedQueries = normalizeDatabaseSavedQueries(conn.saved_queries);
        const query = savedQueries.find(item => item.id === id);
        if (!query) return;
        if (!(await appConfirm(`Delete saved query "${query.name}"?`))) return;
        try {
            await deleteDatabaseSavedQuery(conn.id, id);
            databaseQueryTabs.forEach(tab => {
                if (tab.savedQueryID === id && tab.connectionID === conn.id) tab.savedQueryID = '';
            });
            persistDatabaseQueryTabs();
            renderDatabaseQueryTabs();
            renderDatabaseSavedQueries();
            showToast('Saved query deleted', query.name, 'success', 2200);
        } catch (err) {
            showToast('Delete failed', compactErrorMessage(err && err.message, 'Unable to delete saved query.'), 'error', 4200);
        }
    }

    function openOrphanedDatabaseQuery(id) {
        const query = normalizeDatabaseSavedQueries(databaseOrphanedQueries).find(item => item.id === id);
        if (!query) return;
        addDatabaseQueryTab(query.sql, {
            title: query.name,
            savedQueryID: '',
            connectionID: query.connection_id || '',
        });
    }

    async function deleteOrphanedDatabaseQuery(id) {
        const query = normalizeDatabaseSavedQueries(databaseOrphanedQueries).find(item => item.id === id);
        if (!query) return;
        if (!(await appConfirm(`Delete orphaned query "${query.name}"?`))) return;
        try {
            await deleteDatabaseOrphanedQuery(id);
            showToast('Orphaned query deleted', query.name, 'success', 2200);
        } catch (err) {
            showToast('Delete failed', compactErrorMessage(err && err.message, 'Unable to delete orphaned query.'), 'error', 4200);
        }
    }

    function renderDatabaseConnections() {
        if (databaseConnections.length === 0) {
            selectedDatabaseID = '';
            databaseSchemaCacheByConnection = {};
            databaseSchemaLoadingByConnection = {};
            databaseSchemaErrorByConnection = {};
            databaseSchemaRequestSeqByConnection = {};
            databaseSchemaConnectionSignatures = {};
            databaseConnectedByConnection = {};
            expandedDatabaseConnectionID = '';
            databaseConnectionTreeTouched = false;
            persistSelectedDatabaseConnection();
        } else {
            if (!databaseConnections.some(conn => conn.id === selectedDatabaseID)) {
                selectedDatabaseID = databaseConnections[0].id;
                expandedDatabaseConnectionID = selectedDatabaseID;
                databaseConnectionTreeTouched = false;
            }
            persistSelectedDatabaseConnection();
        }
        syncDatabaseSchemaCachesWithConnections();
        syncDatabaseConnectionTreeExpansion();
        renderDatabaseHeaderTitle();
        renderDatabaseConnectionTree();
        renderDatabaseDiscoveryProjectOptions();
        if (databaseActive) {
            renderDatabaseQueryTabs();
            renderDatabaseResultTabs();
            renderDatabaseActivePane();
        }
    }

    function activeDatabaseQueryConnection(tab = activeDatabaseQueryTab()) {
        return databaseConnectionByID(tab?.connectionID || selectedDatabaseID);
    }

    function databaseFormatterLanguage(conn) {
        switch (normalizeDatabaseDriver(conn?.driver)) {
        case 'sqlite': return 'sqlite';
        case 'postgres': return 'postgresql';
        case 'mysql': return 'mysql';
        default: return 'sql';
        }
    }

    function loadSQLFormatterScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => resolve(window.sqlFormatter);
            script.onerror = () => reject(new Error(`Unable to load ${src}`));
            document.head.appendChild(script);
        });
    }

    async function resolveSQLFormatter() {
        const existing = window.sqlFormatter;
        if (existing && typeof existing.format === 'function') return existing;
    if (!sqlFormatterLoadPromise) {
        sqlFormatterLoadPromise = loadSQLFormatterScript(SQL_FORMATTER_LOCAL_SRC)
            .then(() => {
                const formatter = window.sqlFormatter;
                return formatter && typeof formatter.format === 'function' ? formatter : null;
                })
                .catch(() => null);
        }
        return sqlFormatterLoadPromise;
    }

    async function prettifyActiveDatabaseQuery() {
        updateActiveDatabaseQuerySQL();
        const tab = activeDatabaseQueryTab();
        const sql = databaseQueryValue();
        if (!String(sql || '').trim()) {
            showToast('Empty query', 'Enter SQL before prettifying it.', 'info', 2600);
            return;
        }
        const formatter = await resolveSQLFormatter();
        if (!formatter || typeof formatter.format !== 'function') {
            showToast('Formatter unavailable', 'SQL formatter did not load.', 'error', 4200);
            return;
        }
        try {
            const formatted = await formatter.format(sql, {
                language: databaseFormatterLanguage(activeDatabaseQueryConnection(tab)),
                keywordCase: 'upper',
                tabWidth: 2,
                linesBetweenQueries: 1,
            });
            setDatabaseQueryValue(formatted);
            updateActiveDatabaseQuerySQL();
            if (databaseQueryEditor) {
                databaseQueryEditor.focus();
                databaseQueryEditor.setPosition({ lineNumber: 1, column: 1 });
            } else {
                databaseQueryInput()?.focus();
            }
            showToast('Query prettified', 'SQL indentation was updated.', 'success', 2200);
        } catch (err) {
            showToast('Prettify failed', compactErrorMessage(err && err.message, 'Unable to format this SQL.'), 'error', 5200);
        }
    }

    function rebindActiveDatabaseQueryTabConnection(connectionID) {
        const nextID = String(connectionID || '');
        if (!nextID || databaseActiveTabKind !== 'query') return;
        const tab = activeDatabaseQueryTab();
        if (!tab || tab.connectionID === nextID) return;
        tab.connectionID = nextID;
        tab.savedQueryID = '';
        persistDatabaseQueryTabs();
    }

    function selectDatabaseConnection(id, options = {}) {
        const nextID = String(id || '');
        const changed = selectedDatabaseID !== nextID;
        selectedDatabaseID = nextID;
        if (options.expand !== false) {
            expandedDatabaseConnectionID = nextID;
            databaseConnectionTreeTouched = false;
        }
        persistSelectedDatabaseConnection();
        if (changed) rebindActiveDatabaseQueryTabConnection(selectedDatabaseID);
        renderDatabaseHeaderTitle();
        renderDatabaseConnectionTree();
        const hasSelectedSchema = Boolean(databaseSchemaCacheForConnection(selectedDatabaseID));
        if (selectedDatabaseID && options.loadIfMissing && !hasSelectedSchema) loadDatabaseSchema(selectedDatabaseID, { force: false });
    }

    function syncDatabaseConnectionTreeExpansion() {
        if (expandedDatabaseConnectionID && !databaseConnections.some(conn => conn.id === expandedDatabaseConnectionID)) {
            expandedDatabaseConnectionID = '';
        }
        if (!databaseConnectionTreeTouched && !expandedDatabaseConnectionID && selectedDatabaseID) {
            expandedDatabaseConnectionID = selectedDatabaseID;
        }
    }

    function toggleDatabaseConnectionTree(id) {
        const nextID = String(id || '');
        if (!nextID) return;
        databaseConnectionTreeTouched = true;
        if (expandedDatabaseConnectionID === nextID) {
            expandedDatabaseConnectionID = '';
            renderDatabaseConnectionTree();
            return;
        }
        expandedDatabaseConnectionID = nextID;
        selectDatabaseConnection(nextID, { expand: false, loadIfMissing: true });
    }

    function renderDatabaseSavedQueries() {
        renderDatabaseConnectionTree();
    }

    function databaseTreeSectionKey(scope, section) {
        return [String(scope || 'global'), String(section || '')].join('\u001f');
    }

    function databaseTreeSectionCollapsed(key, defaultCollapsed = false) {
        if (!key) return false;
        if (Object.prototype.hasOwnProperty.call(collapsedDatabaseTreeSections, key)) {
            return Boolean(collapsedDatabaseTreeSections[key]);
        }
        return Boolean(defaultCollapsed);
    }

    function toggleDatabaseTreeSection(key, defaultCollapsed = false) {
        if (!key) return;
        collapsedDatabaseTreeSections[key] = !databaseTreeSectionCollapsed(key, defaultCollapsed);
        renderDatabaseConnectionTree();
    }

    function appendDatabaseTreeSectionToggle(section, title, sectionKey, collapsed, defaultCollapsed = false) {
        if (!sectionKey) {
            section.innerHTML = `<div class="database-section-title">${esc(title)}</div>`;
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'database-section-title database-tree-section-toggle';
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        button.innerHTML =
            `<span class="database-tree-section-chevron">${iconHTML(collapsed ? 'chevron-right' : 'chevron-down')}</span>` +
            `<span class="database-tree-section-title-text">${esc(title)}</span>`;
        button.onclick = () => toggleDatabaseTreeSection(sectionKey, defaultCollapsed);
        section.appendChild(button);
    }

    function appendDatabaseTreeMessage(section, className, text) {
        const el = document.createElement('div');
        el.className = className;
        el.textContent = text;
        section.appendChild(el);
    }

    function databaseTreeActionButton(icon, title, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'database-tree-action';
        button.title = title;
        button.setAttribute('aria-label', title);
        button.innerHTML = iconHTML(icon);
        button.onclick = ev => {
            ev.preventDefault();
            ev.stopPropagation();
            onClick?.();
        };
        return button;
    }

    function renderDatabaseConnectionTree() {
        const container = document.getElementById('database-connection-tree');
        if (!container) return;
        container.innerHTML = '';
        if (databaseConnections.length === 0) {
            container.innerHTML = '<div class="database-empty">Add a connection in settings.</div>';
            appendDatabaseOrphanedTreeSection(container);
            return;
        }
        syncDatabaseConnectionTreeExpansion();
        databaseConnections.forEach(conn => {
            const active = conn.id === selectedDatabaseID;
            const expanded = conn.id === expandedDatabaseConnectionID;
            const node = document.createElement('div');
            node.className = 'database-tree-node' + (active ? ' active' : '') + (expanded ? ' expanded' : '');
            const savedCount = normalizeDatabaseSavedQueries(conn.saved_queries).length;
            const savedLabel = savedCount === 1 ? '1 saved query' : `${savedCount} saved queries`;
            const row = document.createElement('div');
            row.className = 'database-tree-connection-row';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'database-tree-connection';
            button.innerHTML =
                `<span class="database-tree-chevron">${iconHTML(expanded ? 'chevron-down' : 'chevron-right')}</span>` +
                `<span class="database-tree-connection-text"><strong>${esc(conn.name)}</strong><small>${esc(databaseConnectionSubtitle(conn))}</small></span>` +
                `<span class="database-tree-count">${esc(savedLabel)}</span>`;
            button.onclick = () => toggleDatabaseConnectionTree(conn.id);
            row.appendChild(button);
            const actions = document.createElement('div');
            actions.className = 'database-tree-actions';
            actions.appendChild(databaseTreeActionButton('rotate-cw', 'Refresh connection schema', () => loadDatabaseSchema(conn.id, { force: true })));
            if (databaseConnectionConnected(conn.id)) {
                actions.appendChild(databaseTreeActionButton('power', 'Disconnect database', () => disconnectDatabaseConnection(conn.id)));
            } else {
                actions.appendChild(databaseTreeActionButton('play', 'Connect database', () => loadDatabaseSchema(conn.id, { force: true })));
            }
            row.appendChild(actions);
            node.appendChild(row);
            if (expanded) {
                const children = document.createElement('div');
                children.className = 'database-tree-children';
                appendDatabaseTableTreeSection(children, conn);
                appendDatabaseSavedQuerySection(children, 'Saved Queries', normalizeDatabaseSavedQueries(conn.saved_queries), {
                    sectionKey: databaseTreeSectionKey(conn.id, 'saved-queries'),
                    empty: 'No saved queries.',
                    open: openSavedDatabaseQuery,
                    remove: deleteSavedDatabaseQuery,
                    removeTitle: 'Delete saved query',
                });
                node.appendChild(children);
            }
            container.appendChild(node);
        });
        appendDatabaseOrphanedTreeSection(container);
    }

    function appendDatabaseOrphanedTreeSection(container) {
        const orphaned = normalizeDatabaseSavedQueries(databaseOrphanedQueries);
        if (orphaned.length === 0) return;
        const section = document.createElement('div');
        section.className = 'database-tree-orphaned';
        appendDatabaseSavedQuerySection(section, 'Orphaned Queries', orphaned, {
            sectionKey: databaseTreeSectionKey('orphaned', 'saved-queries'),
            open: openOrphanedDatabaseQuery,
            remove: deleteOrphanedDatabaseQuery,
            removeTitle: 'Delete orphaned query',
            orphaned: true,
        });
        container.appendChild(section);
    }

    function appendDatabaseTableTreeSection(container, conn) {
        const section = document.createElement('div');
        const sectionKey = databaseTreeSectionKey(conn.id, 'tables');
        const collapsed = databaseTreeSectionCollapsed(sectionKey);
        section.className = 'database-tree-section' + (collapsed ? ' collapsed' : '');
        appendDatabaseTreeSectionToggle(section, 'Databases', sectionKey, collapsed);
        if (collapsed) {
            container.appendChild(section);
            return;
        }
        const cache = databaseSchemaCacheForConnection(conn.id);
        const loading = databaseSchemaLoadingForConnection(conn.id);
        const error = databaseSchemaErrorForConnection(conn.id);
        if (loading) {
            appendDatabaseTreeMessage(section, 'database-loading', 'loading schema...');
            container.appendChild(section);
            return;
        }
        if (error) {
            appendDatabaseTreeMessage(section, 'database-error', error);
            container.appendChild(section);
            return;
        }
        if (!cache || cache.connection?.id !== conn.id) {
            appendDatabaseTreeMessage(section, 'database-empty', 'Connect or refresh to inspect tables.');
            container.appendChild(section);
            return;
        }
        const schemas = Array.isArray(cache.schemas) ? cache.schemas : [];
        const databaseGroups = schemas
            .map(schema => ({
                name: schema.name || 'main',
                tables: (schema.tables || []).map(table => ({
                    ...table,
                    schema: table.schema || schema.name || 'main',
                })),
            }))
            .filter(schema => schema.tables.length > 0);
        if (databaseGroups.length === 0) {
            appendDatabaseTreeMessage(section, 'database-empty', 'No tables found.');
            container.appendChild(section);
            return;
        }
        const list = document.createElement('div');
        list.className = 'database-tree-database-list';
        databaseGroups.forEach(schema => appendDatabaseTreeDatabaseGroup(list, conn, schema));
        section.appendChild(list);
        container.appendChild(section);
    }

    function appendDatabaseTreeDatabaseGroup(container, conn, schema) {
        const key = databaseTreeSectionKey(conn.id, `database:${schema.name}`);
        const collapsed = databaseTreeSectionCollapsed(key, true);
        const group = document.createElement('div');
        group.className = 'database-tree-database-group' + (collapsed ? ' collapsed' : '');
        const tableCount = schema.tables.length;
        const row = document.createElement('div');
        row.className = 'database-tree-database-row';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'database-tree-database-toggle';
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        button.title = schema.name || 'main';
        button.innerHTML =
            `<span class="database-tree-section-chevron">${iconHTML(collapsed ? 'chevron-right' : 'chevron-down')}</span>` +
            `<span class="database-tree-database-name">${esc(schema.name || 'main')}</span>` +
            `<span class="database-tree-database-count">${tableCount} ${esc(pluralize(tableCount, 'table'))}</span>`;
        button.onclick = () => toggleDatabaseTreeSection(key, true);
        row.appendChild(button);
        row.appendChild(databaseTreeActionButton('rotate-cw', `Refresh ${schema.name || 'main'}`, () => refreshDatabaseSchemaGroup(conn.id, schema.name || 'main')));
        group.appendChild(row);
        if (!collapsed) {
            const tables = document.createElement('div');
            tables.className = 'database-tree-table-list';
            schema.tables.forEach(table => appendDatabaseTreeTableRow(tables, conn, table));
            group.appendChild(tables);
        }
        container.appendChild(group);
    }

    function appendDatabaseTreeTableRow(container, conn, table) {
        const wrap = document.createElement('div');
        wrap.className = 'database-tree-table-row-wrap';
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'database-tree-table-row';
        row.title = table.name || '';
        row.setAttribute('aria-label', table.name || 'Open table');
        const kind = databaseTableKindLabel(table.type);
        row.innerHTML = `<span title="${esc(table.name)}">${esc(table.name)}</span><small>${esc(kind)}</small>`;
        row.onclick = () => openDatabaseTable(table);
        wrap.appendChild(row);
        wrap.appendChild(databaseTreeActionButton('rotate-cw', `Refresh ${table.name || 'table'}`, () => refreshDatabaseTableSchema(conn.id, table)));
        container.appendChild(wrap);
    }

    function appendDatabaseSavedQuerySection(container, title, items, options = {}) {
        const section = document.createElement('div');
        const sectionKey = options.sectionKey || '';
        const collapsed = databaseTreeSectionCollapsed(sectionKey);
        section.className = 'database-saved-query-section' + (collapsed ? ' collapsed' : '');
        appendDatabaseTreeSectionToggle(section, title, sectionKey, collapsed);
        if (collapsed) {
            container.appendChild(section);
            return;
        }
        if (items.length === 0) {
            appendDatabaseTreeMessage(section, 'database-empty', options.empty || 'No queries.');
            container.appendChild(section);
            return;
        }
        const list = document.createElement('div');
        list.className = 'database-saved-query-list';
        items.forEach(query => {
            const row = document.createElement('div');
            row.className = 'database-saved-query-row' + (options.orphaned ? ' orphaned' : '');
            const subtitle = options.orphaned && query.connection_name
                ? `${query.connection_name} · ${compactSQL(query.sql)}`
                : compactSQL(query.sql);
            row.innerHTML =
                `<button class="database-saved-query-main" type="button" title="${esc(query.sql)}">` +
                    `<span>${esc(query.name)}</span><small>${esc(subtitle)}</small>` +
                `</button>` +
                `<button class="database-saved-query-open" type="button" title="Open saved query" aria-label="Open saved query">${iconHTML('arrow-right')}</button>` +
                `<button class="database-saved-query-remove" type="button" title="${esc(options.removeTitle || 'Delete query')}" aria-label="${esc(options.removeTitle || 'Delete query')}">${iconHTML('x')}</button>`;
            row.querySelector('.database-saved-query-main').onclick = () => options.open?.(query.id);
            row.querySelector('.database-saved-query-open').onclick = () => options.open?.(query.id);
            row.querySelector('.database-saved-query-remove').onclick = () => options.remove?.(query.id);
            list.appendChild(row);
        });
        section.appendChild(list);
        container.appendChild(section);
    }

    async function withDatabasePasswordRetry(action) {
        try {
            return await action();
        } catch (err) {
            if (!isDatabasePasswordRequiredError(err)) throw err;
            await requestDatabasePassword(err);
            return await action();
        }
    }

    function isDatabasePasswordRequiredError(err) {
        return !!(err && err.code === 'database_password_required' && err.connection_id);
    }

function requestDatabasePassword(err) {
  const connectionID = String(err.connection_id || '');
  if (databasePasswordPrompt) {
    if (databasePasswordPrompt.connectionID === connectionID) return databasePasswordPrompt.promise;
    return databasePasswordPrompt.promise.catch(() => {}).then(() => requestDatabasePassword(err));
  }
  const modal = document.getElementById('database-password-modal');
  const subtitle = document.getElementById('database-password-subtitle');
  const input = document.getElementById('database-password-input');
  const save = document.getElementById('database-password-save');
  if (!modal || !input || !save) return Promise.reject(new Error('Password required.'));
  subtitle.textContent = err.connection_name || connectionID || '';
        input.value = '';
        save.checked = false;
        modal.style.display = 'flex';
  const promise = new Promise((resolve, reject) => {
    databasePasswordPrompt = {
      connectionID,
      resolve,
      reject,
      promise: null,
            };
        });
        databasePasswordPrompt.promise = promise;
        setTimeout(() => input.focus(), 0);
        return promise;
    }

    function closeDatabasePasswordPrompt() {
        const modal = document.getElementById('database-password-modal');
        if (modal) modal.style.display = 'none';
    }

    function cancelDatabasePasswordPrompt() {
        if (!databasePasswordPrompt) return;
        const prompt = databasePasswordPrompt;
        databasePasswordPrompt = null;
        closeDatabasePasswordPrompt();
        prompt.reject(new Error('Database password required.'));
    }

    async function submitDatabasePasswordPrompt() {
        if (!databasePasswordPrompt) return;
        const prompt = databasePasswordPrompt;
        const input = document.getElementById('database-password-input');
        const save = document.getElementById('database-password-save');
        const password = String(input?.value || '');
        if (!password) {
            input?.focus();
            return;
        }
        try {
            const result = await fetchJSON(`/api/databases/${encodeURIComponent(prompt.connectionID)}/password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password, save: Boolean(save?.checked) }),
            });
            if (result && result.warning) {
                showToast('Password not saved', compactErrorMessage(result.warning, 'Stored for this session only.'), 'error', 5200);
            }
            databasePasswordPrompt = null;
            closeDatabasePasswordPrompt();
            prompt.resolve(result);
        } catch (err) {
            showToast('Password failed', compactErrorMessage(err && err.message, 'Unable to use this password.'), 'error', 4200);
            input?.focus();
        }
    }

    async function loadDatabaseConnections() {
        const data = await fetchJSON('/api/databases');
        applyDatabaseState(data);
        persistSelectedDatabaseConnection();
    }

    async function loadDatabaseSchema(connectionID = selectedDatabaseID, options = {}) {
        const id = String(connectionID || '');
        const conn = databaseConnectionByID(id);
        if (!conn) {
            clearDatabaseSchemaCache(id);
            renderDatabaseSchema();
            return;
        }
        if (options.force === false && databaseSchemaCacheForConnection(id)) {
            renderDatabaseSchema();
            return;
        }
        const requestSeq = (databaseSchemaRequestSeqByConnection[id] || 0) + 1;
        databaseSchemaRequestSeqByConnection[id] = requestSeq;
        setDatabaseSchemaLoading(id, true);
        setDatabaseSchemaError(id, '');
        renderDatabaseConnectionTree();
        try {
            const schema = await withDatabasePasswordRetry(() => fetchJSON(`/api/databases/${encodeURIComponent(id)}/schema`));
            if (databaseSchemaRequestSeqByConnection[id] !== requestSeq) return;
            setDatabaseSchemaCache(id, schema);
            setDatabaseSchemaLoading(id, false);
            setDatabaseSchemaError(id, '');
            setDatabaseConnectionConnected(id, true);
            renderDatabaseSchema();
        } catch (err) {
            if (databaseSchemaRequestSeqByConnection[id] !== requestSeq) return;
            const hadCache = Boolean(databaseSchemaCacheForConnection(id));
            setDatabaseConnectionConnected(id, false);
        setDatabaseSchemaLoading(id, false);
        const message = compactErrorMessage(err && err.message, 'Failed to load schema.');
        if (hadCache) {
            clearDatabaseSchemaCache(id);
            setDatabaseConnectionConnected(id, false);
            setDatabaseSchemaLoading(id, false);
            setDatabaseSchemaError(id, message);
            showToast('Refresh failed', message, 'error', 4200);
        } else {
            setDatabaseSchemaError(id, message);
            }
            renderDatabaseSchema();
        }
    }

    async function refreshDatabaseSchemaGroup(connectionID, schemaName) {
        const id = String(connectionID || '');
        const name = String(schemaName || 'main');
        if (!id || !name) return;
        try {
            const schema = await withDatabasePasswordRetry(() => fetchJSON(`/api/databases/${encodeURIComponent(id)}/schemas/${encodeURIComponent(name)}`));
            upsertDatabaseSchemaGroup(id, schema);
            setDatabaseConnectionConnected(id, true);
            setDatabaseSchemaError(id, '');
            renderDatabaseSchema();
        } catch (err) {
            showToast('Refresh failed', compactErrorMessage(err && err.message, 'Unable to refresh this database.'), 'error', 4200);
        }
    }

    async function refreshDatabaseTableSchema(connectionID, table) {
        const id = String(connectionID || '');
        const schema = String(table?.schema || 'main');
        const name = String(table?.name || '');
        if (!id || !name) return;
        try {
            const updated = await withDatabasePasswordRetry(() => fetchJSON(`/api/databases/${encodeURIComponent(id)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(name)}`));
            upsertDatabaseTableSchema(id, updated);
            setDatabaseConnectionConnected(id, true);
            setDatabaseSchemaError(id, '');
            databaseResultTabs.forEach(tab => {
                if (tab.kind === 'table' && tab.connectionID === id && tab.table?.schema === schema && tab.table?.name === name) {
                    tab.table = { ...tab.table, ...updated };
                }
            });
            renderDatabaseSchema();
            if (databaseActive) renderDatabaseActivePane();
        } catch (err) {
            showToast('Refresh failed', compactErrorMessage(err && err.message, 'Unable to refresh this table.'), 'error', 4200);
        }
    }

    async function disconnectDatabaseConnection(connectionID) {
        const id = String(connectionID || '');
        if (!id) return;
        try {
            await fetchJSON(`/api/databases/${encodeURIComponent(id)}/disconnect`, { method: 'POST' });
            databaseSchemaRequestSeqByConnection[id] = (databaseSchemaRequestSeqByConnection[id] || 0) + 1;
            setDatabaseSchemaLoading(id, false);
            setDatabaseSchemaError(id, '');
            setDatabaseConnectionConnected(id, false);
            renderDatabaseSchema();
        } catch (err) {
            showToast('Disconnect failed', compactErrorMessage(err && err.message, 'Unable to disconnect database.'), 'error', 4200);
        }
    }

    function renderDatabaseSchema() {
        renderDatabaseConnectionTree();
    }

    async function openDatabaseTable(table, options = {}) {
        if (databaseQueryInFlight) {
            showToast('Query running', 'Cancel or wait for the current database query to finish.', 'info', 2600);
            return;
        }
        const conn = databaseConnectionByID(selectedDatabaseID);
        if (!conn || !table) return;
        const tableKey = databaseTableTabKey(conn.id, table);
        const where = String(options.where || '').trim();
        const orderDir = normalizeDatabaseOrderDir(options.orderDir);
        const orderColumn = orderDir ? String(options.orderColumn || '').trim() : '';
        if (!options.duplicate) {
            const existing = databaseResultTabs.find(tab => tab.kind === 'table' && tab.tableKey === tableKey);
            if (existing) {
                activateDatabaseResultTab(existing.id);
                return;
            }
        }
        renderDatabaseInspector(table);
        const progress = startDatabaseQueryProgress('loading table');
        try {
            const result = await withDatabasePasswordRetry(() => fetchJSON(databaseTableRowsURL(conn.id, table, where, orderColumn, orderDir), {
                signal: progress?.signal,
                timeoutMessage: 'Query canceled.',
            }));
            setDatabaseConnectionConnected(conn.id, true);
            renderDatabaseConnectionTree();
            addDatabaseResultTab(`${table.name}`, result, table, { kind: 'table', tableKey, where, orderColumn, orderDir, connectionID: conn.id });
        } catch (err) {
            if (databaseQueryCancelRequested) {
                showToast('Query canceled', 'Table load was canceled.', 'info', 2600);
            } else {
                showToast('Table load failed', compactErrorMessage(err && err.message, 'Unable to load table rows.'), 'error', 4200);
            }
        } finally {
            stopDatabaseQueryProgress();
        }
    }

    function databaseTableTabKey(connectionID, table) {
        return [connectionID || '', table?.schema || 'main', table?.name || ''].join('\u001f');
    }

    function databaseTableRowsURL(connectionID, table, where = '', orderColumn = '', orderDir = '') {
        const schema = table?.schema || 'main';
        const params = new URLSearchParams({ limit: '100' });
        const condition = String(where || '').trim();
        if (condition) params.set('where', condition);
        const dir = normalizeDatabaseOrderDir(orderDir);
        orderColumn = String(orderColumn || '').trim();
        if (orderColumn && dir) {
            params.set('order_column', orderColumn);
            params.set('order_dir', dir);
        }
        return `/api/databases/${encodeURIComponent(connectionID)}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table?.name || '')}?${params.toString()}`;
    }

    function databaseTableCountURL(connectionID, table, where = '') {
        const schema = table?.schema || 'main';
        const params = new URLSearchParams();
        const condition = String(where || '').trim();
        if (condition) params.set('where', condition);
        const query = params.toString();
        return `/api/databases/${encodeURIComponent(connectionID)}/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table?.name || '')}/count${query ? '?' + query : ''}`;
    }

    function renderDatabaseInspector(table, tab = null) {
        const title = document.getElementById('database-inspector-title');
        const body = document.getElementById('database-inspector-body');
        if (!title || !body) return;
        if (!table) {
            title.textContent = 'Inspector';
            body.innerHTML = '';
            return;
        }
        title.textContent = table.name;
        const columns = (table.columns || []).map(col => {
            const checked = !tab || !isDatabaseColumnHidden(tab, col.name);
            const checkbox = tab && tab.kind === 'table'
                ? `<label class="database-column-toggle"><input type="checkbox" data-db-inspector-column="${esc(col.name)}" ${checked ? 'checked' : ''}><span>${esc(col.name)}</span></label>`
                : esc(col.name);
            return `<tr><td>${checkbox}</td><td>${esc(col.type || '')}</td><td>${col.primary ? 'PK' : col.nullable ? 'null' : 'not null'}</td></tr>`;
        }).join('');
        const allToggle = tab && tab.kind === 'table'
            ? '<label class="database-column-toggle database-column-toggle-all"><input id="database-column-visibility-all" type="checkbox"><span>show all</span></label>'
            : '';
        const indexes = (table.indexes || []).map(idx => `<div class="database-inspector-item"><strong>${esc(idx.name)}</strong><span>${esc((idx.columns || []).join(', ') || idx.sql || '')}</span></div>`).join('');
        const fks = (table.foreign_keys || []).map(fk => `<div class="database-inspector-item"><strong>${esc(fk.column)}</strong><span>${esc(fk.referenced_table)}.${esc(fk.referenced_column)}</span></div>`).join('');
        body.innerHTML =
            `<div class="database-inspector-section"><div class="database-section-title">Columns</div>${allToggle}<table class="database-mini-table"><tbody>${columns || '<tr><td>No columns</td></tr>'}</tbody></table></div>` +
            `<div class="database-inspector-section"><div class="database-section-title">Indexes</div>${indexes || '<div class="database-empty">No indexes.</div>'}</div>` +
            `<div class="database-inspector-section"><div class="database-section-title">Foreign keys</div>${fks || '<div class="database-empty">No foreign keys.</div>'}</div>`;
        if (tab && tab.kind === 'table') bindDatabaseInspectorVisibility(tab);
    }

    async function runDatabaseQuery(explain = false) {
        if (databaseQueryInFlight) {
            showToast('Query running', 'Wait for the current database query to finish.', 'info', 2600);
            return;
        }
        updateActiveDatabaseQuerySQL();
        const tab = activeDatabaseQueryTab();
        const conn = activeDatabaseQueryConnection(tab);
        const sql = (tab && tab.sql || '').trim();
        if (!conn) {
            showToast('No connection', 'Select a database connection before running this query.', 'info', 3200);
            return;
        }
        if (!sql) {
            showToast('Empty query', 'Enter a read-only SQL query.', 'info', 2600);
            return;
        }
        const progress = startDatabaseQueryProgress(explain ? 'explaining' : 'running');
        try {
            const result = await withDatabasePasswordRetry(() => fetchJSON(`/api/databases/${encodeURIComponent(conn.id)}/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: progress?.signal,
                timeoutMessage: 'Query canceled.',
                body: JSON.stringify({ sql, explain, limit: 500 }),
            }));
            setDatabaseConnectionConnected(conn.id, true);
            rememberDatabaseQuery(sql);
            tab.result = result;
            tab.resultKind = explain ? 'explain' : 'query';
            tab.resultTitle = explain ? 'Explain' : 'Result';
            databaseActiveTabKind = 'query';
            databaseActiveQueryTabID = tab.id;
            databaseActiveResultTabID = '';
            databaseLastResult = result;
            renderDatabaseInspector(null);
            renderDatabaseQueryTabs();
            renderDatabaseResultTabs();
            renderDatabaseActivePane();
            renderDatabaseConnectionTree();
        } catch (err) {
            if (databaseQueryCancelRequested) {
                showToast('Query canceled', 'Database query was canceled.', 'info', 2600);
            } else {
                showToast('Query failed', compactErrorMessage(err && err.message, 'Unable to run query.'), 'error', 5200);
            }
        } finally {
            stopDatabaseQueryProgress();
        }
    }

    function startDatabaseQueryProgress(label) {
        databaseQueryInFlight = true;
        databaseQueryStartedAt = performance.now();
        databaseQueryCancelRequested = false;
        databaseQueryProgressLabel = label;
        databaseTableCountStatus = null;
        databaseQueryAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        renderDatabaseActivePane();
        setDatabaseQueryButtonsDisabled(true);
        renderDatabaseQueryProgress(label);
        if (databaseQueryProgressTimer) clearInterval(databaseQueryProgressTimer);
        databaseQueryProgressTimer = setInterval(() => renderDatabaseQueryProgress(label), 100);
        return databaseQueryAbortController;
    }

    function stopDatabaseQueryProgress() {
        databaseQueryInFlight = false;
        databaseQueryStartedAt = 0;
        databaseQueryProgressLabel = '';
        databaseQueryAbortController = null;
        if (databaseQueryProgressTimer) {
            clearInterval(databaseQueryProgressTimer);
            databaseQueryProgressTimer = null;
        }
        setDatabaseQueryButtonsDisabled(false);
        const status = document.getElementById('database-query-status');
        if (status) {
            status.classList.remove('active');
            status.innerHTML = '';
        }
        renderDatabaseActivePane();
    }

    function setDatabaseQueryButtonsDisabled(disabled) {
        document.getElementById('database-run-query-btn')?.toggleAttribute('disabled', disabled);
        document.getElementById('database-explain-query-btn')?.toggleAttribute('disabled', disabled);
        document.getElementById('database-pretty-query-btn')?.toggleAttribute('disabled', disabled);
        document.getElementById('database-save-query-btn')?.toggleAttribute('disabled', disabled);
        document.getElementById('database-save-query-name')?.toggleAttribute('disabled', disabled);
        document.getElementById('database-save-query-confirm')?.toggleAttribute('disabled', disabled);
        document.getElementById('database-save-query-cancel')?.toggleAttribute('disabled', disabled);
        document.getElementById('database-table-query-btn')?.toggleAttribute('disabled', disabled);
        document.getElementById('database-table-count-btn')?.toggleAttribute('disabled', disabled);
    }

    function renderDatabaseQueryProgress(label) {
        const status = document.getElementById('database-query-status');
        if (!status || !databaseQueryStartedAt) return;
        const elapsed = Math.max(0, performance.now() - databaseQueryStartedAt);
        status.classList.add('active');
        status.innerHTML = databaseQueryStatusInnerHTML(label, elapsed);
        bindDatabaseQueryCancelButton();
    }

    function databaseQueryStatusHTML(tab = null) {
        const active = databaseQueryInFlight && databaseQueryStartedAt;
        const elapsed = active ? Math.max(0, performance.now() - databaseQueryStartedAt) : 0;
        const countStatus = !active && tab && databaseTableCountStatus?.tabID === tab.id
            ? databaseTableCountStatus.text
            : '';
        const statusClass = active || countStatus ? 'active' : '';
        const statusHTML = active
            ? databaseQueryStatusInnerHTML(databaseQueryProgressLabel || 'running', elapsed)
            : esc(countStatus);
        return `<span id="database-query-status" class="${statusClass}" aria-live="polite">${statusHTML}</span>`;
    }

    function databaseQueryStatusInnerHTML(label, elapsed) {
        const cancel = databaseQueryAbortController
            ? `<button id="database-cancel-query-btn" type="button" title="Cancel query" aria-label="Cancel query">${iconHTML('x')}</button>`
            : '';
        return `<span class="database-query-spinner"></span><span>${esc(label)} ${esc(formatDatabaseQueryElapsed(elapsed))}</span>${cancel}`;
    }

    function clearDatabaseTableCountStatus(tabID = '') {
        if (!databaseTableCountStatus) return;
        if (tabID && databaseTableCountStatus.tabID !== tabID) return;
        databaseTableCountStatus = null;
        const status = document.getElementById('database-query-status');
        if (status && !databaseQueryInFlight) {
            status.classList.remove('active');
            status.innerHTML = '';
        }
    }

    function bindDatabaseQueryCancelButton() {
        const btn = document.getElementById('database-cancel-query-btn');
        if (btn) btn.onclick = cancelDatabaseQuery;
    }

    function cancelDatabaseQuery() {
        if (!databaseQueryAbortController) return;
        databaseQueryCancelRequested = true;
        databaseQueryAbortController.abort();
    }

    function formatDatabaseQueryElapsed(ms) {
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)}s`;
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    function rememberDatabaseQuery(sql) {
        try {
            const history = JSON.parse(localStorage.getItem(DATABASE_HISTORY_KEY) || '[]').filter(item => item !== sql);
            history.unshift(sql);
            localStorage.setItem(DATABASE_HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
        } catch {}
    }

    function addDatabaseResultTab(title, result, table = null, options = {}) {
        const tab = {
            id: stableDatabaseClientID('result'),
            title,
            result,
            table,
            kind: options.kind || (table ? 'table' : 'query'),
            tableKey: options.tableKey || '',
            connectionID: options.connectionID || selectedDatabaseID || '',
            where: String(options.where || ''),
            whereDraft: String(options.where || ''),
            orderColumn: String(options.orderColumn || ''),
            orderDir: normalizeDatabaseOrderDir(options.orderDir),
            columnConversions: options.columnConversions ? { ...options.columnConversions } : {},
            hiddenColumns: options.hiddenColumns ? { ...options.hiddenColumns } : {},
            createdAt: Date.now(),
        };
        databaseResultTabs.unshift(tab);
        databaseResultTabs = databaseResultTabs.slice(0, 12);
        activateDatabaseResultTab(tab.id);
    }

    function activateDatabaseResultTab(id) {
        const tab = databaseResultTabs.find(item => item.id === id);
        if (!tab) {
            databaseActiveResultTabID = '';
            databaseLastResult = null;
            renderDatabaseInspector(null);
            databaseActiveTabKind = 'query';
            renderDatabaseResultTabs();
            renderDatabaseQueryTabs();
            renderDatabaseActivePane();
            return;
        }
        databaseActiveTabKind = 'result';
        databaseActiveResultTabID = tab.id;
        databaseLastResult = tab.result;
        renderDatabaseInspector(tab.table || null, tab);
        renderDatabaseQueryTabs();
        renderDatabaseResultTabs();
        renderDatabaseActivePane();
    }

    function renderDatabaseResultTabs() {
        const tabs = document.getElementById('database-result-tabs');
        if (!tabs) return;
        tabs.innerHTML = '';
        databaseResultTabs.forEach(tab => {
            const el = document.createElement('div');
            el.tabIndex = 0;
            el.setAttribute('role', 'button');
            el.className = 'database-tab result-tab' + (databaseActiveTabKind === 'result' && tab.id === databaseActiveResultTabID ? ' active' : '');
            el.innerHTML = `<span class="database-tab-label">${esc(tab.title)}</span><button class="database-tab-close" type="button" title="Close result tab">${iconHTML('x')}</button>`;
            el.onclick = () => activateDatabaseResultTab(tab.id);
            el.oncontextmenu = (ev) => showDatabaseResultContextMenu(ev, tab.id);
            el.onkeydown = (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    activateDatabaseResultTab(tab.id);
                }
            };
            el.querySelector('.database-tab-close').onclick = (ev) => closeDatabaseResultTab(tab.id, ev);
            tabs.appendChild(el);
        });
    }

    function showDatabaseResultContextMenu(ev, id) {
        ev.preventDefault();
        ev.stopPropagation();
        const tab = databaseResultTabs.find(item => item.id === id);
        if (!tab) return;
        hideTerminalContextMenu();
        hideProjectContextMenu();
        const editorMenu = document.getElementById('editor-context-menu');
        if (editorMenu) editorMenu.style.display = 'none';
        const menu = document.getElementById('database-result-context-menu');
        if (!menu) return;
        const items = [
            { label: 'Duplicate tab', action: () => duplicateDatabaseResultTab(id) },
            { label: 'Close tab', action: () => closeDatabaseResultTab(id) },
        ];
        menu.innerHTML = '';
        items.forEach(item => {
            const el = document.createElement('div');
            el.className = 'terminal-context-item';
            el.textContent = item.label;
            el.addEventListener('click', () => {
                hideDatabaseResultContextMenu();
                item.action();
            });
            menu.appendChild(el);
        });
        positionFixedMenu(menu, ev.clientX, ev.clientY);
    }

    function closeDatabaseResultTab(id, ev) {
        ev?.preventDefault();
        ev?.stopPropagation();
        const idx = databaseResultTabs.findIndex(tab => tab.id === id);
        if (idx < 0) return;
        const wasActive = databaseActiveResultTabID === id;
        databaseResultTabs.splice(idx, 1);
        if (wasActive) {
            const next = databaseResultTabs[Math.min(idx, databaseResultTabs.length - 1)];
            if (next) activateDatabaseResultTab(next.id);
            else activateDatabaseQueryTab(databaseActiveQueryTabID);
            return;
        }
        renderDatabaseResultTabs();
        renderDatabaseActivePane();
    }

    function duplicateDatabaseResultTab(id, ev) {
        ev?.preventDefault();
        ev?.stopPropagation();
        const source = databaseResultTabs.find(tab => tab.id === id);
        if (!source) return;
        const copy = {
            ...source,
            id: stableDatabaseClientID('result'),
            result: source.result,
            table: source.table,
            columnConversions: { ...(source.columnConversions || {}) },
            hiddenColumns: { ...(source.hiddenColumns || {}) },
            createdAt: Date.now(),
        };
        databaseResultTabs.unshift(copy);
        databaseResultTabs = databaseResultTabs.slice(0, 12);
        activateDatabaseResultTab(copy.id);
    }

    function renderDatabaseResult() {
        const container = document.getElementById('database-results');
        if (!container) return;
        const tab = databaseActiveTabKind === 'query'
            ? activeDatabaseQueryTab()
            : databaseResultTabs.find(item => item.id === databaseActiveResultTabID);
        if (!tab) {
            disposeDatabaseWhereEditor();
            container.innerHTML = '<div class="database-empty">Run a query or select a table.</div>';
            return;
        }
        if (databaseActiveTabKind === 'query' && !tab.result) {
            disposeDatabaseWhereEditor();
            if (databaseQueryInFlight) {
                container.innerHTML =
                    `<div class="database-result-meta"><span class="database-result-summary">0 rows · 0ms${databaseQueryStatusHTML(tab)}</span><span>waiting for results</span></div>` +
                    '<div class="database-empty">Waiting for query results.</div>';
                bindDatabaseQueryCancelButton();
            } else {
                container.innerHTML = '<div class="database-empty">Run this query to see results.</div>';
            }
            return;
        }
        const result = tab.result || {};
        const columns = Array.isArray(result.columns) ? result.columns : [];
        const columnTypes = databaseDisplayColumnTypes(tab, result);
        const visibleColumns = databaseVisibleColumnEntries(tab, result, columns, columnTypes);
        const rows = Array.isArray(result.rows) ? result.rows : [];
        const head = visibleColumns.map(col => databaseColumnHeaderHTML(tab, col.name, col.index, col.type, result)).join('');
        const body = visibleColumns.length === 0
            ? '<tr><td colspan="1">No visible columns.</td></tr>'
            : rows.map((row, rowIdx) =>
                `<tr>${visibleColumns.map(col => databaseCellHTML(tab, row[col.index], col.type, col.index, rowIdx)).join('')}</tr>`
            ).join('');
        const meta = `${result.row_count || rows.length} row${(result.row_count || rows.length) === 1 ? '' : 's'} · ${result.elapsed_ms || 0}ms${result.truncated ? ' · truncated' : ''}`;
        const filter = databaseActiveTabKind !== 'query' && tab.kind === 'table' ? databaseTableFilterHTML(tab) : '';
        const filterState = databaseActiveTabKind !== 'query' && tab.kind === 'table' ? captureDatabaseTableFilterState(tab) : null;
        disposeDatabaseWhereEditor();
        container.innerHTML =
            filter +
            `<div class="database-result-meta"><span class="database-result-summary">${esc(meta)}${databaseQueryStatusHTML(tab)}</span><span title="${esc(result.sql || '')}">${esc(compactSQL(result.sql || ''))}</span></div>` +
            `<div class="database-table-wrap"><table class="database-result-table"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${Math.max(visibleColumns.length, 1)}">No rows.</td></tr>`}</tbody></table></div>`;
        if (databaseActiveTabKind !== 'query' && tab.kind === 'table') bindDatabaseTableFilter(tab, filterState);
        bindDatabaseQueryCancelButton();
        bindDatabaseColumnHeaders(tab, columns, columnTypes, result);
    }

    function databaseDisplayColumnTypes(tab, result) {
        const resultTypes = Array.isArray(result?.column_types) ? result.column_types : [];
        const columns = Array.isArray(result?.columns) ? result.columns : [];
        if (!tab || tab.kind !== 'table' || !tab.table || !Array.isArray(tab.table.columns)) return resultTypes;
        const tableColumns = new Map(tab.table.columns.map(column => [column.name, column]));
        return columns.map((name, idx) => {
            const resultType = resultTypes[idx] || {};
            const tableColumn = tableColumns.get(name);
            if (!tableColumn) return resultType;
            return {
                ...resultType,
                type: tableColumn.type || resultType.type || '',
                schema_type: tableColumn.type || '',
            };
        });
    }

    function databaseVisibleColumnEntries(tab, result, columns = null, columnTypes = null) {
        columns = Array.isArray(columns) ? columns : (Array.isArray(result?.columns) ? result.columns : []);
        columnTypes = Array.isArray(columnTypes) ? columnTypes : databaseDisplayColumnTypes(tab, result);
        return columns
            .map((name, index) => ({ name, index, type: columnTypes[index] }))
            .filter(column => !isDatabaseColumnHidden(tab, column.name));
    }

    function databaseTableColumnNames(tab) {
        if (tab && tab.table && Array.isArray(tab.table.columns) && tab.table.columns.length > 0) {
            return tab.table.columns.map(column => column.name);
        }
        const columns = Array.isArray(tab?.result?.columns) ? tab.result.columns : [];
        return columns.slice();
    }

    function isDatabaseColumnHidden(tab, columnName) {
        return !!(tab && tab.kind === 'table' && tab.hiddenColumns && tab.hiddenColumns[columnName]);
    }

    function setDatabaseColumnVisibility(tab, columnName, visible) {
        if (!tab || tab.kind !== 'table' || !columnName) return;
        if (!tab.hiddenColumns) tab.hiddenColumns = {};
        if (visible) delete tab.hiddenColumns[columnName];
        else tab.hiddenColumns[columnName] = true;
        renderDatabaseResult();
        renderDatabaseInspector(tab.table || null, tab);
    }

    function setDatabaseAllColumnsVisibility(tab, visible) {
        if (!tab || tab.kind !== 'table') return;
        tab.hiddenColumns = {};
        if (!visible) {
            databaseTableColumnNames(tab).forEach(columnName => {
                if (columnName) tab.hiddenColumns[columnName] = true;
            });
        }
        renderDatabaseResult();
        renderDatabaseInspector(tab.table || null, tab);
    }

    function bindDatabaseInspectorVisibility(tab) {
        const columns = databaseTableColumnNames(tab);
        const visibleCount = columns.filter(columnName => !isDatabaseColumnHidden(tab, columnName)).length;
        const all = document.getElementById('database-column-visibility-all');
        if (all) {
            all.checked = columns.length > 0 && visibleCount === columns.length;
            all.indeterminate = visibleCount > 0 && visibleCount < columns.length;
            all.onchange = () => setDatabaseAllColumnsVisibility(tab, all.checked);
        }
        document.querySelectorAll('#database-inspector input[data-db-inspector-column]').forEach(input => {
            input.onchange = () => setDatabaseColumnVisibility(tab, input.dataset.dbInspectorColumn, input.checked);
        });
    }

    function databaseColumnHeaderHTML(tab, columnName, columnIndex, column = null, result = null) {
        const sortable = databaseActiveTabKind !== 'query' && tab && tab.kind === 'table';
        const active = sortable && tab.orderColumn === columnName && normalizeDatabaseOrderDir(tab.orderDir);
        const indicator = active ? iconHTML(active === 'desc' ? 'chevron-down' : 'chevron-up') : '';
        const sampleValue = firstDatabaseColumnBinaryValue(result, columnIndex);
        const binary = isDatabaseBinaryColumn(column) || isDatabaseBinaryValue(sampleValue);
        const classes = [
            sortable ? 'database-sortable-column' : '',
            active ? 'active' : '',
            binary ? 'database-binary-column' : '',
        ].filter(Boolean).join(' ');
        const title = [
            sortable ? 'Click to cycle table ordering' : '',
            binary ? 'Right-click for binary conversion' : sortable ? 'Right-click for ordering' : '',
        ].filter(Boolean).join('; ');
        const attrs = ` class="${classes}" data-db-column-index="${columnIndex}"${title ? ` title="${esc(title)}"` : ''}`;
        return `<th${attrs}><span class="database-column-header"><span class="database-column-label">${esc(columnName)}</span><span class="database-sort-indicator">${indicator}</span></span></th>`;
    }

    function databaseCellHTML(tab, value, column, columnIndex, rowIndex) {
        const mode = databaseCellConversionMode(tab, value, column, columnIndex);
        return `<td>${esc(formatDatabaseCell(value, column, mode))}</td>`;
    }

    function databaseTableFilterHTML(tab) {
        return `<form id="database-table-filter-form" class="database-table-filter" autocomplete="off">` +
            `<span class="database-table-filter-label">where</span>` +
            `<div id="database-table-filter-editor" class="database-sql-filter-editor">` +
                `<pre id="database-table-filter-highlight" class="database-sql-filter-highlight" aria-hidden="true"></pre>` +
                `<input id="database-table-filter-input" type="text" spellcheck="false" placeholder="column like &quot;%value%&quot; and other_column is not null">` +
                `<div id="database-table-filter-monaco" aria-label="WHERE condition"></div>` +
            `</div>` +
            `<button id="database-table-filter-apply" type="submit" title="Apply condition">${iconHTML('filter')}</button>` +
            `<button id="database-table-count-btn" type="button" title="Count rows matching this condition" aria-label="Count rows matching this condition">${iconHTML('hash')}</button>` +
            `<button id="database-table-query-btn" type="button" title="New query from this table view" aria-label="New query from this table view">${iconHTML('plus')}</button>` +
            `<button id="database-table-filter-clear" type="button" title="Clear condition">${iconHTML('x')}</button>` +
            `</form>`;
    }

    function databaseTableFilterValue(tab) {
        if (!tab || tab.kind !== 'table') return '';
        return typeof tab.whereDraft === 'string' ? tab.whereDraft : String(tab.where || '');
    }

    function renderDatabaseTableFilterHighlight(input) {
        const highlight = document.getElementById('database-table-filter-highlight');
        const editor = document.getElementById('database-table-filter-editor');
        if (!input || !highlight || !editor) return;
        const value = input.value || '';
        highlight.innerHTML = databaseSQLHighlightHTML(value);
        highlight.scrollLeft = input.scrollLeft;
        editor.classList.toggle('has-value', value.length > 0);
    }

    function databaseTableColumnObjects(tab) {
        if (tab && tab.table && Array.isArray(tab.table.columns) && tab.table.columns.length > 0) {
            return tab.table.columns.map(column => ({
                name: String(column.name || ''),
                type: String(column.type || ''),
            })).filter(column => column.name);
        }
        return databaseTableColumnNames(tab).map(name => ({ name, type: '' })).filter(column => column.name);
    }

    function disposeDatabaseWhereEditor() {
        if (!databaseWhereEditor) return;
        const model = databaseWhereEditor.getModel();
        if (model) databaseWhereCompletionModels.delete(model);
        databaseWhereEditor.dispose();
        if (model) model.dispose();
        databaseWhereEditor = null;
        databaseWhereEditorSyncing = false;
    }

    function initDatabaseWhereEditor(tab, input, state = null) {
        const host = document.getElementById('database-table-filter-monaco');
        const wrapper = document.getElementById('database-table-filter-editor');
        const form = document.getElementById('database-table-filter-form');
        if (!tab || tab.kind !== 'table' || !input || !host || !wrapper) return;
        ensureMonaco(() => {
            if (!document.getElementById('database-table-filter-monaco') || databaseWhereEditor) return;
            const activeTable = databaseResultTabs.find(item => item.id === databaseActiveResultTabID);
            if (activeTable !== tab || document.getElementById('database-table-filter-input') !== input) return;
            registerDatabaseSQLCompletions();
            const model = monaco.editor.createModel(input.value || '', 'sql');
            databaseWhereCompletionModels.set(model, tab);
            databaseWhereEditor = monaco.editor.create(host, {
                model,
                theme: getMonacoThemeName(),
                automaticLayout: true,
                minimap: { enabled: false },
                fixedOverflowWidgets: true,
                scrollBeyondLastLine: false,
                scrollbar: {
                    vertical: 'hidden',
                    horizontal: 'hidden',
                    handleMouseWheel: false,
                    alwaysConsumeMouseWheel: false,
                },
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                lineNumbers: 'off',
                lineDecorationsWidth: 0,
                lineNumbersMinChars: 0,
                glyphMargin: false,
                folding: false,
                wordWrap: 'off',
                renderLineHighlight: 'none',
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
                padding: { top: 4, bottom: 0 },
                quickSuggestions: { other: true, comments: false, strings: false },
                suggestOnTriggerCharacters: true,
                suggest: { selectionMode: 'always' },
                acceptSuggestionOnEnter: 'on',
                tabCompletion: 'on',
            });
            wrapper.classList.add('monaco-active');
            databaseWhereEditor.onDidChangeModelContent(() => {
                if (databaseWhereEditorSyncing) return;
                input.value = databaseWhereEditor.getValue();
                tab.whereDraft = input.value;
                clearDatabaseTableCountStatus(tab.id);
            });
            databaseWhereEditor.onKeyDown(ev => {
                if (ev.keyCode !== monaco.KeyCode.Enter) return;
                if (databaseWhereAutocompleteOpen()) return;
                ev.preventDefault();
                ev.stopPropagation();
                if (typeof form?.requestSubmit === 'function') form.requestSubmit();
                else form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            });
            host.addEventListener('keydown', ev => {
                consumeDatabaseAutocompleteEscape(ev);
            }, true);
            restoreDatabaseTableFilterState(input, state);
            setTimeout(() => databaseWhereEditor?.layout(), 0);
        });
    }

    function setDatabaseWhereEditorValue(value) {
        const next = String(value || '');
        if (!databaseWhereEditor || databaseWhereEditor.getValue() === next) return;
        databaseWhereEditorSyncing = true;
        databaseWhereEditor.setValue(next);
        databaseWhereEditorSyncing = false;
    }

    function databaseAutocompleteWidgetVisible(widget) {
        if (!widget) return false;
        const style = window.getComputedStyle(widget);
        const rect = widget.getBoundingClientRect();
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && style.opacity !== '0'
            && rect.width > 0
            && rect.height > 0;
    }

    function databaseMonacoAutocompleteOpen(editor, rootSelector) {
        if (!databaseActive || !editor) return false;
        const active = document.activeElement;
        const editorFocused = typeof editor.hasTextFocus === 'function'
            ? editor.hasTextFocus()
            : Boolean(active?.closest && active.closest(rootSelector));
        if (!editorFocused) return false;
        return Array.from(document.querySelectorAll('.suggest-widget, .parameter-hints-widget'))
            .some(databaseAutocompleteWidgetVisible);
    }

    function databaseQueryAutocompleteOpen() {
        return databaseActiveTabKind === 'query' && databaseMonacoAutocompleteOpen(databaseQueryEditor, '#database-query-editor');
    }

    function databaseWhereAutocompleteOpen() {
        return databaseMonacoAutocompleteOpen(databaseWhereEditor, '#database-table-filter-monaco');
    }

    function consumeDatabaseAutocompleteEscape(ev) {
        if (!ev || ev.key !== 'Escape') return false;
        const editor = databaseWhereAutocompleteOpen()
            ? databaseWhereEditor
            : databaseQueryAutocompleteOpen()
                ? databaseQueryEditor
                : null;
        if (editor) {
            try { editor.trigger('keyboard', 'hideSuggestWidget', {}); } catch {}
            ev.preventDefault();
            ev.stopPropagation();
            return true;
        }
        return false;
    }

    function captureDatabaseTableFilterState(tab) {
        const input = document.getElementById('database-table-filter-input');
        if (!input || !tab || tab.kind !== 'table') return null;
        const value = databaseWhereEditor ? databaseWhereEditor.getValue() : input.value;
        tab.whereDraft = value;
        input.value = value;
        if (databaseWhereEditor && typeof databaseWhereEditor.hasTextFocus === 'function' && databaseWhereEditor.hasTextFocus()) {
            return { monacoPosition: databaseWhereEditor.getPosition() };
        }
        if (document.activeElement !== input) return null;
        return {
            selectionStart: input.selectionStart,
            selectionEnd: input.selectionEnd,
        };
    }

    function restoreDatabaseTableFilterState(input, state) {
        if (!input || !state) return;
        if (databaseWhereEditor && state.monacoPosition) {
            databaseWhereEditor.focus();
            try { databaseWhereEditor.setPosition(state.monacoPosition); } catch {}
            return;
        }
        try {
            input.focus({ preventScroll: true });
        } catch {
            input.focus();
        }
        if (typeof input.setSelectionRange !== 'function') return;
        const end = Number.isInteger(state.selectionEnd) ? state.selectionEnd : input.value.length;
        const start = Number.isInteger(state.selectionStart) ? state.selectionStart : end;
        try {
            input.setSelectionRange(
                Math.max(0, Math.min(start, input.value.length)),
                Math.max(0, Math.min(end, input.value.length))
            );
        } catch {}
    }

    function bindDatabaseColumnHeaders(tab, columns, columnTypes = [], result = null) {
        document.querySelectorAll('#database-results th[data-db-column-index]').forEach(header => {
            const columnIndex = Number.parseInt(header.dataset.dbColumnIndex, 10);
            const columnName = columns[columnIndex];
            if (columnName === undefined) return;
            const sortable = databaseActiveTabKind !== 'query' && tab && tab.kind === 'table';
            const column = columnTypes[columnIndex];
            const sampleValue = firstDatabaseColumnBinaryValue(result, columnIndex);
            const binary = isDatabaseBinaryColumn(column) || isDatabaseBinaryValue(sampleValue);
            if (sortable) header.onclick = () => cycleDatabaseTableOrdering(tab, columnName);
            if (sortable || binary) {
                header.oncontextmenu = (ev) => showDatabaseColumnContextMenu(ev, tab, columnName, column, columnIndex, sampleValue);
            }
        });
    }

    function showDatabaseColumnContextMenu(ev, tab, columnName, column = null, columnIndex = -1, sampleValue = null) {
        ev.preventDefault();
        ev.stopPropagation();
        if (!tab) return;
        const sortable = databaseActiveTabKind !== 'query' && tab.kind === 'table';
        const binary = isDatabaseBinaryColumn(column) || isDatabaseBinaryValue(sampleValue);
        if (!sortable && !binary) return;
        hideTerminalContextMenu();
        hideProjectContextMenu();
        const editorMenu = document.getElementById('editor-context-menu');
        if (editorMenu) editorMenu.style.display = 'none';
        const menu = document.getElementById('database-result-context-menu');
        if (!menu) return;
        menu.innerHTML = '';
        if (sortable) {
            const currentDir = tab.orderColumn === columnName ? normalizeDatabaseOrderDir(tab.orderDir) : '';
            [
                { label: 'Sort descending', dir: 'desc' },
                { label: 'Sort ascending', dir: 'asc' },
                { label: 'Clear ordering', dir: '' },
            ].forEach(item => {
                const active = item.dir ? currentDir === item.dir : !normalizeDatabaseOrderDir(tab.orderDir);
                appendDatabaseContextMenuItem(menu, item.label + (active ? ' (active)' : ''), () => {
                    setDatabaseTableOrdering(tab.id, item.dir ? columnName : '', item.dir);
                });
            });
            appendDatabaseContextMenuItem(menu, 'Hide column', () => {
                setDatabaseColumnVisibility(tab, columnName, false);
            });
        }
        if (sortable && binary) {
            const sep = document.createElement('div');
            sep.className = 'database-context-separator';
            menu.appendChild(sep);
        }
        if (binary) {
            const uuidEnabled = isDatabaseUUIDBinaryColumn(column, sampleValue);
            const current = databaseColumnConversionMode(tab, column, columnIndex, sampleValue);
            [
                { label: 'UUID string (ordered time)', mode: 'uuid-ordered', enabled: uuidEnabled },
                { label: 'UUID string', mode: 'uuid', enabled: uuidEnabled },
                { label: 'UTF-8 string', mode: 'text', enabled: true },
                { label: 'Hex (0x...)', mode: 'hex', enabled: true },
            ].forEach(item => {
                appendDatabaseContextMenuItem(menu, item.label + (item.mode === current ? ' (active)' : ''), () => {
                    setDatabaseColumnConversion(tab, columnIndex, item.mode);
                }, item.enabled);
            });
        }
        positionFixedMenu(menu, ev.clientX, ev.clientY);
    }

    function appendDatabaseContextMenuItem(menu, label, action, enabled = true) {
        const el = document.createElement('div');
        el.className = 'terminal-context-item' + (enabled ? '' : ' disabled');
        el.textContent = label;
        if (enabled) {
            el.addEventListener('click', () => {
                hideDatabaseResultContextMenu();
                action();
            });
        }
        menu.appendChild(el);
    }

    function firstDatabaseColumnBinaryValue(result, columnIndex) {
        const rows = Array.isArray(result?.rows) ? result.rows : [];
        for (const row of rows) {
            if (!Array.isArray(row)) continue;
            const value = row[columnIndex];
            if (isDatabaseBinaryValue(value)) return value;
        }
        return null;
    }

    function setDatabaseColumnConversion(tab, columnIndex, mode) {
        if (!tab || columnIndex < 0) return;
        if (!tab.columnConversions) tab.columnConversions = {};
        tab.columnConversions[columnIndex] = mode;
        renderDatabaseResult();
    }

    function databaseColumnConversionMode(tab, column, columnIndex, sampleValue = null) {
        const explicit = tab && tab.columnConversions && tab.columnConversions[columnIndex];
        if (explicit) return explicit;
        if (isDatabaseUUIDBinaryColumn(column, sampleValue)) return 'uuid-ordered';
        if (isDatabaseBinaryColumn(column) || isDatabaseBinaryValue(sampleValue)) return 'hex';
        return 'text';
    }

    function bindDatabaseTableFilter(tab, filterState = null) {
        const form = document.getElementById('database-table-filter-form');
        const input = document.getElementById('database-table-filter-input');
        const clear = document.getElementById('database-table-filter-clear');
        const queryBtn = document.getElementById('database-table-query-btn');
        const countBtn = document.getElementById('database-table-count-btn');
        if (!form || !input || !clear) return;
        input.value = databaseTableFilterValue(tab);
        renderDatabaseTableFilterHighlight(input);
        input.oninput = () => {
            tab.whereDraft = input.value;
            clearDatabaseTableCountStatus(tab.id);
            renderDatabaseTableFilterHighlight(input);
        };
        input.onscroll = () => {
            renderDatabaseTableFilterHighlight(input);
        };
        form.onsubmit = (ev) => {
            ev.preventDefault();
            if (databaseWhereEditor) input.value = databaseWhereEditor.getValue();
            tab.whereDraft = input.value;
            applyDatabaseTableWhere(tab.id, input.value);
        };
        clear.onclick = () => {
            input.value = '';
            setDatabaseWhereEditorValue('');
            tab.whereDraft = '';
            renderDatabaseTableFilterHighlight(input);
            applyDatabaseTableWhere(tab.id, '');
        };
        initDatabaseWhereEditor(tab, input, filterState);
        if (countBtn) countBtn.onclick = () => {
            if (databaseWhereEditor) input.value = databaseWhereEditor.getValue();
            countDatabaseTableRows(tab.id, input.value);
        };
        if (queryBtn) queryBtn.onclick = () => createDatabaseQueryFromTableView(tab);
        if (!databaseWhereEditor) restoreDatabaseTableFilterState(input, filterState);
    }

    function createDatabaseQueryFromTableView(tab) {
        if (!tab || tab.kind !== 'table') return;
        const sql = String(tab.result?.sql || '').trim();
        if (!sql) return;
        addDatabaseQueryTab(sql.endsWith(';') ? sql : `${sql};`, {
            connectionID: tab.connectionID || String(tab.tableKey || '').split('\u001f')[0] || selectedDatabaseID || '',
        });
    }

    function databaseCellConversionMode(tab, value, column, columnIndex) {
        return databaseColumnConversionMode(tab, column, columnIndex, value);
    }

    function cycleDatabaseTableOrdering(tab, columnName) {
        if (!tab || tab.kind !== 'table') return;
        const current = tab.orderColumn === columnName ? normalizeDatabaseOrderDir(tab.orderDir) : '';
        const next = current === 'desc' ? 'asc' : current === 'asc' ? '' : 'desc';
        setDatabaseTableOrdering(tab.id, next ? columnName : '', next);
    }

    function normalizeDatabaseOrderDir(dir) {
        dir = String(dir || '').trim().toLowerCase();
        return dir === 'asc' || dir === 'desc' ? dir : '';
    }

    async function setDatabaseTableOrdering(tabID, columnName, direction) {
        const tab = databaseResultTabs.find(item => item.id === tabID);
        if (!tab || tab.kind !== 'table' || !tab.table) return;
        const dir = normalizeDatabaseOrderDir(direction);
        await reloadDatabaseTableTab(tab, {
            orderColumn: dir ? String(columnName || '').trim() : '',
            orderDir: dir,
        }, 'Ordering failed', 'Unable to apply table ordering.');
    }

    async function applyDatabaseTableWhere(tabID, where) {
        const tab = databaseResultTabs.find(item => item.id === tabID);
        if (!tab || tab.kind !== 'table' || !tab.table) return;
        const form = document.getElementById('database-table-filter-form');
        if (form) form.classList.add('loading');
        try {
            await reloadDatabaseTableTab(tab, { where: String(where || '').trim() }, 'Filter failed', 'Unable to apply table condition.');
        } finally {
            const nextForm = document.getElementById('database-table-filter-form');
            if (nextForm) nextForm.classList.remove('loading');
        }
    }

    async function countDatabaseTableRows(tabID, where) {
        const tab = databaseResultTabs.find(item => item.id === tabID);
        if (!tab || tab.kind !== 'table' || !tab.table) return;
        if (databaseQueryInFlight) {
            showToast('Query running', 'Cancel or wait for the current database query to finish.', 'info', 2600);
            return;
        }
        const condition = String(where || '').trim();
        tab.whereDraft = condition;
        const connectionID = tab.connectionID || String(tab.tableKey || '').split('\u001f')[0] || selectedDatabaseID;
        const progress = startDatabaseQueryProgress('counting rows');
        try {
            const result = await withDatabasePasswordRetry(() => fetchJSON(databaseTableCountURL(connectionID, tab.table, condition), {
                signal: progress?.signal,
                timeoutMessage: 'Count canceled.',
            }));
            setDatabaseConnectionConnected(connectionID, true);
            const count = Number(result?.count || 0);
            const elapsed = Number(result?.elapsed_ms || 0);
            databaseTableCountStatus = {
                tabID: tab.id,
                text: `${formatDatabaseCount(count)} ${count === 1 ? 'row' : 'rows'} · ${elapsed}ms`,
            };
            renderDatabaseConnectionTree();
        } catch (err) {
            if (databaseQueryCancelRequested) {
                showToast('Count canceled', 'Table count was canceled.', 'info', 2600);
            } else {
                showToast('Count failed', compactErrorMessage(err && err.message, 'Unable to count table rows.'), 'error', 4200);
            }
        } finally {
            stopDatabaseQueryProgress();
        }
    }

    function formatDatabaseCount(value) {
        const count = Number.isFinite(value) ? value : 0;
        try {
            return count.toLocaleString();
        } catch {
            return String(count);
        }
    }

    async function reloadDatabaseTableTab(tab, changes = {}, toastTitle = 'Table load failed', fallback = 'Unable to load table rows.') {
        if (!tab || tab.kind !== 'table' || !tab.table) return;
        if (databaseQueryInFlight) {
            showToast('Query running', 'Cancel or wait for the current database query to finish.', 'info', 2600);
            return;
        }
        const connectionID = tab.connectionID || String(tab.tableKey || '').split('\u001f')[0] || selectedDatabaseID;
        const whereChanged = Object.prototype.hasOwnProperty.call(changes, 'where');
        const where = whereChanged
            ? String(changes.where || '').trim()
            : String(tab.where || '').trim();
        const orderDir = Object.prototype.hasOwnProperty.call(changes, 'orderDir')
            ? normalizeDatabaseOrderDir(changes.orderDir)
            : normalizeDatabaseOrderDir(tab.orderDir);
        const orderColumn = orderDir
            ? String(Object.prototype.hasOwnProperty.call(changes, 'orderColumn') ? changes.orderColumn || '' : tab.orderColumn || '').trim()
            : '';
        const progress = startDatabaseQueryProgress('loading table');
        try {
            const result = await withDatabasePasswordRetry(() => fetchJSON(databaseTableRowsURL(connectionID, tab.table, where, orderColumn, orderDir), {
                signal: progress?.signal,
                timeoutMessage: 'Query canceled.',
            }));
            setDatabaseConnectionConnected(connectionID, true);
            tab.result = result;
            tab.where = where;
            if (whereChanged) tab.whereDraft = where;
            tab.orderColumn = orderColumn;
            tab.orderDir = orderColumn ? orderDir : '';
            if (databaseActiveResultTabID === tab.id) {
                databaseLastResult = result;
                renderDatabaseResult();
            }
            renderDatabaseConnectionTree();
        } catch (err) {
            if (databaseQueryCancelRequested) {
                showToast('Query canceled', 'Table load was canceled.', 'info', 2600);
            } else {
                showToast(toastTitle, compactErrorMessage(err && err.message, fallback), 'error', 4200);
            }
        } finally {
            stopDatabaseQueryProgress();
        }
    }

    function formatDatabaseCell(value, column = null, mode = '') {
        if (value === null || value === undefined) return 'NULL';
        if (isDatabaseBinaryValue(value)) {
            const bytes = databaseBinaryBytes(value);
            const conversion = mode || (isDatabaseUUIDBinaryColumn(column, value) ? 'uuid-ordered' : 'hex');
            if ((conversion === 'uuid-ordered' || conversion === 'uuid') && bytes.length === 16) {
                return conversion === 'uuid-ordered' ? orderedUUIDString(bytes) : uuidString(bytes);
            }
            if (conversion === 'text') return databaseBinaryText(bytes);
            return databaseBinaryHex(value);
        }
        if (isDatabaseTinyIntColumn(column)) return formatDatabaseTinyIntBoolean(value);
        if (typeof value === 'object') {
            try { return JSON.stringify(value); } catch { return String(value); }
        }
        return String(value);
    }

    function isDatabaseTinyIntColumn(column) {
        const type = String(column && (column.schema_type || column.type || column.database_type) || '').toLowerCase();
        if (/\btinyint\s*\(\s*1\s*\)/.test(type)) return true;
        if (!/\btinyint\b/.test(type)) return false;
        return Number(column && column.length) === 1;
    }

    function formatDatabaseTinyIntBoolean(value) {
        if (typeof value === 'boolean') return value ? 'true' : 'false';
        if (typeof value === 'number' && Number.isFinite(value)) return value === 0 ? 'false' : 'true';
        const text = String(value).trim();
        if (/^[+-]?\d+(\.0+)?$/.test(text)) return Number(text) === 0 ? 'false' : 'true';
        return String(value);
    }

    function isDatabaseBinaryValue(value) {
        return !!(value && typeof value === 'object' && value.type === 'binary' && typeof value.hex === 'string');
    }

    function isDatabaseBinaryColumn(column) {
        if (column && column.binary) return true;
        const type = String(column && (column.database_type || column.type) || '').toUpperCase();
        return type.includes('BINARY') || type.endsWith('BLOB') || ['BLOB', 'BYTEA', 'RAW', 'LONG RAW'].includes(type);
    }

    function isDatabaseUUIDBinaryColumn(column, value) {
        if (!isDatabaseBinaryColumn(column) && !isDatabaseBinaryValue(value)) return false;
        const type = String(column && (column.database_type || column.type || column.schema_type) || '').toLowerCase();
        const declaredLength = Number(column && column.length) || 0;
        const valueLength = isDatabaseBinaryValue(value) ? Number(value.length) || 0 : 0;
        return valueLength === 16 || declaredLength === 16 || /\bbinary\s*\(\s*16\s*\)/i.test(type);
    }

    function databaseBinaryBytes(value) {
        const hex = String(value && value.hex || '').replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '');
        const bytes = [];
        for (let i = 0; i + 1 < hex.length; i += 2) {
            bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
        }
        return bytes;
    }

    function databaseBinaryHex(value) {
        const hex = String(value && value.hex || '').replace(/^0x/i, '').toLowerCase();
        return hex ? `0x${hex}` : '0x';
    }

    function databaseBinaryText(bytes) {
        try {
            return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
        } catch {
            return String.fromCharCode(...bytes);
        }
    }

    function uuidString(bytes) {
        const hex = bytes.map(byte => byte.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    function orderedUUIDString(bytes) {
        if (bytes.length !== 16) return uuidString(bytes);
        const raw = bytes.slice(4, 8).concat(bytes.slice(2, 4), bytes.slice(0, 2), bytes.slice(8));
        return uuidString(raw);
    }

    function compactSQL(sql) {
        const text = String(sql || '').replace(/\s+/g, ' ').trim();
        return text.length > 140 ? text.slice(0, 137) + '...' : text;
    }

    const DATABASE_SQL_COMPLETION_KEYWORDS = [
        'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'BETWEEN',
        'LIKE', 'ILIKE', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN',
        'LEFT JOIN', 'INNER JOIN', 'ON', 'AS', 'DISTINCT', 'CASE', 'WHEN', 'THEN',
        'ELSE', 'END', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
    ];

    const DATABASE_SQL_TABLE_CONTEXT_KEYWORDS = [
        'JOIN', 'LEFT JOIN', 'INNER JOIN', 'WHERE', 'GROUP BY', 'ORDER BY', 'LIMIT',
    ];

    const DATABASE_SQL_COLUMN_CONTEXT_KEYWORDS = [
        'AND', 'OR', 'NOT', 'IS NULL', 'IS NOT NULL', 'IN', 'NOT IN', 'LIKE', 'ILIKE',
        'BETWEEN', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT',
    ];

    const DATABASE_WHERE_COMPLETION_KEYWORDS = [
        'AND', 'OR', 'NOT', 'IS NULL', 'IS NOT NULL', 'IN', 'NOT IN', 'LIKE', 'ILIKE',
        'BETWEEN', 'EXISTS', 'TRUE', 'FALSE',
    ];

    const DATABASE_SQL_KEYWORDS = new Set([
        'all', 'and', 'any', 'as', 'asc', 'between', 'by', 'case', 'cast', 'desc', 'distinct',
        'else', 'end', 'exists', 'false', 'from', 'group', 'having', 'ilike', 'in', 'is',
        'join', 'like', 'limit', 'not', 'null', 'offset', 'on', 'or', 'order', 'regexp',
        'select', 'then', 'true', 'when', 'where',
    ]);

    function databaseSQLHighlightHTML(sql) {
        const text = String(sql || '');
        const tokenRE = /(--.*$|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:\"\"|[^"])*"|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[a-z_][\w$]*\b|<>|!=|<=|>=|[(),.;=*<>!+\-/]+|\s+|.)/gim;
        return text.replace(tokenRE, token => {
            let cls = '';
            const lower = token.toLowerCase();
            if (/^--|^\/\*/.test(token)) cls = 'sql-token-comment';
            else if (/^['"`]/.test(token)) cls = 'sql-token-string';
            else if (/^\d/.test(token)) cls = 'sql-token-number';
            else if (DATABASE_SQL_KEYWORDS.has(lower)) cls = 'sql-token-keyword';
            else if (/^(<>|!=|<=|>=|[(),.;=*<>!+\-/]+)$/.test(token)) cls = 'sql-token-operator';
            const html = esc(token);
            return cls ? `<span class="${cls}">${html}</span>` : html;
        });
    }

    function exportDatabaseCSV() {
        const tab = databaseActiveTabKind === 'query'
            ? activeDatabaseQueryTab()
            : databaseResultTabs.find(item => item.id === databaseActiveResultTabID);
        const result = tab?.result || databaseLastResult;
        if (!result || !Array.isArray(result.columns)) {
            showToast('No result', 'Run a query before exporting.', 'info', 2600);
            return;
        }
        const columnTypes = databaseDisplayColumnTypes(tab, result);
        const visibleColumns = databaseVisibleColumnEntries(tab, result, result.columns, columnTypes);
        if (visibleColumns.length === 0) {
            showToast('No visible columns', 'Show at least one column before exporting.', 'info', 2600);
            return;
        }
        const lines = [visibleColumns.map(column => csvEscape(column.name)).join(',')];
        (result.rows || []).forEach(row => {
            lines.push(visibleColumns.map(column => {
                const value = row[column.index];
                const mode = databaseCellConversionMode(tab, value, column.type, column.index);
                return csvEscape(value, column.type, mode);
            }).join(','));
        });
        const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'database-results.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function csvEscape(value, column = null, mode = '') {
        const text = formatDatabaseCell(value, column, mode);
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    function renderDatabaseDiscoveryProjectOptions() {
        const select = document.getElementById('database-discovery-project');
        if (!select) return;
        const current = select.value;
        select.innerHTML = '';
        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.name;
            option.textContent = project.name;
            select.appendChild(option);
        });
        if (current && projects.some(project => project.name === current)) select.value = current;
    }

    async function scanDatabaseDiscovery() {
        const select = document.getElementById('database-discovery-project');
        const project = select?.value || '';
        const results = document.getElementById('database-discovery-results');
        if (!project) return;
        if (results) results.innerHTML = '<div class="database-loading">scanning...</div>';
        try {
            const data = await fetchJSON('/api/databases/discover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project }),
            });
            renderDatabaseDiscoveryResults(data.suggestions || []);
        } catch (err) {
            if (results) results.innerHTML = `<div class="database-error">${esc(compactErrorMessage(err && err.message, 'Discovery failed.'))}</div>`;
        }
    }

    function renderDatabaseDiscoveryResults(items) {
        const results = document.getElementById('database-discovery-results');
        if (!results) return;
        results.innerHTML = '';
        const suggestions = normalizeDatabaseConnections(items);
        if (suggestions.length === 0) {
            results.innerHTML = '<div class="database-empty">No suggestions found.</div>';
            return;
        }
        suggestions.forEach(conn => {
            const row = document.createElement('div');
            row.className = 'database-discovery-item';
            row.innerHTML = `<div><strong>${esc(conn.name)}</strong><span>${esc(databaseConnectionSubtitle(conn))}</span></div><button type="button">save</button>`;
            row.querySelector('button').onclick = () => saveDiscoveredDatabase(conn);
            results.appendChild(row);
        });
    }

    async function saveDiscoveredDatabase(conn) {
        const savedConn = { ...conn, id: conn.id || stableDatabaseClientID('db') };
        const source = settingsModalIsOpen() ? settingsDatabaseConnections : databaseConnections;
        if (source.some(existing => existing.id === savedConn.id)) {
            showToast('Connection already saved', savedConn.name, 'info', 2600);
            return;
        }
        await createDatabaseConnection(savedConn);
        selectedDatabaseID = savedConn.id;
        expandedDatabaseConnectionID = savedConn.id;
        databaseConnectionTreeTouched = false;
        persistSelectedDatabaseConnection();
        renderDatabaseConnections();
        showToast('Connection saved', savedConn.name, 'success', 2600);
    }

    async function testDatabaseConnection(conn) {
        const data = await withDatabasePasswordRetry(() => fetchJSON('/api/databases/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: conn && conn.id || '', connection: conn }),
        }));
        return data;
    }

    function showDatabase() {
        if (overviewActive) hideOverview();
        if (jobsActive) hideJobs();
        databaseActive = true;
        persistDatabaseActiveView(true);
        document.getElementById('database-view').style.display = 'flex';
        document.getElementById('terminal-tabs').style.display = 'none';
        document.getElementById('terminal-container').style.display = 'none';
        document.getElementById('database-btn').classList.add('active');
        updateStatusContext();
        updateSidePanels();
        renderDatabaseConnections();
        renderDatabaseQueryTabs();
        renderDatabaseResultTabs();
        renderDatabaseActivePane();
        initDatabaseQueryEditor();
        if (databaseQueryEditor) setTimeout(() => databaseQueryEditor.layout(), 0);
        loadDatabaseConnections().catch(err => showToast('Databases unavailable', compactErrorMessage(err && err.message, 'Unable to load database connections.'), 'error', 4200));
    }

    function hideDatabase() {
        databaseActive = false;
        persistDatabaseActiveView(false);
        document.getElementById('database-view').style.display = 'none';
        document.getElementById('terminal-tabs').style.display = '';
        document.getElementById('terminal-container').style.display = '';
        document.getElementById('database-btn').classList.remove('active');
        updateStatusContext();
        updateSidePanels();
        if (activeTab) fitTab(activeTab);
    }

    function toggleDatabase() {
        if (databaseActive) {
            hideDatabase();
            markVisibleTabCompletionSeen();
        } else {
            showDatabase();
        }
    }

    function initDatabase() {
        loadStoredDatabaseState();
        document.getElementById('database-btn').onclick = toggleDatabase;
        document.getElementById('database-refresh-btn').onclick = () => loadDatabaseSchema(selectedDatabaseID, { force: true });
        document.getElementById('database-settings-btn').onclick = openSettings;
        document.getElementById('database-discovery-scan-btn').onclick = scanDatabaseDiscovery;
        document.getElementById('database-new-query-tab-btn').onclick = () => addDatabaseQueryTab();
        document.getElementById('database-run-query-btn').onclick = () => runDatabaseQuery(false);
        document.getElementById('database-explain-query-btn').onclick = () => runDatabaseQuery(true);
        document.getElementById('database-pretty-query-btn').onclick = prettifyActiveDatabaseQuery;
        document.getElementById('database-save-query-btn').onclick = saveActiveDatabaseQuery;
        document.getElementById('database-save-query-form').onsubmit = confirmDatabaseSaveQuery;
        document.getElementById('database-save-query-cancel').onclick = closeDatabaseSaveQueryForm;
        document.getElementById('database-save-query-name').addEventListener('keydown', ev => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                closeDatabaseSaveQueryForm();
            }
        });
        document.getElementById('database-password-close').onclick = cancelDatabasePasswordPrompt;
        document.getElementById('database-password-cancel').onclick = cancelDatabasePasswordPrompt;
        document.getElementById('database-password-backdrop').onclick = cancelDatabasePasswordPrompt;
        document.getElementById('database-password-submit').onclick = submitDatabasePasswordPrompt;
        document.getElementById('database-password-input').addEventListener('keydown', ev => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                submitDatabasePasswordPrompt();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                cancelDatabasePasswordPrompt();
            }
        });
        document.getElementById('database-export-csv-btn').onclick = exportDatabaseCSV;
        document.getElementById('database-query-input').addEventListener('input', updateActiveDatabaseQuerySQL);
        document.getElementById('database-query-input').addEventListener('keydown', ev => {
            if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
                ev.preventDefault();
                runDatabaseQuery(false);
            }
        });
    }

    function stableDatabaseClientID(prefix) {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    // ─── Jobs ─────────────────────────────────────────────────────────
    function showJobs(options = {}) {
        if (overviewActive) hideOverview();
        if (databaseActive) hideDatabase();
        jobsActive = true;
        document.getElementById('jobs-view').style.display = 'flex';
        document.getElementById('terminal-tabs').style.display = 'none';
        document.getElementById('terminal-container').style.display = 'none';
        document.getElementById('git-panel').style.display = 'none';
        document.getElementById('jobs-btn').classList.add('active');
        renderJobProjectOptions();
        updateStatusContext();
        if (options.load !== false) loadJobs({ notify: false, render: true });
    }

    function hideJobs() {
        closeJobScheduleBuilder();
        closeJobLogs();
        jobsActive = false;
        document.getElementById('jobs-view').style.display = 'none';
        document.getElementById('terminal-tabs').style.display = '';
        document.getElementById('terminal-container').style.display = '';
        document.getElementById('jobs-btn').classList.remove('active');
        updateStatusContext();
        updateSidePanels();
        if (activeTab) fitTab(activeTab);
    }

    function toggleJobs() {
        if (jobsActive) {
            hideJobs();
            markVisibleTabCompletionSeen();
        } else {
            showJobs();
        }
    }

    function startJobsPoll() {
        if (jobsPollTimer) return;
        loadJobs({ notify: false, render: jobsActive });
        jobsPollTimer = setInterval(() => loadJobs({ notify: true, render: jobsActive }), 10000);
    }

    function initNotificationHandlers() {
        if (typeof window.electronOnNotificationClick !== 'function') return;
        window.electronOnNotificationClick(payload => {
            if (!payload || payload.action !== 'open-job-log') return;
            const jobID = payload.data && payload.data.jobID;
            if (!jobID) return;
            openJobFromNotification(jobID).catch(err => {
                showToast('Job logs unavailable', compactErrorMessage(err && err.message, 'Unable to open job logs.'), 'error', 4200);
            });
        });
    }

    async function sendJobNotification(job, notification = null) {
        const status = notification?.status || job.last_status;
        const failed = status === 'failed';
        const title = failed ? 'Job failed' : 'Job completed';
        const subject = job.name || job.project || 'Scheduled job';
        const error = notification?.lastError || job.last_error;
        const detail = failed && error ? compactErrorMessage(error, '') : job.project;
        const body = detail ? `${subject} · ${detail}` : subject;
        const payload = {
            title,
            body,
            action: 'open-job-log',
            data: { jobID: job.id },
        };
        try {
            if (typeof window.electronNotify === 'function') {
                const result = await window.electronNotify(payload);
                if (result && result.ok) return;
            }
        } catch {}
        showToast(title, body, failed ? 'error' : 'success', failed ? 6200 : 4200);
    }

    function jobStatusSnapshot(job) {
        return {
            status: job.last_status || 'idle',
            runCount: Number(job.run_count) || 0,
            lastRunAt: job.last_run_at || '',
        };
    }

    function jobStatusNotificationKey(snapshot) {
        return `${snapshot.lastRunAt}:${snapshot.runCount}:${snapshot.status}`;
    }

    function jobStatusNotification(job, snapshot) {
        return {
            key: jobStatusNotificationKey(snapshot),
            status: snapshot.status,
            lastError: job.last_error || '',
        };
    }

    function syncJobStatusSnapshots(jobs, notify) {
        const next = {};
        const nextPendingNotifications = {};
        jobs.forEach(job => {
            if (!job.id) return;
            const current = jobStatusSnapshot(job);
            const previous = jobStatusSnapshots[job.id];
            const finished = current.status === 'completed' || current.status === 'failed';
            const notificationKey = jobStatusNotificationKey(current);
            const changedRun = previous && (
                current.runCount !== previous.runCount ||
                current.lastRunAt !== previous.lastRunAt
            );
            let pendingNotifications = Array.isArray(pendingJobNotifications[job.id])
                ? pendingJobNotifications[job.id].slice()
                : [];
            if (jobsLoadedOnce && finished && previous && (previous.status === 'running' || changedRun)) {
                const notification = jobStatusNotification(job, current);
                if (!pendingNotifications.some(item => item.key === notificationKey)) {
                    pendingNotifications.push(notification);
                }
            }
            if (notify && pendingNotifications.length > 0) {
                pendingNotifications.forEach(notification => sendJobNotification(job, notification));
                pendingNotifications = [];
            }
            if (pendingNotifications.length > 0) {
                nextPendingNotifications[job.id] = pendingNotifications;
            }
            next[job.id] = current;
        });
        jobStatusSnapshots = next;
        pendingJobNotifications = nextPendingNotifications;
        jobsLoadedOnce = true;
    }

    async function openJobFromNotification(jobID) {
        if (!jobsActive) showJobs({ load: false });
        const jobs = await loadJobs({ notify: false, render: true });
        const job = jobs.find(item => item.id === jobID);
        if (!job) {
            showToast('Job not found', 'The finished job is no longer available.', 'error', 4200);
            return;
        }
        await openJobLogs(job, { mode: 'terminal' });
    }

    function renderJobProjectOptions() {
        const select = document.getElementById('job-project');
        if (!select) return;
        const current = select.value;
        select.innerHTML = '';
        projects.forEach(project => {
            const option = document.createElement('option');
            option.value = project.name;
            option.textContent = project.name;
            select.appendChild(option);
        });
        if (current && projects.some(project => project.name === current)) {
            select.value = current;
        }
    }

    const JOB_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    function padJobScheduleNumber(value) {
        return String(value).padStart(2, '0');
    }

    function clampJobScheduleNumber(id, min, max, fallback) {
        const input = document.getElementById(id);
        let value = parseInt(input.value, 10);
        if (!Number.isFinite(value)) value = fallback;
        value = Math.max(min, Math.min(max, value));
        input.value = String(value);
        return value;
    }

    function readJobScheduleTime() {
        const input = document.getElementById('job-schedule-time');
        const match = /^(\d{1,2}):(\d{2})$/.exec(input.value || '');
        let hour = 9;
        let minute = 0;
        if (match) {
            hour = Math.max(0, Math.min(23, parseInt(match[1], 10)));
            minute = Math.max(0, Math.min(59, parseInt(match[2], 10)));
        }
        input.value = `${padJobScheduleNumber(hour)}:${padJobScheduleNumber(minute)}`;
        return { hour, minute, text: input.value };
    }

    function setJobScheduleTime(hour, minute) {
        document.getElementById('job-schedule-time').value =
            `${padJobScheduleNumber(hour)}:${padJobScheduleNumber(minute)}`;
    }

    function buildJobScheduleFromControls() {
        const mode = document.getElementById('job-schedule-mode').value || 'daily';
        if (mode === 'custom') {
            const schedule = document.getElementById('job-schedule').value.trim();
            return {
                schedule,
                label: schedule ? 'Custom cron' : 'Enter a cron expression',
            };
        }

        if (mode === 'interval') {
            const minutes = parseInt(document.getElementById('job-schedule-interval').value, 10) || 15;
            return {
                schedule: `*/${minutes} * * * *`,
                label: `Every ${minutes} minutes`,
            };
        }

        if (mode === 'hourly') {
            const minute = clampJobScheduleNumber('job-schedule-minute', 0, 59, 0);
            return {
                schedule: `${minute} * * * *`,
                label: `Hourly at minute ${minute}`,
            };
        }

        const { hour, minute, text } = readJobScheduleTime();
        if (mode === 'weekdays') {
            return {
                schedule: `${minute} ${hour} * * 1-5`,
                label: `Weekdays at ${text}`,
            };
        }
        if (mode === 'weekly') {
            const day = parseInt(document.getElementById('job-schedule-weekday').value, 10) || 0;
            return {
                schedule: `${minute} ${hour} * * ${day}`,
                label: `${JOB_WEEKDAY_NAMES[day]} at ${text}`,
            };
        }
        if (mode === 'monthly') {
            const day = clampJobScheduleNumber('job-schedule-monthday', 1, 31, 1);
            return {
                schedule: `${minute} ${hour} ${day} * *`,
                label: `Monthly on day ${day} at ${text}`,
            };
        }

        return {
            schedule: `${minute} ${hour} * * *`,
            label: `Daily at ${text}`,
        };
    }

    function updateJobScheduleControls() {
        const mode = document.getElementById('job-schedule-mode').value || 'daily';
        document.querySelectorAll('.job-schedule-part').forEach(part => {
            const modes = (part.dataset.scheduleModes || '').split(/\s+/);
            part.style.display = modes.includes(mode) ? '' : 'none';
        });

        const built = buildJobScheduleFromControls();
        const preview = document.getElementById('job-schedule-preview');
        preview.innerHTML = `${esc(built.label)}${built.schedule ? ` <span class="job-schedule-cron-value">${esc(built.schedule)}</span>` : ''}`;
    }

    function updateJobSaveState() {
        const btn = document.getElementById('job-save-btn');
        if (!btn) return;
        const schedule = document.getElementById('job-schedule')?.value.trim() || '';
        const localError = jobScheduleLocalError(schedule);
        const previewError = !jobScheduleValid && jobSchedulePreviewBlocksSave
            ? (jobScheduleValidationMessage || 'Enter a valid cron schedule.')
            : '';
        btn.disabled = jobSaving || Boolean(localError || previewError);
        btn.title = !jobSaving ? (localError || previewError) : '';
    }

    function setJobScheduleValidation(valid, message = '', nextRuns = [], options = {}) {
        jobScheduleValid = Boolean(valid);
        jobSchedulePreviewBlocksSave = !jobScheduleValid && Boolean(options.blockSave);
        jobScheduleValidationMessage = message || '';
        const summary = document.getElementById('job-schedule-summary');
        const preview = document.getElementById('job-schedule-preview-list');
        if (summary) summary.classList.toggle('invalid', !jobScheduleValid);
        if (preview) {
            preview.classList.toggle('invalid', !jobScheduleValid);
            if (jobScheduleValid && nextRuns.length > 0) {
                const runs = nextRuns
                    .map(run => `<span class="job-schedule-next-run">${esc(jobTimeText(run))}</span>`)
                    .join('');
                preview.innerHTML = `<span>Next runs</span>${runs}`;
            } else {
                preview.textContent = message || '';
            }
        }
        updateJobSaveState();
    }

    function scheduleJobSchedulePreview() {
        const schedule = document.getElementById('job-schedule').value.trim();
        window.clearTimeout(jobSchedulePreviewTimer);
        jobSchedulePreviewSeq++;
        if (!schedule) {
            setJobScheduleValidation(false, 'Enter a cron expression.');
            return;
        }
        const localError = jobScheduleLocalError(schedule);
        if (localError) {
            setJobScheduleValidation(false, localError);
            return;
        }
        const seq = jobSchedulePreviewSeq;
        setJobScheduleValidation(false, 'Checking schedule...');
        jobSchedulePreviewTimer = window.setTimeout(() => {
            loadJobSchedulePreview(schedule, seq).catch(err => {
                if (seq === jobSchedulePreviewSeq) {
                    setJobScheduleValidation(false, compactErrorMessage(err && err.message, 'Unable to validate schedule.'));
                }
            });
        }, 220);
    }

    async function loadJobSchedulePreview(schedule, seq) {
        const result = await fetchJSON('/api/jobs/schedule/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schedule, count: 5 }),
        });
        if (seq !== jobSchedulePreviewSeq) return;
        if (!result || !result.valid) {
            setJobScheduleValidation(false, (result && result.error) || 'Invalid cron schedule.', [], { blockSave: true });
            return;
        }
        setJobScheduleValidation(true, '', Array.isArray(result.next_runs) ? result.next_runs : []);
    }

    function updateJobScheduleSummary() {
        const input = document.getElementById('job-schedule');
        const summary = document.getElementById('job-schedule-summary');
        const schedule = input.value.trim();
        const parsed = parseJobSchedule(schedule);
        summary.innerHTML = schedule
            ? `${esc(parsed.label)} <span class="job-schedule-cron-value">${esc(schedule)}</span>`
            : 'Enter a cron expression or build one.';
        scheduleJobSchedulePreview();
    }

    function isJobCronNumber(value, min, max) {
        if (!/^\d+$/.test(value)) return false;
        const number = parseInt(value, 10);
        return number >= min && number <= max;
    }

    function parseJobSchedule(schedule) {
        const raw = String(schedule || '').trim();
        const parts = raw.split(/\s+/);
        if (!raw || parts.length !== 5) return { mode: 'custom', schedule: raw, label: raw || 'Custom cron' };

        const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
        const intervalMatch = /^\*\/(\d+)$/.exec(minute);
        if (intervalMatch && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
            const minutes = parseInt(intervalMatch[1], 10);
            if ([5, 10, 15, 30].includes(minutes)) {
                return { mode: 'interval', interval: String(minutes), schedule: raw, label: `Every ${minutes} minutes` };
            }
        }

        if (isJobCronNumber(minute, 0, 59) && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
            return { mode: 'hourly', minute: parseInt(minute, 10), schedule: raw, label: `Hourly at minute ${parseInt(minute, 10)}` };
        }

        if (isJobCronNumber(minute, 0, 59) && isJobCronNumber(hour, 0, 23) && dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
            return { mode: 'weekdays', hour: parseInt(hour, 10), minute: parseInt(minute, 10), schedule: raw, label: `Weekdays at ${padJobScheduleNumber(hour)}:${padJobScheduleNumber(minute)}` };
        }

        if (isJobCronNumber(minute, 0, 59) && isJobCronNumber(hour, 0, 23) && dayOfMonth === '*' && month === '*' && isJobCronNumber(dayOfWeek, 0, 6)) {
            const day = parseInt(dayOfWeek, 10);
            return { mode: 'weekly', hour: parseInt(hour, 10), minute: parseInt(minute, 10), weekday: String(day), schedule: raw, label: `${JOB_WEEKDAY_NAMES[day]} at ${padJobScheduleNumber(hour)}:${padJobScheduleNumber(minute)}` };
        }

        if (isJobCronNumber(minute, 0, 59) && isJobCronNumber(hour, 0, 23) && isJobCronNumber(dayOfMonth, 1, 31) && month === '*' && dayOfWeek === '*') {
            return { mode: 'monthly', hour: parseInt(hour, 10), minute: parseInt(minute, 10), monthday: parseInt(dayOfMonth, 10), schedule: raw, label: `Monthly on day ${parseInt(dayOfMonth, 10)} at ${padJobScheduleNumber(hour)}:${padJobScheduleNumber(minute)}` };
        }

        if (isJobCronNumber(minute, 0, 59) && isJobCronNumber(hour, 0, 23) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
            return { mode: 'daily', hour: parseInt(hour, 10), minute: parseInt(minute, 10), schedule: raw, label: `Daily at ${padJobScheduleNumber(hour)}:${padJobScheduleNumber(minute)}` };
        }

        return { mode: 'custom', schedule: raw, label: 'Custom cron' };
    }

    function jobScheduleLocalError(schedule) {
        const raw = String(schedule || '').trim();
        if (!raw) return 'Choose a schedule.';
        const parts = raw.split(/\s+/);
        if (parts.length !== 5) return 'Schedule must use five cron fields.';

        const fields = [
            ['Minute', parts[0], 0, 59],
            ['Hour', parts[1], 0, 23],
            ['Day of month', parts[2], 1, 31],
            ['Month', parts[3], 1, 12],
            ['Day of week', parts[4], 0, 7],
        ];
        for (const [label, value, min, max] of fields) {
            const error = jobCronFieldLocalError(value, min, max);
            if (error) return `${label}: ${error}`;
        }
        return '';
    }

    function jobCronFieldLocalError(value, min, max) {
        for (const part of String(value || '').split(',')) {
            if (!part) return 'empty field part';
            const pieces = part.split('/');
            if (pieces.length > 2 || pieces[0] === '') return `invalid field part "${part}"`;
            if (pieces.length === 2 && (!/^\d+$/.test(pieces[1]) || parseInt(pieces[1], 10) <= 0)) {
                return `invalid step "${part}"`;
            }

            const base = pieces[0];
            let start;
            let end;
            if (base === '*') {
                start = min;
                end = max;
            } else if (base.includes('-')) {
                const range = base.split('-');
                if (range.length !== 2 || !/^\d+$/.test(range[0]) || !/^\d+$/.test(range[1])) {
                    return `invalid range "${base}"`;
                }
                start = parseInt(range[0], 10);
                end = parseInt(range[1], 10);
            } else if (/^\d+$/.test(base)) {
                start = parseInt(base, 10);
                end = start;
            } else {
                return `invalid field part "${part}"`;
            }

            if (start < min || end > max || start > end) return `value outside ${min}-${max}`;
        }
        return '';
    }

    function applyJobScheduleToForm(schedule) {
        const parsed = parseJobSchedule(schedule);
        document.getElementById('job-schedule-mode').value = parsed.mode;
        document.getElementById('job-schedule').value = parsed.schedule || '';
        if (parsed.mode === 'interval') document.getElementById('job-schedule-interval').value = parsed.interval;
        if (parsed.mode === 'hourly') document.getElementById('job-schedule-minute').value = String(parsed.minute);
        if (['daily', 'weekdays', 'weekly', 'monthly'].includes(parsed.mode)) setJobScheduleTime(parsed.hour, parsed.minute);
        if (parsed.mode === 'weekly') document.getElementById('job-schedule-weekday').value = parsed.weekday;
        if (parsed.mode === 'monthly') document.getElementById('job-schedule-monthday').value = String(parsed.monthday);
        updateJobScheduleControls();
        updateJobScheduleSummary();
    }

    function openJobScheduleBuilder() {
        applyJobScheduleToForm(document.getElementById('job-schedule').value);
        document.getElementById('job-schedule-modal').style.display = 'flex';
    }

    function closeJobScheduleBuilder() {
        document.getElementById('job-schedule-modal').style.display = 'none';
    }

    function useJobScheduleBuilder() {
        const built = buildJobScheduleFromControls();
        document.getElementById('job-schedule').value = built.schedule;
        updateJobScheduleSummary();
        closeJobScheduleBuilder();
    }

    function jobScheduleLabel(schedule) {
        return parseJobSchedule(schedule).label || schedule || 'unscheduled';
    }

    function resetJobForm() {
        jobEditingID = '';
        document.getElementById('job-name').value = '';
        document.getElementById('job-schedule-mode').value = 'daily';
        document.getElementById('job-schedule-interval').value = '15';
        document.getElementById('job-schedule-minute').value = '0';
        setJobScheduleTime(9, 0);
        document.getElementById('job-schedule-weekday').value = '1';
        document.getElementById('job-schedule-monthday').value = '1';
        document.getElementById('job-schedule').value = '0 9 * * *';
        document.getElementById('job-prompt').value = '';
        document.getElementById('job-enabled').checked = true;
        document.getElementById('job-save-btn').textContent = 'create job';
        document.getElementById('job-form-cancel').style.display = 'none';
        renderJobProjectOptions();
        updateJobScheduleControls();
        updateJobScheduleSummary();
    }

    function editJob(job) {
        jobEditingID = job.id;
        renderJobProjectOptions();
        document.getElementById('job-name').value = job.name || '';
        document.getElementById('job-project').value = job.project || '';
        applyJobScheduleToForm(job.schedule || '');
        document.getElementById('job-prompt').value = job.prompt || '';
        document.getElementById('job-enabled').checked = Boolean(job.enabled);
        document.getElementById('job-save-btn').textContent = 'save job';
        document.getElementById('job-form-cancel').style.display = '';
        document.getElementById('job-name').focus();
    }

    function readJobFormPayload() {
        const project = document.getElementById('job-project').value.trim();
        if (!project) throw new Error('Select a project.');
        const schedule = document.getElementById('job-schedule').value.trim();
        if (!schedule) throw new Error('Choose a schedule.');
        return {
            name: document.getElementById('job-name').value.trim(),
            project,
            schedule,
            prompt: document.getElementById('job-prompt').value.trim(),
            enabled: Boolean(document.getElementById('job-enabled').checked),
        };
    }

    async function saveJob(ev) {
        ev?.preventDefault();
        try {
            const payload = readJobFormPayload();
            const scheduleError = jobScheduleLocalError(payload.schedule);
            if (scheduleError) throw new Error(scheduleError);
            if (!jobScheduleValid && jobSchedulePreviewBlocksSave) {
                throw new Error(jobScheduleValidationMessage || 'Enter a valid cron schedule.');
            }
            jobSaving = true;
            updateJobSaveState();
            const editing = Boolean(jobEditingID);
            await fetchJSON(editing ? `/api/jobs/${encodeURIComponent(jobEditingID)}` : '/api/jobs', {
                method: editing ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            showToast(editing ? 'Job saved' : 'Job created', payload.name || payload.project, 'success', 2600);
            resetJobForm();
            await loadJobs({ notify: false, render: true });
        } catch (err) {
            showToast('Job save failed', compactErrorMessage(err && err.message, 'Unable to save job.'), 'error', 5200);
        } finally {
            jobSaving = false;
            updateJobSaveState();
        }
    }

    async function loadJobs(options = {}) {
        const shouldRender = options.render !== false && (options.render === true || jobsActive);
        try {
            const jobs = await fetchJSON('/api/jobs');
            const list = Array.isArray(jobs) ? jobs : [];
            syncJobStatusSnapshots(list, options.notify !== false);
            if (shouldRender) renderJobs(list);
            return list;
        } catch (err) {
            if (shouldRender) {
                document.getElementById('jobs-list').innerHTML =
                    `<div class="job-error">${esc(compactErrorMessage(err && err.message, 'Failed to load jobs.'))}</div>`;
            }
            return [];
        }
    }

    function renderJobs(jobs) {
        const list = document.getElementById('jobs-list');
        list.innerHTML = '';
        if (jobs.length === 0) {
            list.innerHTML = '<div class="job-empty">No jobs scheduled.</div>';
            return;
        }

        jobs
            .slice()
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            .forEach(job => list.appendChild(renderJobCard(job)));
    }

    function renderJobCard(job) {
        const card = document.createElement('div');
        const status = job.last_status || 'idle';
        const scheduleLabel = jobScheduleLabel(job.schedule || '');
        card.className = 'job-card' + (status === 'running' ? ' running' : '') + (!job.enabled ? ' disabled' : '');

        const top = document.createElement('div');
        top.className = 'job-card-top';

        const title = document.createElement('div');
        title.className = 'job-card-title';
        title.innerHTML =
            `<span class="job-name" title="${esc(job.name || '')}">${esc(job.name || '(unnamed job)')}</span>` +
            `<span class="job-project" title="${esc(job.project || '')}">${esc(job.project || '')}</span>`;
        top.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'job-meta';
        meta.innerHTML =
            `<span class="job-chip ${job.enabled ? 'enabled' : 'disabled'}">${job.enabled ? 'enabled' : 'disabled'}</span>` +
            `<span class="job-chip" title="${esc(job.schedule || '')}">${esc(scheduleLabel)}</span>` +
            `<span class="job-chip ${esc(status)}">${esc(status)}</span>` +
            `<span class="job-chip">${job.next_run_at ? 'next ' + esc(jobTimeText(job.next_run_at)) : 'no next run'}</span>`;
        top.appendChild(meta);
        card.appendChild(top);

        const prompt = document.createElement('div');
        prompt.className = 'job-prompt';
        prompt.title = job.prompt || '';
        prompt.textContent = job.prompt || '';
        card.appendChild(prompt);

        const actions = document.createElement('div');
        actions.className = 'job-actions';
        if (status === 'running') {
            actions.appendChild(jobAction('stop', () => cancelJob(job), 'primary danger', { button: true }));
        } else {
            actions.appendChild(jobAction('run manually', () => runJobNow(job), 'primary', { button: true }));
        }
        actions.appendChild(jobAction('edit', () => editJob(job)));
        actions.appendChild(jobAction('duplicate', () => duplicateJob(job)));
        actions.appendChild(jobAction('logs', () => openJobLogs(job)));
        actions.appendChild(jobAction(job.enabled ? 'disable' : 'enable', () => setJobEnabled(job, !job.enabled)));
        actions.appendChild(jobAction('delete', () => deleteJob(job), 'danger'));
        card.appendChild(actions);

        return card;
    }

    function jobAction(label, handler, extraClass = '', options = {}) {
        const action = document.createElement(options.button ? 'button' : 'span');
        if (options.button) action.type = 'button';
        action.className = 'job-action' + (extraClass ? ' ' + extraClass : '');
        action.textContent = label;
        if (options.disabled) action.disabled = true;
        else action.onclick = handler;
        return action;
    }

    function jobTimeText(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'unknown';
        return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    async function duplicateJob(job) {
        try {
            await fetchJSON(`/api/jobs/${encodeURIComponent(job.id)}/duplicate`, { method: 'POST' });
            showToast('Job duplicated', 'Duplicate is disabled until enabled.', 'success', 2800);
            await loadJobs({ notify: false, render: true });
        } catch (err) {
            showToast('Duplicate failed', compactErrorMessage(err && err.message, 'Unable to duplicate job.'), 'error', 4200);
        }
    }

    async function runJobNow(job) {
        try {
            await fetchJSON(`/api/jobs/${encodeURIComponent(job.id)}/run`, { method: 'POST' });
            showToast('Job started', job.name || job.project, 'success', 2600);
            await loadJobs({ notify: false, render: true });
        } catch (err) {
            showToast('Run failed', compactErrorMessage(err && err.message, 'Unable to start job.'), 'error', 5200);
        }
    }

    async function cancelJob(job) {
        if (!(await appConfirm(`Stop job "${job.name || job.project}"?`))) return;
        try {
            await fetchJSON(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: 'POST' });
            showToast('Job stopped', job.name || job.project, 'success', 2600);
            await loadJobs({ notify: false, render: true });
        } catch (err) {
            showToast('Stop failed', compactErrorMessage(err && err.message, 'Unable to stop job.'), 'error', 5200);
        }
    }

    async function setJobEnabled(job, enabled) {
        try {
            await fetchJSON(`/api/jobs/${encodeURIComponent(job.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled }),
            });
            await loadJobs({ notify: false, render: true });
        } catch (err) {
            showToast('Job update failed', compactErrorMessage(err && err.message, 'Unable to update job.'), 'error', 4200);
        }
    }

    async function deleteJob(job) {
        if (!(await appConfirm(`Delete job "${job.name || job.project}"?`))) return;
        try {
            await fetchJSON(`/api/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
            if (jobEditingID === job.id) resetJobForm();
            await loadJobs({ notify: false, render: true });
        } catch (err) {
            showToast('Delete failed', compactErrorMessage(err && err.message, 'Unable to delete job.'), 'error', 4200);
        }
    }

    const JOB_RESPONSE_LOG_MAX_LINES = 500;
    const JOB_RESPONSE_LOG_MAX_CHARS = 80000;

    function stripJobTerminalEscapes(output) {
        return String(output || '')
            .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
            .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
            .replace(/\x1b[@-_]/g, '');
    }

    function jobResponseLogText(output) {
        const cleaned = stripJobTerminalEscapes(output)
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map(line => line.split('\r').pop())
            .join('\n')
            .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
        const lines = cleaned.split('\n')
            .map(line => line.trimEnd())
            .filter((line, index, all) => line.trim() || (index > 0 && index < all.length - 1));
        let text = lines.slice(-JOB_RESPONSE_LOG_MAX_LINES).join('\n').trim();
        if (text.length > JOB_RESPONSE_LOG_MAX_CHARS) {
            text = text.slice(text.length - JOB_RESPONSE_LOG_MAX_CHARS).trimStart();
        }
        return text;
    }

    function disposeJobLogTerminal() {
        if (jobLogConnection) jobLogConnection.close();
        if (jobLogTerm) jobLogTerm.dispose();
        jobLogConnection = null;
        jobLogTerm = null;
        jobLogFit = null;
    }

    function updateJobLogModeButtons() {
        document.getElementById('job-log-response-btn').classList.toggle('active', jobLogMode === 'terminal');
        document.getElementById('job-log-response-btn').title = 'Show the agent terminal view';
        const textBtn = document.getElementById('job-log-terminal-btn');
        textBtn.classList.toggle('active', jobLogMode === 'text');
        textBtn.title = 'Show plain text output';
    }

    function jobRunOptionLabel(run, index) {
        const parts = [];
        if (index === 0) parts.push('latest');
        parts.push(jobTimeText(run.started_at));
        if (run.status) parts.push(run.status);
        if (run.output_bytes) parts.push(formatBytes(run.output_bytes));
        return parts.join(' · ');
    }

function updateJobLogRunSelect() {
        const select = document.getElementById('job-log-run-select');
        const runs = Array.isArray(jobLogInfo && jobLogInfo.runs) ? jobLogInfo.runs : [];
        select.innerHTML = '';
        select.style.display = runs.length > 1 ? '' : 'none';
        runs.forEach((run, index) => {
            const option = document.createElement('option');
            option.value = run.id;
            option.textContent = jobRunOptionLabel(run, index);
            select.appendChild(option);
        });
    if (jobLogInfo && jobLogInfo.selected_run_id) {
        select.value = jobLogInfo.selected_run_id;
    }
}

function scrollJobLogTextToBottom(pre) {
    pre.scrollTop = pre.scrollHeight;
    requestAnimationFrame(() => {
        pre.scrollTop = pre.scrollHeight;
    });
}

function scrollJobLogTerminalToBottom(term) {
    term.scrollToBottom();
    requestAnimationFrame(() => term.scrollToBottom());
}

function renderJobLogText(container) {
        const pre = document.createElement('pre');
        pre.className = 'job-log-text';
        pre.tabIndex = 0;
    pre.textContent = jobResponseLogText(jobLogInfo.output || '') || 'No response output.';
    container.appendChild(pre);
    pre.focus();
    scrollJobLogTextToBottom(pre);
}

    function renderJobLogTerminal(container) {
        const { term, fitAddon } = makeTerminalInstance(container);
        jobLogTerm = term;
        jobLogFit = fitAddon;
        const liveSession = Boolean(jobLogInfo.has_session && jobLogInfo.session_alive);
    if (liveSession) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        let initialScrollPending = true;
        const jobID = jobLogInfo.job_id;
        const sessionKey = jobLogInfo.session;
        const baseWsUrl = `${proto}//${location.host}/ws/${encodeURIComponent(sessionKey)}`;
        jobLogConnection = connectTerminalWs(term, fitAddon, baseWsUrl, {
            afterWrite: () => {
                if (!initialScrollPending) return;
                initialScrollPending = false;
                scrollJobLogTerminalToBottom(term);
            },
            isSessionAlive: async () => {
                const info = await fetchJSON(`/api/jobs/${encodeURIComponent(jobID)}/output`, { timeoutMs: 5000 });
                return Boolean(info && info.has_session && info.session_alive && info.session === sessionKey);
            },
            closedMessage: '\r\n\x1b[38;5;203m[Job session closed]\x1b[0m\r\n',
        });
    } else {
        term.write(jobLogInfo.output || '\r\nNo output.\r\n', () => {
            fitAddon.fit();
            scrollJobLogTerminalToBottom(term);
        });
    }
        term.focus();
    }

    function renderJobLogContent() {
        const container = document.getElementById('job-log-terminal');
        disposeJobLogTerminal();
        container.innerHTML = '';
        updateJobLogRunSelect();
        updateJobLogModeButtons();
        if (!jobLogInfo) return;

        if (jobLogMode === 'text') renderJobLogText(container);
        else renderJobLogTerminal(container);
    }

    function setJobLogMode(mode) {
        jobLogMode = mode === 'text' ? 'text' : 'terminal';
        renderJobLogContent();
    }

    async function loadJobLogRun(runID) {
        if (!jobLogInfo || !jobLogInfo.job_id || !runID) return;
        const info = await fetchJSON(`/api/jobs/${encodeURIComponent(jobLogInfo.job_id)}/output?run=${encodeURIComponent(runID)}`);
        jobLogInfo = info || {};
        renderJobLogContent();
    }

    async function openJobLogs(job, options = {}) {
        try {
            const info = await fetchJSON(`/api/jobs/${encodeURIComponent(job.id)}/output`);
            const hasRuns = Array.isArray(info.runs) && info.runs.length > 0;
            if (!info.has_session && !info.output && !hasRuns) {
                showToast('No logs yet', 'Run the job once before opening logs.', 'info', 3200);
                return;
            }
            closeJobLogs();
            const modal = document.getElementById('job-log-modal');
            document.getElementById('job-log-title').textContent = 'Job: ' + (job.name || job.project);
            jobLogMode = options.mode === 'text' ? 'text' : 'terminal';
            jobLogInfo = info || {};
            modal.style.display = 'flex';
            renderJobLogContent();
        } catch (err) {
            showToast('Logs unavailable', compactErrorMessage(err && err.message, 'Unable to open job logs.'), 'error', 4200);
        }
    }

    function closeJobLogs() {
        document.getElementById('job-log-modal').style.display = 'none';
        disposeJobLogTerminal();
        jobLogInfo = null;
        document.getElementById('job-log-terminal').innerHTML = '';
    }

    document.getElementById('jobs-btn').onclick = toggleJobs;
    document.getElementById('jobs-refresh-btn').onclick = () => loadJobs({ notify: false, render: true });
    document.getElementById('job-form').addEventListener('submit', saveJob);
    document.getElementById('job-form-cancel').onclick = resetJobForm;
    document.getElementById('job-schedule-builder-btn').onclick = openJobScheduleBuilder;
    document.getElementById('job-schedule-backdrop').onclick = closeJobScheduleBuilder;
    document.getElementById('job-schedule-close').onclick = closeJobScheduleBuilder;
    document.getElementById('job-schedule-use-btn').onclick = useJobScheduleBuilder;
    document.getElementById('job-schedule').addEventListener('input', updateJobScheduleSummary);
    document.getElementById('job-schedule').addEventListener('change', updateJobScheduleSummary);
    document.getElementById('job-schedule-mode').onchange = updateJobScheduleControls;
    [
        'job-schedule-interval',
        'job-schedule-minute',
        'job-schedule-time',
        'job-schedule-weekday',
        'job-schedule-monthday',
    ].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', updateJobScheduleControls);
        el.addEventListener('change', updateJobScheduleControls);
    });
    updateJobScheduleControls();
    updateJobScheduleSummary();
    document.getElementById('job-log-backdrop').onclick = closeJobLogs;
    document.getElementById('job-log-close').onclick = closeJobLogs;
    document.getElementById('job-log-response-btn').onclick = () => setJobLogMode('terminal');
    document.getElementById('job-log-terminal-btn').onclick = () => setJobLogMode('text');
    document.getElementById('job-log-run-select').onchange = ev => {
        loadJobLogRun(ev.target.value).catch(err => {
            showToast('Logs unavailable', compactErrorMessage(err && err.message, 'Unable to open job logs.'), 'error', 4200);
        });
    };



    // ─── Overview ─────────────────────────────────────────────────────
    let overviewActive = false;
    let overviewPollTimer = null;

    function showOverview() {
        if (jobsActive) hideJobs();
        if (databaseActive) hideDatabase();
        overviewActive = true;
        document.getElementById('overview-view').style.display = 'flex';
        document.getElementById('terminal-tabs').style.display = 'none';
        document.getElementById('terminal-container').style.display = 'none';
        document.getElementById('git-panel').style.display = 'none';
        document.getElementById('overview-btn').classList.add('active');
        updateStatusContext();
        loadOverview();
        overviewPollTimer = setInterval(loadOverview, 10000);
    }

    function hideOverview() {
        overviewActive = false;
        document.getElementById('overview-view').style.display = 'none';
        document.getElementById('terminal-tabs').style.display = '';
        document.getElementById('terminal-container').style.display = '';
        document.getElementById('overview-btn').classList.remove('active');
        updateStatusContext();
        clearInterval(overviewPollTimer);
        overviewPollTimer = null;
        updateSidePanels();
        // Re-fit active terminal
        fitTab(activeTab);
    }

    function toggleOverview() {
        if (overviewActive) {
            hideOverview();
            markVisibleTabCompletionSeen();
        } else {
            showOverview();
        }
    }

    document.getElementById('overview-btn').onclick = toggleOverview;
    document.getElementById('overview-refresh-btn').onclick = loadOverview;

    async function pullAllProjects(btn = null) {
        if (btn) {
            btn.textContent = 'pulling...';
            btn.style.pointerEvents = 'none';
        }
        try {
            const results = await fetchJSON('/api/pull-all', { method: 'POST' });
            const summary = summarizePullAllResults(results);
            if (btn) btn.textContent = summary.ok ? 'done' : 'failed';
            showToast(summary.ok ? 'Pull all complete' : 'Pull all failed', summary.message, summary.ok ? 'success' : 'error', summary.ok ? 3600 : 6200);
            loadOverview();
            updateBadges();
            if (btn) setTimeout(() => { btn.textContent = 'pull all'; btn.style.pointerEvents = ''; }, 2000);
        } catch (err) {
            if (btn) {
                btn.textContent = 'failed';
                setTimeout(() => { btn.textContent = 'pull all'; btn.style.pointerEvents = ''; }, 2000);
            }
            showToast('Pull all failed', compactErrorMessage(err && err.message, 'Unable to pull all projects.'), 'error', 4200);
        }
    }

    document.getElementById('overview-pull-all-btn').onclick = function() {
        pullAllProjects(this);
    };

    async function loadOverview() {
        try {
            const data = await fetchJSON('/api/overview');
            renderOverview(data);
        } catch {
            document.getElementById('overview-grid').innerHTML =
                '<div style="padding:20px;color:var(--red)">Failed to load overview</div>';
        }
    }

    function renderOverview(projects) {
        const grid = document.getElementById('overview-grid');
        grid.innerHTML = '';

        // Sort: pinned first, then alphabetical
        const sorted = [...projects].sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return a.name.localeCompare(b.name);
        });

        const filtered = sorted.filter(overviewMatchesFilter);
        if (filtered.length === 0) {
            grid.innerHTML = `<div class="overview-empty">No projects match ${esc(overviewFilter)}.</div>`;
            return;
        }

        filtered.forEach(p => {
            const card = document.createElement('div');
            card.className = 'overview-card';
            if (p.name === activeProject) card.classList.add('active');

            // Header row
            const header = document.createElement('div');
            header.className = 'overview-card-header';

            const nameEl = document.createElement('span');
            nameEl.className = 'overview-card-name';
            if (p.pinned) nameEl.innerHTML = '<span class="overview-pin">' + iconHTML('star') + '</span> ';
            nameEl.innerHTML += esc(p.name);
            header.appendChild(nameEl);

            // Session dot
            if (p.has_session) {
                const status = p.session_alive
                    ? tabPaneStatus(p.name)
                        || { state: p.session_state, waiting_for: p.session_waiting_for, remote_control: p.session_remote_control }
                    : null;
                const dot = document.createElement('span');
                dot.className = 'overview-dot ' + (p.session_alive ? 'alive' : 'dead') + sessionStateSuffix(status)
                    + (p.session_alive && isCompletedTabUnseen(p.name, status) ? ' unseen' : '')
                    + (status && status.remote_control ? ' remote' : '');
                dot.title = p.session_alive
                    ? sessionStateLabel(status, 'Session running', isCompletedTabUnseen(p.name, status))
                    : 'Session ended';
                header.appendChild(dot);
            }

            card.appendChild(header);

            // Info rows
            const info = document.createElement('div');
            info.className = 'overview-card-info';

            // Branch
            if (p.branch) {
                const branchEl = document.createElement('div');
                branchEl.className = 'overview-info-row';
                branchEl.innerHTML = '<span class="overview-label">\u2387</span><span class="overview-branch">' + esc(p.branch) + '</span>';

                // Sync indicator
                if (p.ahead > 0 || p.behind > 0) {
                    const sync = document.createElement('span');
                    sync.className = 'overview-sync';
                    let syncText = '';
                    if (p.ahead > 0) syncText += '\u2191' + p.ahead;
                    if (p.behind > 0) syncText += (syncText ? ' ' : '') + '\u2193' + p.behind;
                    sync.textContent = syncText;
                    branchEl.appendChild(sync);
                }

                info.appendChild(branchEl);
            }

            // Dirty files
            if (!p.is_git_repo) {
                const filesEl = document.createElement('div');
                filesEl.className = 'overview-info-row overview-clean';
                filesEl.textContent = p.dirty_count + ' project file' + (p.dirty_count !== 1 ? 's' : '');
                info.appendChild(filesEl);
            } else if (p.dirty_count > 0) {
                const dirtyEl = document.createElement('div');
                dirtyEl.className = 'overview-info-row';
                dirtyEl.innerHTML = '<span class="overview-dirty">' + p.dirty_count + ' changed file' + (p.dirty_count !== 1 ? 's' : '') + '</span>';
                info.appendChild(dirtyEl);
            } else {
                const cleanEl = document.createElement('div');
                cleanEl.className = 'overview-info-row overview-clean';
                cleanEl.textContent = 'clean';
                info.appendChild(cleanEl);
            }

            // Docker
            if (p.docker_compose_file) {
                const dockerEl = document.createElement('div');
                dockerEl.className = 'overview-info-row';
                const dockerDot = document.createElement('span');
                dockerDot.className = 'overview-docker-dot ' + (p.docker_running ? 'running' : '');
                dockerEl.appendChild(dockerDot);
                const dockerName = document.createElement('span');
                dockerName.textContent = p.docker_compose_file;
                dockerName.className = 'overview-docker-name';
                dockerEl.appendChild(dockerName);
                info.appendChild(dockerEl);
            }

            card.appendChild(info);

            // Actions
            const actions = document.createElement('div');
            actions.className = 'overview-card-actions';

            const openBtn = document.createElement('span');
            openBtn.className = 'overview-action';
            openBtn.textContent = 'open';
            openBtn.onclick = (ev) => {
                ev.stopPropagation();
                hideOverview();
                switchProject(p.name);
            };
            actions.appendChild(openBtn);

            if (p.is_git_repo) {
                const pullBtn = document.createElement('span');
                pullBtn.className = 'overview-action';
                pullBtn.textContent = 'pull';
                pullBtn.onclick = async (ev) => {
                    ev.stopPropagation();
                    pullBtn.textContent = '...';
                    try {
                        const data = await fetchJSON(`/api/projects/${encodeURIComponent(p.name)}/pull`, { method: 'POST' });
                        if (data.error) {
                            showToast('Pull failed', compactErrorMessage(data.output || data.error), 'error', 6200);
                            pullBtn.textContent = 'fail';
                            setTimeout(() => { pullBtn.textContent = 'pull'; }, 1500);
                            return;
                        }
                        showGitSuccessToast('Pull complete', data, `${p.name} pulled successfully.`);
                        pullBtn.textContent = 'done';
                        setTimeout(() => { pullBtn.textContent = 'pull'; loadOverview(); }, 1500);
                    } catch (err) {
                        showToast('Pull failed', compactErrorMessage(err && err.message), 'error', 6200);
                        pullBtn.textContent = 'fail';
                        setTimeout(() => { pullBtn.textContent = 'pull'; }, 1500);
                    }
                };
                actions.appendChild(pullBtn);
            }

            card.appendChild(actions);

            card.onclick = () => {
                hideOverview();
                switchProject(p.name);
            };

            grid.appendChild(card);
        });
    }

    function overviewMatchesFilter(project) {
        switch (overviewFilter) {
        case 'pinned':
            return !!project.pinned;
        case 'dirty':
            return project.dirty_count > 0;
        case 'behind':
            return project.behind > 0;
        case 'docker':
            return !!project.docker_compose_file;
        case 'no-session':
            return !project.has_session || !project.session_alive;
        default:
            return true;
        }
    }

    function initOverviewFilters() {
        document.querySelectorAll('.overview-filter').forEach(btn => {
            btn.onclick = () => {
                overviewFilter = btn.dataset.filter || 'all';
                document.querySelectorAll('.overview-filter').forEach(other => {
                    other.classList.toggle('active', other === btn);
                });
                if (overviewActive) loadOverview();
            };
        });
    }

    function isCommandPaletteOpen() {
        return document.getElementById('command-palette-modal').style.display !== 'none';
    }

    function initTextPrompt() {
        document.getElementById('text-prompt-backdrop').onclick = cancelTextInputRequest;
        document.getElementById('text-prompt-close').onclick = cancelTextInputRequest;
        document.getElementById('text-prompt-cancel').onclick = cancelTextInputRequest;
        document.getElementById('text-prompt-submit').onclick = submitTextInputRequest;
        document.getElementById('text-prompt-input').addEventListener('keydown', ev => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                submitTextInputRequest();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                cancelTextInputRequest();
            }
        });
    }

    function initCommandPalette() {
        document.getElementById('command-palette-btn').onclick = openCommandPalette;
        document.getElementById('command-palette-backdrop').onclick = closeCommandPalette;
        document.getElementById('command-palette-close').onclick = closeCommandPalette;
        document.getElementById('command-palette-input').addEventListener('input', renderCommandPalette);
        document.getElementById('shortcuts-btn').onclick = openShortcutsModal;
        document.getElementById('shortcuts-modal-backdrop').onclick = closeShortcutsModal;
        document.getElementById('shortcuts-modal-close').onclick = closeShortcutsModal;
        document.getElementById('shortcuts-config-btn').onclick = openKeymapConfigModal;
        document.getElementById('keymap-config-backdrop').onclick = closeKeymapConfigModal;
        document.getElementById('keymap-config-close').onclick = closeKeymapConfigModal;
        document.getElementById('keymap-config-cancel-btn').onclick = closeKeymapConfigModal;
        document.getElementById('keymap-config-save-btn').onclick = saveKeymapConfig;
        document.getElementById('keymap-profile-reset-btn').onclick = resetKeymapProfile;
        document.getElementById('keymap-profile-select').onchange = changeKeymapProfile;
        document.getElementById('keymap-profile-create-btn').onclick = createKeymapProfile;
        document.getElementById('keymap-profile-delete-btn').onclick = deleteKeymapProfile;
        document.getElementById('keymap-profile-name').addEventListener('input', renameKeymapProfile);
        document.getElementById('keymap-command-search').addEventListener('input', ev => {
            keymapSearchQuery = ev.target.value || '';
            renderKeymapCommandBindings();
        });
        document.addEventListener('keyup', handleKeymapCaptureKeydown, true);
    }

    function decorateCommandActions(actions, state = keymapState) {
        return actions.map(action => ({
            ...action,
            shortcut: action.id ? commandShortcutLabel(action.id, state) : (action.shortcut || ''),
        }));
    }

    function switchAdjacentTab(delta) {
        const names = getTabKeys();
        if (names.length === 0) return;
        const idx = names.indexOf(activeTab);
        if (idx < 0) return;
        const next = (idx + delta + names.length) % names.length;
        switchProject(names[next]);
    }

    function keymapActionForEvent(ev, state = keymapState) {
        if (!Keymap.isPotentialShortcutEvent(ev)) return null;
        return commandPaletteActions(state).find(action => (
            action.id && Keymap.eventMatchesCommand(state, action.id, ev, keymapOptions())
        )) || null;
    }

    function keymapCommandForEvent(ev, state = keymapState) {
        if (!Keymap.isPotentialShortcutEvent(ev)) return null;
        return currentKeymapCommands(state).find(command => (
            command.id && Keymap.eventMatchesCommand(state, command.id, ev, keymapOptions())
        )) || null;
    }

    function keymapCommandCatalog() {
        return [
            { id: 'app.openCommandPalette', title: 'Open command palette', subtitle: 'Search actions, projects, and saved commands' },
            { id: 'app.toggleOverview', title: 'Open overview', subtitle: 'Workspace health and pull status' },
            { id: 'app.openJobs', title: 'Open jobs', subtitle: 'Scheduled agent prompts' },
            { id: 'app.openDatabase', title: 'Open database workbench', subtitle: 'Read-only schemas, query console, and results' },
            { id: 'overview.refresh', title: 'Overview: Refresh', subtitle: 'Reload workspace health' },
            { id: 'overview.pullAll', title: 'Overview: Pull all', subtitle: 'Run git pull for every project' },
            { id: 'workspace.create', title: 'Workspace: New', subtitle: 'One AI session with several tracked projects' },
            { id: 'workspace.manage', title: 'Workspace: Manage tracked projects', subtitle: 'Add or remove projects from this workspace' },
            { id: 'app.rescanProjects', title: 'Projects: Rescan', subtitle: 'Find newly checked-out repositories' },
            { id: 'app.openSettings', title: 'Open settings', subtitle: 'Projects, capabilities, and preferences' },
            { id: 'app.openShortcuts', title: 'Open shortcuts', subtitle: 'Keyboard shortcut list' },
            { id: 'app.openKeymapConfig', title: 'Open keymap config', subtitle: 'Profiles and command shortcuts' },
            { id: 'app.goToProject', title: 'Go to project', subtitle: 'Jump directly to a repository' },
            { id: 'app.toggleSidebar', title: 'Toggle project sidebar', subtitle: 'Collapse or expand projects' },
            { id: 'app.toggleRightPanel', title: 'Toggle right panel', subtitle: 'Collapse or expand Git status' },
            { id: 'app.previousTab', title: 'Go to previous tab', subtitle: 'Switch open terminal tab' },
            { id: 'app.nextTab', title: 'Go to next tab', subtitle: 'Switch open terminal tab' },
            { id: 'project.findInFiles', title: 'Find in files', subtitle: 'Search the active project' },
            { id: 'project.goToFile', title: 'Go to file', subtitle: 'Open a file in the active project' },
            { id: 'diff.toggleViewed', title: 'Diff: Toggle viewed', subtitle: 'Mark or unmark the open diff as viewed' },
            { id: 'terminal.splitPane', title: 'Terminal: Split pane', subtitle: 'Split the active tab with another agent' },
            { id: 'terminal.closePaneOrTab', title: 'Terminal: Close active pane/tab', subtitle: 'Close the focused terminal pane or tab' },
            { id: 'terminal.restartSession', title: 'Restart session', subtitle: 'Restart the active terminal session' },
            { id: 'terminal.restartAndResumeSession', title: 'Restart and resume session', subtitle: 'Restart the focused pane and resume its last conversation' },
        ];
    }

    function currentKeymapCommands(state = keymapState) {
        const seen = new Set();
        const commands = [];
        const pushCommand = action => {
            if (!action.id || seen.has(action.id)) return;
            seen.add(action.id);
            commands.push(action);
        };
        keymapCommandCatalog().forEach(pushCommand);
        commandPaletteActions(state).forEach(pushCommand);
        return commands;
    }

    function commandIDPart(value) {
        return String(value || 'item')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '.')
            .replace(/^\.+|\.+$/g, '') || 'item';
    }

    function commandIDHash(value) {
        const text = String(value || '');
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function stableCommandID(parts) {
        const rawParts = parts.map(part => String(part || ''));
        const slug = rawParts.map(commandIDPart).join('.');
        return `${slug}.${commandIDHash(rawParts.join('\u001f'))}`;
    }

    function commandPaletteActions(state = keymapState) {
        const actions = [
            { id: 'app.openCommandPalette', title: 'Open command palette', subtitle: 'Search actions, projects, and saved commands', run: () => openCommandPalette() },
            { id: 'app.toggleOverview', title: 'Open overview', subtitle: 'Workspace health and pull status', run: () => toggleOverview() },
            { id: 'app.openJobs', title: 'Open jobs', subtitle: 'Scheduled agent prompts', run: () => toggleJobs() },
            { id: 'app.openDatabase', title: 'Open database workbench', subtitle: 'Read-only schemas, query console, and results', run: () => toggleDatabase() },
            { id: 'overview.refresh', title: 'Overview: Refresh', subtitle: 'Reload workspace health', run: () => overviewActive ? loadOverview() : showOverview() },
            { id: 'overview.pullAll', title: 'Overview: Pull all', subtitle: 'Run git pull for every project', run: () => pullAllProjects() },
            { id: 'workspace.create', title: 'Workspace: New', subtitle: 'One AI session with several tracked projects', run: () => openWorkspaceDialog() },
            { id: 'app.rescanProjects', title: 'Projects: Rescan', subtitle: 'Find newly checked-out repositories', run: () => rescanProjects() },
            { id: 'app.openSettings', title: 'Open settings', subtitle: 'Projects, capabilities, and preferences', run: () => openSettings() },
            { id: 'app.openShortcuts', title: 'Open shortcuts', subtitle: 'Keyboard shortcut list', run: () => openShortcutsModal() },
            { id: 'app.openKeymapConfig', title: 'Open keymap config', subtitle: 'Profiles and command shortcuts', run: () => openKeymapConfigModal() },
            { id: 'app.goToProject', title: 'Go to project', subtitle: 'Jump directly to a repository', run: () => openGotoProject() },
            { id: 'app.toggleSidebar', title: 'Toggle project sidebar', subtitle: 'Collapse or expand projects', run: () => sidebarCollapseBtn.click() },
            { id: 'app.toggleRightPanel', title: 'Toggle right panel', subtitle: 'Collapse or expand Git status', run: () => gitPanelCollapseBtn.click() },
            { id: 'app.previousTab', title: 'Go to previous tab', subtitle: 'Switch open terminal tab', run: () => switchAdjacentTab(-1) },
            { id: 'app.nextTab', title: 'Go to next tab', subtitle: 'Switch open terminal tab', run: () => switchAdjacentTab(1) },
            { id: 'terminal.closePaneOrTab', title: 'Terminal: Close active pane/tab', subtitle: workspaceForTab()?.name || activeTab || 'Close the focused terminal pane or tab', run: () => closeActivePaneOrTab() },
        ];
        if (activeTab) {
            actions.push({ id: 'terminal.restartSession', title: 'Restart session', subtitle: workspaceForTab()?.name || activeTab, run: () => restartProject(activeTab) });
            if (canResumeActiveSession()) {
                actions.push({ id: 'terminal.restartAndResumeSession', title: 'Restart and resume session', subtitle: workspaceForTab()?.name || activeTab, run: () => restartAndResumeActiveSession() });
            }
            if (isWorkspaceTab(activeTab)) {
                actions.push({ id: 'workspace.manage', title: 'Workspace: Manage tracked projects', subtitle: workspaceForTab()?.name || '', run: () => openWorkspaceDialog(workspaceForTab()?.id) });
            } else {
                actions.push({ id: 'terminal.splitPane', title: 'Terminal: Split pane', subtitle: activeTab, run: () => openAgentPicker() });
            }
        }
        if (activeProject) {
            const activeBaseProject = activeCommandProject();
            const activeProjectInfo = projectForKey(activeProject);
            const activeBaseInfo = projects.find(project => project.name === activeBaseProject);
            const gitFiles = currentGitFiles();
            const gitFilesSubtitle = currentGitFilesSubtitle(gitFiles);
            const isGitRepo = currentGitStatusIsRepository();
            const gitRepositoryActions = isGitRepo ? [
                { id: 'worktree.create', title: 'Worktree: Create', subtitle: activeBaseProject, run: () => promptCreateWorktree(activeBaseProject) },
                { id: 'worktree.open', title: 'Worktree: Open', subtitle: activeBaseProject, run: () => promptOpenWorktree(activeBaseProject) },
                { id: 'worktree.remove', title: 'Worktree: Remove', subtitle: activeBaseProject, run: () => promptRemoveWorktree(activeBaseProject) },
                { id: 'git.checkoutMain', title: 'Git: Checkout main/master', subtitle: activeProject, run: () => document.getElementById('git-checkout-main-btn').click() },
                { id: 'git.pull', title: 'Git: Pull', subtitle: activeProject, run: () => pullProject(activeProject) },
                { id: 'git.commitChanges', title: 'Git: Commit changes', subtitle: activeProject, run: () => openCommitModal() },
                { id: 'git.revertAllChanges', title: 'Git: Revert all changes', subtitle: activeProject, run: () => document.getElementById('git-revert-btn').click() },
                { id: 'git.switchBranch', title: 'Git: Switch branch', subtitle: activeProject, run: () => {
                    const branchEl = document.getElementById('git-branch-name');
                    if (branchEl) branchEl.click();
                    else showToast('Branch unavailable', 'Git status has not loaded a branch yet.', 'info', 3200);
                } },
            ] : [];
            actions.push(
                { id: 'project.findInFiles', title: 'Find in files', subtitle: activeProject, run: () => openFindModal() },
                { id: 'project.goToFile', title: 'Go to file', subtitle: activeProject, run: () => openGotoFile() },
                { id: 'project.openEditor', title: 'Open editor', subtitle: activeProject, run: () => openEditorModal() },
                { id: 'project.openFolder', title: 'Project: Open folder', subtitle: activeProject, run: () => openProjectFolder(activeProjectInfo) },
                { id: 'project.togglePin', title: activeBaseInfo && activeBaseInfo.pinned ? 'Project: Unpin' : 'Project: Pin', subtitle: activeBaseProject, run: () => togglePin(activeBaseProject) },
                ...gitRepositoryActions,
                { id: 'git.viewChangedFiles', title: isGitRepo ? 'Git: View changed files' : 'Project: View files', subtitle: gitFilesSubtitle, run: () => openFirstChangedFileDiff() },
            );
            if (activeBaseInfo && activeBaseInfo.docker_compose_file) {
                actions.push(
                    { id: 'docker.startActiveStack', title: 'Docker: Start stack', subtitle: `${activeBaseProject} · ${activeBaseInfo.docker_compose_file}`, run: () => startDockerStack(activeBaseProject) },
                    { id: 'docker.stopActiveStack', title: 'Docker: Stop stack', subtitle: `${activeBaseProject} · ${activeBaseInfo.docker_compose_file}`, run: () => stopDockerStack(activeBaseProject) },
                );
            }
            gitFiles.forEach((file) => {
                const fileID = stableCommandID([activeProject, file.name]);
                actions.push({
                    id: `git.openDiff.${fileID}`,
                    title: isGitRepo ? `Git: Open diff: ${file.name}` : `Project: Open file: ${file.name}`,
                    subtitle: `${activeProject} · ${file.status}`,
                    run: () => showDiffModal(file.name),
                });
                if (file.revertible !== false) {
                    actions.push({
                        id: `git.revertFile.${fileID}`,
                        title: `Git: Revert file: ${file.name}`,
                        subtitle: `${activeProject} · ${file.status}`,
                        run: () => revertFile(file.name, file.status),
                    });
                }
            });
        }
        workspaces.forEach(workspace => {
            actions.push({ id: 'workspace.open.' + workspace.id, title: 'Workspace: ' + workspace.name, subtitle: workspace.working_directory, run: () => switchProject('workspace:' + workspace.id) });
        });
        sortedProjects().forEach(project => {
            const projectID = commandIDPart(project.name);
            actions.push({
                id: `project.open.${projectID}`,
                title: `Project: ${project.name}`,
                subtitle: projectTagList(project.name).join(', ') || project.path || 'Open workspace',
                run: () => switchProject(project.name),
            });
            actions.push({
                id: `project.openFolder.${projectID}`,
                title: `Project: Open folder: ${project.name}`,
                subtitle: project.path || 'Open project folder',
                run: () => openProjectFolder(project),
            });
            actions.push({
                id: `project.restartSession.${projectID}`,
                title: `Project: Restart session: ${project.name}`,
                subtitle: project.has_session ? 'Restart existing session' : 'Start a fresh session',
                run: () => restartProject(project.name),
            });
            actions.push({
                id: `project.togglePin.${projectID}`,
                title: `Project: ${project.pinned ? 'Unpin' : 'Pin'}: ${project.name}`,
                subtitle: project.pinned ? 'Remove from pinned projects' : 'Pin to top',
                run: () => togglePin(project.name),
            });
            if (project.docker_compose_file) {
                actions.push({
                    id: `docker.startStack.${projectID}`,
                    title: `Docker: Start stack: ${project.name}`,
                    subtitle: project.docker_compose_file,
                    run: () => startDockerStack(project.name),
                });
                actions.push({
                    id: `docker.stopStack.${projectID}`,
                    title: `Docker: Stop stack: ${project.name}`,
                    subtitle: project.docker_compose_file,
                    run: () => stopDockerStack(project.name),
                });
            }
            (worktreeCache[project.name] || []).forEach(wt => {
                const worktreeKey = `${project.name}@${wt.name}`;
                const worktreeID = `${projectID}.${commandIDPart(wt.name)}`;
                actions.push({
                    id: `worktree.open.${worktreeID}`,
                    title: `Worktree: Open ${worktreeKey}`,
                    subtitle: wt.branch || project.name,
                    run: () => switchProject(worktreeKey),
                });
                actions.push({
                    id: `worktree.remove.${worktreeID}`,
                    title: `Worktree: Remove ${worktreeKey}`,
                    subtitle: wt.branch || project.name,
                    run: () => confirmDeleteWorktree(project.name, wt),
                });
            });
        });
        return decorateCommandActions(actions, state);
    }

    function scrollActiveCommandPaletteItem() {
        const results = document.getElementById('command-palette-results');
        const active = results.querySelector('.command-palette-item.active');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function updateCommandPaletteSelection(prevIndex = -1) {
        const results = document.getElementById('command-palette-results');
        if (!results) return;
        if (prevIndex === commandPaletteIndex) {
            scrollActiveCommandPaletteItem();
            return;
        }
        const rows = results.querySelectorAll('.command-palette-item');
        if (prevIndex >= 0 && prevIndex < rows.length) {
            rows[prevIndex].classList.remove('active');
        }
        if (commandPaletteIndex >= 0 && commandPaletteIndex < rows.length) {
            rows[commandPaletteIndex].classList.add('active');
        }
        scrollActiveCommandPaletteItem();
    }

    function renderCommandPalette() {
        const input = document.getElementById('command-palette-input');
        const results = document.getElementById('command-palette-results');
        const parts = (input.value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        commandPaletteItems = commandPaletteActions().filter(item => {
            if (parts.length === 0) return true;
            const haystack = [item.title, item.subtitle, item.shortcut].join(' ').toLowerCase();
            return parts.every(part => haystack.includes(part));
        });
        const renderedCount = Math.min(commandPaletteItems.length, COMMAND_PALETTE_RENDER_LIMIT);
        commandPaletteIndex = Math.min(commandPaletteIndex, Math.max(renderedCount - 1, 0));
        results.innerHTML = '';
        if (commandPaletteItems.length === 0) {
            results.innerHTML = '<div class="command-palette-empty">No actions match the current search.</div>';
            return;
        }
        commandPaletteItems.slice(0, COMMAND_PALETTE_RENDER_LIMIT).forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'command-palette-item' + (idx === commandPaletteIndex ? ' active' : '');
            row.innerHTML = `<div class="command-palette-main"><span class="command-palette-title">${esc(item.title)}</span><span class="command-palette-subtitle">${esc(item.subtitle || '')}</span></div><span class="command-palette-shortcut">${esc(item.shortcut || '')}</span>`;
            row.onclick = () => runCommandPaletteItem(idx);
            results.appendChild(row);
        });
        updateCommandPaletteSelection();
    }

    function runCommandPaletteItem(idx) {
        const item = commandPaletteItems[idx];
        if (!item) return;
        closeCommandPalette();
        Promise.resolve(item.run()).catch(err => showToast('Command failed', (err && err.message) || 'Unable to run command.', 'error', 4200));
    }

    function openCommandPalette() {
        commandPaletteIndex = 0;
        const modal = document.getElementById('command-palette-modal');
        modal.style.display = 'flex';
        const input = document.getElementById('command-palette-input');
        input.value = '';
        renderCommandPalette();
        input.focus();
    }

    function closeCommandPalette() {
        document.getElementById('command-palette-modal').style.display = 'none';
    }

    function isKeymapConfigOpen() {
        return document.getElementById('keymap-config-modal').style.display !== 'none';
    }

    function ensureKeymapDraftState() {
        if (!keymapDraftState) {
            keymapDraftState = Keymap.cloneState(keymapState);
        }
        return keymapDraftState;
    }

    function keymapDraftProfile() {
        const state = ensureKeymapDraftState();
        return state.profiles.find(profile => profile.id === state.activeProfileID)
            || state.profiles[0];
    }

    function openKeymapConfigModal() {
        if (isShortcutsOpen()) closeShortcutsModal();
        keymapDraftState = Keymap.cloneState(keymapState);
        keymapSearchQuery = '';
        keymapCaptureCommandID = '';
        document.getElementById('keymap-config-modal').style.display = 'flex';
        renderKeymapConfig();
        requestAnimationFrame(() => document.getElementById('keymap-command-search')?.focus());
    }

    function closeKeymapConfigModal() {
        document.getElementById('keymap-config-modal').style.display = 'none';
        keymapDraftState = null;
        keymapCaptureCommandID = '';
        focusActiveTerminalSoon();
    }

    function renderKeymapSaveButton() {
        const btn = document.getElementById('keymap-config-save-btn');
        if (!btn) return;
        btn.disabled = keymapSaveInFlight;
        btn.textContent = keymapSaveInFlight ? 'Saving...' : 'Save Profile';
    }

    function renderKeymapConfig() {
        const state = ensureKeymapDraftState();
        const profile = keymapDraftProfile();
        const select = document.getElementById('keymap-profile-select');
        const nameInput = document.getElementById('keymap-profile-name');
        const deleteBtn = document.getElementById('keymap-profile-delete-btn');
        const searchInput = document.getElementById('keymap-command-search');

        select.innerHTML = '';
        state.profiles.forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.name || item.id;
            select.appendChild(option);
        });
        select.value = profile.id;
        nameInput.value = profile.name || profile.id;
        nameInput.readOnly = profile.id === Keymap.DEFAULT_PROFILE_ID;
        nameInput.title = profile.id === Keymap.DEFAULT_PROFILE_ID
            ? 'Default profile name is fixed. Create a new profile to rename it.'
            : 'Profile name';
        if (searchInput) searchInput.value = keymapSearchQuery;
        deleteBtn.disabled = profile.id === Keymap.DEFAULT_PROFILE_ID;
        renderKeymapSaveButton();
        renderKeymapCommandBindings();
    }

    function renderKeymapCommandBindings() {
        const state = ensureKeymapDraftState();
        const profile = keymapDraftProfile();
        const list = document.getElementById('keymap-command-list');
        const summary = document.getElementById('keymap-profile-summary');
        const allCommands = currentKeymapCommands(state);
        const boundCount = allCommands.filter(command => (profile.bindings?.[command.id] || []).length > 0).length;
        const query = keymapSearchQuery.trim().toLowerCase();
        const commands = query
            ? allCommands.filter(command => [command.title, command.subtitle, command.id]
                .join(' ')
                .toLowerCase()
                .includes(query))
            : allCommands;
        list.innerHTML = '';
        if (summary) {
            summary.textContent = `${boundCount}/${allCommands.length} commands mapped`;
        }

        if (!commands.length) {
            list.innerHTML = '<div class="command-palette-empty">No commands match this search.</div>';
            return;
        }

        commands.forEach(command => {
            const row = document.createElement('div');
            row.className = 'keymap-command-row';
            row.classList.toggle('recording', keymapCaptureCommandID === command.id);

            const main = document.createElement('div');
            main.className = 'keymap-command-main';
            const title = document.createElement('div');
            title.className = 'keymap-command-title';
            title.textContent = command.title || command.id;
            const subtitle = document.createElement('div');
            subtitle.className = 'keymap-command-subtitle';
            subtitle.textContent = command.subtitle || command.id;
            main.appendChild(title);
            main.appendChild(subtitle);

            const bindingsEl = document.createElement('div');
            bindingsEl.className = 'keymap-command-bindings';
            const shortcuts = Array.isArray(profile.bindings?.[command.id]) ? profile.bindings[command.id] : [];
            const chips = document.createElement('div');
            chips.className = 'keymap-shortcut-chips';
            shortcuts.forEach(shortcut => {
                const chip = document.createElement('span');
                chip.className = 'keymap-shortcut-chip';
                const label = document.createElement('span');
                label.textContent = Keymap.shortcutLabel(shortcut, keymapOptions());
                chip.appendChild(label);
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.setAttribute('aria-label', 'Remove shortcut');
                remove.title = 'Remove shortcut';
                remove.innerHTML = iconHTML('x');
                remove.onclick = () => {
                    const next = (profile.bindings[command.id] || []).filter(item => item !== shortcut);
                    if (next.length) profile.bindings[command.id] = next;
                    else if (profile.id === Keymap.DEFAULT_PROFILE_ID) profile.bindings[command.id] = [];
                    else delete profile.bindings[command.id];
                    renderKeymapCommandBindings();
                };
                chip.appendChild(remove);
                chips.appendChild(chip);
            });
            if (shortcuts.length === 0) {
                const empty = document.createElement('span');
                empty.className = 'keymap-shortcut-empty';
                empty.textContent = 'Unmapped';
                chips.appendChild(empty);
            }

            const isRecording = keymapCaptureCommandID === command.id;
            if (isRecording) {
                const hint = document.createElement('span');
                hint.className = 'keymap-record-hint';
                hint.textContent = 'Press shortcut now';
                chips.appendChild(hint);
            }
            const record = document.createElement('button');
            record.type = 'button';
            record.className = 'keymap-record-btn';
            record.dataset.commandId = command.id;
            record.title = isRecording
                ? 'Cancel recording'
                : (shortcuts.length > 0 ? 'Replace shortcut' : 'Add shortcut');
            record.innerHTML = isRecording
                ? `${iconHTML('x')}<span>Cancel</span>`
                : `${iconHTML('plus')}<span>${shortcuts.length > 0 ? 'Replace' : 'Record'}</span>`;
            record.onclick = () => {
                if (isRecording) {
                    keymapCaptureCommandID = '';
                    renderKeymapCommandBindings();
                    return;
                }
                startKeymapCapture(command.id);
            };

            bindingsEl.appendChild(chips);
            bindingsEl.appendChild(record);
            row.appendChild(main);
            row.appendChild(bindingsEl);
            list.appendChild(row);
        });
    }

    function focusKeymapRecordButton(commandID) {
        requestAnimationFrame(() => {
            const btn = [...document.querySelectorAll('.keymap-record-btn')]
                .find(item => item.dataset.commandId === commandID);
            if (btn) btn.focus();
        });
    }

    function startKeymapCapture(commandID) {
        keymapCaptureCommandID = commandID;
        renderKeymapCommandBindings();
        focusKeymapRecordButton(commandID);
    }

    function handleKeymapCaptureKeydown(ev) {
        if (!isKeymapConfigOpen() || !keymapCaptureCommandID) return false;

        ev.preventDefault();
        ev.stopPropagation();

        if (ev.key === 'Escape') {
            keymapCaptureCommandID = '';
            renderKeymapCommandBindings();
            return true;
        }
        const commandID = keymapCaptureCommandID;
        const allowsPlainShortcut = commandID === 'diff.toggleViewed';
        if (!Keymap.isPotentialShortcutEvent(ev) && !allowsPlainShortcut) return true;
        const shortcut = Keymap.shortcutFromEvent(ev, keymapOptions());
        if (!shortcut) return true;
        addKeymapShortcut(commandID, shortcut);
        keymapCaptureCommandID = '';
        return true;
    }

    function addKeymapShortcut(commandID, shortcut) {
        const state = ensureKeymapDraftState();
        const profile = keymapDraftProfile();
        const normalized = Keymap.normalizeShortcut(shortcut);
        if (!normalized) {
            showToast('Shortcut not added', 'Press a shortcut with Ctrl, Cmd, Alt, or a function key.', 'error', 3200);
            return;
        }
        profile.bindings = profile.bindings || {};
        Object.keys(profile.bindings).forEach(id => {
            const next = (profile.bindings[id] || []).filter(item => item !== normalized);
            if (next.length) profile.bindings[id] = next;
            else if (profile.id === Keymap.DEFAULT_PROFILE_ID) profile.bindings[id] = [];
            else delete profile.bindings[id];
        });
        profile.bindings[commandID] = [normalized];
        state.activeProfileID = profile.id;
        keymapCaptureCommandID = '';
        renderKeymapCommandBindings();
    }

    function changeKeymapProfile() {
        const select = document.getElementById('keymap-profile-select');
        const state = ensureKeymapDraftState();
        state.activeProfileID = select.value;
        keymapCaptureCommandID = '';
        renderKeymapConfig();
    }

    function createKeymapProfile() {
        const state = ensureKeymapDraftState();
        const source = keymapDraftProfile();
        const baseName = 'New profile';
        const id = Keymap.makeProfileID(baseName, state.profiles.map(profile => profile.id));
        const suffix = id === 'new-profile' ? '' : ` ${id.split('-').pop()}`;
        const name = `${baseName}${suffix}`;
        state.profiles.push({
            id,
            name,
            bindings: source ? Keymap.cloneBindings(source.bindings) : {},
        });
        state.activeProfileID = id;
        keymapCaptureCommandID = '';
        renderKeymapConfig();
        requestAnimationFrame(() => {
            const input = document.getElementById('keymap-profile-name');
            if (!input) return;
            input.focus();
            input.select();
        });
    }

    function renameKeymapProfile(ev) {
        const profile = keymapDraftProfile();
        if (!profile) return;
        if (profile.id === Keymap.DEFAULT_PROFILE_ID) {
            ev.target.value = Keymap.DEFAULT_PROFILE_NAME;
            return;
        }
        profile.name = (ev.target.value || '').trim() || profile.id;
        const select = document.getElementById('keymap-profile-select');
        const option = [...select.options].find(item => item.value === profile.id);
        if (option) option.textContent = profile.name;
    }

    function deleteKeymapProfile() {
        const state = ensureKeymapDraftState();
        const profile = keymapDraftProfile();
        if (profile.id === Keymap.DEFAULT_PROFILE_ID) {
            showToast('Profile kept', `${Keymap.DEFAULT_PROFILE_NAME} cannot be deleted.`, 'info', 2600);
            return;
        }
        state.profiles = state.profiles.filter(item => item.id !== profile.id);
        state.activeProfileID = state.profiles.some(item => item.id === Keymap.DEFAULT_PROFILE_ID)
            ? Keymap.DEFAULT_PROFILE_ID
            : (state.profiles[0] && state.profiles[0].id);
        keymapCaptureCommandID = '';
        renderKeymapConfig();
    }

    function resetKeymapProfile() {
        const profile = keymapDraftProfile();
        if (!profile) return;
        profile.bindings = Keymap.defaultBindings(keymapOptions());
        if (profile.id === Keymap.DEFAULT_PROFILE_ID) {
            profile.name = Keymap.DEFAULT_PROFILE_NAME;
        }
        keymapCaptureCommandID = '';
        renderKeymapConfig();
        showToast('Profile reset', `${profile.name || profile.id} restored to default shortcuts.`, 'info', 2600);
    }

    async function saveKeymapConfig() {
        if (!keymapDraftState || keymapSaveInFlight) return;
        const nextProfile = keymapDraftProfile();
        try {
            keymapSaveInFlight = true;
            renderKeymapSaveButton();
            await patchConfig(Keymap.serializeState(keymapDraftState), {
                timeoutMs: CONFIG_SAVE_TIMEOUT_MS,
                timeoutMessage: 'Keymap save timed out. Please try again.',
            });
            closeKeymapConfigModal();
            showToast('Profile saved', `${nextProfile.name || nextProfile.id} is active.`, 'success', 2600);
        } catch (err) {
            showToast('Profile save failed', (err && err.message) || 'Unable to save keymap profile.', 'error', 4200);
        } finally {
            keymapSaveInFlight = false;
            renderKeymapSaveButton();
        }
    }

    function isShortcutsOpen() {
        return document.getElementById('shortcuts-modal').style.display !== 'none';
    }

    function shortcutEntries() {
        const entry = (commandID, label) => ({ key: commandShortcutLabel(commandID), label });
        const common = [
            entry('app.openCommandPalette', 'Open command palette'),
            entry('app.goToProject', 'Jump to project'),
            entry('app.toggleOverview', 'Toggle overview'),
            entry('app.openJobs', 'Open jobs'),
            entry('app.openDatabase', 'Open database workbench'),
            entry('app.openSettings', 'Open settings'),
            entry('app.openShortcuts', 'Open keyboard shortcuts'),
            entry('app.openKeymapConfig', 'Open keymap config'),
            entry('app.toggleSidebar', 'Toggle project sidebar'),
            entry('app.toggleRightPanel', 'Toggle right panel'),
            entry('app.previousTab', 'Previous tab'),
            entry('app.nextTab', 'Next tab'),
            { key: 'Esc', label: 'Close active modal or panel' },
        ].filter(item => item.key);
        if (overviewActive || jobsActive || databaseActive) return common;
        return common.concat([
            entry('terminal.splitPane', 'Split with agent'),
            entry('project.findInFiles', 'Find in files'),
            entry('project.goToFile', 'Go to file'),
            entry('terminal.closePaneOrTab', 'Close pane or tab'),
            entry('terminal.restartSession', 'Restart terminal session'),
            entry('terminal.restartAndResumeSession', 'Restart and resume session'),
        ].filter(item => item.key));
    }

    function renderShortcutsModalContent() {
        const list = document.getElementById('shortcuts-list');
        const copy = document.getElementById('shortcuts-context-copy');
        copy.textContent = overviewActive ? 'Overview mode focuses on workspace health and bulk actions.' : jobsActive ? 'Jobs mode focuses on scheduled Codex prompts.' : databaseActive ? 'Database mode focuses on read-only schemas, query console, and results.' : 'Project mode focuses on terminal, Git, Docker, and file workflows.';
        list.innerHTML = '';
        shortcutEntries().forEach(entry => {
            const card = document.createElement('div');
            card.className = 'shortcut-card';
            card.innerHTML = `<strong>${esc(entry.key)}</strong><span>${esc(entry.label)}</span>`;
            list.appendChild(card);
        });
    }

    function openShortcutsModal() {
        const modal = document.getElementById('shortcuts-modal');
        renderShortcutsModalContent();
        modal.style.display = 'flex';
    }

    function closeShortcutsModal() {
        document.getElementById('shortcuts-modal').style.display = 'none';
    }

    function dispatchKeymapAction(ev) {
        if (!Keymap.isPotentialShortcutEvent(ev)) return false;
        const action = keymapActionForEvent(ev);
        if (!action) return false;
        ev.preventDefault?.();
        ev.stopPropagation?.();
        Promise.resolve(action.run()).catch(err => showToast('Command failed', (err && err.message) || 'Unable to run command.', 'error', 4200));
        return true;
    }

    function shortcutEventFromElectronInput(input) {
        return {
            key: input && input.key,
            code: input && input.code,
            ctrlKey: !!(input && input.ctrlKey),
            metaKey: !!(input && input.metaKey),
            shiftKey: !!(input && input.shiftKey),
            altKey: !!(input && input.altKey),
            type: (input && input.type) || 'keydown',
            preventDefault() {},
            stopPropagation() {},
        };
    }

    if (window.electronShortcutInput) {
        window.electronShortcutInput((input) => {
            if (input && input.type && input.type !== 'keydown') return;
            if (isKeymapConfigOpen() || isShortcutsOpen()) return;
            if (isEditingShortcutContext()) return;
            dispatchKeymapAction(shortcutEventFromElectronInput(input));
        });
    }

    const shortcutBlockingModalIDs = [
        'setup-overlay',
        'agent-picker-modal',
        'app-dialog-modal',
        'branch-conflict-modal',
        'commit-modal',
        'diff-modal',
        'editor-modal',
        'find-modal',
        'goto-file-overlay',
        'goto-project-overlay',
        'settings-modal',
        'command-palette-modal',
        'workspace-modal',
        'database-password-modal',
        'text-prompt-modal',
        'job-schedule-modal',
        'job-log-modal',
        'shortcuts-modal',
        'keymap-config-modal',
    ];

    function isVisibleElement(id) {
        const el = document.getElementById(id);
        return !!el && el.style.display !== 'none';
    }

    function isModalOrOverlayOpen() {
        return shortcutBlockingModalIDs.some(isVisibleElement);
    }

    function isEditingShortcutContext() {
        if (isModalOrOverlayOpen()) return true;

        const active = document.activeElement;
        if (!active) return false;
        if (active.closest && active.closest('.xterm')) return false;
        if (active.closest && active.closest('.monaco-editor')) return true;
        if (/^(INPUT|TEXTAREA|SELECT)$/i.test(active.tagName || '')) return true;
        if (active.isContentEditable) return true;

        return false;
    }

    // ─── Keyboard Shortcuts ─────────────────────────────────────────
    document.addEventListener('keydown', ev => {
        if (handleKeymapCaptureKeydown(ev)) return;

        if (ev.key === 'Escape') {
            if (isVisibleElement('workspace-modal') && !appDialog) {
                ev.stopPropagation();
                if (ev.isComposing || ev.keyCode === 229) return;
                ev.preventDefault();
                closeWorkspaceDialog();
                return;
            }
            if (consumeDatabaseAutocompleteEscape(ev)) return;
            if (activeDiffComment) {
                ev.stopPropagation();
                if (ev.isComposing || ev.keyCode === 229) return;
                ev.preventDefault();
                closeActiveDiffComment();
                return;
            }
            if (textInputRequest) {
                cancelTextInputRequest();
                return;
            }
			if (settingsCLIIntegrationModalIsOpen()) {
				closeSettingsCLIIntegrationModal();
				return;
			}
			if (settingsDatabaseModalIsOpen()) {
				closeSettingsDatabaseModal();
				return;
			}
            if (isCommandPaletteOpen()) {
                closeCommandPalette();
                return;
            }
            if (databasePasswordPrompt) {
                cancelDatabasePasswordPrompt();
                return;
            }
            if (isKeymapConfigOpen()) {
                closeKeymapConfigModal();
                return;
            }
            if (isShortcutsOpen()) {
                closeShortcutsModal();
                return;
            }
            if (document.getElementById('job-schedule-modal').style.display !== 'none') {
                closeJobScheduleBuilder();
                return;
            }
            if (document.getElementById('job-log-modal').style.display !== 'none') {
                closeJobLogs();
                return;
            }
            if (isAgentPickerOpen()) {
                closeAgentPicker();
                return;
            }
            if (overviewActive) {
                hideOverview();
                markVisibleTabCompletionSeen();
                return;
            }
            if (jobsActive) {
                hideJobs();
                markVisibleTabCompletionSeen();
                return;
            }
            if (databaseActive) {
                hideDatabase();
                markVisibleTabCompletionSeen();
                return;
            }
            if (document.getElementById('goto-project-overlay').style.display !== 'none') {
                closeGotoProject();
                return;
            }
            if (document.getElementById('goto-file-overlay').style.display !== 'none') {
                closeGotoFile();
                return;
            }
            if (document.getElementById('find-modal').style.display !== 'none') {
                closeFindModal();
                return;
            }
            if (document.getElementById('editor-modal').style.display !== 'none') {
                closeEditorModal();
                return;
            }
            if (document.getElementById('branch-conflict-modal').style.display !== 'none') {
                closeBranchConflictModal();
                return;
            }
            closeDiffModal();
            closeSettings();
            closeCommitModal();
            closeBranchDropdown();
            return;
        }

        if (isAgentPickerOpen()) {
            const optionsCount = Math.max(agentPickerOptions().length, 1);
            if (ev.key === 'ArrowDown') {
                ev.preventDefault();
                ev.stopPropagation();
                agentPickerState.selectedIndex = (agentPickerState.selectedIndex + 1) % optionsCount;
                renderAgentPickerOptions();
                return;
            }
            if (ev.key === 'ArrowUp') {
                ev.preventDefault();
                ev.stopPropagation();
                agentPickerState.selectedIndex = (agentPickerState.selectedIndex - 1 + optionsCount) % optionsCount;
                renderAgentPickerOptions();
                return;
            }
            if (ev.key === 'Enter') {
                ev.preventDefault();
                ev.stopPropagation();
                confirmAgentPicker().catch(err => showToast('Split failed', compactErrorMessage(err && err.message, 'Failed to start agent'), 'error', 4200));
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            return;
        }

        if (isCommandPaletteOpen()) {
            if (ev.key === 'ArrowDown') {
                ev.preventDefault();
                const prevIndex = commandPaletteIndex;
                commandPaletteIndex = Math.min(commandPaletteIndex + 1, Math.max(Math.min(commandPaletteItems.length, COMMAND_PALETTE_RENDER_LIMIT) - 1, 0));
                updateCommandPaletteSelection(prevIndex);
                return;
            }
            if (ev.key === 'ArrowUp') {
                ev.preventDefault();
                const prevIndex = commandPaletteIndex;
                commandPaletteIndex = Math.max(commandPaletteIndex - 1, 0);
                updateCommandPaletteSelection(prevIndex);
                return;
            }
            if (ev.key === 'Enter') {
                ev.preventDefault();
                runCommandPaletteItem(commandPaletteIndex);
                return;
            }
        }

        if (isKeymapConfigOpen()) return;
        if (isShortcutsOpen()) return;

        // Diff modal shortcuts (only when editor not focused)
        const diffModal = document.getElementById('diff-modal');
        if (diffModal.style.display !== 'none') {
            const diffEditorEvent = diffEditorHasKeyboardFocus(ev);
            if (diffEditorEvent) {
                collapseUnsafeDiffEditorSelectionForPlainInput(ev);
                return;
            }
            if (
                !ev.repeat
                && diffEntryCanBeViewed(diffFiles[diffIndex])
                && Keymap.eventMatchesCommand(keymapState, 'diff.toggleViewed', ev, keymapOptions())
            ) {
                ev.preventDefault();
                ev.stopPropagation();
                toggleCurrentDiffViewed();
                return;
            }
            if (ev.key === 'ArrowLeft' && diffFiles.length > 1) {
                ev.preventDefault();
                diffNavigate(-1);
                return;
            }
            if (ev.key === 'ArrowRight' && diffFiles.length > 1) {
                ev.preventDefault();
                diffNavigate(1);
                return;
            }
            if (ev.key === 'ArrowUp') {
                ev.preventDefault();
                diffChangeNavigate(-1);
                return;
            }
            if (ev.key === 'ArrowDown') {
                ev.preventDefault();
                diffChangeNavigate(1);
                return;
            }
        }

        if (!Keymap.isPotentialShortcutEvent(ev)) return;
        if (isEditingShortcutContext()) return;

        dispatchKeymapAction(ev);

    }, true);  // Capture phase

    // ─── Window Resize ──────────────────────────────────────────────
    window.addEventListener('resize', () => {
        fitTab(activeTab);
    });

    // ─── Container Resize Observer ──────────────────────────────────
    // Catches layout-driven resizes (git panel, project list, tab bar changes)
    // that don't fire the window resize event but still affect terminal size
    const termContainer = document.getElementById('terminal-container');
    if (termContainer && typeof ResizeObserver !== 'undefined') {
        let resizeRaf = null;
        new ResizeObserver(() => {
            if (resizeRaf) return;
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = null;
                fitTab(activeTab);
            });
        }).observe(termContainer);
    }

    // ─── Helpers ────────────────────────────────────────────────────
    async function fetchJSON(url, options = {}) {
        const { timeoutMs, timeoutMessage, ...fetchOptions } = options || {};
        let timeoutID = null;
        let controller = null;
        let upstreamSignal = null;
        let upstreamAbort = null;

        if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
            controller = new AbortController();
            upstreamSignal = fetchOptions.signal;
            fetchOptions.signal = controller.signal;
            if (upstreamSignal) {
                upstreamAbort = () => controller.abort();
                if (upstreamSignal.aborted) upstreamAbort();
                else upstreamSignal.addEventListener('abort', upstreamAbort, { once: true });
            }
            timeoutID = setTimeout(() => controller.abort(), timeoutMs);
        }

        let res;
        let text;
        try {
            res = await fetch(url, fetchOptions);
            text = await res.text();
        } catch (err) {
            if (err && err.name === 'AbortError') {
                throw new Error(timeoutMessage || 'Request timed out.');
            }
            throw err;
        } finally {
            if (timeoutID) clearTimeout(timeoutID);
            if (upstreamSignal && upstreamAbort) upstreamSignal.removeEventListener('abort', upstreamAbort);
        }

        if (!res.ok) {
            let message = res.statusText || `HTTP ${res.status}`;
            const errorText = text.trim();
            let errorData = null;
            if (errorText) {
                try {
                    errorData = JSON.parse(errorText);
                } catch {
                    message = errorText;
                }
            }
            if (errorData && typeof errorData === 'object') {
                message = errorData.error || errorData.message || message;
            }
            const err = new Error(message);
            err.status = res.status;
            if (errorData && typeof errorData === 'object') {
                Object.assign(err, errorData);
            }
            throw err;
        }
        if (!text.trim()) return null;
        return JSON.parse(text);
    }

    // Fit terminal without losing scroll position
    function safeFit(t) {
        if (!t || !t.term || !t.fitAddon) return;
        const before = t.term.buffer.active;
        const distanceFromBottom = Math.max(0, before.baseY - before.viewportY);
        const wasAtBottom = distanceFromBottom === 0;
        t.fitAddon.fit();
        if (wasAtBottom) {
            t.term.scrollToBottom();
        } else {
            // Reflow can change absolute line numbers. Preserve the user's
            // distance from the tail and let xterm own all other scroll state.
            const maxScroll = t.term.buffer.active.baseY;
            t.term.scrollToLine(Math.max(0, maxScroll - distanceFromBottom));
        }
        t.term.refresh(0, Math.max(0, t.term.rows - 1));
    }

    function fitTab(tabKey) {
        getPaneKeys(tabKey).forEach(key => safeFit(terminals[key]));
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // ─── Sidebar collapse ────────────────────────────────────────────
    function refitActiveTerminal() {
        setTimeout(() => {
            fitTab(activeTab);
        }, 220); // after CSS transition
    }

    const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
    const gitPanelCollapseBtn = document.getElementById('git-panel-collapse-btn');
    const SIDE_PANEL_MIN_WIDTH = 180;
    const SIDE_PANEL_MAIN_MIN_WIDTH = 240;
    const SIDE_PANEL_DRAG_THRESHOLD = 4;
    const sidePanelResizeStates = new Map();

    function sidePanelMaxWidth(panel) {
        const otherPanel = panel.id === 'sidebar'
            ? document.getElementById('git-panel')
            : document.getElementById('sidebar');
        const otherState = otherPanel ? sidePanelResizeStates.get(otherPanel.id) : null;
        const otherWidth = otherPanel && !otherPanel.classList.contains('collapsed')
            ? (otherState?.expandedWidth ?? otherPanel.getBoundingClientRect().width)
            : SIDE_PANEL_MIN_WIDTH;
        const handleWidth = sidebarCollapseBtn.offsetWidth + gitPanelCollapseBtn.offsetWidth;
        const appWidth = document.getElementById('app').getBoundingClientRect().width || window.innerWidth;
        return Math.max(
            SIDE_PANEL_MIN_WIDTH,
            appWidth - Math.max(SIDE_PANEL_MIN_WIDTH, otherWidth) - handleWidth - SIDE_PANEL_MAIN_MIN_WIDTH,
        );
    }

    function bindResizableSidePanel({ panel, handle, side, storageKey, panelName, expandedIcon, collapsedIcon }) {
        let dragState = null;
        let suppressNextClick = false;
        let expandedWidth = panel.getBoundingClientRect().width;

        try {
            const storedWidth = Number(localStorage.getItem(storageKey));
            if (Number.isFinite(storedWidth) && storedWidth >= SIDE_PANEL_MIN_WIDTH) {
                expandedWidth = storedWidth;
            }
        } catch {}

        function applyWidth(width) {
            const nextWidth = Math.round(Math.max(
                SIDE_PANEL_MIN_WIDTH,
                Math.min(width, sidePanelMaxWidth(panel)),
            ));
            panel.style.setProperty('--side-panel-width', `${nextWidth}px`);
            expandedWidth = nextWidth;
            return nextWidth;
        }

        function setCollapsed(collapsed) {
            if (!collapsed) applyWidth(expandedWidth);
            panel.classList.toggle('collapsed', collapsed);
            handle.classList.toggle('collapsed', collapsed);
            handle.innerHTML = iconHTML(collapsed ? collapsedIcon : expandedIcon);
            handle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            handle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${panelName}; drag to resize`);
        }

        function persistWidth() {
            try {
                localStorage.setItem(storageKey, String(expandedWidth));
            } catch {}
        }

        function onPointerMove(ev) {
            if (!dragState || ev.pointerId !== dragState.pointerId) return;
            const pointerDelta = ev.clientX - dragState.startX;
            if (!dragState.dragged && Math.abs(pointerDelta) < SIDE_PANEL_DRAG_THRESHOLD) return;

            if (!dragState.dragged) {
                dragState.dragged = true;
                handle.classList.add('dragging');
                panel.classList.add('resizing');
                document.body.classList.add('side-panel-resizing');
            }

            const requestedWidth = dragState.startWidth + (side === 'left' ? pointerDelta : -pointerDelta);
            if (dragState.startWidth === 0 && requestedWidth <= 0) return;
            if (panel.classList.contains('collapsed')) setCollapsed(false);
            applyWidth(requestedWidth);
            ev.preventDefault();
        }

        function finishPointerDrag(ev) {
            if (!dragState || ev.pointerId !== dragState.pointerId) return;
            const wasDragged = dragState.dragged;
            dragState = null;
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', finishPointerDrag);
            document.removeEventListener('pointercancel', finishPointerDrag);
            if (handle.hasPointerCapture?.(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
            handle.classList.remove('dragging');
            panel.classList.remove('resizing');
            document.body.classList.remove('side-panel-resizing');

            if (!wasDragged) return;
            if (!panel.classList.contains('collapsed')) persistWidth();
            suppressNextClick = ev.type === 'pointerup';
            setTimeout(() => { suppressNextClick = false; }, 0);
            refitActiveTerminal();
        }

        handle.addEventListener('pointerdown', ev => {
            if (dragState || ev.button !== 0 || ev.isPrimary === false) return;
            const renderedWidth = panel.getBoundingClientRect().width;
            dragState = {
                pointerId: ev.pointerId,
                startX: ev.clientX,
                startWidth: panel.classList.contains('collapsed') ? 0 : (renderedWidth || expandedWidth),
                dragged: false,
            };
            handle.setPointerCapture?.(ev.pointerId);
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', finishPointerDrag);
            document.addEventListener('pointercancel', finishPointerDrag);
        });

        handle.addEventListener('click', ev => {
            if (suppressNextClick) {
                suppressNextClick = false;
                ev.preventDefault();
                return;
            }
            setCollapsed(!panel.classList.contains('collapsed'));
            refitActiveTerminal();
        });

        const state = {
            get expandedWidth() { return expandedWidth; },
            initialize() {
                applyWidth(expandedWidth);
                setCollapsed(panel.classList.contains('collapsed'));
            },
            reclamp() {
                if (!panel.classList.contains('collapsed')) applyWidth(expandedWidth);
            },
        };
        sidePanelResizeStates.set(panel.id, state);
        return state;
    }

    function reclampSidePanelWidths() {
        sidePanelResizeStates.forEach(state => state.reclamp());
    }

    const sidePanelBindings = [
        bindResizableSidePanel({
            panel: document.getElementById('sidebar'),
            handle: sidebarCollapseBtn,
            side: 'left',
            storageKey: 'sidebar-panel-width',
            panelName: 'project sidebar',
            expandedIcon: 'chevron-left',
            collapsedIcon: 'chevron-right',
        }),
        bindResizableSidePanel({
            panel: document.getElementById('git-panel'),
            handle: gitPanelCollapseBtn,
            side: 'right',
            storageKey: 'git-panel-width',
            panelName: 'right panel',
            expandedIcon: 'chevron-right',
            collapsedIcon: 'chevron-left',
        }),
    ];
    sidePanelBindings.forEach(binding => binding.initialize());


    // ─── Start ──────────────────────────────────────────────────────
    init();
})();
