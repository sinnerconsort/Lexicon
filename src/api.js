/**
 * Lexicon Public API
 * Exposes a lightweight read-only interface for other extensions.
 * Access via: window.LexiconAPI (available after Lexicon init)
 *
 * Usage from another extension (e.g. Spark):
 *   if (window.LexiconAPI) {
 *       const lore = window.LexiconAPI.getBackgroundEntries();
 *       const hints = window.LexiconAPI.getHintableEntries();
 *   }
 */

import { getSettings, getChatState, getCharacterKey, computeNarrativeState } from './state.js';
import { getAllCandidateEntries } from './scanner.js';
import {
    REVEAL_TIERS, NARRATIVE_ACTIONS, NARRATIVE_STATES, REVEAL_TIER_META,
} from './config.js';
import { getContext } from '../../../extensions.js';

/**
 * Get all active entries, optionally filtered.
 * @param {object} [filter] - Optional filter object
 * @param {string} [filter.scope] - 'global' | 'character' | 'chat'
 * @param {string} [filter.revealTier] - 'background' | 'foreshadow' | 'gated' | 'twist'
 * @param {string} [filter.category] - Entry category string
 * @param {boolean} [filter.enabledOnly] - Only return enabled entries (default: true)
 * @returns {Promise<Array>} Filtered entry objects (cloned, safe to mutate)
 */
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

    // Return clones so consumers can't mutate our state
    return results.map(e => ({ ...e }));
}

/**
 * Get entries safe to openly reference — background tier only.
 * Ideal for Spark scenario hooks that should use lore without spoiling.
 * @returns {Promise<Array>}
 */
async function getBackgroundEntries() {
    return getEntries({ revealTier: REVEAL_TIERS.BACKGROUND });
}

/**
 * Get entries suitable for atmospheric hints — foreshadow + gated (not yet met).
 * Returns a simplified shape: { id, title, hintText, category, revealTier, seedCount }.
 * Full content is intentionally withheld so consuming extensions can't accidentally reveal.
 * @returns {Promise<Array>}
 */
async function getHintableEntries() {
    const candidates = await getAllCandidateEntries();
    return candidates
        .filter(e => {
            const tier = e.revealTier || 'background';
            return (tier === REVEAL_TIERS.FORESHADOW || tier === REVEAL_TIERS.GATED)
                && e.enabled !== false
                && !e.chekhov?.firedAt; // Not yet fully revealed
        })
        .map(e => ({
            id: e.id,
            title: e.title,
            hintText: e.hintText || '',
            category: e.category || '',
            revealTier: e.revealTier,
            seedCount: e.chekhov?.seedCount || 0,
            narrativeState: computeNarrativeState(e),
        }));
}

/**
 * Get the narrative state of a specific entry.
 * @param {string} entryId
 * @returns {Promise<object|null>} { narrativeState, action, relevance, seedCount, firedAt }
 */
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
    };
}

/**
 * Get a compact lore summary block suitable for prompt injection.
 * Returns background entries as full text + hintable entries as hint-only text.
 * Designed for extensions like Spark that want a ready-to-use lore context block.
 * @param {number} [maxEntries=10] - Max total entries to include
 * @returns {Promise<string>} Formatted lore block
 */
async function getLoreContextBlock(maxEntries = 10) {
    const bg = await getBackgroundEntries();
    const hints = await getHintableEntries();

    const parts = [];
    let count = 0;

    // Background entries: full content (truncated)
    for (const e of bg) {
        if (count >= maxEntries) break;
        const content = (e.content || '').substring(0, 300);
        parts.push(`[${e.title || 'Lore'}]: ${content}`);
        count++;
    }

    // Hintable entries: hint text only (no full content exposed)
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

/**
 * Check if Lexicon is enabled and active.
 * @returns {boolean}
 */
function isActive() {
    const settings = getSettings();
    return settings?.enabled === true;
}

/**
 * Get available tier metadata (labels, icons, colors).
 * Useful for extensions that want to render Lexicon-style tier badges.
 * @returns {object}
 */
function getTierMeta() {
    return { ...REVEAL_TIER_META };
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerAPI() {
    window.LexiconAPI = {
        getEntries,
        getBackgroundEntries,
        getHintableEntries,
        getNarrativeState,
        getLoreContextBlock,
        isActive,
        getTierMeta,
        version: '2.0.0',
    };
    console.log('[Lexicon] Public API registered → window.LexiconAPI');
}

export function unregisterAPI() {
    if (window.LexiconAPI) {
        delete window.LexiconAPI;
        console.log('[Lexicon] Public API unregistered');
    }
}
