import { getSettings } from './state.js';
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
    const paths = [
        '../../../../scripts/world-info.js',
        '../../../world-info.js',
    ];

    for (const path of paths) {
        try {
            const mod = await import(path);
            const wi = mod.world_info ?? mod.default;
            if (!wi) continue;

            let rawEntries = [];
            if (Array.isArray(wi)) {
                rawEntries = wi;
            } else if (wi.entries && typeof wi.entries === 'object') {
                rawEntries = Object.values(wi.entries);
            } else if (typeof wi === 'object') {
                rawEntries = Object.values(wi);
            }

            if (!rawEntries.length) continue;

            const mapped = rawEntries
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
                    // v2: Default narrative fields for lorebook entries
                    revealTier: REVEAL_TIERS.BACKGROUND,
                    hintText: '',
                    gateConditions: [],
                    chekhov: { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null },
                    narrativeState: NARRATIVE_STATES.DORMANT,
                }));

            if (mapped.length > 0) {
                console.log(`[Lexicon] Lorebook bridge: loaded ${mapped.length} entries from ${path}`);
                return mapped;
            }
        } catch {
            // Try next path
        }
    }

    return [];
}

export function clearLorebookCache() {
    lorebookCache = null;
    lorebookCacheTime = 0;
}
