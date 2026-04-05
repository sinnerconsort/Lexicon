/**
 * Lexicon Public API v2.1
 * Exposes a read-only interface for other extensions.
 * Access via: window.LexiconAPI (available after Lexicon init)
 */

import {
    getSettings, getChatState, getCharacterKey, computeNarrativeState,
    getEntryFrequency, getMostFrequentEntries, getEntriesFiredSince,
    getEffectiveSceneType,
} from './state.js';
import { getAllCandidateEntries } from './scanner.js';
import {
    REVEAL_TIERS, NARRATIVE_ACTIONS, NARRATIVE_STATES, REVEAL_TIER_META,
    SCENE_TYPE_META,
} from './config.js';
import { getContext } from '../../../../extensions.js';

// ─── Existing v2 Methods (unchanged) ─────────────────────────────────────────

async function getEntries(filter = {}) {
    const candidates = await getAllCandidateEntries();
    let results = candidates;

    if (filter.scope) {
        results = results.filter(e => e.scope === filter.scope);
    }
    if (filter.revealTier) {
        results = results.filter(e => (e.revealTier || 'background') === filter.revealTier);
    }
    if (filter.category) {
        const cat = filter.category.toLowerCase();
        results = results.filter(e => (e.category || '').toLowerCase() === cat);
    }
    if (filter.enabledOnly !== false) {
        results = results.filter(e => e.enabled !== false);
    }
    // v2.1: filter by scene_type if specified
    if (filter.sceneType) {
        results = results.filter(e =>
            Array.isArray(e.scene_types) && e.scene_types.includes(filter.sceneType)
        );
    }

    return results.map(e => ({ ...e }));
}

async function getBackgroundEntries() {
    return getEntries({ revealTier: REVEAL_TIERS.BACKGROUND });
}

async function getHintableEntries() {
    const candidates = await getAllCandidateEntries();
    return candidates
        .filter(e => {
            const tier = e.revealTier || 'background';
            return (tier === REVEAL_TIERS.FORESHADOW || tier === REVEAL_TIERS.GATED)
                && e.enabled !== false
                && !e.chekhov?.firedAt;
        })
        .map(e => ({
            id: e.id,
            title: e.title,
            hintText: e.hintText || '',
            category: e.category || '',
            revealTier: e.revealTier,
            seedCount: e.chekhov?.seedCount || 0,
            narrativeState: computeNarrativeState(e),
            scene_types: e.scene_types || [],
        }));
}

async function getNarrativeState(entryId) {
    const candidates = await getAllCandidateEntries();
    const entry = candidates.find(e => e.id === entryId);
    if (!entry) return null;

    const chatState = getChatState();
    const action = chatState?.narrativeActions?.[entryId] || null;
    const relevance = chatState?.currentRelevanceScores?.[entryId] || null;

    return {
        narrativeState: computeNarrativeState(entry),
        action,
        relevance,
        seedCount: entry.chekhov?.seedCount || 0,
        firedAt: entry.chekhov?.firedAt || null,
        revealTier: entry.revealTier || 'background',
        scene_types: entry.scene_types || [],
    };
}

async function getLoreContextBlock(maxEntries = 10) {
    const bg = await getBackgroundEntries();
    const hints = await getHintableEntries();

    const parts = [];
    let count = 0;

    for (const e of bg) {
        if (count >= maxEntries) break;
        const content = (e.content || '').substring(0, 300);
        parts.push(`[${e.title || 'Lore'}]: ${content}`);
        count++;
    }

    for (const e of hints) {
        if (count >= maxEntries) break;
        if (e.hintText) {
            parts.push(`[Atmospheric Detail — ${e.title || '???'}]: ${e.hintText}`);
        } else {
            parts.push(`[Atmospheric Detail]: There is something significant about ${e.title || 'this'} that may become relevant...`);
        }
        count++;
    }

    if (!parts.length) return '';
    return parts.join('\n');
}

function isActive() {
    const settings = getSettings();
    return settings?.enabled === true;
}

function getTierMeta() {
    return { ...REVEAL_TIER_META };
}

// ─── v2.1: Injection History Methods ─────────────────────────────────────────

/**
 * Get the injection history log, optionally limited to last N entries.
 * @param {number} [lastN] - Return only the most recent N log entries
 * @returns {Array} Log entries: { entry_id, message_index, action, timestamp }
 */
function getInjectionHistory(lastN) {
    const chatState = getChatState();
    const log = chatState?.injectionHistory?.log || [];
    if (lastN && lastN > 0) return log.slice(-lastN);
    return [...log];
}

/**
 * Get injection frequency for a specific entry.
 * @param {string} entryId
 * @returns {{ count: number, last_injected_msg: number }}
 */
function getEntryFrequencyAPI(entryId) {
    const chatState = getChatState();
    return getEntryFrequency(chatState, entryId);
}

/**
 * Get the top N most frequently injected entries.
 * @param {number} [topN=5]
 * @returns {Array} { entry_id, count, last_injected_msg }
 */
function getMostFrequentEntriesAPI(topN = 5) {
    const chatState = getChatState();
    return getMostFrequentEntries(chatState, topN);
}

/**
 * Get all injection events since a specific message index.
 * @param {number} messageIndex
 * @returns {Array} Log entries
 */
function getEntriesFiredSinceAPI(messageIndex) {
    const chatState = getChatState();
    return getEntriesFiredSince(chatState, messageIndex);
}

// ─── v2.1: Scene Type Methods ────────────────────────────────────────────────

/**
 * Get the current effective scene type (override > detected).
 * @returns {string|null}
 */
function getCurrentSceneType() {
    const chatState = getChatState();
    return getEffectiveSceneType(chatState);
}

/**
 * Get scene type metadata (labels, icons, descriptions).
 * @returns {object}
 */
function getSceneTypeMeta() {
    return { ...SCENE_TYPE_META };
}

/**
 * Get entries filtered by scene type.
 * @param {string} sceneType
 * @returns {Promise<Array>}
 */
async function getEntriesBySceneType(sceneType) {
    return getEntries({ sceneType });
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerAPI() {
    window.LexiconAPI = {
        // v2 (unchanged)
        getEntries,
        getBackgroundEntries,
        getHintableEntries,
        getNarrativeState,
        getLoreContextBlock,
        isActive,
        getTierMeta,
        // v2.1: Injection History
        getInjectionHistory,
        getEntryFrequency: getEntryFrequencyAPI,
        getMostFrequentEntries: getMostFrequentEntriesAPI,
        getEntriesFiredSince: getEntriesFiredSinceAPI,
        // v2.1: Scene Types
        getCurrentSceneType,
        getSceneTypeMeta,
        getEntriesBySceneType,
        // Meta
        version: '2.1.0',
    };
    console.log('[Lexicon] Public API v2.1 registered → window.LexiconAPI');
}

export function unregisterAPI() {
    if (window.LexiconAPI) {
        delete window.LexiconAPI;
        console.log('[Lexicon] Public API unregistered');
    }
}
