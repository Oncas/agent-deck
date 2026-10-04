(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.TerminalInteractions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function normalizeExternalUrl(url) {
        if (typeof url !== 'string') return '';
        const trimmed = url.trim();
        if (!trimmed) return '';
        try {
            const parsed = new URL(trimmed);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
            return parsed.toString();
        } catch (_) {
            return '';
        }
    }

    async function openExternalUrl(url, deps = {}) {
        const safeUrl = normalizeExternalUrl(url);
        const notifyFn = typeof deps.notify === 'function'
            ? deps.notify
            : (typeof deps.alert === 'function' ? deps.alert : null);
        const logError = deps.console && typeof deps.console.error === 'function'
            ? deps.console.error.bind(deps.console)
            : null;

        if (!safeUrl) {
            if (notifyFn) notifyFn(`Invalid external link.\n\n${url || ''}`);
            return { ok: false, error: 'Invalid URL' };
        }

        if (typeof deps.electronOpenExternal === 'function') {
            try {
                const result = await deps.electronOpenExternal(safeUrl);
                if (result && result.ok) return { ok: true };
                const message = (result && result.error) || 'Unable to open external link.';
                if (logError) logError('Failed to open external URL:', safeUrl, message);
                if (notifyFn) notifyFn(`${message}\n\n${safeUrl}`);
                return { ok: false, error: message };
            } catch (err) {
                const message = (err && err.message) || 'Unable to open external link.';
                if (logError) logError('Failed to open external URL:', safeUrl, err);
                if (notifyFn) notifyFn(`${message}\n\n${safeUrl}`);
                return { ok: false, error: message };
            }
        }

        const openWindow = typeof deps.openWindow === 'function' ? deps.openWindow : null;
        if (!openWindow) {
            if (notifyFn) notifyFn(`Unable to open external link.\n\n${safeUrl}`);
            return { ok: false, error: 'No opener available' };
        }

        const opened = openWindow(safeUrl, '_blank', 'noopener,noreferrer');
        if (!opened) {
            if (notifyFn) notifyFn(`Unable to open external link.\n\n${safeUrl}`);
            return { ok: false, error: 'Popup blocked' };
        }
        return { ok: true };
    }

    function findTerminalLinks(buf, rowIndex, cols) {
        // Check if a row's last cell has a non-space character (line fills to edge)
        function filledToEdge(row) {
            const line = buf.getLine(row);
            if (!line) return false;
            const cell = line.getCell(cols - 1);
            return cell && cell.getChars() !== '' && cell.getChars() !== ' ';
        }

        // Get trimmed text from a row
        function getRowText(row) {
            const line = buf.getLine(row);
            return line ? line.translateToString(true) : '';
        }

        // Try to extend a URL across program-inserted line breaks.
        // Returns { url, endRow, endCol } with the extended URL and its end position.
        function extendUrl(url, fromRow) {
            let extUrl = url;
            let extEndRow = fromRow;
            let extEndCol = -1;
            let peekRow = fromRow + 1;
            while (peekRow < buf.length && filledToEdge(peekRow - 1)) {
                if (buf.getLine(peekRow)?.isWrapped) break;
                const rawText = getRowText(peekRow);
                const stripped = rawText.replace(/^\s+/, '');
                const leadingWs = rawText.length - stripped.length;
                // Stop if empty, or if it starts a new URL scheme
                if (!stripped || /^https?:\/\//.test(stripped)) break;
                const cont = stripped.match(/^[^\s'"\]>)}\x00-\x1f]+/);
                if (!cont) break;
                extUrl += cont[0];
                extEndRow = peekRow;
                extEndCol = leadingWs + cont[0].length - 1;
                // The URL only spills onto a further row if it ran to this row's edge.
                if (extEndCol < cols - 1) break;
                peekRow++;
            }
            return { url: extUrl, endRow: extEndRow, endCol: extEndCol };
        }

        // Walk backwards through wrapped lines
        let startRow = rowIndex;
        while (startRow > 0 && buf.getLine(startRow)?.isWrapped) {
            startRow--;
        }
        let endRow = rowIndex;
        while (endRow < buf.length - 1 && buf.getLine(endRow + 1)?.isWrapped) {
            endRow++;
        }

        // Build full logical line text
        let fullText = '';
        for (let r = startRow; r <= endRow; r++) {
            const line = buf.getLine(r);
            if (!line) continue;
            const lineText = line.translateToString(false);
            fullText += r < endRow ? lineText.substring(0, cols) : lineText;
        }

        // Find all URLs in the logical line
        const urlRe = /https?:\/\/[^\s'"\]>)}\x00-\x1f]+/g;
        let match;
        const links = [];
        while ((match = urlRe.exec(fullText)) !== null) {
            let url = match[0];
            const urlStart = match.index;
            const urlTextEnd = urlStart + url.length;

            // Try extending across program-inserted line breaks
            let extEndRow = -1, extEndCol = -1;
            const trimmedEnd = fullText.trimEnd().length;
            if (urlTextEnd >= trimmedEnd) {
                const ext = extendUrl(url, endRow);
                url = ext.url;
                extEndRow = ext.endRow;
                extEndCol = ext.endCol;
            }

            // Check if this URL is visible on the hovered row
            const rowOffsetStart = (rowIndex - startRow) * cols;
            const rowOffsetEnd = rowOffsetStart + cols;
            const onOriginalRows = urlTextEnd > rowOffsetStart && urlStart < rowOffsetEnd;
            if (!onOriginalRows) continue;

            // Compute link range
            const linkStartRow = startRow + Math.floor(urlStart / cols);
            const linkStartCol = urlStart % cols;
            let linkEndRow, linkEndCol;
            if (extEndCol >= 0 && extEndRow > endRow) {
                linkEndRow = extEndRow;
                linkEndCol = extEndCol;
            } else {
                linkEndRow = startRow + Math.floor((urlTextEnd - 1) / cols);
                linkEndCol = (urlTextEnd - 1) % cols;
            }

            links.push({
                url: url,
                range: {
                    start: { x: linkStartCol + 1, y: linkStartRow + 1 },
                    end: { x: linkEndCol + 1, y: linkEndRow + 1 },
                },
            });
        }

        // Backward check: if hovering a continuation line with no URL scheme,
        // walk back through previous logical lines to find a URL that extends
        // into this row (handles URLs spanning 3+ program-inserted line breaks).
        if (links.length === 0) {
            let scanEnd = startRow - 1;
            while (scanEnd >= 0 && links.length === 0) {
                let scanStart = scanEnd;
                while (scanStart > 0 && buf.getLine(scanStart)?.isWrapped) {
                    scanStart--;
                }
                if (!filledToEdge(scanEnd)) break;
                let prevText = '';
                for (let r = scanStart; r <= scanEnd; r++) {
                    const line = buf.getLine(r);
                    if (!line) continue;
                    const lineText = line.translateToString(false);
                    prevText += r < scanEnd ? lineText.substring(0, cols) : lineText;
                }
                const tailMatch = prevText.match(/https?:\/\/[^\s'"\]>)}\x00-\x1f]+$/);
                if (tailMatch) {
                    const ext = extendUrl(tailMatch[0], scanEnd);
                    if (ext.endRow >= rowIndex) {
                        const urlStartInPrev = tailMatch.index;
                        const prevCols = cols;
                        const sRow = scanStart + Math.floor(urlStartInPrev / prevCols);
                        const sCol = urlStartInPrev % prevCols;
                        links.push({
                            url: ext.url,
                            range: {
                                start: { x: sCol + 1, y: sRow + 1 },
                                end: { x: ext.endCol + 1, y: ext.endRow + 1 },
                            },
                        });
                    }
                }
                scanEnd = scanStart - 1;
            }
        }

        return links;
    }

    const SHELL_SPECIAL = /(["'`\\$&|;<>()\[\]{}*?!#~ \t])/g;

    function escapeDroppedPath(path) {
        return path.replace(SHELL_SPECIAL, '\\$1');
    }

    function pathFromFileUri(uri) {
        if (typeof uri !== 'string') return '';
        const trimmed = uri.trim();
        if (!/^file:\/\//i.test(trimmed)) return '';
        try {
            const parsed = new URL(trimmed);
            if (parsed.hostname && parsed.hostname !== 'localhost') return '';
            return decodeURIComponent(parsed.pathname);
        } catch (_) {
            return '';
        }
    }

    function parseUriList(uriList) {
        if (typeof uriList !== 'string') return [];
        return uriList
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(pathFromFileUri)
            .filter(Boolean);
    }

    function buildDropInsertion(payload = {}) {
        const paths = Array.isArray(payload.paths) ? payload.paths : [];
        const usable = paths
            .filter(path => typeof path === 'string')
            .map(path => path.trim())
            .filter(path => path && !/[\r\n]/.test(path));
        if (usable.length) return usable.map(escapeDroppedPath).join(' ');
        if (paths.length) return '';
        return typeof payload.text === 'string' ? payload.text : '';
    }

    const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number', '']);

    // Whether the browser should keep handling a drop itself, so dragging text
    // into a form field still works while file drops stay blocked everywhere.
    function acceptsTextDrop(target, types, uriList) {
        if (!target) return false;
        const offered = Array.from(types || []);
        if (offered.includes('Files')) return false;
        if (offered.includes('text/uri-list') && parseUriList(uriList).length) return false;
        if (target.isContentEditable) return true;
        if (target.disabled || target.readOnly) return false;
        const tag = (target.tagName || '').toUpperCase();
        if (tag === 'TEXTAREA') return true;
        if (tag === 'INPUT') return TEXT_INPUT_TYPES.has((target.type || 'text').toLowerCase());
        return false;
    }

    function getTerminalContextMenuItems(state = {}) {
        const hasSelection = !!state.hasSelection;
        const selectedUrl = normalizeExternalUrl(state.selection || '');
        const canPaste = state.canPaste !== false;
        return [
            { action: 'copy', label: 'Copy', enabled: hasSelection },
            { action: 'paste', label: 'Paste', enabled: canPaste },
            { action: 'select-all', label: 'Select All', enabled: true },
            { action: 'open-selected-link', label: 'Open Selected Link', enabled: !!selectedUrl, url: selectedUrl },
        ];
    }

    return {
        normalizeExternalUrl,
        findTerminalLinks,
        openExternalUrl,
        getTerminalContextMenuItems,
        escapeDroppedPath,
        pathFromFileUri,
        parseUriList,
        buildDropInsertion,
        acceptsTextDrop,
    };
});
