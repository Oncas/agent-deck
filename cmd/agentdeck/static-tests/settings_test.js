const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const staticDir = path.join(__dirname, '..', 'static');
const source = fs.readFileSync(path.join(staticDir, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf8');

function functionSource(name) {
    const match = new RegExp(`^([ \\t]*)(?:async )?function ${name}\\(`, 'm').exec(source);
    assert.ok(match, `missing function ${name}`);
    const end = source.indexOf('\n' + match[1] + '}\n', match.index);
    assert.ok(end > match.index);
    return source.slice(match.index, end + match[1].length + 3);
}

function fakeElement(attrs = {}) {
    const classes = new Set();
    return {
        ...attrs,
        hidden: false,
        attributes: {},
        dataset: { ...(attrs.dataset || {}) },
        classList: {
            toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
            contains: name => classes.has(name),
        },
        setAttribute(name, value) { this.attributes[name] = String(value); },
    };
}

function navHarness() {
    const pages = ['general', 'projects', 'ai', 'databases'];
    const navItems = pages.map(page => fakeElement({ dataset: { settingsPage: page } }));
    const panels = pages.map(page => fakeElement({ dataset: { settingsPage: page } }));
    const context = {
        document: {
            querySelectorAll: selector => {
                if (selector === '.settings-nav-item') return navItems;
                if (selector === '.settings-page') return panels;
                return [];
            },
        },
    };
    vm.runInNewContext(functionSource('showSettingsPage'), context);
    return { context, navItems, panels };
}

test('settings nav shows one page at a time', () => {
    const { context, navItems, panels } = navHarness();
    context.showSettingsPage('projects');
    assert.deepEqual(panels.map(panel => panel.hidden), [true, false, true, true]);
    assert.deepEqual(navItems.map(item => item.classList.contains('active')), [false, true, false, false]);
    assert.equal(navItems[1].attributes['aria-selected'], 'true');
    assert.equal(navItems[0].attributes['aria-selected'], 'false');
});

test('an unknown settings page falls back to General', () => {
    const { context, panels } = navHarness();
    context.showSettingsPage('nope');
    assert.deepEqual(panels.map(panel => panel.hidden), [false, true, true, true]);
});

test('settings markup lists the four pages and opens on General', () => {
    for (const page of ['general', 'projects', 'ai', 'databases']) {
        assert.match(indexHtml, new RegExp(`class="settings-nav-item"[^>]*data-settings-page="${page}"`));
        assert.match(indexHtml, new RegExp(`class="settings-page"[^>]*data-settings-page="${page}"`));
    }
    assert.match(functionSource('openSettings'), /showSettingsPage\('general'\)/);
    assert.doesNotMatch(indexHtml, /id="settings-save-btn"|id="settings-cancel-btn"|id="settings-unsaved-overlay"/);
});

function autosaveHarness({ failSave = false } = {}) {
    const saves = [];
    const context = {
        settingsSaveChain: Promise.resolve(),
        settingsAutosaveTimer: null,
        settingsChangeSeq: 0,
        settingsSavedSeq: 0,
        settingsSavedSnapshot: 'a',
        snapshot: 'a',
        currentSettingsSnapshot: () => context.snapshot,
        settingsModalIsOpen: () => true,
        setTimeout: () => 1,
        clearTimeout() {},
        saveSettings: async () => {
            saves.push(context.snapshot);
            if (context.onSave) context.onSave();
            if (failSave) return false;
            context.settingsSavedSnapshot = saves[saves.length - 1];
            return true;
        },
    };
    vm.runInNewContext(['noteSettingsChange', 'flushSettingsAutosave'].map(functionSource).join('\n'), context);
    return { context, saves };
}

test('autosave skips the request when nothing changed', async () => {
    const { context, saves } = autosaveHarness();
    context.noteSettingsChange();
    await context.flushSettingsAutosave();
    assert.deepEqual(saves, []);
});

test('autosave saves a change once', async () => {
    const { context, saves } = autosaveHarness();
    context.snapshot = 'b';
    context.noteSettingsChange();
    await context.flushSettingsAutosave();
    await context.flushSettingsAutosave();
    assert.deepEqual(saves, ['b']);
});

test('a change made while a save is in flight is saved afterwards', async () => {
    const { context, saves } = autosaveHarness();
    context.snapshot = 'b';
    context.onSave = () => {
        context.onSave = null;
        context.snapshot = 'c';
        context.noteSettingsChange();
    };
    context.noteSettingsChange();
    await context.flushSettingsAutosave();
    assert.deepEqual(saves, ['b', 'c']);
});

test('a failed save does not retry in a loop', async () => {
    const { context, saves } = autosaveHarness({ failSave: true });
    context.snapshot = 'b';
    context.noteSettingsChange();
    await context.flushSettingsAutosave();
    assert.deepEqual(saves, ['b']);
});

test('the last scan path cannot be removed', () => {
    const render = functionSource('renderScanPaths');
    assert.match(render, /settingsScanPaths\.length <= 1/);
});

function cliChoices(providers, capabilities, selected) {
    const context = {};
    vm.runInNewContext(functionSource('settingsCLIChoices'), context);
    return context.settingsCLIChoices(providers, capabilities, selected).map(provider => provider.value);
}

const providers = ['claude', 'openai', 'gemini', 'my-wrapper'].map(value => ({ value }));

test('default CLI choices hide CLIs that are not installed', () => {
    const capabilities = { dependencies: {
        claude: { available: true }, openai: { available: false }, gemini: { available: false },
    } };
    assert.deepEqual(cliChoices(providers, capabilities, 'claude'), ['claude', 'my-wrapper']);
});

test('the selected CLI stays listed even when it is missing', () => {
    const capabilities = { dependencies: { claude: { available: true }, gemini: { available: false } } };
    assert.deepEqual(cliChoices(providers, capabilities, 'gemini'), ['claude', 'openai', 'gemini', 'my-wrapper']);
});

test('every CLI is listed when installs could not be checked', () => {
    assert.deepEqual(cliChoices(providers, null, 'claude'), ['claude', 'openai', 'gemini', 'my-wrapper']);
});

test('setting names are plain text, so only the control itself toggles', () => {
    const start = indexHtml.indexOf('<div id="settings-modal"');
    const settingsHtml = indexHtml.slice(start, indexHtml.indexOf('<div id="settings-database-modal"', start));
    assert.doesNotMatch(settingsHtml, /<label class="settings-row-label"/);
    for (const id of ['settings-github-activity', 'settings-prevent-sleep', 'settings-startup-git-pull-ff-only']) {
        assert.match(settingsHtml, new RegExp(`<label class="settings-switch"><input type="checkbox" id="${id}" aria-labelledby="${id}-label">`));
    }
});

test('the permission bypass toggle only switches from the switch', () => {
    const context = { esc: value => String(value), settingsDangerousPermissions: { claude: true } };
    vm.runInNewContext(['settingsDangerousInputID', 'settingsDangerousToggleHTML'].map(functionSource).join('\n'), context);
    const html = context.settingsDangerousToggleHTML({ value: 'claude', dangerousFlag: '--x', dangerousLabel: 'Bypass' });
    assert.match(html, /<span[^>]*>Bypass<\/span><label class="settings-switch">/);
    assert.doesNotMatch(html, /<label[^>]*>[^<]*<input[^>]*><span>Bypass/);
});

test('the job enabled toggle only switches from the switch', () => {
    assert.match(indexHtml, /<span id="job-enabled-label">Enabled<\/span>\s*<label class="settings-switch"><input type="checkbox" id="job-enabled" aria-labelledby="job-enabled-label" checked>/);
});

// The usage module's declarations and functions, run against a fake DOM.
const usageDeclarations = ['USAGE_PROVIDERS', 'usageState', 'USAGE_ACTIVE_TAB_KEY'].map(name => {
    const match = new RegExp(`^ *const ${name} = [\\s\\S]*?;\\n`, 'm').exec(source);
    assert.ok(match, `missing ${name}`);
    return match[0];
}).join('');
const usageFunctions = ['formatUsageCost', 'formatUsageReset', 'formatUsageDuration', 'formatUsageCountdown',
    'formatUsageAge', 'usageLimitsHTML', 'usageBudgetHTML', 'usageSummaryHTML', 'usageProviderInstalled',
    'enabledUsageProviders', 'loadUsageActiveTab', 'saveUsageActiveTab', 'activeUsageProvider', 'usageTabsHTML',
    'renderUsageBox', 'selectUsageTab', 'applyUsageConfig', 'settingsUsageRowsHTML', 'settingsBudgetValue',
    'readSettingsUsage', 'syncSettingsUsageToggles', 'noteUsageToggle'];

function usageHarness({ config = {}, stored = '', installed = { claude: true, openai: true } } = {}) {
    const storage = new Map(stored ? [['usage-active-tab', stored]] : []);
    const elements = {
        'usage-section': { style: { display: 'none' } },
        'usage-tabs': { innerHTML: '' },
        'usage-body': { innerHTML: '' },
    };
    const context = {
        esc: value => String(value),
        compactErrorMessage: (message, fallback) => message || fallback,
        Date,
        localStorage: {
            getItem: key => (storage.has(key) ? storage.get(key) : null),
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key),
        },
        runtimeCapabilities: {
            dependencies: Object.fromEntries(Object.entries(installed).map(([key, available]) => [key, { available }])),
        },
        settingsCapabilities: null,
        document: { getElementById: id => elements[id] || null },
    };
    vm.runInNewContext(usageDeclarations + usageFunctions.map(functionSource).join('\n') +
        '\nfunction syncUsage() { renderUsageBox(); }\nthis.usageState = usageState;\nthis.USAGE_PROVIDERS = USAGE_PROVIDERS;',
        context);
    context.applyUsageConfig(config);
    const provider = id => context.USAGE_PROVIDERS.find(entry => entry.id === id);
    // The usage box body for one provider's response.
    const summary = (id, data, error = '') => {
        Object.assign(context.usageState[id], { data, error });
        return context.usageSummaryHTML(provider(id), context.usageState[id]);
    };
    const activeTab = () => /data-usage-tab="(\w+)" aria-selected="true"/.exec(elements['usage-tabs'].innerHTML)?.[1];
    return { context, elements, storage, summary, activeTab, provider };
}

const usagePeriods = [{ key: 'today', total: { cost: 5, messages: 1 } }, { key: 'week', total: { cost: 40, messages: 9 } },
    { key: 'month', total: { cost: 108, messages: 30 } }];

test('every usage provider gets its settings rows', () => {
    assert.match(indexHtml, /<div id="settings-usage-rows"><\/div>/);
    const { context } = usageHarness();
    for (const provider of context.USAGE_PROVIDERS) {
        const id = provider.id;
        const html = context.settingsUsageRowsHTML(provider);
        assert.match(html, new RegExp(`<label class="settings-switch"><input type="checkbox" id="settings-${id}-usage" aria-labelledby="settings-${id}-usage-label">`));
        assert.match(html, new RegExp(`<select id="settings-${id}-billing"`));
        assert.match(html, new RegExp(`id="settings-${id}-budget-row"[\\s\\S]*id="settings-${id}-budget"`));
        assert.doesNotMatch(html, /<label class="settings-row-label"/);
    }
});

test('usage settings are read back as their config fields', () => {
    const { context, elements } = usageHarness();
    Object.assign(elements, {
        'settings-claude-usage': { checked: true },
        'settings-claude-billing': { value: 'api' },
        'settings-claude-budget': { value: '200' },
        'settings-codex-usage': { checked: false },
        'settings-codex-billing': { value: '' },
        'settings-codex-budget': { value: 'abc' },
    });
    assert.deepEqual({ ...context.readSettingsUsage() }, {
        show_claude_usage: true, claude_billing: 'api', claude_monthly_budget: 200,
        show_codex_usage: false, codex_billing: '', codex_monthly_budget: 0,
    });
    assert.match(functionSource('saveSettings'), /\.\.\.readSettingsUsage\(\)/);
    assert.match(functionSource('currentSettingsSnapshot'), /usage: readSettingsUsage\(\)/);
});

test('with several providers on, the box opens on the remembered tab and switches', () => {
    const { context, elements, storage, activeTab } = usageHarness({
        config: { show_claude_usage: true, show_codex_usage: true }, stored: 'codex',
    });
    context.renderUsageBox();
    assert.equal(elements['usage-section'].style.display, '');
    assert.equal((elements['usage-tabs'].innerHTML.match(/<button/g) || []).length, 2);
    assert.equal(activeTab(), 'codex');
    assert.doesNotMatch(elements['usage-tabs'].innerHTML, / only/);

    context.selectUsageTab('claude');
    assert.equal(storage.get('usage-active-tab'), 'claude');
    assert.equal(activeTab(), 'claude');
});

test('a single provider shows its tab as a plain title', () => {
    const { context, elements, activeTab } = usageHarness({ config: { show_claude_usage: true }, stored: 'codex' });
    context.renderUsageBox();
    assert.equal(activeTab(), 'claude');
    assert.match(elements['usage-tabs'].innerHTML, /class="usage-tab active only"/);
    context.selectUsageTab('codex');
    assert.equal(activeTab(), 'claude');
});

test('the usage box hides with no provider on', () => {
    const { context, elements } = usageHarness();
    elements['usage-section'].style.display = '';
    context.renderUsageBox();
    assert.equal(elements['usage-section'].style.display, 'none');
});

test('a provider whose CLI is missing gets no tab and cannot be turned on', () => {
    const { context, elements, activeTab } = usageHarness({
        config: { show_claude_usage: true, show_codex_usage: true }, stored: 'codex', installed: { claude: true, openai: false },
    });
    context.renderUsageBox();
    assert.equal(activeTab(), 'claude');
    assert.doesNotMatch(elements['usage-tabs'].innerHTML, /data-usage-tab="codex"/);

    Object.assign(elements, { 'settings-claude-usage': { checked: false }, 'settings-codex-usage': { checked: false } });
    context.settingsCapabilities = context.runtimeCapabilities;
    context.syncSettingsUsageToggles();
    assert.equal(elements['settings-claude-usage'].disabled, false);
    assert.equal(elements['settings-codex-usage'].disabled, true);
    assert.equal(elements['settings-codex-usage'].title, 'Codex CLI is not installed.');
    elements['settings-codex-usage'].checked = true;
    context.syncSettingsUsageToggles();
    assert.equal(elements['settings-codex-usage'].disabled, false);
    assert.match(elements['settings-codex-usage'].title, /You can turn this off/);
});

test('the usage box opens on whichever provider was turned on first', () => {
    const { context, elements, storage } = usageHarness();
    const toggles = { claude: { checked: false }, codex: { checked: false } };
    elements['settings-claude-usage'] = toggles.claude;
    elements['settings-codex-usage'] = toggles.codex;
    const toggle = (id, on) => {
        toggles[id].checked = on;
        context.noteUsageToggle(id, on);
    };
    toggle('codex', true);
    toggle('claude', true);
    assert.equal(storage.get('usage-active-tab'), 'codex');

    // Turning off the default hands it to the one still on.
    toggle('codex', false);
    assert.equal(storage.get('usage-active-tab'), 'claude');
    toggle('claude', false);
    assert.equal(storage.has('usage-active-tab'), false);
});

test('a usage summary is a cost table, or the error', () => {
    const { summary } = usageHarness();
    const html = summary('claude', { periods: [{ key: 'today', total: { cost: 1.5, messages: 3 } }] });
    assert.match(html, /<table class="usage-summary">/);
    assert.match(html, /\$1\.50/);
    assert.match(summary('claude', null, 'boom'), /class="usage-error">boom</);
    assert.match(summary('codex', { periods: [] }), /No usage data/);
});

test('plan windows show the time left until they reset', () => {
    const context = {};
    vm.runInNewContext(['formatUsageDuration', 'formatUsageCountdown'].map(functionSource).join('\n'), context);
    const now = Date.parse('2026-10-04T16:00:00Z');
    const at = minutes => new Date(now + minutes * 60000).toISOString();
    assert.equal(context.formatUsageCountdown(at(45), now), '45m');
    assert.equal(context.formatUsageCountdown(at(2 * 60 + 13), now), '2h 13m');
    assert.equal(context.formatUsageCountdown(at(5 * 60), now), '5h');
    assert.equal(context.formatUsageCountdown(at(3 * 24 * 60 + 4 * 60 + 30), now), '3d 4h');
    assert.equal(context.formatUsageCountdown(at(2 * 24 * 60), now), '2d');
    assert.equal(context.formatUsageCountdown(new Date(now + 20 * 1000).toISOString(), now), '1m');
    assert.equal(context.formatUsageCountdown(at(-1), now), 'now');
    assert.equal(context.formatUsageCountdown('garbage', now), '');
});

test('subscription usage shows a bar per plan window', () => {
    const { summary } = usageHarness();
    const resetsAt = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    const html = summary('codex', { periods: usagePeriods, limits: {
        observed_at: new Date().toISOString(),
        windows: [{ key: 'five_hour', label: '5h', used_percent: 42.5, resets_at: resetsAt },
            { key: 'weekly', label: 'Week', used_percent: 90 }],
    } });
    assert.match(html, /5h/);
    assert.match(html, /width:42\.5%/);
    assert.match(html, /43%/);
    assert.match(html, /usage-limit-bar high/);
    assert.match(html, new RegExp(`data-resets-at="${resetsAt}" title="Resets [^"]+">1h 30m<`));
    assert.doesNotMatch(html, /usage-budget/);
});

test('an old limits reading says how long ago it was taken', () => {
    const { summary } = usageHarness();
    const observedAt = new Date(Date.now() - (20 * 60 + 11) * 60 * 1000).toISOString();
    const html = summary('codex', { periods: usagePeriods, limits: {
        observed_at: observedAt,
        windows: [{ key: 'weekly', label: 'Week', used_percent: 2, resets_at: new Date(Date.now() + 86400000 * 5).toISOString() }],
    } });
    assert.match(html, new RegExp(`data-observed-at="${observedAt}"[^>]*>updated 20h 11m ago<`));
    assert.doesNotMatch(html, /as of/);
});

test('API billing shows the month against the budget instead of plan windows', () => {
    const { summary } = usageHarness({ config: { claude_billing: 'api', claude_monthly_budget: 200 } });
    const html = summary('claude', { periods: usagePeriods, limits: { observed_at: '', windows: [{ key: 'five_hour', label: '5h', used_percent: 10 }] } });
    assert.match(html, /\$108\.00 \/ \$200\.00/);
    assert.match(html, /width:54%/);
    assert.doesNotMatch(html, /usage-limit-label">5h/);
});

test('API billing without a budget shows only the cost table', () => {
    const { summary } = usageHarness({ config: { codex_billing: 'api' } });
    assert.doesNotMatch(summary('codex', { periods: usagePeriods }), /usage-budget|usage-limits/);
});

test('Claude asks for a sign-in when a subscription has no limit data', () => {
    const { summary } = usageHarness();
    assert.match(summary('claude', { periods: usagePeriods }), /Plan limits: open Claude Code to sign in/);
    assert.doesNotMatch(summary('codex', { periods: usagePeriods }), /Plan limits:/);
});

test('Claude plan limits need no status line setup', () => {
    assert.doesNotMatch(indexHtml, /settings-claude-limits/);
    assert.doesNotMatch(source, /limits\/recorder/);
});

test('a period with unpriced models marks its cost as a lower bound', () => {
    const { summary } = usageHarness();
    const html = summary('codex', { periods: [
        { key: 'today', total: { cost: 4.2, messages: 3, unpriced_models: ['gpt-9-nova'] } },
        { key: 'week', total: { cost: 40, messages: 9 } },
        { key: 'month', total: { cost: 108, messages: 30 } },
    ] });
    assert.match(html, /\$4\.20\+/);
    assert.match(html, /No price known for gpt-9-nova/);
    assert.doesNotMatch(html, /\$40\.00\+/);
});

test('project label suggestions list scanned projects and fill in existing labels', () => {
    const options = {
        children: [],
        set innerHTML(_) { this.children = []; },
        appendChild(child) { this.children.push(child); },
    };
    const elements = {
        'settings-tags-project-options': options,
        'settings-tags-project': { value: ' shop-api ' },
        'settings-tags-value': { value: '' },
    };
    const context = {
        projects: [{ name: 'shop-web' }, { name: 'shop-api' }],
        settingsProjectTags: { 'shop-api': ['backend', 'payments'] },
        document: { getElementById: id => elements[id], createElement: () => ({}) },
    };
    vm.runInNewContext(['renderProjectLabelSuggestions', 'prefillProjectLabels'].map(functionSource).join('\n'), context);

    context.renderProjectLabelSuggestions();
    assert.deepEqual(options.children.map(option => [option.value, option.label]), [
        ['shop-api', 'backend, payments'],
        ['shop-web', undefined],
    ]);

    context.prefillProjectLabels();
    assert.equal(elements['settings-tags-value'].value, 'backend, payments');
    // Labels the user has already typed are never overwritten.
    elements['settings-tags-value'].value = 'frontend';
    context.prefillProjectLabels();
    assert.equal(elements['settings-tags-value'].value, 'frontend');

    assert.match(indexHtml, /id="settings-tags-project" list="settings-tags-project-options"/);
    assert.match(indexHtml, /<datalist id="settings-tags-project-options"><\/datalist>/);
});
