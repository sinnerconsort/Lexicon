import { getContext } from '../../../../extensions.js';
import { generateRaw } from '../../../../../script.js';
import {
    getSettings, getChatState, getCharacterKey, areGatesMet,
} from './state.js';
import { getLorebookEntries } from './lorebook.js';
import {
    REVEAL_TIERS, NARRATIVE_ACTIONS, REVEAL_TIER_META,
} from './config.js';

// ─── Candidate Collection ─────────────────────────────────────────────────────

export async function getAllCandidateEntries() {
    const settings = getSettings();
    const chatState = getChatState();
    const ctx = getContext();

    let candidates = [];

    // 1. Global compendium entries
    candidates = candidates.concat(
        (settings.entries || []).filter(e => e.enabled !== false)
    );

    // 2. Character-scoped entries
    const charKey = getCharacterKey(ctx);
    if (charKey && settings.characterEntries?.[charKey]) {
        candidates = candidates.concat(
            settings.characterEntries[charKey].filter(e => e.enabled !== false)
        );
    }

    // 3. Chat-scoped entries
    if (chatState?.chatEntries?.length > 0) {
        candidates = candidates.concat(
            chatState.chatEntries.filter(e => e.enabled !== false)
        );
    }

    // 4. Lorebook bridge
    const lbEntries = await getLorebookEntries();
    candidates = candidates.concat(lbEntries.filter(e => e.enabled !== false));

    // Deduplicate by ID
    const seen = new Set();
    return candidates.filter(e => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
    });
}

// ─── Context Extraction ───────────────────────────────────────────────────────

export function getRecentContext(messageCount = 5) {
    const ctx = getContext();
    if (!ctx?.chat?.length) return '';

    const recent = ctx.chat.slice(-messageCount);
    return recent
        .map(msg => {
            const name = msg.is_user ? (ctx.name1 || 'User') : (ctx.name2 || 'AI');
            return `${name}: ${msg.mes || ''}`;
        })
        .join('\n\n');
}

/**
 * Get a broader story summary (last 15 messages) for readiness evaluation.
 */
export function getBroadContext(messageCount = 15) {
    const ctx = getContext();
    if (!ctx?.chat?.length) return '';

    const msgs = ctx.chat.slice(-messageCount);
    return msgs
        .map(msg => {
            const name = msg.is_user ? (ctx.name1 || 'User') : (ctx.name2 || 'AI');
            // Shorter per-message to fit more context
            const text = (msg.mes || '').substring(0, 200);
            return `${name}: ${text}`;
        })
        .join('\n');
}

// ─── AI Scoring — Narrative Director ──────────────────────────────────────────

/**
 * v2: Score entries with narrative awareness.
 * Returns array of { id, relevance, action, readiness, reason }.
 * Pinned entries always INJECT. Background entries use relevance only.
 * Foreshadow/Gated/Twist entries get the full narrative evaluation.
 */
export async function scoreEntriesWithAI(candidates, context) {
    if (!candidates.length) return [];

    const settings = getSettings();

    // Pinned entries always inject — skip scoring
    const pinned = candidates.filter(e => e.pinned);
    const scoreable = candidates.filter(e => !e.pinned);

    if (!scoreable.length) {
        return pinned.map((e, i) => ({
            id: e.id, relevance: 10, readiness: 10,
            action: NARRATIVE_ACTIONS.INJECT, pinned: true,
        }));
    }

    // If pacing is disabled, fall back to v1 relevance-only scoring
    if (!settings.enableNarrativePacing) {
        return await scoreRelevanceOnly(scoreable, pinned, context, settings);
    }

    // Separate entries by whether they need narrative evaluation
    const backgroundEntries = scoreable.filter(e =>
        (e.revealTier || 'background') === REVEAL_TIERS.BACKGROUND
    );
    const narrativeEntries = scoreable.filter(e =>
        (e.revealTier || 'background') !== REVEAL_TIERS.BACKGROUND
    );

    let results = [];

    // Score background entries with simple relevance (cheaper prompt)
    if (backgroundEntries.length > 0) {
        const bgResults = await scoreRelevanceOnly(
            backgroundEntries, [], context, settings
        );
        results = results.concat(bgResults);
    }

    // Score narrative entries with the full director prompt
    if (narrativeEntries.length > 0) {
        const broadContext = getBroadContext(15);
        const narrativeResults = await scoreNarrativeDirector(
            narrativeEntries, context, broadContext, settings
        );
        results = results.concat(narrativeResults);
    }

    // Apply relationship boost across all results
    const boosted = applyRelationshipBoost(results, scoreable, candidates);

    // Pinned always first
    const pinnedResults = pinned.map((e, i) => ({
        id: e.id, relevance: 10, readiness: 10,
        action: NARRATIVE_ACTIONS.INJECT, pinned: true,
    }));

    return [...pinnedResults, ...boosted];
}

// ─── v1 Relevance-Only Scoring (for background entries or pacing-off mode) ───

