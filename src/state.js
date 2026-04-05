import { extension_settings } from '../../../../extensions.js';
import { chat_metadata } from '../../../../../script.js';
import {
    EXT_ID, DEFAULT_SETTINGS, DEFAULT_CHAT_STATE, DEFAULT_ENTRY,
    NARRATIVE_STATES, REVEAL_TIERS, SCENE_TYPE_KEYWORDS,
    RESOLUTION_STATUSES,
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

    // v2 + v2.1 migration: ensure all entries have required fields
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

        // v2.1 migrations
        if (!state.injectionHistory || typeof state.injectionHistory !== 'object') {
            state.injectionHistory = { log: [], frequency_map: {} };
        }
        if (!Array.isArray(state.injectionHistory.log)) {
            state.injectionHistory.log = [];
        }
        if (!state.injectionHistory.frequency_map || typeof state.injectionHistory.frequency_map !== 'object') {
            state.injectionHistory.frequency_map = {};
        }
        if (state.detectedSceneType === undefined) state.detectedSceneType = null;
        if (state.sceneTypeOverride === undefined) state.sceneTypeOverride = null;
        if (!Array.isArray(state.pendingRelatedBoosts)) state.pendingRelatedBoosts = [];

        // Migrate chat entries too
        migrateEntries(state.chatEntries);
    } catch (e) {
        console.warn('[Lexicon] sanitizeChatState failed:', e);
    }
}

/**
 * Ensure all entries have v2 + v2.1 fields. Non-destructive.
 */
