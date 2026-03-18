import { setExtensionPrompt } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import {
    getSettings, getChatState, recordSeed, recordFired,
    addTimelineEvent,
} from './state.js';
import {
    getAllCandidateEntries, scoreEntriesWithAI, getRecentContext,
    generateHintText,
} from './scanner.js';
import { saveChatData, saveSettings } from './persistence.js';
import { NARRATIVE_ACTIONS } from './config.js';

const INJECT_KEY = 'lexicon_lore';

// Attempt to import extension_prompt_types; fall back to numeric constant
let PROMPT_TYPE_IN_CHAT = 1;
try {
    const { extension_prompt_types } = await import('../../../../script.js');
    if (extension_prompt_types?.IN_CHAT !== undefined) {
        PROMPT_TYPE_IN_CHAT = extension_prompt_types.IN_CHAT;
    }
} catch {
    // Use numeric fallback
}

let isScanning = false;

/**
 * Main entry point: scan, evaluate narrative pacing, and inject.
 */
export async function scanAndInject(options = {}) {
    if (isScanning && !options.force) return;
    isScanning = true;

    try {
        const settings = getSettings();
        const chatState = getChatState();
        const ctx = getContext();

        const candidates = await getAllCandidateEntries();

        if (!candidates.length) {
            clearInjection();
            chatState.currentInjectedIds = [];
            chatState.currentRelevanceScores = {};
            chatState.narrativeActions = {};
            saveChatData();
            dispatchUpdateEvent();
            return;
        }

        // Get recent context for scoring
        const context = getRecentContext(5);

        // Score via AI (narrative-aware if pacing enabled)
        const scored = await scoreEntriesWithAI(candidates, context);

        // Separate by action type
        const pinnedScored = scored.filter(s => s.pinned);
        const injectScored = scored
            .filter(s => !s.pinned && s.action === NARRATIVE_ACTIONS.INJECT)
            .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
            .slice(0, settings.maxInjectedEntries);
        const hintScored = scored
            .filter(s => !s.pinned && s.action === NARRATIVE_ACTIONS.HINT)
            .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
            .slice(0, Math.max(2, Math.floor(settings.maxInjectedEntries / 2)));
        const suppressedScored = scored
            .filter(s => s.action === NARRATIVE_ACTIONS.SUPPRESS && !s.pinned);

        const allActive = [...pinnedScored, ...injectScored, ...hintScored];

        // Build the injection block
        const loreLines = [];

        // Inject pinned entries (full content)
        for (const s of pinnedScored) {
            const entry = candidates.find(e => e.id === s.id);
            if (entry) {
                loreLines.push(buildFullBlock(entry));
            }
        }

        // Inject full entries
        for (const s of injectScored) {
            const entry = candidates.find(e => e.id === s.id);
            if (entry) {
                loreLines.push(buildFullBlock(entry));
                // Track: Chekhov fired
                updateEntryNarrative(entry, NARRATIVE_ACTIONS.INJECT, settings);
                addTimelineEvent(chatState, entry.id, entry.title, 'INJECT',
                    context.substring(0, 120));
            }
        }

        // Inject hints (breadcrumbs)
        for (const s of hintScored) {
            const entry = candidates.find(e => e.id === s.id);
            if (entry) {
                const hintContent = await resolveHintText(entry, settings);
                if (hintContent) {
                    loreLines.push(buildHintBlock(entry, hintContent));
                }
                // Track: Chekhov seed
                updateEntryNarrative(entry, NARRATIVE_ACTIONS.HINT, settings);
                addTimelineEvent(chatState, entry.id, entry.title, 'HINT',
                    context.substring(0, 120));
            }
        }

        // Track suppressions in timeline (but don't inject)
        for (const s of suppressedScored) {
            const entry = candidates.find(e => e.id === s.id);
            if (entry && (s.relevance || 0) >= 3) {
                // Only log suppression if the entry was actually relevant
                addTimelineEvent(chatState, entry.id, entry.title, 'SUPPRESS',
                    s.reason || 'Not ready yet');
            }
        }

        // Store all scores and actions in chat state
        const scores = {};
        const actions = {};
        for (const s of scored) {
            scores[s.id] = s.relevance ?? s.score ?? 0;
            actions[s.id] = s.action || NARRATIVE_ACTIONS.SUPPRESS;
        }
        chatState.currentRelevanceScores = scores;
        chatState.narrativeActions = actions;
        chatState.currentInjectedIds = allActive.map(s => s.id);
        chatState.lastScanAt = ctx?.chat?.length || 0;
        chatState.lastScanTime = Date.now();

        // Do the actual injection
        if (loreLines.length > 0) {
            const loreBlock = `<lore>\n${loreLines.join('\n\n---\n\n')}\n</lore>`;
            setExtensionPrompt(
                INJECT_KEY,
                loreBlock,
                PROMPT_TYPE_IN_CHAT,
                settings.injectionDepth,
                false
            );
        } else {
            clearInjection();
        }

        saveChatData();
        saveSettings(); // Save Chekhov tracking updates on entries
        dispatchUpdateEvent();

    } catch (err) {
        console.error('[Lexicon] scanAndInject failed:', err);
    } finally {
        isScanning = false;
    }
}

/**
 * Clear all injected lore.
 */
export function clearInjection() {
    try {
        setExtensionPrompt(INJECT_KEY, '', PROMPT_TYPE_IN_CHAT, 0, false);
    } catch (e) {
        // Ignore
    }
}

// ─── Block Builders ───────────────────────────────────────────────────────────

function buildFullBlock(entry) {
    const title = entry.title ? `[${entry.title}]` : '[Lore]';
    return `${title}\n${entry.content || ''}`;
}

function buildHintBlock(entry, hintContent) {
    const title = entry.title ? `[${entry.title}]` : '[Lore Hint]';
    return `[NARRATIVE HINT — reference obliquely, do NOT reveal details]\n${title}\n${hintContent}`;
}

// ─── Hint Resolution ──────────────────────────────────────────────────────────

/**
 * Get hint text: manual override → cached auto-hint → generate new.
 */
async function resolveHintText(entry, settings) {
    // Manual hint always wins
    if (entry.hintText && entry.hintText.trim()) {
        return entry.hintText;
    }

    // Auto-generate if enabled
    if (settings.autoHintGeneration) {
        try {
            const generated = await generateHintText(entry);
            if (generated) {
                // Cache it on the entry so we don't regenerate every time
                entry.hintText = generated;
                return generated;
            }
        } catch (err) {
            console.warn('[Lexicon] Auto-hint generation failed:', err);
        }
    }

    // Last resort: generic breadcrumb
    return `There is something significant about ${entry.title || 'this'} that may become important...`;
}

// ─── Narrative Tracking ───────────────────────────────────────────────────────

function updateEntryNarrative(entry, action, settings) {
    if (action === NARRATIVE_ACTIONS.INJECT) {
        recordFired(entry);
    } else if (action === NARRATIVE_ACTIONS.HINT) {
        recordSeed(entry);
    }
}

// ─── Events ───────────────────────────────────────────────────────────────────

function dispatchUpdateEvent() {
    const event = new CustomEvent('lexicon:updated');
    document.dispatchEvent(event);
}