async function scoreRelevanceOnly(scoreable, pinned, context, settings) {
    const entryList = scoreable.map(e => {
        const snippet = (e.content || '').length > 300
            ? e.content.substring(0, 300) + '…'
            : (e.content || '');
        const cat = e.category ? ` | ${e.category}` : '';
        return `[ID:${e.id}${cat}]\n${e.title || 'Untitled'}: ${snippet}`;
    }).join('\n\n');

    const maxReturn = settings.maxInjectedEntries;

    const prompt = `You are a lore relevance engine for a collaborative roleplay story. Identify which lore entries are meaningfully relevant to the current scene.

CURRENT SCENE CONTEXT:
${context}

AVAILABLE LORE ENTRIES:
${entryList}

Return ONLY a valid JSON array of entry IDs ordered by relevance (most relevant first, max ${maxReturn} entries). Include an entry only if it is directly relevant to what is happening or what the characters would plausibly reference. Return [] if nothing is relevant.

Example: ["lex_abc123", "lex_def456"]
ONLY return the JSON array. No explanation.`;

    let responseText = '';
    try {
        responseText = await callScoringAI(prompt);
    } catch (err) {
        console.error('[Lexicon] AI relevance scoring failed:', err);
    }

    const relevantIds = parseJsonArray(responseText);
    if (!Array.isArray(relevantIds)) {
        console.warn('[Lexicon] Could not parse relevance response:', responseText?.substring(0, 200));
        const pinnedResults = pinned.map((e, i) => ({
            id: e.id, relevance: 10, readiness: 10,
            action: NARRATIVE_ACTIONS.INJECT, pinned: true,
        }));
        return pinnedResults;
    }

    return relevantIds
        .filter(id => scoreable.find(e => e.id === id))
        .map((id, index) => ({
            id,
            relevance: maxReturn - index,
            readiness: 10,
            action: NARRATIVE_ACTIONS.INJECT,
        }));
}

// ─── v2 Narrative Director Scoring ────────────────────────────────────────────

async function scoreNarrativeDirector(narrativeEntries, sceneContext, broadContext, settings) {
    const entryList = narrativeEntries.map(e => {
        const snippet = (e.content || '').length > 400
            ? e.content.substring(0, 400) + '…'
            : (e.content || '');
        const tier = REVEAL_TIER_META[e.revealTier]?.label || 'Unknown';
        const seeds = e.chekhov?.seedCount || 0;
        const gateInfo = buildGateInfo(e);

        return `[ID:${e.id} | TIER:${tier} | Seeds:${seeds}${gateInfo}]
${e.title || 'Untitled'}: ${snippet}`;
    }).join('\n\n');

    const prompt = `You are a NARRATIVE DIRECTOR for a collaborative roleplay story. Your job is to control pacing — deciding what the AI should know, what it should hint at, and what it must NOT reveal yet.

RECENT SCENE (last few messages):
${sceneContext}

BROADER STORY CONTEXT:
${broadContext}

ENTRIES TO EVALUATE:
${entryList}

TIER RULES:
- FORESHADOW: Reference obliquely. Plant seeds. Never reveal the actual secret or twist.
- GATED: Only INJECT if gate conditions feel met from the story. Otherwise SUPPRESS or HINT.
- TWIST: Actively suppress unless narrative tension has built significantly (high seed count + story readiness). These are your biggest payoffs — don't waste them.

For each entry, respond with a JSON array of objects:
[
  {
    "id": "<entry_id>",
    "action": "INJECT" | "HINT" | "SUPPRESS",
    "relevance": <0-10>,
    "readiness": <0-10>,
    "reason": "<brief 1-sentence justification>"
  }
]

INJECT = full content, the story has earned this.
HINT = inject a breadcrumb only — tease, don't tell.
SUPPRESS = not yet. Hold it back.

Be a patient storyteller. The food isn't going anywhere. Prefer HINT over INJECT for foreshadow/gated entries unless readiness is very high. Prefer SUPPRESS for twists unless you're confident the payoff will land.

Return ONLY the JSON array. No other text.`;

    let responseText = '';
    try {
        responseText = await callScoringAI(prompt);
    } catch (err) {
        console.error('[Lexicon] Narrative director scoring failed:', err);
    }

    const parsed = parseJsonArrayOfObjects(responseText);
    if (!parsed) {
        console.warn('[Lexicon] Could not parse narrative response:', responseText?.substring(0, 300));
        // Fallback: suppress all narrative entries (safe default)
        return narrativeEntries.map(e => ({
            id: e.id,
            relevance: 0,
            readiness: 0,
            action: NARRATIVE_ACTIONS.SUPPRESS,
        }));
    }

    // Map parsed results, validating against our entry list
    const validIds = new Set(narrativeEntries.map(e => e.id));
    return parsed
        .filter(r => validIds.has(r.id))
        .map(r => ({
            id: r.id,
            relevance: clamp(r.relevance ?? 0, 0, 10),
            readiness: clamp(r.readiness ?? 0, 0, 10),
            action: normalizeAction(r.action),
            reason: r.reason || '',
        }));
}

/**
 * Build concise gate info string for the scoring prompt.
 */
