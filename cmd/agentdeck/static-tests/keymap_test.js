const assert = require('node:assert/strict');
const test = require('node:test');

const Keymap = require('../static/keymap');

test('defaults expose the Default profile with platform shortcuts', () => {
    const state = Keymap.normalizeConfig({}, { isMacOS: false });
    const profile = Keymap.activeProfile(state);

    assert.equal(profile.id, Keymap.DEFAULT_PROFILE_ID);
    assert.equal(profile.name, 'Default');
    assert.deepEqual(profile.bindings['app.openCommandPalette'], ['Primary+Shift+K']);
    assert.deepEqual(profile.bindings['app.openJobs'], ['Primary+Shift+J']);
    assert.deepEqual(profile.bindings['diff.toggleViewed'], ['V']);
    assert.equal(profile.bindings['app.openGitHubDashboard'], undefined);
    assert.equal(profile.bindings['app.openAgentsDashboard'], undefined);
    assert.equal(Keymap.commandShortcutLabel(state, 'app.openCommandPalette', { primaryLabel: 'Ctrl' }), 'Ctrl+Shift+K');
});

test('plain contextual shortcuts match without becoming global app shortcuts', () => {
    const state = Keymap.normalizeConfig({}, { isMacOS: false });
    const ev = { key: 'v', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };

    assert.equal(Keymap.eventMatchesCommand(state, 'diff.toggleViewed', ev, { isMacOS: false }), true);
    assert.equal(Keymap.isPotentialShortcutEvent(ev), false);
});

test('shifted slash matches keyboard event for shortcuts modal', () => {
    const state = Keymap.normalizeConfig({}, { isMacOS: false });
    const ev = { key: '/', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false };

    assert.equal(Keymap.eventMatchesCommand(state, 'app.openShortcuts', ev, { isMacOS: false }), true);
});

test('explicit ctrl shortcuts match non-mac events', () => {
    const ev = { key: 'k', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false };

    assert.equal(Keymap.eventMatchesShortcut('Ctrl+Shift+K', ev, { isMacOS: false }), true);
});

test('shortcut capture falls back to event code for composed key events', () => {
    const ev = { key: 'Process', code: 'KeyU', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false };

    assert.equal(Keymap.shortcutFromEvent(ev, { isMacOS: false }), 'Primary+Shift+U');
    assert.equal(Keymap.eventMatchesShortcut('Primary+Shift+U', ev, { isMacOS: false }), true);
});

test('serialization preserves custom profiles', () => {
    const state = Keymap.normalizeConfig({
        active_keymap_profile: 'vim',
        keymap_profiles: [
            {
                id: 'vim',
                name: 'Vim profile',
                bindings: {
                    'app.openCommandPalette': ['Alt+P'],
                    'terminal.closePaneOrTab': ['Primary+W'],
                },
            },
        ],
    });

    const serialized = Keymap.serializeState(state);

    assert.equal(serialized.active_keymap_profile, 'vim');
    assert.equal(serialized.keymap_profiles.length, 2);
    assert.deepEqual(serialized.keymap_profiles.find(profile => profile.id === 'vim').bindings, {
        'app.openCommandPalette': ['Alt+P'],
        'terminal.closePaneOrTab': ['Primary+W'],
    });
});