function migrateEntries(entries) {
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
        // v2 fields
        if (!e.revealTier) e.revealTier = REVEAL_TIERS.BACKGROUND;
        if (e.hintText === undefined) e.hintText = '';
        if (!Array.isArray(e.gateConditions)) e.gateConditions = [];
        if (!e.chekhov || typeof e.chekhov !== 'object') {
            e.chekhov = { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null };
        }
        if (!e.narrativeState) e.narrativeState = NARRATIVE_STATES.DORMANT;
        // v2.1 fields
        if (!Array.isArray(e.scene_types)) e.scene_types = [];
        // v2.1: Resolution
        if (!e.resolution || typeof e.resolution !== 'object') {
            e.resolution = { status: 'active', evolution_log: [] };
        }
        if (!e.resolution.status) e.resolution.status = 'active';
        if (!Array.isArray(e.resolution.evolution_log)) e.resolution.evolution_log = [];
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

export function recordFired(entry) {
    if (!entry.chekhov) entry.chekhov = { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null };
    entry.chekhov.firedAt = Date.now();
    entry.narrativeState = NARRATIVE_STATES.REVEALED;
}

export function areGatesMet(entry) {
    if (!entry.gateConditions || entry.gateConditions.length === 0) return true;
    return entry.gateConditions.every(g => g.met);
}

export function computeNarrativeState(entry) {
    if (entry.chekhov?.firedAt) return NARRATIVE_STATES.REVEALED;
    if (entry.revealTier === REVEAL_TIERS.BACKGROUND) return NARRATIVE_STATES.DORMANT;
    if (areGatesMet(entry) && entry.revealTier === REVEAL_TIERS.GATED) return NARRATIVE_STATES.READY;
    if (entry.chekhov?.seedCount > 0) return NARRATIVE_STATES.SEEDING;
    return NARRATIVE_STATES.DORMANT;
}

export function addTimelineEvent(chatState, entryId, entryTitle, action, contextSnippet) {
    if (!Array.isArray(chatState.narrativeTimeline)) chatState.narrativeTimeline = [];
    chatState.narrativeTimeline.push({
        timestamp: Date.now(),
        entryId,
        entryTitle: entryTitle || 'Unknown',
        action,
        context: (contextSnippet || '').substring(0, 120),
    });
    if (chatState.narrativeTimeline.length > 200) {
        chatState.narrativeTimeline = chatState.narrativeTimeline.slice(-200);
    }
}

// ─── v2.1: Injection History ─────────────────────────────────────────────────

/**
 * Record that an entry was injected (full or hint) into context.
 * Updates both the rolling log and the frequency map.
 */
export function recordInjectionEvent(chatState, entryId, messageIndex, action) {
    if (!chatState.injectionHistory) {
        chatState.injectionHistory = { log: [], frequency_map: {} };
    }
    const history = chatState.injectionHistory;

    // Append to rolling log
    history.log.push({
        entry_id: entryId,
        message_index: messageIndex,
        action: action || 'INJECT',
        timestamp: new Date().toISOString(),
    });

    // Cap log at 200 entries — prune oldest but keep frequency counts
    if (history.log.length > 200) {
        history.log = history.log.slice(-200);
    }

    // Update frequency map
    if (!history.frequency_map[entryId]) {
        history.frequency_map[entryId] = { count: 0, last_injected_msg: 0 };
    }
    history.frequency_map[entryId].count++;
    history.frequency_map[entryId].last_injected_msg = messageIndex;
}

/**
 * Get injection frequency for a specific entry.
 */
export function getEntryFrequency(chatState, entryId) {
    const fm = chatState?.injectionHistory?.frequency_map;
    if (!fm || !fm[entryId]) return { count: 0, last_injected_msg: 0 };
    return { ...fm[entryId] };
}

/**
 * Get top N most frequently injected entries.
 */
export function getMostFrequentEntries(chatState, topN = 5) {
    const fm = chatState?.injectionHistory?.frequency_map;
    if (!fm) return [];
    return Object.entries(fm)
        .map(([id, data]) => ({ entry_id: id, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, topN);
}

/**
 * Get all injection events since a specific message index.
 */
export function getEntriesFiredSince(chatState, messageIndex) {
    const log = chatState?.injectionHistory?.log;
    if (!Array.isArray(log)) return [];
    return log.filter(e => e.message_index >= messageIndex);
}

/**
 * Check if an entry has hit the soft cooldown threshold.
 * Returns true if the entry has been injected >= threshold times in the last N messages.
 */
export function isEntryCoolingDown(chatState, entryId, currentMsgIndex, threshold = 3, windowSize = 10) {
    const log = chatState?.injectionHistory?.log;
    if (!Array.isArray(log) || !log.length) return false;

    const windowStart = currentMsgIndex - windowSize;
    const recentFirings = log.filter(
        e => e.entry_id === entryId && e.message_index >= windowStart
    );
    return recentFirings.length >= threshold;
}

// ─── v2.1: Scene Type Detection ──────────────────────────────────────────────

/**
 * Detect the current scene type from recent text using keyword heuristics.
 * Returns the scene type with the highest keyword match count, or null if no clear winner.
 */
export function detectSceneType(recentText) {
    if (!recentText) return null;

    const lower = recentText.toLowerCase();
    const scores = {};

    for (const [sceneType, keywords] of Object.entries(SCENE_TYPE_KEYWORDS)) {
        let count = 0;
        for (const kw of keywords) {
            // Count occurrences — simple indexOf check
            let idx = 0;
            while ((idx = lower.indexOf(kw, idx)) !== -1) {
                count++;
                idx += kw.length;
            }
        }
        if (count > 0) scores[sceneType] = count;
    }

    if (Object.keys(scores).length === 0) return null;

    // Return the scene type with the highest score, but only if it has a meaningful lead
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const second = sorted[1];

    // Need at least 2 keyword hits and some margin over second place
    if (top[1] < 2) return null;
    if (second && top[1] - second[1] < 1) return null; // Too ambiguous

    return top[0];
}

/**
 * Get the effective scene type — manual override > detected.
 */
export function getEffectiveSceneType(chatState) {
    if (chatState?.sceneTypeOverride) return chatState.sceneTypeOverride;
    return chatState?.detectedSceneType || null;
}

// ─── v2.1: Related Entry Boost Tracking ──────────────────────────────────────

/**
 * After a scan, compute which entry IDs should get a next-cycle related boost.
 * Called with the list of entries that were just injected/hinted.
 */
export function computePendingRelatedBoosts(injectedEntries, allCandidates) {
    const boostSet = new Set();
    const injectedIds = new Set(injectedEntries.map(e => e.id));

    for (const entry of injectedEntries) {
        if (!entry.relatedIds?.length) continue;
        for (const relId of entry.relatedIds) {
            // Don't boost entries that were already injected this cycle
            if (!injectedIds.has(relId)) {
                // Verify the related entry actually exists
                if (allCandidates.some(c => c.id === relId)) {
                    boostSet.add(relId);
                }
            }
        }
    }

    return Array.from(boostSet);
}

/**
 * Check if an entry has a pending related boost from last cycle.
 */
export function hasPendingBoost(chatState, entryId) {
    return Array.isArray(chatState?.pendingRelatedBoosts)
        && chatState.pendingRelatedBoosts.includes(entryId);
}

// ─── v2.1: Resolution & Healing ──────────────────────────────────────────────

/**
 * Change an entry's resolution status and log the transition.
 * @param {object} entry - The entry to update
 * @param {string} newStatus - One of: active, softening, resolved, dormant_resolution
 * @param {string} reason - Brief explanation of why the status changed
 * @param {number} [messageIndex] - Current message index for logging
 * @returns {boolean} True if status actually changed
 */
export function setResolutionStatus(entry, newStatus, reason, messageIndex) {
    if (!entry.resolution) {
        entry.resolution = { status: 'active', evolution_log: [] };
    }

    const oldStatus = entry.resolution.status;
    if (oldStatus === newStatus) return false;

    // Log the transition
    if (!Array.isArray(entry.resolution.evolution_log)) {
        entry.resolution.evolution_log = [];
    }

    entry.resolution.evolution_log.push({
        from: oldStatus,
        to: newStatus,
        reason: reason || '',
        message_index: messageIndex ?? null,
        timestamp: new Date().toISOString(),
    });

    // Cap evolution log at 20 entries
    if (entry.resolution.evolution_log.length > 20) {
        entry.resolution.evolution_log = entry.resolution.evolution_log.slice(-20);
    }

    entry.resolution.status = newStatus;
    return true;
}

/**
 * Get the effective injection priority modifier for a resolution status.
 * Used by the scanner to adjust scoring.
 * @param {string} status - Resolution status
 * @returns {string} Priority effect: 'normal', 'reduce', 'suppress'
 */
export function getResolutionPriorityEffect(status) {
    switch (status) {
        case RESOLUTION_STATUSES.ACTIVE:
            return 'normal';
        case RESOLUTION_STATUSES.SOFTENING:
            return 'reduce';    // Demote one priority level
        case RESOLUTION_STATUSES.RESOLVED:
        case RESOLUTION_STATUSES.DORMANT_RES:
            return 'suppress';  // Suppress unless explicitly triggered
        default:
            return 'normal';
    }
}
