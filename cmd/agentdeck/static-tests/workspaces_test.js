const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'static', 'app.js'), 'utf8');

function functionSource(name) {
    const match = new RegExp(`(?:^|\\n)([ \\t]*)(?:async )?function ${name}\\(`).exec(source);
    assert.ok(match, `missing function ${name}`);
    const start = match.index + (source[match.index] === '\n' ? 1 : 0);
    const end = source.indexOf('\n' + match[1] + '}\n', start);
    assert.ok(end > start, `missing end of function ${name}`);
    return source.slice(start, end + match[1].length + 3);
}

test('rapid tracked project changes keep one session and discard stale Git responses', async () => {
    const requests = [];
    const pending = [];
    const rendered = [];
    const workspace = { id: 'one', projects: ['org/a', 'org/b'], active_project: 'org/a' };
    const context = {
        activeTab: 'workspace:one', activeProject: 'org/a', workspaces: [workspace],
        workspaceSaveQueue: Promise.resolve(), gitStatusRequestSeq: 0, gitTrunkDiffView: false, URLSearchParams,
        GIT_STATUS_POLL_INTERVAL_MS: 3000, CONFIG_SAVE_TIMEOUT_MS: 10000,
        isSpecialTab: () => false,
        closeDiffModal() {}, closeBranchDropdown() {}, closeCommitModal() {},
        renderWorkspaceControls() {}, renderProjectList() {}, renderWorkspaceList() {},
        updateDockerSection() {}, updateStatusContext() {},
        setGitStatusPollInterval() {}, resetGitStatusForProject() {},
        showToast() { assert.fail('unexpected error'); },
        renderGitStatus: (status, project) => rendered.push([project, status.branch]),
        fetchJSON(url, options) {
            requests.push({ url, options });
            if (options?.method === 'PATCH') return Promise.resolve(workspace);
            return new Promise(resolve => pending.push(resolve));
        },
    };
    vm.runInNewContext(['isWorkspaceTab', 'workspaceForTab', 'saveWorkspacePatch', 'selectWorkspaceProject', 'refreshWorkspaceGitContext', 'updateGitStatus'].map(functionSource).join('\n'), context);
    const b = context.selectWorkspaceProject('org/b');
    const a = context.selectWorkspaceProject('org/a');
    await Promise.all([b, a]);
    pending[1]({ branch: 'a-branch' });
    pending[0]({ branch: 'b-branch' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(rendered, [['org/a', 'a-branch']]);
    assert.equal(context.activeTab, 'workspace:one');
    assert.equal(context.activeProject, 'org/a');
    assert.deepEqual(requests.filter(request => request.options?.method === 'PATCH').map(request => JSON.parse(request.options.body)), [
        { active_project: 'org/b' }, { active_project: 'org/a' },
    ]);
    assert.ok(requests.every(request => !/terminal|restart|\/ws\//.test(request.url)));
    assert.ok(requests.filter(request => !request.options).every(request => request.url.startsWith('/api/projects/org%2F')));
});

test('workspace diff comments reach the shared terminal with repository context', () => {
    const sent = [];
    const requested = [];
    const context = {
        activeTab: 'workspace:one',
        workspaces: [{ id: 'one', projects: ['org/a', 'org/b@task'] }],
        projectForKey: key => ({ path: '/projects/' + key }),
        getTerminalEntry(key) {
            requested.push(key);
            return { term: { paste: value => sent.push(value) }, connection: { state: 'open', sendInput: () => true } };
        },
        showToast() { assert.fail('unexpected error'); },
    };
    vm.runInNewContext(['isWorkspaceTab', 'workspaceForTab', 'sendDiffCommentToAI'].map(functionSource).join('\n'), context);
    assert.equal(context.sendDiffCommentToAI('org/b@task', 'Explain shared.txt'), true);
    assert.deepEqual(requested, ['workspace:one']);
    assert.equal(sent[0], 'Project: org/b@task\nPath: /projects/org/b@task\nExplain shared.txt');
});

test('removing all tracked projects clears Git state without touching the terminal', () => {
    const elements = {};
    const context = {
        activeTab: 'workspace:one', activeProject: 'org/a', workspaces: [{ id: 'one', projects: [], active_project: '' }],
        gitPollTimer: 42, gitStatusRequestSeq: 0, lastGitHtml: 'previous diff',
        document: { getElementById: id => elements[id] ||= { dataset: {}, innerHTML: '' } },
        clearInterval: () => {},
        setCurrentGitFiles: (project, files, state) => { context.git = { project, files: Array.from(files), state }; },
        setGitRepositoryActionsVisible: visible => { context.gitActions = visible; },
        closeDiffModal() {}, closeBranchDropdown() {}, closeCommitModal() {},
        renderWorkspaceControls() {}, renderProjectList() {}, renderWorkspaceList() {},
        updateDockerSection() {}, updateStatusContext() {},
    };
    vm.runInNewContext(['isWorkspaceTab', 'workspaceForTab', 'showNoProjectGitState', 'refreshWorkspaceGitContext'].map(functionSource).join('\n'), context);
    context.refreshWorkspaceGitContext();
    assert.equal(context.activeTab, 'workspace:one');
    assert.equal(context.activeProject, null);
    assert.deepEqual(context.git, { project: null, files: [], state: 'idle' });
    assert.equal(context.gitActions, false);
    assert.match(elements['git-content'].innerHTML, /Add projects/);
});

test('a stale workspace open keeps its newly started session as a saved background tab', async () => {
    let paneCount = 0;
    let resolveStart;
    const visibility = [];
    let rendered = 0;
    let layouts = 0;
    let refocused = 0;
    const context = {
        activeTab: 'org/current', currentCLI: 'codex', tabSwitchRequestSeq: 1,
        CONFIG_SAVE_TIMEOUT_MS: 10000,
        workspaceForTab: key => key === 'workspace:one' ? { id: 'one', name: 'One' } : null,
        normalizeCLI: cli => cli,
        resolveRuntimeCLI: cli => cli,
        terminalAPIBase: () => '/api/workspaces/one',
        getPaneKeys: () => Array.from({ length: paneCount }, (_, index) => `pane-${index}`),
        fetchJSON: () => new Promise(resolve => { resolveStart = resolve; }),
        createTerminal: () => { paneCount = 1; },
        setTabVisibility: (key, active) => visibility.push([key, active]),
        renderTabs: () => { rendered++; },
        refreshTerminalContainerLayout: () => { layouts++; },
        focusActiveTerminalSoon: () => { refocused++; },
        showToast: () => assert.fail('unexpected error'),
        compactErrorMessage: error => String(error),
    };
    vm.runInNewContext(functionSource('openWorkspaceTab'), context);

    const opening = context.openWorkspaceTab('workspace:one', { requestSeq: 1 });
    context.tabSwitchRequestSeq = 2;
    resolveStart({});
    await opening;

    assert.equal(context.activeTab, 'org/current');
    assert.equal(paneCount, 1);
    assert.deepEqual(visibility, [['workspace:one', false]]);
    assert.equal(rendered, 1);
    assert.equal(layouts, 1);
    assert.equal(refocused, 1);
});

test('workspace dialog Escape contains IME events and delayed terminal focus respects open dialogs', () => {
    const start = source.indexOf("if (isVisibleElement('workspace-modal') && !appDialog)");
    const end = source.indexOf('if (consumeDatabaseAutocompleteEscape(ev))', start);
    assert.ok(start >= 0 && end > start);
    const escapeSection = source.slice(start, end);
    assert.match(escapeSection, /ev\.stopPropagation\(\);\s*if \(ev\.isComposing \|\| ev\.keyCode === 229\) return;\s*ev\.preventDefault\(\);/);

    let focused = 0;
    let modalOpen = false;
    const context = {
        appDialog: {},
        window: { setTimeout: callback => callback() },
        isModalOrOverlayOpen: () => modalOpen,
        focusActiveTerminal: () => { focused++; },
    };
    vm.runInNewContext(functionSource('focusActiveTerminalSoon'), context);
    context.focusActiveTerminalSoon();
    assert.equal(focused, 0);
    context.appDialog = null;
    modalOpen = true;
    context.focusActiveTerminalSoon();
    assert.equal(focused, 0);
    modalOpen = false;
    context.focusActiveTerminalSoon();
    assert.equal(focused, 1);
});

test('Shift-click ranges select, clear, and follow the visible order', () => {
    const context = { workspaceChoiceAnchor: null, workspaceDraftProjects: new Set() };
    vm.runInNewContext(functionSource('toggleWorkspaceChoiceRange'), context);
    const keys = ['a', 'b', 'c', 'd', 'e'];
    const selected = () => [...context.workspaceDraftProjects].sort();

    assert.equal(context.toggleWorkspaceChoiceRange(keys, 'c'), false, 'no anchor yet');
    context.workspaceChoiceAnchor = 'b';
    assert.equal(context.toggleWorkspaceChoiceRange(keys, 'd'), true);
    assert.deepEqual(selected(), ['b', 'c', 'd']);

    // Clicking a ticked row clears the range, including rows already clear.
    context.workspaceChoiceAnchor = 'e';
    context.toggleWorkspaceChoiceRange(keys, 'c');
    assert.deepEqual(selected(), ['b']);

    // Ranges work upwards too.
    context.workspaceChoiceAnchor = 'd';
    context.toggleWorkspaceChoiceRange(keys, 'a');
    assert.deepEqual(selected(), ['a', 'b', 'c', 'd']);

    // With a filter applied, only visible rows change, and a hidden anchor
    // does not extend.
    context.workspaceDraftProjects.clear();
    context.workspaceChoiceAnchor = 'b';
    assert.equal(context.toggleWorkspaceChoiceRange(['a', 'c', 'e'], 'e'), false);
    context.workspaceChoiceAnchor = 'a';
    context.toggleWorkspaceChoiceRange(['a', 'c', 'e'], 'e');
    assert.deepEqual(selected(), ['a', 'c', 'e']);
});

test('Shift-clicking rendered project rows ticks a range and updates the count', () => {
    const element = () => ({
        children: [], dataset: {}, listeners: {},
        append(...items) { this.children.push(...items); },
        appendChild(item) { this.children.push(item); },
        addEventListener(type, listener) { this.listeners[type] = listener; },
    });
    const list = {
        ...element(),
        set innerHTML(_) { this.children = []; },
        querySelectorAll: () => list.children.map(row => row.children[0]),
    };
    const elements = {
        'workspace-project-choices': list,
        'workspace-project-filter': { value: '' },
        'workspace-selected-count': { textContent: '' },
    };
    const context = {
        workspaceChoiceAnchor: null,
        workspaceDraftProjects: new Set(),
        workspaceProjectChoices: () => ['org/a', 'org/b', 'org/b@task', 'org/c'].map(key => ({ key, label: key, path: '' })),
        document: { getElementById: id => elements[id], createElement: element },
        setTimeout: callback => callback(),
    };
    vm.runInNewContext(['updateWorkspaceSelectedCount', 'toggleWorkspaceChoiceRange', 'renderWorkspaceProjectChoices'].map(functionSource).join('\n'), context);
    context.renderWorkspaceProjectChoices();

    // Like a browser: an uncancelled click toggles the box and fires change.
    const click = (index, shiftKey = false) => {
        const row = list.children[index];
        let prevented = false;
        row.listeners.click({ shiftKey, preventDefault() { prevented = true; } });
        if (!prevented) {
            row.children[0].checked = !row.children[0].checked;
            row.children[0].onchange();
        }
        return prevented;
    };
    const ticked = () => list.children.map(row => row.children[0].checked);

    assert.equal(click(0), false);
    assert.equal(click(3, true), true);
    assert.deepEqual(ticked(), [true, true, true, true]);
    assert.equal(elements['workspace-selected-count'].textContent, '4 selected');

    assert.equal(click(1, true), true);
    assert.deepEqual(ticked(), [true, false, false, false]);
    assert.deepEqual([...context.workspaceDraftProjects], ['org/a']);
    assert.equal(elements['workspace-selected-count'].textContent, '1 selected');
});

test('workspace workflow works in the rendered application', { timeout: 60000 }, async t => {
    const repoRoot = path.join(__dirname, '..', '..', '..');
    const binary = path.join(repoRoot, 'electron', 'node_modules', '.bin', 'electron');
    if (!fs.existsSync(binary)) {
        t.skip('Electron is not installed');
        return;
    }
    const output = await new Promise((resolve, reject) => {
        const child = spawn(binary, ['--no-sandbox', '--headless', path.join(repoRoot, 'electron', 'workspaces_browser_test_runner.js')], {
            cwd: repoRoot,
            env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '', stderr = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Workspace browser test timed out\n' + stdout + stderr)); }, 55000);
        child.stdout.on('data', data => { stdout += data; });
        child.stderr.on('data', data => { stderr += data; });
        child.on('error', err => { clearTimeout(timer); reject(err); });
        child.on('close', code => {
            clearTimeout(timer);
            if (code === 0) resolve(stdout);
            else reject(new Error(`Workspace browser test failed (${code})\n${stdout}\n${stderr}`));
        });
    });
    assert.match(output, /WORKSPACE_BROWSER_RESULT ok/);
});
