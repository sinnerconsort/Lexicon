import { getSettings } from './state.js';
import { getContext } from '../../../../extensions.js';
import { REVEAL_TIERS, NARRATIVE_STATES } from './config.js';

let lorebookCache = null;
let lorebookCacheTime = 0;
const CACHE_TTL = 10000;

export let lorebookStatus = 'unknown';

export async function getLorebookEntries() {
    const settings = getSettings();
    if (!settings.bridgeLorebooks) {
        lorebookStatus = 'disabled';
        return [];
    }

    if (lorebookCache && (Date.now() - lorebookCacheTime) < CACHE_TTL) {
        return lorebookCache;
    }

    const entries = await tryReadWorldInfo();
    lorebookCache = entries;
    lorebookCacheTime = Date.now();
    lorebookStatus = entries.length > 0 ? 'ok' : 'unavailable';
    return entries;
}

async function tryReadWorldInfo() {

    // Method 1: Context API — most version-safe
    try {
        const ctx = getContext();
        const wi = ctx?.worldInfo || ctx?.world_info;
        if (wi) {
            const entries = extractWorldInfoEntries(wi);
            if (entries.length > 0) {
                console.log(`[Lexicon] Lorebook bridge: ${entries.length} entries via context`);
                return entries;
            }
        }
    } catch (e) {
        console.warn('[Lexicon] Lorebook context method failed:', e.message);
    }

    // Method 2: Dynamic import — try multiple paths
    // From src/lorebook.js the tree is:
    //   scripts/extensions/third-party/Lexicon/src/lorebook.js
    //   scripts/world-info.js  ← target (4 levels up)
    const paths = [
        '../../../../world-info.js',
        '../../../../../scripts/world-info.js',
        '../../../../scripts/world-info.js',
        '../../../world-info.js',
    ];

    for (const path of paths) {
        try {
            const mod = await import(path);
            const wi = mod.world_info ?? mod.default;
            if (!wi) continue;
            const entries = extractWorldInfoEntries(wi);
            if (entries.length > 0) {
                console.log(`[Lexicon] Lorebook bridge: ${entries.length} entries from ${path}`);
                return entries;
            }
        } catch {
            // Try next path
        }
    }

    // Method 3: Fetch from ST API
    try {
        const headers = {};
        try {
            const { getRequestHeaders } = await import('../../../../../script.js');
            Object.assign(headers, getRequestHeaders());
        } catch {
            headers['Content-Type'] = 'application/json';
        }
        const response = await fetch('/api/worldinfo/get', { method: 'POST', headers, body: JSON.stringify({}) });
        if (response.ok) {
            const data = await response.json();
            if (data) {
                const entries = extractWorldInfoEntries(data);
                if (entries.length > 0) {
                    console.log(`[Lexicon] Lorebook bridge: ${entries.length} entries via fetch API`);
                    return entries;
                }
            }
        }
    } catch {
        // No API route available
    }

    return [];
}

function extractWorldInfoEntries(wi) {
    let rawEntries = [];
    if (Array.isArray(wi)) {
        rawEntries = wi;
    } else if (wi.entries && typeof wi.entries === 'object') {
        rawEntries = Object.values(wi.entries);
    } else if (typeof wi === 'object') {
        rawEntries = Object.values(wi).filter(v => v && typeof v === 'object' && v.content);
    }

    return rawEntries
        .filter(e => e && e.content && !e.disable && !e.disabled)
        .map(e => ({
            id: `lb_${e.uid ?? e.id ?? Math.random().toString(36).substr(2, 6)}`,
            title: e.comment || (Array.isArray(e.key) ? e.key[0] : e.key) || 'Lorebook Entry',
            content: e.content,
            category: 'Lorebook',
            pinned: e.constant || false,
            relatedIds: [],
            scope: 'global',
            enabled: true,
            fromLorebook: true,
            lorebookKey: Array.isArray(e.key) ? e.key : [e.key].filter(Boolean),
            revealTier: REVEAL_TIERS.BACKGROUND,
            hintText: '',
            gateConditions: [],
            chekhov: { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null },
            narrativeState: NARRATIVE_STATES.DORMANT,
        }));
}

export function clearLorebookCache() {
    lorebookCache = null;
    lorebookCacheTime = 0;
}