function buildGateInfo(entry) {
    if (!entry.gateConditions?.length) return '';
    const met = entry.gateConditions.filter(g => g.met).length;
    const total = entry.gateConditions.length;
    const conditions = entry.gateConditions.map(g =>
        `${g.met ? '✓' : '✗'} ${g.text}`
    ).join('; ');
    return ` | Gates:${met}/${total} (${conditions})`;
}

// ─── Auto-Hint Generation ─────────────────────────────────────────────────────

/**
 * Generate a breadcrumb hint from full entry content via AI.
 * Only called when entry has no manual hintText and autoHintGeneration is on.
 */
export async function generateHintText(entry) {
    const prompt = `You are a narrative hint generator. Given the following lore entry, write a SHORT, OBLIQUE breadcrumb that teases its existence without revealing the secret. The hint should make the AI reference this topic vaguely or atmospherically.

ENTRY TITLE: ${entry.title}
ENTRY CONTENT: ${(entry.content || '').substring(0, 500)}

Write 1-2 sentences that:
- Reference the TOPIC without revealing specifics
- Could be woven naturally into narration
- Leave the reader curious but not informed

Return ONLY the hint text. No quotes, no explanation.`;

    try {
        const hint = await callScoringAI(prompt);
        return (hint || '').trim().substring(0, 500);
    } catch (err) {
        console.warn('[Lexicon] Hint generation failed:', err);
        // Fallback: extract first sentence + ellipsis
        const firstSentence = (entry.content || '').split(/[.!?]/)[0];
        return firstSentence ? `Something about ${entry.title}...` : '';
    }
}

// ─── Relationship Boost ───────────────────────────────────────────────────────

function applyRelationshipBoost(scored, scoreable, allCandidates) {
    const selectedIds = new Set(scored.filter(s =>
        s.action === NARRATIVE_ACTIONS.INJECT || s.action === NARRATIVE_ACTIONS.HINT
    ).map(s => s.id));

    const boostQueue = [];

    for (const s of scored) {
        if (s.action === NARRATIVE_ACTIONS.SUPPRESS) continue;
        const entry = allCandidates.find(e => e.id === s.id);
        if (!entry?.relatedIds?.length) continue;

        for (const relId of entry.relatedIds) {
            if (!selectedIds.has(relId)) {
                const relEntry = allCandidates.find(e => e.id === relId);
                if (relEntry) {
                    selectedIds.add(relId);
                    boostQueue.push({
                        id: relId,
                        relevance: 0.5,
                        readiness: 5,
                        action: NARRATIVE_ACTIONS.INJECT,
                        boosted: true,
                    });
                }
            }
        }
    }

    return [...scored, ...boostQueue];
}

// ─── AI Communication ─────────────────────────────────────────────────────────

async function callScoringAI(prompt) {
    const ctx = getContext();
    const settings = getSettings();

    if (ctx?.ConnectionManagerRequestService) {
        const profileId = resolveProfileId(settings.selectedProfile, ctx);
        if (profileId) {
            try {
                const response = await ctx.ConnectionManagerRequestService.sendRequest(
                    profileId,
                    [{ role: 'user', content: prompt }],
                    500,
                    { extractData: true, includePreset: false, includeInstruct: false },
                    {}
                );
                if (response?.content) return response.content;
            } catch (err) {
                console.warn('[Lexicon] ConnectionManagerRequestService failed, using fallback:', err.message);
            }
        }
    }

    return await generateRaw(prompt, null, false, false, '', 500);
}

function resolveProfileId(profileName, ctx) {
    const cm = ctx?.extensionSettings?.connectionManager;
    if (!cm) return null;

    if (!profileName || profileName === 'current') {
        return cm.selectedProfile;
    }

    const profile = cm.profiles?.find(p => p.name === profileName);
    return profile?.id ?? cm.selectedProfile;
}

// ─── Parsing Helpers ──────────────────────────────────────────────────────────

function parseJsonArray(text) {
    if (!text) return null;
    const cleaned = text.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*?\]/);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[0]);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function parseJsonArrayOfObjects(text) {
    if (!text) return null;
    const cleaned = text.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    // Find the outermost array
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return null;

    try {
        const parsed = JSON.parse(cleaned.substring(start, end + 1));
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
            return parsed;
        }
        return null;
    } catch {
        return null;
    }
}

function normalizeAction(action) {
    const upper = String(action || '').toUpperCase().trim();
    if (upper === 'INJECT') return NARRATIVE_ACTIONS.INJECT;
    if (upper === 'HINT') return NARRATIVE_ACTIONS.HINT;
    return NARRATIVE_ACTIONS.SUPPRESS;
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, Number(val) || 0));
}

// ─── Trigger Logic ────────────────────────────────────────────────────────────

export function shouldScan() {
    const settings = getSettings();
    const chatState = getChatState();
    const ctx = getContext();

    if (!settings.enabled) return false;
    if (settings.triggerMode === 'manual') return false;

    const messageCount = ctx?.chat?.length || 0;

    if (settings.triggerMode === 'every_message') return true;

    if (settings.triggerMode === 'every_n') {
        const messagesSince = messageCount - (chatState.lastScanAt || 0);
        return messagesSince >= (settings.triggerEveryN || 3);
    }

    return false;
}
