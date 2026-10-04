(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.AgentDeckKeymap = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DEFAULT_PROFILE_ID = 'default';
    const DEFAULT_PROFILE_NAME = 'Default';

    const COMMON_DEFAULT_BINDINGS = {
        'app.openCommandPalette': ['Primary+Shift+K'],
        'app.openShortcuts': ['Primary+Shift+/'],
        'app.toggleOverview': ['Primary+Shift+O'],
        'app.openJobs': ['Primary+Shift+J'],
        'app.goToProject': ['Primary+Shift+M'],
        'app.toggleSidebar': ['Primary+['],
        'app.toggleRightPanel': ['Primary+]'],
        'app.previousTab': ['Primary+Shift+ArrowLeft'],
        'app.nextTab': ['Primary+Shift+ArrowRight'],
        'project.findInFiles': ['Primary+Shift+F'],
        'project.goToFile': ['Primary+Shift+N'],
        'diff.toggleViewed': ['V'],
        'terminal.splitPane': ['Primary+Shift+T'],
        'terminal.closePaneOrTab': ['Primary+Shift+W', 'Primary+Alt+W'],
        'terminal.restartSession': ['Primary+Shift+R'],
    };

    const MAC_DEFAULT_BINDINGS = {
        'app.openSettings': ['Primary+,'],
    };

    function keymapOptions(options = {}) {
        return {
            isMacOS: !!options.isMacOS,
            primaryLabel: options.primaryLabel || (options.isMacOS ? 'Cmd' : 'Ctrl'),
        };
    }

    function defaultBindings(options = {}) {
        const opts = keymapOptions(options);
        const bindings = cloneBindings(COMMON_DEFAULT_BINDINGS);
        if (opts.isMacOS) {
            Object.assign(bindings, cloneBindings(MAC_DEFAULT_BINDINGS));
        }
        return bindings;
    }

    function defaultProfile(options = {}) {
        return {
            id: DEFAULT_PROFILE_ID,
            name: DEFAULT_PROFILE_NAME,
            bindings: defaultBindings(options),
        };
    }

    function cloneBindings(bindings) {
        if (!bindings || typeof bindings !== 'object') return {};
        const next = {};
        Object.entries(bindings).forEach(([commandID, shortcuts]) => {
            if (!commandID) return;
            const values = Array.isArray(shortcuts) ? shortcuts : [];
            next[commandID] = [...new Set(values.map(value => normalizeShortcut(value)).filter(Boolean))];
        });
        return next;
    }

    function cloneProfile(profile) {
        return {
            id: profile.id,
            name: profile.name,
            bindings: cloneBindings(profile.bindings),
        };
    }

    function cloneState(state) {
        const normalized = normalizeConfig({
            keymap_profiles: state && state.profiles,
            active_keymap_profile: state && state.activeProfileID,
        });
        return {
            activeProfileID: normalized.activeProfileID,
            profiles: normalized.profiles.map(cloneProfile),
        };
    }

    function mergeDefaultProfileBindings(profile, options = {}) {
        if (!profile || profile.id !== DEFAULT_PROFILE_ID) return profile;
        return {
            ...profile,
            name: profile.name || DEFAULT_PROFILE_NAME,
            bindings: {
                ...defaultBindings(options),
                ...cloneBindings(profile.bindings),
            },
        };
    }

    function normalizeConfig(cfg = {}, options = {}) {
        const opts = keymapOptions(options);
        const rawProfiles = Array.isArray(cfg.keymap_profiles) ? cfg.keymap_profiles : [];
        const profiles = [];
        const seen = new Set();

        rawProfiles.forEach((profile) => {
            if (!profile || typeof profile !== 'object') return;
            const id = String(profile.id || '').trim();
            if (!id || seen.has(id)) return;
            seen.add(id);
            profiles.push(mergeDefaultProfileBindings({
                id,
                name: String(profile.name || id).trim() || id,
                bindings: cloneBindings(profile.bindings),
            }, opts));
        });

        if (!seen.has(DEFAULT_PROFILE_ID)) {
            profiles.unshift(defaultProfile(opts));
            seen.add(DEFAULT_PROFILE_ID);
        }

        const activeProfileID = seen.has(cfg.active_keymap_profile)
            ? cfg.active_keymap_profile
            : DEFAULT_PROFILE_ID;

        return {
            activeProfileID,
            profiles,
        };
    }

    function serializeState(state) {
        const normalized = normalizeConfig({
            keymap_profiles: state && state.profiles,
            active_keymap_profile: state && state.activeProfileID,
        });
        return {
            active_keymap_profile: normalized.activeProfileID,
            keymap_profiles: normalized.profiles.map(cloneProfile),
        };
    }

    function activeProfile(state) {
        const normalized = normalizeConfig({
            keymap_profiles: state && state.profiles,
            active_keymap_profile: state && state.activeProfileID,
        });
        return normalized.profiles.find(profile => profile.id === normalized.activeProfileID) || normalized.profiles[0];
    }

    function commandShortcuts(state, commandID) {
        if (!commandID) return [];
        const profile = activeProfile(state);
        const shortcuts = profile && profile.bindings ? profile.bindings[commandID] : [];
        return Array.isArray(shortcuts) ? shortcuts : [];
    }

    function commandShortcutLabel(state, commandID, options = {}) {
        return commandShortcuts(state, commandID)
            .map(shortcut => shortcutLabel(shortcut, options))
            .filter(Boolean)
            .join(' / ');
    }

    function hasPrimaryModifier(ev, options = {}) {
        return keymapOptions(options).isMacOS ? !!ev.metaKey : !!ev.ctrlKey;
    }

    function normalizeKeyName(key) {
        if (key == null) return '';
        const raw = String(key).trim();
        if (!raw) return '';
        const lower = raw.toLowerCase();
        const aliases = {
            ' ': 'Space',
            'spacebar': 'Space',
            'space': 'Space',
            'esc': 'Escape',
            'escape': 'Escape',
            'return': 'Enter',
            'enter': 'Enter',
            'arrowleft': 'ArrowLeft',
            'left': 'ArrowLeft',
            'arrowright': 'ArrowRight',
            'right': 'ArrowRight',
            'arrowup': 'ArrowUp',
            'up': 'ArrowUp',
            'arrowdown': 'ArrowDown',
            'down': 'ArrowDown',
            'plus': '+',
            'comma': ',',
            'period': '.',
            'slash': '/',
            'backslash': '\\',
            '?': '/',
        };
        if (aliases[lower]) return aliases[lower];
        if (/^f\d{1,2}$/i.test(raw)) return raw.toUpperCase();
        if (raw.length === 1 && /[a-z]/i.test(raw)) return raw.toUpperCase();
        return raw;
    }

    function keyNameFromEvent(ev) {
        const key = normalizeKeyName(ev && ev.key);
        if (key && key !== 'Process' && key !== 'Unidentified') return key;

        const code = String((ev && ev.code) || '');
        const codeAliases = {
            Space: 'Space',
            Comma: ',',
            Period: '.',
            Slash: '/',
            Backslash: '\\',
            Semicolon: ';',
            Quote: "'",
            BracketLeft: '[',
            BracketRight: ']',
            Backquote: '`',
            Minus: '-',
            Equal: '=',
            NumpadAdd: '+',
            NumpadSubtract: '-',
            NumpadMultiply: '*',
            NumpadDivide: '/',
            NumpadDecimal: '.',
        };
        if (/^Key[A-Z]$/.test(code)) return code.slice(3);
        if (/^Digit[0-9]$/.test(code)) return code.slice(5);
        if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
        if (/^F\d{1,2}$/.test(code)) return code;
        return normalizeKeyName(codeAliases[code] || '');
    }

    function parseShortcut(shortcut) {
        const value = String(shortcut || '').trim();
        if (!value) return null;
        const rawParts = value.split('+').map(part => part.trim()).filter(Boolean);
        if (rawParts.length === 0) return null;

        const spec = {
            primary: false,
            ctrl: false,
            meta: false,
            shift: false,
            alt: false,
            key: '',
        };

        rawParts.forEach((part) => {
            const lower = part.toLowerCase();
            if (lower === 'primary' || lower === 'cmdorctrl' || lower === 'mod') {
                spec.primary = true;
            } else if (lower === 'ctrl' || lower === 'control') {
                spec.ctrl = true;
            } else if (lower === 'cmd' || lower === 'command' || lower === 'meta' || lower === 'super') {
                spec.meta = true;
            } else if (lower === 'shift') {
                spec.shift = true;
            } else if (lower === 'alt' || lower === 'option') {
                spec.alt = true;
            } else {
                spec.key = normalizeKeyName(part);
            }
        });

        if (!spec.key) return null;
        return spec;
    }

    function normalizeShortcut(shortcut) {
        const spec = parseShortcut(shortcut);
        if (!spec) return '';
        const parts = [];
        if (spec.primary) parts.push('Primary');
        if (spec.ctrl) parts.push('Ctrl');
        if (spec.meta) parts.push('Meta');
        if (spec.shift) parts.push('Shift');
        if (spec.alt) parts.push('Alt');
        parts.push(spec.key);
        return parts.join('+');
    }

    function shortcutLabel(shortcut, options = {}) {
        const spec = parseShortcut(shortcut);
        if (!spec) return '';
        const opts = keymapOptions(options);
        const parts = [];
        if (spec.primary) parts.push(opts.primaryLabel);
        if (spec.ctrl) parts.push('Ctrl');
        if (spec.meta) parts.push(opts.isMacOS ? 'Cmd' : 'Meta');
        if (spec.shift) parts.push('Shift');
        if (spec.alt) parts.push('Alt');
        parts.push(spec.key);
        return parts.join('+');
    }

    function shortcutFromEvent(ev, options = {}) {
        const key = keyNameFromEvent(ev);
        if (!key || ['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return '';
        const opts = keymapOptions(options);
        const parts = [];
        if (opts.isMacOS ? ev.metaKey : ev.ctrlKey) parts.push('Primary');
        else if (ev.ctrlKey) parts.push('Ctrl');
        else if (ev.metaKey) parts.push('Meta');
        if (ev.shiftKey) parts.push('Shift');
        if (ev.altKey) parts.push('Alt');
        parts.push(key);
        return parts.join('+');
    }

    function eventMatchesShortcut(shortcut, ev, options = {}) {
        const spec = parseShortcut(shortcut);
        if (!spec) return false;
        const opts = keymapOptions(options);
        const primaryDown = opts.isMacOS ? !!ev.metaKey : !!ev.ctrlKey;
        if (spec.primary && !primaryDown) return false;
        if (spec.ctrl !== (!spec.primary && !!ev.ctrlKey)) return false;
        if (spec.meta !== (!spec.primary && !!ev.metaKey)) return false;
        if (spec.shift !== !!ev.shiftKey) return false;
        if (spec.alt !== !!ev.altKey) return false;
        return keyNameFromEvent(ev) === spec.key;
    }

    function eventMatchesCommand(state, commandID, ev, options = {}) {
        return commandShortcuts(state, commandID).some(shortcut => eventMatchesShortcut(shortcut, ev, options));
    }

    function isPotentialShortcutEvent(ev) {
        if (!ev) return false;
        const key = keyNameFromEvent(ev);
        if (!key || ['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return false;
        return !!(ev.ctrlKey || ev.metaKey || ev.altKey || /^F\d{1,2}$/.test(key));
    }

    function makeProfileID(name, existingIDs = []) {
        const base = String(name || 'profile')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'profile';
        const used = new Set(existingIDs);
        if (!used.has(base)) return base;
        let idx = 2;
        while (used.has(`${base}-${idx}`)) idx++;
        return `${base}-${idx}`;
    }

    return {
        DEFAULT_PROFILE_ID,
        DEFAULT_PROFILE_NAME,
        defaultBindings,
        defaultProfile,
        normalizeConfig,
        serializeState,
        cloneState,
        cloneBindings,
        activeProfile,
        commandShortcuts,
        commandShortcutLabel,
        normalizeShortcut,
        shortcutLabel,
        shortcutFromEvent,
        eventMatchesShortcut,
        eventMatchesCommand,
        isPotentialShortcutEvent,
        hasPrimaryModifier,
        makeProfileID,
    };
});
