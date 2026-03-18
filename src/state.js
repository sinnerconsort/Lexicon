import { extension_settings } from '../../../../extensions.js';
import { chat_metadata } from '../../../../../script.js';
import {
    EXT_ID, DEFAULT_SETTINGS, DEFAULT_CHAT_STATE, DEFAULT_ENTRY,
    NARRATIVE_STATES, REVEAL_TIERS,
} from './config.js';

// ─── Core Getters ─────────────────────────────────────────────────────────────

export function getSettings() {
    if (!extension_settings[EXT_ID]) {
        extension_settings[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    }
    return extension_settings[EXT_ID];
}

export function getChatState() {
    if (!chat_metadata) return JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE));
    if (!chat_metadata[EXT_ID]) {
        chat_metadata[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE));
    }
    return chat_metadata[EXT_ID];
}

// ─── Sanitization ─────────────────────────────────────────────────────────────

export function sanitizeSettings() {
    const s = getSettings();
    for (const key in DEFAULT_SETTINGS) {
        if (s[key] === undefined) s[key] = DEFAULT_SETTINGS[key];
    }
    if (!Array.isArray(s.entries)) s.entries = [];
    if (!s.characterEntries || typeof s.characterEntries !== 'object') {
        s.characterEntries = {};
    }

    // v2 migration: ensure all entries have narrative fields
    migrateEntries(s.entries);
    for (const key of Object.keys(s.characterEntries)) {
        migrateEntries(s.characterEntries[key]);
    }
}

export function sanitizeChatState() {
    try {
        const state = getChatState();
        for (const key in DEFAULT_CHAT_STATE) {
            if (state[key] === undefined) {
                state[key] = JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE[key]));
            }
        }
        if (!Array.isArray(state.chatEntries)) state.chatEntries = [];
        if (!Array.isArray(state.currentInjectedIds)) state.currentInjectedIds = [];
        if (!state.currentRelevanceScores || typeof state.currentRelevanceScores !== 'object') {
            state.currentRelevanceScores = {};
        }
        if (!state.narrativeActions || typeof state.narrativeActions !== 'object') {
            state.narrativeActions = {};
        }
        if (!Array.isArray(state.narrativeTimeline)) {
            state.narrativeTimeline = [];
        }

        // Migrate chat entries too
        migrateEntries(state.chatEntries);
    } catch (e) {
        console.warn('[Lexicon] sanitizeChatState failed:', e);
    }
}

/**
 * Ensure all entries have v2 narrative fields. Non-destructive.
 */
function migrateEntries(entries) {
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
        if (!e.revealTier) e.revealTier = REVEAL_TIERS.BACKGROUND;
        if (e.hintText === undefined) e.hintText = '';
        if (!Array.isArray(e.gateConditions)) e.gateConditions = [];
        if (!e.chekhov || typeof e.chekhov !== 'object') {
            e.chekhov = { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null };
        }
        if (!e.narrativeState) e.narrativeState = NARRATIVE_STATES.DORMANT;
    }
}

// ─── ID / Key Helpers ─────────────────────────────────────────────────────────

export function generateEntryId() {
    return `lex_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export function getCharacterKey(ctx) {
    if (!ctx) return null;
    const charId = ctx.characterId ?? ctx.this_chid;
    const name = (ctx.name2 || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
    return charId != null ? `char_${charId}_${name}` : null;
}

// ─── Narrative State Helpers ──────────────────────────────────────────────────

/**
 * Record that an entry was hinted at (Chekhov seed planted).
 */
export function recordSeed(entry) {
    if (!entry.chekhov) entry.chekhov = { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null };
    entry.chekhov.seedCount++;
    entry.chekhov.lastHintAt = Date.now();
    if (!entry.chekhov.plantedAt) {
        entry.chekhov.plantedAt = Date.now();
    }
    if (entry.narrativeState === NARRATIVE_STATES.DORMANT) {
        entry.narrativeState = NARRATIVE_STATES.SEEDING;
    }
}

/**
 * Record that an entry was fully revealed (Chekhov's Gun fired).
 */
export function recordFired(entry) {
    if (!entry.chekhov) entry.chekhov = { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null };
    entry.chekhov.firedAt = Date.now();
    entry.narrativeState = NARRATIVE_STATES.REVEALED;
}

/**
 * Check if all manual gate conditions are marked as met.
 */
export function areGatesMet(entry) {
    if (!entry.gateConditions || entry.gateConditions.length === 0) return true;
    return entry.gateConditions.every(g => g.met);
}

/**
 * Compute effective narrative state from entry data.
 */
export function computeNarrativeState(entry) {
    if (entry.chekhov?.firedAt) return NARRATIVE_STATES.REVEALED;
    if (entry.revealTier === REVEAL_TIERS.BACKGROUND) return NARRATIVE_STATES.DORMANT;
    if (areGatesMet(entry) && entry.revealTier === REVEAL_TIERS.GATED) return NARRATIVE_STATES.READY;
    if (entry.chekhov?.seedCount > 0) return NARRATIVE_STATES.SEEDING;
    return NARRATIVE_STATES.DORMANT;
}

/**
 * Add a timeline event to chat state.
 */
export function addTimelineEvent(chatState, entryId, entryTitle, action, contextSnippet) {
    if (!Array.isArray(chatState.narrativeTimeline)) chatState.narrativeTimeline = [];
    chatState.narrativeTimeline.push({
        timestamp: Date.now(),
        entryId,
        entryTitle: entryTitle || 'Unknown',
        action,
        context: (contextSnippet || '').substring(0, 120),
    });
    // Cap timeline at 200 events to keep chat_metadata reasonable
    if (chatState.narrativeTimeline.length > 200) {
        chatState.narrativeTimeline = chatState.narrativeTimeline.slice(-200);
    }
}
