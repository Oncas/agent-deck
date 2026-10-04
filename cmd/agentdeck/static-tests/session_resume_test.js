const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Keymap = require('../static/keymap');

const source = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');
const commandID = 'terminal.restartAndResumeSession';

function functionSource(name) {
    const match = new RegExp(`^([ \\t]*)(?:async )?function ${name}\\(`, 'm').exec(source);
    assert.ok(match, `missing function ${name}`);
    const end = source.indexOf('\n' + match[1] + '}\n', match.index);
    assert.ok(end > match.index);
    return source.slice(match.index, end + match[1].length + 3);
}

function harness(tabKey = 'org/project', sessionKey = 'split-pane') {
    const requests = [];
    const focused = [];
    const errors = [];
    const otherPane = { cli: 'openai' };
    const context = {
        activeTab: tabKey, activeProject: null, sessionRestartInFlight: false,
        terminals: { [sessionKey]: { cli: 'openai' }, other: otherPane },
        customCLIIntegrations: [],
        Keymap,
        keymapState: Keymap.normalizeConfig({
            active_keymap_profile: 'custom',
            keymap_profiles: [{ id: 'custom', bindings: { [commandID]: ['Alt+R'] } }],
        }),
        keymapOptions: () => ({ isMacOS: false }),
        sortedProjects: () => [],
        decorateCommandActions: actions => actions,
        getFocusedPaneKey: () => sessionKey,
        normalizeCLI: cli => cli,
        resolveRuntimeCLI: cli => cli,
        fetch: async (url, options) => { requests.push({ url, options }); },
        fetchJSON: async (url, options) => { requests.push({ url, options }); },
        unregisterPane() {}, renderTabs() {}, refreshTerminalContainerLayout() {},
        setTabVisibility() {},
        setFocusedPane: (tab, session) => focused.push([tab, session]),
        createTerminal: (session, options) => { context.terminals[session] = { cli: options.cli }; },
        showToast: (...args) => errors.push(args),
        compactErrorMessage: message => message,
    };
    const names = [
        'canResumeActiveSession', 'restartAndResumeActiveSession', 'restartSessionInTab',
        'restartTerminalSession', 'terminalAPIBase', 'restartProject',
        'commandPaletteActions', 'keymapCommandCatalog', 'keymapActionForEvent',
    ];
    vm.runInNewContext(names.map(functionSource).join('\n'), context);
    return { context, requests, focused, errors, otherPane };
}

for (const tabKey of ['org/project', 'org/project@task']) {
    test(`bound restart and resume touches only the focused session in ${tabKey}`, async () => {
        const { context, requests, focused, otherPane } = harness(tabKey);
        assert.ok(context.keymapCommandCatalog().some(item => item.id === commandID));
        const action = context.keymapActionForEvent({ key: 'r', altKey: true });
        assert.equal(action?.id, commandID);
        await action.run();

        const base = '/api/projects/' + encodeURIComponent(tabKey);
        assert.deepEqual(requests.map(item => item.url), [
            base + '/restart?session=split-pane', base + '/terminal/start',
        ]);
        assert.deepEqual(JSON.parse(requests[1].options.body), {
            session: 'split-pane', cli: 'openai', resume_last: true,
        });
        assert.equal(context.terminals.other, otherPane);
        assert.deepEqual(focused, [[tabKey, 'split-pane']]);
        assert.equal(context.sessionRestartInFlight, false);
    });
}

test('ordinary restart continues to start a fresh focused session', async () => {
    const { context, requests } = harness();
    await context.commandPaletteActions().find(item => item.id === 'terminal.restartSession').run();
    assert.equal(JSON.parse(requests[1].options.body).resume_last, false);
});

test('resume is offered only for a focused provider that supports it', async () => {
    const { context, requests } = harness();
    for (const cli of ['claude', 'cursor', 'gemini', 'custom']) {
        context.terminals['split-pane'].cli = cli;
        assert.equal(context.commandPaletteActions().some(item => item.id === commandID), false);
        await context.restartAndResumeActiveSession();
    }
    assert.equal(requests.length, 0);
    context.customCLIIntegrations = [{ id: 'custom', resume_command: 'custom resume' }];
    await context.commandPaletteActions().find(item => item.id === commandID).run();
    assert.equal(JSON.parse(requests[1].options.body).cli, 'custom');
    assert.equal(JSON.parse(requests[1].options.body).resume_last, true);
    context.terminals['split-pane'].cli = 'opencode';
    assert.equal(context.canResumeActiveSession(), true);
    await context.restartAndResumeActiveSession();
    assert.equal(JSON.parse(requests[3].options.body).cli, 'opencode');
    assert.equal(JSON.parse(requests[3].options.body).resume_last, true);
    context.activeTab = null;
    assert.equal(context.canResumeActiveSession(), false);
});

test('resume blocks duplicate requests and reports failures while releasing the lock', async () => {
    const { context, errors } = harness();
    let rejectStart;
    let restarts = 0;
    context.restartSessionInTab = () => {
        restarts++;
        return new Promise((resolve, reject) => { rejectStart = reject; });
    };
    const resuming = context.restartAndResumeActiveSession();
    await context.restartAndResumeActiveSession();
    assert.equal(restarts, 1);
    rejectStart(new Error('start failed'));
    await resuming;
    assert.equal(context.sessionRestartInFlight, false);
    assert.equal(errors[0][0], 'Session resume failed');
    assert.equal(errors[0][1], 'start failed');
});
