/**
 * Lexicon v2 — Semantic Lore Engine + Narrative Pacing
 * Single-file build — all modules merged, Spark FAB pattern
 */
import {
    getContext,
    extension_settings,
} from '../../../extensions.js';

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    saveChatDebounced,
    chat_metadata,
    generateRaw,
    setExtensionPrompt,
} from '../../../../script.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const EXT_ID = 'lexicon';
const EXT_DISPLAY_NAME = 'Lexicon';
const EXT_VERSION = '2.0.0';

const TRIGGER_MODES = { EVERY_MESSAGE: 'every_message', EVERY_N: 'every_n', MANUAL: 'manual' };
const ENTRY_SCOPES = { GLOBAL: 'global', CHARACTER: 'character', CHAT: 'chat' };
const CATEGORIES = ['Character','Location','Item','Faction','Event','Concept','Rule','Lore','Relationship','History','Other'];

const REVEAL_TIERS = { BACKGROUND: 'background', FORESHADOW: 'foreshadow', GATED: 'gated', TWIST: 'twist' };
const NARRATIVE_ACTIONS = { INJECT: 'INJECT', HINT: 'HINT', SUPPRESS: 'SUPPRESS' };
const NARRATIVE_STATES = { DORMANT: 'dormant', SEEDING: 'seeding', READY: 'ready', REVEALED: 'revealed' };

const REVEAL_TIER_META = {
    background: { label: 'Background', icon: '🌍', color: '#7a9e7e', desc: 'Always safe — facts, geography, basic info' },
    foreshadow: { label: 'Foreshadow', icon: '🌙', color: '#b8a460', desc: "Hint obliquely, don't reveal details" },
    gated: { label: 'Gated', icon: '🔒', color: '#8a7eb8', desc: 'Locked until conditions are met' },
    twist: { label: 'Twist', icon: '⚡', color: '#c45c5c', desc: 'Actively suppressed until the perfect moment' },
};

const DEFAULT_SETTINGS = {
    enabled: true, selectedProfile: 'current',
    triggerMode: TRIGGER_MODES.EVERY_MESSAGE, triggerEveryN: 3,
    maxInjectedEntries: 5, injectionDepth: 1,
    showDebugOverlay: true, bridgeLorebooks: true,
    enableNarrativePacing: true, autoHintGeneration: true,
    entries: [], characterEntries: {}, settingsVersion: 2,
};

const DEFAULT_CHAT_STATE = {
    chatEntries: [], lastScanAt: 0, lastScanTime: 0,
    currentInjectedIds: [], currentRelevanceScores: {},
    narrativeActions: {}, narrativeTimeline: [],
};

// ═══════════════════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════════════════

function getSettings() {
    if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    return extension_settings[EXT_ID];
}

function getChatState() {
    if (!chat_metadata) return JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE));
    if (!chat_metadata[EXT_ID]) chat_metadata[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE));
    return chat_metadata[EXT_ID];
}

function sanitizeSettings() {
    const s = getSettings();
    for (const key in DEFAULT_SETTINGS) { if (s[key] === undefined) s[key] = DEFAULT_SETTINGS[key]; }
    if (!Array.isArray(s.entries)) s.entries = [];
    if (!s.characterEntries || typeof s.characterEntries !== 'object') s.characterEntries = {};
    migrateEntries(s.entries);
    for (const key of Object.keys(s.characterEntries)) migrateEntries(s.characterEntries[key]);
}

function sanitizeChatState() {
    try {
        const state = getChatState();
        for (const key in DEFAULT_CHAT_STATE) {
            if (state[key] === undefined) state[key] = JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE[key]));
        }
        if (!Array.isArray(state.chatEntries)) state.chatEntries = [];
        if (!Array.isArray(state.currentInjectedIds)) state.currentInjectedIds = [];
        if (!state.currentRelevanceScores || typeof state.currentRelevanceScores !== 'object') state.currentRelevanceScores = {};
        if (!state.narrativeActions || typeof state.narrativeActions !== 'object') state.narrativeActions = {};
        if (!Array.isArray(state.narrativeTimeline)) state.narrativeTimeline = [];
        migrateEntries(state.chatEntries);
    } catch (e) { console.warn('[Lexicon] sanitizeChatState failed:', e); }
}

function migrateEntries(entries) {
    if (!Array.isArray(entries)) return;
    for (const e of entries) {
        if (!e.revealTier) e.revealTier = REVEAL_TIERS.BACKGROUND;
        if (e.hintText === undefined) e.hintText = '';
        if (!Array.isArray(e.gateConditions)) e.gateConditions = [];
        if (!e.chekhov || typeof e.chekhov !== 'object') e.chekhov = { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null };
        if (!e.narrativeState) e.narrativeState = NARRATIVE_STATES.DORMANT;
    }
}

function generateEntryId() { return `lex_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`; }

function getCharacterKey(ctx) {
    if (!ctx) return null;
    const charId = ctx.characterId ?? ctx.this_chid;
    const name = (ctx.name2 || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
    return charId != null ? `char_${charId}_${name}` : null;
}

function recordSeed(entry) {
    if (!entry.chekhov) entry.chekhov = { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null };
    entry.chekhov.seedCount++;
    entry.chekhov.lastHintAt = Date.now();
    if (!entry.chekhov.plantedAt) entry.chekhov.plantedAt = Date.now();
    if (entry.narrativeState === NARRATIVE_STATES.DORMANT) entry.narrativeState = NARRATIVE_STATES.SEEDING;
}

function recordFired(entry) {
    if (!entry.chekhov) entry.chekhov = { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null };
    entry.chekhov.firedAt = Date.now();
    entry.narrativeState = NARRATIVE_STATES.REVEALED;
}

function areGatesMet(entry) {
    if (!entry.gateConditions || entry.gateConditions.length === 0) return true;
    return entry.gateConditions.every(g => g.met);
}

function computeNarrativeState(entry) {
    if (entry.chekhov?.firedAt) return NARRATIVE_STATES.REVEALED;
    if (entry.revealTier === REVEAL_TIERS.BACKGROUND) return NARRATIVE_STATES.DORMANT;
    if (areGatesMet(entry) && entry.revealTier === REVEAL_TIERS.GATED) return NARRATIVE_STATES.READY;
    if (entry.chekhov?.seedCount > 0) return NARRATIVE_STATES.SEEDING;
    return NARRATIVE_STATES.DORMANT;
}

function addTimelineEvent(chatState, entryId, entryTitle, action, contextSnippet) {
    if (!Array.isArray(chatState.narrativeTimeline)) chatState.narrativeTimeline = [];
    chatState.narrativeTimeline.push({ timestamp: Date.now(), entryId, entryTitle: entryTitle || 'Unknown', action, context: (contextSnippet || '').substring(0, 120) });
    if (chatState.narrativeTimeline.length > 200) chatState.narrativeTimeline = chatState.narrativeTimeline.slice(-200);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════════

function saveSettings() { saveSettingsDebounced(); }
function saveChatData() { if (chat_metadata) saveChatDebounced(); }
function loadChatData() { return getChatState(); }

function exportCompendium() {
    const settings = getSettings();
    const chatState = getChatState();
    return JSON.stringify({ version: 2, exported: new Date().toISOString(), entries: settings.entries, characterEntries: settings.characterEntries, narrativeTimeline: chatState?.narrativeTimeline || [] }, null, 2);
}

function importCompendium(jsonString, mode = 'merge') {
    try {
        const data = JSON.parse(jsonString);
        let entriesToImport = [];
        
        // Accept Lexicon native format (entries as array)
        if (Array.isArray(data.entries)) {
            entriesToImport = data.entries;
        }
        // Accept ST lorebook format (entries as object keyed by uid)
        else if (data.entries && typeof data.entries === 'object') {
            entriesToImport = Object.values(data.entries).map(e => ({
                id: 'lex_' + (e.comment || e.key?.[0] || 'entry').toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + (e.uid || Date.now()),
                title: e.comment || (Array.isArray(e.key) ? e.key[0] : 'Untitled'),
                content: e.content || '',
                category: 'General',
                revealTier: 'background',
                gateConditions: [],
                lorebookKey: Array.isArray(e.key) ? e.key : [e.key].filter(Boolean),
                enabled: !e.disable,
                order: e.order || 10,
            }));
        }
        else { throw new Error('Invalid format: entries must be an array or object'); }
        
        if (!entriesToImport.length) { throw new Error('No entries found in file'); }
        
        const settings = getSettings();
        if (mode === 'replace') {
            settings.entries = entriesToImport;
            if (data.characterEntries) settings.characterEntries = data.characterEntries;
        } else {
            const existingIds = new Set(settings.entries.map(e => e.id));
            const existingTitles = new Set(settings.entries.map(e => e.title?.toLowerCase()));
            settings.entries = [...settings.entries, ...entriesToImport.filter(e => !existingIds.has(e.id) && !existingTitles.has(e.title?.toLowerCase()))];
            if (data.characterEntries) {
                for (const [key, entries] of Object.entries(data.characterEntries)) {
                    if (!settings.characterEntries[key]) { settings.characterEntries[key] = entries; }
                    else {
                        const eIds = new Set(settings.characterEntries[key].map(e => e.id));
                        settings.characterEntries[key] = [...settings.characterEntries[key], ...entries.filter(e => !eIds.has(e.id))];
                    }
                }
            }
        }
        saveSettings();
        return { success: true, count: entriesToImport.length };
    } catch (e) { return { success: false, error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOREBOOK BRIDGE
// ═══════════════════════════════════════════════════════════════════════════════

let lorebookCache = null;
let lorebookCacheTime = 0;
let lorebookStatus = 'unknown';

async function getLorebookEntries() {
    const settings = getSettings();
    if (!settings.bridgeLorebooks) { lorebookStatus = 'disabled'; return []; }
    if (lorebookCache && (Date.now() - lorebookCacheTime) < 10000) return lorebookCache;
    const entries = await tryReadWorldInfo();
    lorebookCache = entries;
    lorebookCacheTime = Date.now();
    lorebookStatus = entries.length > 0 ? 'ok' : 'unavailable';
    return entries;
}

async function tryReadWorldInfo() {
    const paths = ['../../../../scripts/world-info.js', '../../../world-info.js'];
    for (const path of paths) {
        try {
            const mod = await import(path);
            const wi = mod.world_info ?? mod.default;
            if (!wi) continue;
            let rawEntries = Array.isArray(wi) ? wi : (wi.entries && typeof wi.entries === 'object') ? Object.values(wi.entries) : typeof wi === 'object' ? Object.values(wi) : [];
            if (!rawEntries.length) continue;
            const mapped = rawEntries.filter(e => e && e.content && !e.disable && !e.disabled).map(e => ({
                id: `lb_${e.uid ?? e.id ?? Math.random().toString(36).substr(2, 6)}`,
                title: e.comment || (Array.isArray(e.key) ? e.key[0] : e.key) || 'Lorebook Entry',
                content: e.content, category: 'Lorebook', pinned: e.constant || false,
                relatedIds: [], scope: 'global', enabled: true, fromLorebook: true,
                lorebookKey: Array.isArray(e.key) ? e.key : [e.key].filter(Boolean),
                revealTier: REVEAL_TIERS.BACKGROUND, hintText: '', gateConditions: [],
                chekhov: { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null },
                narrativeState: NARRATIVE_STATES.DORMANT,
            }));
            if (mapped.length > 0) { console.log(`[Lexicon] Lorebook bridge: ${mapped.length} entries from ${path}`); return mapped; }
        } catch { /* try next */ }
    }
    return [];
}

function clearLorebookCache() { lorebookCache = null; lorebookCacheTime = 0; }

// ═══════════════════════════════════════════════════════════════════════════════
//  SCANNER — Candidate Collection + AI Scoring
// ═══════════════════════════════════════════════════════════════════════════════

async function getAllCandidateEntries() {
    const settings = getSettings();
    const chatState = getChatState();
    const ctx = getContext();
    let candidates = [...(settings.entries || []).filter(e => e.enabled !== false)];
    const charKey = getCharacterKey(ctx);
    if (charKey && settings.characterEntries?.[charKey]) candidates = candidates.concat(settings.characterEntries[charKey].filter(e => e.enabled !== false));
    if (chatState?.chatEntries?.length > 0) candidates = candidates.concat(chatState.chatEntries.filter(e => e.enabled !== false));
    const lbEntries = await getLorebookEntries();
    candidates = candidates.concat(lbEntries.filter(e => e.enabled !== false));
    const seen = new Set();
    return candidates.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });
}

function getRecentContext(messageCount = 5) {
    const ctx = getContext();
    if (!ctx?.chat?.length) return '';
    return ctx.chat.slice(-messageCount).map(msg => {
        const name = msg.is_user ? (ctx.name1 || 'User') : (ctx.name2 || 'AI');
        return `${name}: ${msg.mes || ''}`;
    }).join('\n\n');
}

function getBroadContext(messageCount = 15) {
    const ctx = getContext();
    if (!ctx?.chat?.length) return '';
    return ctx.chat.slice(-messageCount).map(msg => {
        const name = msg.is_user ? (ctx.name1 || 'User') : (ctx.name2 || 'AI');
        return `${name}: ${(msg.mes || '').substring(0, 200)}`;
    }).join('\n');
}

async function scoreEntriesWithAI(candidates, context) {
    if (!candidates.length) return [];
    const settings = getSettings();
    const pinned = candidates.filter(e => e.pinned);
    const scoreable = candidates.filter(e => !e.pinned);
    if (!scoreable.length) return pinned.map((e, i) => ({ id: e.id, relevance: 10, readiness: 10, action: NARRATIVE_ACTIONS.INJECT, pinned: true }));
    if (!settings.enableNarrativePacing) return await scoreRelevanceOnly(scoreable, pinned, context, settings);
    const bg = scoreable.filter(e => (e.revealTier || 'background') === REVEAL_TIERS.BACKGROUND);
    const narrative = scoreable.filter(e => (e.revealTier || 'background') !== REVEAL_TIERS.BACKGROUND);
    let results = [];
    if (bg.length > 0) results = results.concat(await scoreRelevanceOnly(bg, [], context, settings));
    if (narrative.length > 0) results = results.concat(await scoreNarrativeDirector(narrative, context, getBroadContext(15), settings));
    const boosted = applyRelationshipBoost(results, scoreable, candidates);
    const pinnedResults = pinned.map((e, i) => ({ id: e.id, relevance: 10, readiness: 10, action: NARRATIVE_ACTIONS.INJECT, pinned: true }));
    return [...pinnedResults, ...boosted];
}

async function scoreRelevanceOnly(scoreable, pinned, context, settings) {
    const entryList = scoreable.map(e => {
        const snippet = (e.content || '').length > 300 ? e.content.substring(0, 300) + '…' : (e.content || '');
        return `[ID:${e.id}${e.category ? ` | ${e.category}` : ''}]\n${e.title || 'Untitled'}: ${snippet}`;
    }).join('\n\n');
    const prompt = `You are a lore relevance engine for a collaborative roleplay story. Identify which lore entries are meaningfully relevant to the current scene.\n\nCURRENT SCENE CONTEXT:\n${context}\n\nAVAILABLE LORE ENTRIES:\n${entryList}\n\nReturn ONLY a valid JSON array of entry IDs ordered by relevance (most relevant first, max ${settings.maxInjectedEntries} entries). Return [] if nothing is relevant.\nExample: ["lex_abc123"]\nONLY return the JSON array.`;
    let responseText = '';
    try { responseText = await callScoringAI(prompt); } catch (err) { console.error('[Lexicon] Relevance scoring failed:', err); }
    const relevantIds = parseJsonArray(responseText);
    if (!Array.isArray(relevantIds)) {
        return pinned.map((e, i) => ({ id: e.id, relevance: 10, readiness: 10, action: NARRATIVE_ACTIONS.INJECT, pinned: true }));
    }
    return relevantIds.filter(id => scoreable.find(e => e.id === id)).map((id, index) => ({ id, relevance: settings.maxInjectedEntries - index, readiness: 10, action: NARRATIVE_ACTIONS.INJECT }));
}

async function scoreNarrativeDirector(narrativeEntries, sceneContext, broadContext, settings) {
    const entryList = narrativeEntries.map(e => {
        const snippet = (e.content || '').length > 400 ? e.content.substring(0, 400) + '…' : (e.content || '');
        const tier = REVEAL_TIER_META[e.revealTier]?.label || 'Unknown';
        const seeds = e.chekhov?.seedCount || 0;
        let gateInfo = '';
        if (e.gateConditions?.length) {
            const met = e.gateConditions.filter(g => g.met).length;
            gateInfo = ` | Gates:${met}/${e.gateConditions.length} (${e.gateConditions.map(g => `${g.met ? '✓' : '✗'} ${g.text}`).join('; ')})`;
        }
        return `[ID:${e.id} | TIER:${tier} | Seeds:${seeds}${gateInfo}]\n${e.title || 'Untitled'}: ${snippet}`;
    }).join('\n\n');
    const prompt = `You are a NARRATIVE DIRECTOR for a collaborative roleplay story. Your job is to control pacing.\n\nRECENT SCENE:\n${sceneContext}\n\nBROADER STORY:\n${broadContext}\n\nENTRIES TO EVALUATE:\n${entryList}\n\nTIER RULES:\n- FORESHADOW: Reference obliquely. Plant seeds. Never reveal the secret.\n- GATED: Only INJECT if gate conditions feel met. Otherwise SUPPRESS or HINT.\n- TWIST: Actively suppress unless narrative tension is high. These are your biggest payoffs.\n\nFor each entry, respond with a JSON array:\n[{"id":"<id>","action":"INJECT"|"HINT"|"SUPPRESS","relevance":<0-10>,"readiness":<0-10>,"reason":"<1 sentence>"}]\n\nINJECT=full content. HINT=breadcrumb only. SUPPRESS=hold back.\nBe patient. The food isn't going anywhere. Prefer HINT over INJECT for foreshadow/gated unless readiness is very high.\nReturn ONLY the JSON array.`;
    let responseText = '';
    try { responseText = await callScoringAI(prompt); } catch (err) { console.error('[Lexicon] Narrative scoring failed:', err); }
    const parsed = parseJsonArrayOfObjects(responseText);
    if (!parsed) return narrativeEntries.map(e => ({ id: e.id, relevance: 0, readiness: 0, action: NARRATIVE_ACTIONS.SUPPRESS }));
    const validIds = new Set(narrativeEntries.map(e => e.id));
    return parsed.filter(r => validIds.has(r.id)).map(r => ({
        id: r.id, relevance: clamp(r.relevance ?? 0, 0, 10), readiness: clamp(r.readiness ?? 0, 0, 10),
        action: normalizeAction(r.action), reason: r.reason || '',
    }));
}

async function generateHintText(entry) {
    const prompt = `You are a narrative hint generator. Write a SHORT, OBLIQUE breadcrumb that teases this lore without revealing the secret.\n\nENTRY: ${entry.title}: ${(entry.content || '').substring(0, 500)}\n\nWrite 1-2 sentences that reference the TOPIC without revealing specifics. Return ONLY the hint text.`;
    try { const hint = await callScoringAI(prompt); return (hint || '').trim().substring(0, 500); }
    catch { return `Something about ${entry.title}...`; }
}

function applyRelationshipBoost(scored, scoreable, allCandidates) {
    const selectedIds = new Set(scored.filter(s => s.action !== NARRATIVE_ACTIONS.SUPPRESS).map(s => s.id));
    const boostQueue = [];
    for (const s of scored) {
        if (s.action === NARRATIVE_ACTIONS.SUPPRESS) continue;
        const entry = allCandidates.find(e => e.id === s.id);
        if (!entry?.relatedIds?.length) continue;
        for (const relId of entry.relatedIds) {
            if (!selectedIds.has(relId) && allCandidates.find(e => e.id === relId)) {
                selectedIds.add(relId);
                boostQueue.push({ id: relId, relevance: 0.5, readiness: 5, action: NARRATIVE_ACTIONS.INJECT, boosted: true });
            }
        }
    }
    return [...scored, ...boostQueue];
}

async function callScoringAI(prompt) {
    const ctx = getContext();
    const settings = getSettings();
    if (ctx?.ConnectionManagerRequestService) {
        const profileId = resolveProfileId(settings.selectedProfile, ctx);
        if (profileId) {
            try {
                const response = await ctx.ConnectionManagerRequestService.sendRequest(profileId, [{ role: 'user', content: prompt }], 500, { extractData: true, includePreset: false, includeInstruct: false }, {});
                if (response?.content) return response.content;
            } catch (err) { console.warn('[Lexicon] CMRS failed, fallback:', err.message); }
        }
    }
    return await generateRaw(prompt, null, false, false, '', 500);
}

function resolveProfileId(profileName, ctx) {
    const cm = ctx?.extensionSettings?.connectionManager;
    if (!cm) return null;
    if (!profileName || profileName === 'current') return cm.selectedProfile;
    const profile = cm.profiles?.find(p => p.name === profileName);
    return profile?.id ?? cm.selectedProfile;
}

function shouldScan() {
    const settings = getSettings();
    const chatState = getChatState();
    const ctx = getContext();
    if (!settings.enabled || settings.triggerMode === 'manual') return false;
    const messageCount = ctx?.chat?.length || 0;
    if (settings.triggerMode === 'every_message') return true;
    if (settings.triggerMode === 'every_n') return (messageCount - (chatState.lastScanAt || 0)) >= (settings.triggerEveryN || 3);
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INJECTOR
// ═══════════════════════════════════════════════════════════════════════════════

const INJECT_KEY = 'lexicon_lore';
let PROMPT_TYPE_IN_CHAT = 1;
let isScanning = false;

async function scanAndInject(options = {}) {
    if (isScanning && !options.force) return;
    isScanning = true;
    try {
        const settings = getSettings();
        const chatState = getChatState();
        const ctx = getContext();
        const candidates = await getAllCandidateEntries();
        if (!candidates.length) { clearInjection(); chatState.currentInjectedIds = []; chatState.currentRelevanceScores = {}; chatState.narrativeActions = {}; saveChatData(); dispatchUpdateEvent(); return; }
        const context = getRecentContext(5);
        const scored = await scoreEntriesWithAI(candidates, context);
        const pinnedScored = scored.filter(s => s.pinned);
        const injectScored = scored.filter(s => !s.pinned && s.action === NARRATIVE_ACTIONS.INJECT).sort((a, b) => (b.relevance || 0) - (a.relevance || 0)).slice(0, settings.maxInjectedEntries);
        const hintScored = scored.filter(s => !s.pinned && s.action === NARRATIVE_ACTIONS.HINT).sort((a, b) => (b.relevance || 0) - (a.relevance || 0)).slice(0, Math.max(2, Math.floor(settings.maxInjectedEntries / 2)));
        const suppressedScored = scored.filter(s => s.action === NARRATIVE_ACTIONS.SUPPRESS && !s.pinned);
        const allActive = [...pinnedScored, ...injectScored, ...hintScored];
        const loreLines = [];
        for (const s of pinnedScored) { const e = candidates.find(c => c.id === s.id); if (e) loreLines.push(`[${e.title || 'Lore'}]\n${e.content || ''}`); }
        for (const s of injectScored) {
            const e = candidates.find(c => c.id === s.id);
            if (e) { loreLines.push(`[${e.title || 'Lore'}]\n${e.content || ''}`); recordFired(e); addTimelineEvent(chatState, e.id, e.title, 'INJECT', context.substring(0, 120)); }
        }
        for (const s of hintScored) {
            const e = candidates.find(c => c.id === s.id);
            if (e) {
                const hint = await resolveHintText(e, settings);
                if (hint) loreLines.push(`[NARRATIVE HINT — reference obliquely, do NOT reveal details]\n[${e.title || 'Lore Hint'}]\n${hint}`);
                recordSeed(e); addTimelineEvent(chatState, e.id, e.title, 'HINT', context.substring(0, 120));
            }
        }
        for (const s of suppressedScored) { const e = candidates.find(c => c.id === s.id); if (e && (s.relevance || 0) >= 3) addTimelineEvent(chatState, e.id, e.title, 'SUPPRESS', s.reason || 'Not ready'); }
        const scores = {}; const actions = {};
        for (const s of scored) { scores[s.id] = s.relevance ?? 0; actions[s.id] = s.action || NARRATIVE_ACTIONS.SUPPRESS; }
        chatState.currentRelevanceScores = scores; chatState.narrativeActions = actions;
        chatState.currentInjectedIds = allActive.map(s => s.id);
        chatState.lastScanAt = ctx?.chat?.length || 0; chatState.lastScanTime = Date.now();
        if (loreLines.length > 0) { setExtensionPrompt(INJECT_KEY, `<lore>\n${loreLines.join('\n\n---\n\n')}\n</lore>`, PROMPT_TYPE_IN_CHAT, settings.injectionDepth, false); }
        else { clearInjection(); }
        saveChatData(); saveSettings(); dispatchUpdateEvent();
    } catch (err) { console.error('[Lexicon] scanAndInject failed:', err); }
    finally { isScanning = false; }
}

function clearInjection() { try { setExtensionPrompt(INJECT_KEY, '', PROMPT_TYPE_IN_CHAT, 0, false); } catch (e) {} }

async function resolveHintText(entry, settings) {
    if (entry.hintText?.trim()) return entry.hintText;
    if (settings.autoHintGeneration) { try { const g = await generateHintText(entry); if (g) { entry.hintText = g; return g; } } catch {} }
    return `There is something significant about ${entry.title || 'this'} that may become important...`;
}

function dispatchUpdateEvent() { document.dispatchEvent(new CustomEvent('lexicon:updated')); }

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function parseJsonArray(text) {
    if (!text) return null;
    const cleaned = text.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*?\]/);
    if (!match) return null;
    try { const p = JSON.parse(match[0]); return Array.isArray(p) ? p : null; } catch { return null; }
}
function parseJsonArrayOfObjects(text) {
    if (!text) return null;
    const cleaned = text.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('['), end = cleaned.lastIndexOf(']');
    if (start === -1 || end <= start) return null;
    try { const p = JSON.parse(cleaned.substring(start, end + 1)); return Array.isArray(p) && p.length > 0 && typeof p[0] === 'object' ? p : null; } catch { return null; }
}
function normalizeAction(a) { const u = String(a || '').toUpperCase().trim(); if (u === 'INJECT') return NARRATIVE_ACTIONS.INJECT; if (u === 'HINT') return NARRATIVE_ACTIONS.HINT; return NARRATIVE_ACTIONS.SUPPRESS; }
function clamp(val, min, max) { return Math.max(min, Math.min(max, Number(val) || 0)); }
function xss(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ═══════════════════════════════════════════════════════════════════════════════
//  PUBLIC API (window.LexiconAPI)
// ═══════════════════════════════════════════════════════════════════════════════

function registerAPI() {
    window.LexiconAPI = {
        version: '2.0.0',
        isActive: () => getSettings()?.enabled === true,
        getTierMeta: () => ({ ...REVEAL_TIER_META }),
        getEntries: async (filter = {}) => {
            let r = await getAllCandidateEntries();
            if (filter.scope) r = r.filter(e => e.scope === filter.scope);
            if (filter.revealTier) r = r.filter(e => (e.revealTier || 'background') === filter.revealTier);
            if (filter.category) r = r.filter(e => (e.category || '').toLowerCase() === filter.category.toLowerCase());
            if (filter.enabledOnly !== false) r = r.filter(e => e.enabled !== false);
            return r.map(e => ({ ...e }));
        },
        getBackgroundEntries: async () => (await getAllCandidateEntries()).filter(e => (e.revealTier || 'background') === REVEAL_TIERS.BACKGROUND && e.enabled !== false).map(e => ({ ...e })),
        getHintableEntries: async () => (await getAllCandidateEntries()).filter(e => { const t = e.revealTier || 'background'; return (t === REVEAL_TIERS.FORESHADOW || t === REVEAL_TIERS.GATED) && e.enabled !== false && !e.chekhov?.firedAt; }).map(e => ({ id: e.id, title: e.title, hintText: e.hintText || '', category: e.category || '', revealTier: e.revealTier, seedCount: e.chekhov?.seedCount || 0, narrativeState: computeNarrativeState(e) })),
        getNarrativeState: async (entryId) => { const cs = await getAllCandidateEntries(); const e = cs.find(c => c.id === entryId); if (!e) return null; const chatState = getChatState(); return { narrativeState: computeNarrativeState(e), action: chatState?.narrativeActions?.[entryId] || null, relevance: chatState?.currentRelevanceScores?.[entryId] || null, seedCount: e.chekhov?.seedCount || 0, firedAt: e.chekhov?.firedAt || null, revealTier: e.revealTier || 'background' }; },
        getLoreContextBlock: async (maxEntries = 10) => {
            const bg = (await getAllCandidateEntries()).filter(e => (e.revealTier || 'background') === REVEAL_TIERS.BACKGROUND && e.enabled !== false);
            const hints = (await getAllCandidateEntries()).filter(e => { const t = e.revealTier || 'background'; return (t === REVEAL_TIERS.FORESHADOW || t === REVEAL_TIERS.GATED) && e.enabled !== false && !e.chekhov?.firedAt; });
            const parts = []; let count = 0;
            for (const e of bg) { if (count >= maxEntries) break; parts.push(`[${e.title || 'Lore'}]: ${(e.content || '').substring(0, 300)}`); count++; }
            for (const e of hints) { if (count >= maxEntries) break; parts.push(e.hintText ? `[Atmospheric — ${e.title || '???'}]: ${e.hintText}` : `[Atmospheric]: Something about ${e.title || 'this'}...`); count++; }
            return parts.join('\n');
        },
    };
    console.log('[Lexicon] Public API registered → window.LexiconAPI');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FAB — Spark's proven pattern (inline styles, #form_sheld attachment)
// ═══════════════════════════════════════════════════════════════════════════════

function createFAB() {
    if ($('#lexicon-fab').length) return;

    const fab = $('<button>', {
        id: 'lexicon-fab',
        title: 'Lexicon — Semantic Lore Engine',
        html: '<i class="fa-solid fa-book-open" style="pointer-events:none;"></i>'
    }).css({
        position: 'fixed',
        bottom: '130px',
        right: '15px',
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        border: '2px solid var(--SmartThemeBodyColor, rgba(255,255,255,0.3))',
        background: 'var(--SmartThemeBlurTintColor, rgba(20,20,35,0.9))',
        color: 'var(--SmartThemeBodyColor, #e8e0d0)',
        fontSize: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: '31000',
        boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
        padding: '0',
        margin: '0',
        pointerEvents: 'auto',
        overflow: 'visible',
    });

    // Attach to ST containers first, fall back to body
    const targets = ['#form_sheld', '#sheld', '#chat', 'body'];
    let attached = false;
    for (const sel of targets) {
        const target = $(sel);
        if (target.length) {
            target.append(fab);
            target.css('overflow', 'visible');
            attached = true;
            break;
        }
    }
    if (!attached) $('body').append(fab);

    // Touch drag (Spark pattern)
    let isDragging = false, wasDragged = false;
    let startX, startY, startRight, startBottom;

    fab.on('click', (e) => {
        if (wasDragged) { wasDragged = false; return; }
        e.preventDefault(); e.stopPropagation();
        togglePanel();
    });

    fab[0].addEventListener('touchstart', (e) => {
        isDragging = true; wasDragged = false;
        const touch = e.touches[0];
        startX = touch.clientX; startY = touch.clientY;
        const rect = fab[0].getBoundingClientRect();
        startRight = window.innerWidth - rect.right;
        startBottom = window.innerHeight - rect.bottom;
    }, { passive: true });

    fab[0].addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const touch = e.touches[0];
        const dx = touch.clientX - startX, dy = touch.clientY - startY;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
            wasDragged = true; e.preventDefault();
            fab.css({ right: Math.max(4, startRight - dx) + 'px', bottom: Math.max(4, startBottom - dy) + 'px' });
        }
    }, { passive: false });

    fab[0].addEventListener('touchend', () => { isDragging = false; }, { passive: true });

    // Self-healing (Spark pattern)
    setInterval(() => {
        if (getSettings().enabled && !$('#lexicon-fab').length) createFAB();
    }, 3000);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PANEL UI — tabs, entries, edit, timeline, settings, debug
// ═══════════════════════════════════════════════════════════════════════════════

let editingEntry = null;
let formGates = [];

function createPanel() {
    if ($('#lexicon-panel').length) return;

    const tierOptions = Object.entries(REVEAL_TIER_META).map(([val, m]) => `<option value="${val}">${m.icon} ${m.label}</option>`).join('');

    const html = `
<div id="lexicon-panel" class="lexicon-panel" style="display:none;">
  <div class="lexicon-header">
    <span class="lexicon-title"><i class="fa-solid fa-book-open"></i> ${EXT_DISPLAY_NAME} <span class="lex-version-tag">v2</span></span>
    <div class="lexicon-header-btns">
      <button class="lexicon-icon-btn" id="lexicon-scan-now" title="Scan now"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
      <button class="lexicon-icon-btn" id="lexicon-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
    </div>
  </div>
  <div class="lexicon-tabs">
    <button class="lexicon-tab active" data-tab="entries">Entries</button>
    <button class="lexicon-tab" data-tab="edit">Add/Edit</button>
    <button class="lexicon-tab" data-tab="timeline">Timeline</button>
    <button class="lexicon-tab" data-tab="settings">Settings</button>
    <button class="lexicon-tab" data-tab="debug">Debug</button>
  </div>
  <div class="lexicon-pane" id="lexicon-pane-entries">
    <div class="lexicon-filter-row">
      <select id="lex-scope-filter"><option value="all">All scopes</option><option value="global">Global</option><option value="character">Character</option><option value="chat">This chat</option><option value="lorebook">Lorebook</option></select>
      <select id="lex-tier-filter"><option value="all">All tiers</option><option value="background">🌍 Background</option><option value="foreshadow">🌙 Foreshadow</option><option value="gated">🔒 Gated</option><option value="twist">⚡ Twist</option></select>
      <input type="text" id="lex-search" placeholder="Search…" />
    </div>
    <div id="lex-entries-list" class="lex-entries-list"><div class="lex-empty">No entries yet.</div></div>
  </div>
  <div class="lexicon-pane" id="lexicon-pane-edit" style="display:none;">
    <div class="lex-form">
      <label>Title</label><input type="text" id="lex-f-title" placeholder="Entry title…" />
      <label>Category</label><input type="text" id="lex-f-category" placeholder="Character, Location…" list="lex-cat-list" /><datalist id="lex-cat-list">${CATEGORIES.map(c => `<option value="${c}">`).join('')}</datalist>
      <label>Scope</label><select id="lex-f-scope"><option value="global">Global</option><option value="character">Character</option><option value="chat">This chat</option></select>
      <div class="lex-inline-checks"><label class="lex-check"><input type="checkbox" id="lex-f-pinned" /> 📌 Always inject</label><label class="lex-check"><input type="checkbox" id="lex-f-enabled" checked /> Enabled</label></div>
      <label>Content</label><textarea id="lex-f-content" rows="5" placeholder="Lore content…"></textarea>
      <div class="lex-form-section-header">🎭 Narrative Pacing</div>
      <label>Reveal Tier</label><select id="lex-f-tier">${tierOptions}</select><div class="lex-tier-desc" id="lex-tier-desc"></div>
      <label>Hint Text <span class="lex-hint">(optional — AI generates if empty)</span></label><textarea id="lex-f-hint" rows="2" placeholder="Breadcrumb…"></textarea>
      <label>Gate Conditions <span class="lex-hint">(for Gated/Twist tiers)</span></label>
      <div id="lex-f-gates" class="lex-gate-list"></div>
      <div class="lex-gate-add-row"><input type="text" id="lex-f-gate-input" placeholder="e.g. Player visited the Whirling…" /><button class="lexicon-btn lexicon-btn-sm" id="lex-f-gate-add">+ Add</button></div>
      <label>Related IDs <span class="lex-hint">(comma separated)</span></label><input type="text" id="lex-f-related" placeholder="lex_abc123…" />
      <div class="lex-entry-id-display" id="lex-f-id-display" style="display:none;">ID: <code id="lex-f-id-text"></code></div>
      <div class="lex-form-actions">
        <button class="lexicon-btn lexicon-btn-primary" id="lex-save-btn"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        <button class="lexicon-btn" id="lex-cancel-btn" style="display:none;"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button class="lexicon-btn" id="lex-clear-form-btn"><i class="fa-solid fa-eraser"></i> Clear</button>
      </div>
    </div>
  </div>
  <div class="lexicon-pane" id="lexicon-pane-timeline" style="display:none;">
    <div class="lex-timeline-header"><span class="lex-timeline-title">Narrative Timeline</span><button class="lexicon-btn lexicon-btn-sm" id="lex-timeline-clear">Clear</button></div>
    <div id="lex-timeline-list" class="lex-timeline-list"><div class="lex-empty">No events yet.</div></div>
  </div>
  <div class="lexicon-pane lex-settings-pane" id="lexicon-pane-settings" style="display:none;">
    <div class="lex-setting-group"><label class="lex-check"><input type="checkbox" id="lex-s-enabled" /> <b>Enable Lexicon</b></label></div>
    <div class="lex-setting-group"><label class="lex-check"><input type="checkbox" id="lex-s-pacing" /> <b>Narrative Pacing</b></label><div class="lex-hint">Off = relevance-only (v1 mode).</div></div>
    <div class="lex-setting-group"><label class="lex-check"><input type="checkbox" id="lex-s-autohint" /> Auto-generate hints</label></div>
    <div class="lex-setting-group"><div class="lex-setting-label"><b>Scan Trigger</b></div>
      <label class="lex-check"><input type="radio" name="lex-trigger" value="every_message" /> Every response</label>
      <label class="lex-check"><input type="radio" name="lex-trigger" value="every_n" /> Every N messages</label>
      <div id="lex-every-n-row" style="display:none;margin-left:20px;"><input type="number" id="lex-s-n" min="1" max="20" value="3" style="width:50px;" /> between scans</div>
      <label class="lex-check"><input type="radio" name="lex-trigger" value="manual" /> Manual only</label>
    </div>
    <div class="lex-setting-group"><div class="lex-setting-label"><b>Max entries</b> <span id="lex-max-val">5</span></div><input type="range" id="lex-s-max" min="1" max="10" value="5" /></div>
    <div class="lex-setting-group"><div class="lex-setting-label"><b>Injection depth</b> <span id="lex-depth-val">1</span></div><input type="range" id="lex-s-depth" min="0" max="6" value="1" /></div>
    <div class="lex-setting-group"><div class="lex-setting-label"><b>Connection profile</b></div><select id="lex-s-profile"><option value="current">Current connection</option></select><div class="lex-hint">Point at a cheap model.</div></div>
    <div class="lex-setting-group"><label class="lex-check"><input type="checkbox" id="lex-s-lorebook" /> Bridge lorebooks</label><div class="lex-hint" id="lex-lorebook-status"></div></div>
    <div class="lex-setting-group"><label class="lex-check"><input type="checkbox" id="lex-s-debug-badge" /> Show badge</label></div>
    <div class="lex-setting-group"><div class="lex-btn-row"><button class="lexicon-btn" id="lex-export-btn"><i class="fa-solid fa-download"></i> Export</button><button class="lexicon-btn" id="lex-import-btn"><i class="fa-solid fa-upload"></i> Import</button><input type="file" id="lex-import-file" accept=".json" style="display:none;" /></div></div>
    <div class="lex-setting-group"><button class="lexicon-btn lexicon-btn-danger" id="lex-clear-all-btn"><i class="fa-solid fa-trash"></i> Clear all entries</button></div>
  </div>
  <div class="lexicon-pane" id="lexicon-pane-debug" style="display:none;">
    <div class="lex-debug-block"><span class="lex-debug-label">Last scan</span> <span id="lex-d-time">never</span><br/><span class="lex-debug-label">Trigger</span> <span id="lex-d-trigger">—</span><br/><span class="lex-debug-label">Depth</span> <span id="lex-d-depth">—</span><br/><span class="lex-debug-label">Pool</span> <span id="lex-d-pool">—</span><br/><span class="lex-debug-label">Lorebook</span> <span id="lex-d-lorebook">—</span><br/><span class="lex-debug-label">Pacing</span> <span id="lex-d-pacing">—</span></div>
    <div class="lex-debug-section"><div class="lex-debug-heading">Narrative Actions</div><div id="lex-d-narrative">No scan yet.</div></div>
    <div class="lex-debug-section"><div class="lex-debug-heading">All Scored</div><div id="lex-d-all-scored">No scan yet.</div></div>
    <div class="lex-btn-row" style="margin-top:12px;"><button class="lexicon-btn lexicon-btn-primary" id="lex-d-scan-btn"><i class="fa-solid fa-wand-magic-sparkles"></i> Scan</button><button class="lexicon-btn" id="lex-d-clear-btn"><i class="fa-solid fa-ban"></i> Clear</button></div>
  </div>
</div>`;
    $('body').append(html);
    bindPanelEvents();
}

function destroyUI() { $('#lexicon-fab').remove(); $('#lexicon-panel').remove(); $('#lexicon-debug-badge').remove(); }

function togglePanel() { $('#lexicon-panel').is(':visible') ? $('#lexicon-panel').fadeOut(150) : openPanel(); }
function openPanel() { $('#lexicon-panel').fadeIn(150); const t = $('.lexicon-tab.active').data('tab') || 'entries'; gotoTab(t); }
function gotoTab(name) {
    $('.lexicon-tab').removeClass('active'); $(`.lexicon-tab[data-tab="${name}"]`).addClass('active');
    $('.lexicon-pane').hide(); $(`#lexicon-pane-${name}`).show();
    if (name === 'entries') renderEntriesList(); if (name === 'edit') updateTierDesc();
    if (name === 'timeline') renderTimeline(); if (name === 'settings') renderSettingsTab(); if (name === 'debug') renderDebugTab();
}

// ─── Panel Event Binding ──────────────────────────────────────────────────────

function bindPanelEvents() {
    $('#lexicon-close').on('click', () => $('#lexicon-panel').fadeOut(150));
    $('#lexicon-scan-now').on('click', runManualScan);
    $(document).on('click', '.lexicon-tab[data-tab]', function () { gotoTab($(this).data('tab')); });
    $(document).on('input', '#lex-search', () => renderEntriesList());
    $(document).on('change', '#lex-scope-filter, #lex-tier-filter', () => renderEntriesList());
    $('#lex-save-btn').on('click', panelSaveEntry);
    $('#lex-cancel-btn').on('click', cancelEdit);
    $('#lex-clear-form-btn').on('click', clearForm);
    $('#lex-f-tier').on('change', updateTierDesc);
    $('#lex-f-gate-add').on('click', addGateCondition);
    $('#lex-f-gate-input').on('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addGateCondition(); } });
    $('#lex-s-enabled').on('change', function () { getSettings().enabled = this.checked; saveSettings(); if (!this.checked) clearInjection(); });
    $('#lex-s-pacing').on('change', function () { getSettings().enableNarrativePacing = this.checked; saveSettings(); });
    $('#lex-s-autohint').on('change', function () { getSettings().autoHintGeneration = this.checked; saveSettings(); });
    $(document).on('change', 'input[name="lex-trigger"]', function () { getSettings().triggerMode = this.value; saveSettings(); $('#lex-every-n-row').toggle(this.value === 'every_n'); });
    $('#lex-s-n').on('change', function () { getSettings().triggerEveryN = parseInt(this.value) || 3; saveSettings(); });
    $('#lex-s-max').on('input', function () { const v = parseInt(this.value); getSettings().maxInjectedEntries = v; $('#lex-max-val').text(v); saveSettings(); });
    $('#lex-s-depth').on('input', function () { const v = parseInt(this.value); getSettings().injectionDepth = v; $('#lex-depth-val').text(v); saveSettings(); });
    $('#lex-s-profile').on('change', function () { getSettings().selectedProfile = this.value; saveSettings(); });
    $('#lex-s-lorebook').on('change', function () { getSettings().bridgeLorebooks = this.checked; clearLorebookCache(); saveSettings(); });
    $('#lex-s-debug-badge').on('change', function () { getSettings().showDebugOverlay = this.checked; saveSettings(); });
    $('#lex-export-btn').on('click', () => { const b = new Blob([exportCompendium()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `lexicon_${Date.now()}.json`; a.click(); toastr.success('Exported'); });
    $('#lex-import-btn').on('click', () => $('#lex-import-file').click());
    $('#lex-import-file').on('change', function () { const f = this.files[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => { const res = importCompendium(ev.target.result); if (res.success) { toastr.success(`Imported ${res.count} entries`); renderEntriesList(); } else toastr.error(`Import failed: ${res.error}`); }; r.readAsText(f); this.value = ''; });
    $('#lex-clear-all-btn').on('click', () => { if (!confirm('Clear ALL entries?')) return; const s = getSettings(); s.entries = []; s.characterEntries = {}; saveSettings(); clearInjection(); renderEntriesList(); toastr.info('Cleared'); });
    $('#lex-timeline-clear').on('click', () => { if (!confirm('Clear timeline?')) return; getChatState().narrativeTimeline = []; saveChatData(); renderTimeline(); });
    $('#lex-d-scan-btn').on('click', runManualScan);
    $('#lex-d-clear-btn').on('click', () => { clearInjection(); const s = getChatState(); s.currentInjectedIds = []; s.currentRelevanceScores = {}; s.narrativeActions = {}; saveChatData(); renderDebugTab(); });
    $(document).on('click', '.lex-gate-toggle', function () { toggleGateOnEntry($(this).closest('.lex-entry-card').data('id'), $(this).data('gate-idx')); });
    document.addEventListener('lexicon:updated', () => { if ($('#lexicon-pane-entries').is(':visible')) renderEntriesList(); if ($('#lexicon-pane-debug').is(':visible')) renderDebugTab(); if ($('#lexicon-pane-timeline').is(':visible')) renderTimeline(); });
}

// ─── Render: Entries ──────────────────────────────────────────────────────────

function renderEntriesList() {
    const settings = getSettings(); const chatState = getChatState(); const ctx = getContext(); const charKey = getCharacterKey(ctx);
    const scopeFilter = $('#lex-scope-filter').val() || 'all'; const tierFilter = $('#lex-tier-filter').val() || 'all';
    const searchRaw = ($('#lex-search').val() || '').toLowerCase().trim();
    let all = [];
    for (const e of (settings.entries || [])) all.push({ ...e, _displayScope: 'global' });
    if (charKey && settings.characterEntries?.[charKey]) for (const e of settings.characterEntries[charKey]) all.push({ ...e, _displayScope: 'character' });
    if (chatState?.chatEntries) for (const e of chatState.chatEntries) all.push({ ...e, _displayScope: 'chat' });
    if (scopeFilter !== 'all') all = all.filter(e => scopeFilter === 'lorebook' ? e.fromLorebook : e._displayScope === scopeFilter);
    if (tierFilter !== 'all') all = all.filter(e => (e.revealTier || 'background') === tierFilter);
    if (searchRaw) all = all.filter(e => (e.title || '').toLowerCase().includes(searchRaw) || (e.content || '').toLowerCase().includes(searchRaw) || (e.category || '').toLowerCase().includes(searchRaw));
    if (!all.length) { $('#lex-entries-list').html('<div class="lex-empty">No entries match.</div>'); return; }
    const actions = chatState?.narrativeActions || {}; const scores = chatState?.currentRelevanceScores || {};
    const html = all.map(e => {
        const action = actions[e.id]; const tierMeta = REVEAL_TIER_META[e.revealTier || 'background'];
        const narState = computeNarrativeState(e); const seeds = e.chekhov?.seedCount || 0;
        const isActive = action === NARRATIVE_ACTIONS.INJECT || action === NARRATIVE_ACTIONS.HINT;
        const preview = (e.content || '').substring(0, 100).replace(/\n/g, ' ');
        let actionBadge = '';
        if (action === NARRATIVE_ACTIONS.INJECT) actionBadge = '<span class="lex-badge lex-action-inject">✓ INJECTED</span>';
        else if (action === NARRATIVE_ACTIONS.HINT) actionBadge = '<span class="lex-badge lex-action-hint">🌙 HINTED</span>';
        else if (action === NARRATIVE_ACTIONS.SUPPRESS) actionBadge = '<span class="lex-badge lex-action-suppress">🔇 SUPPRESSED</span>';
        const stateBadges = { dormant: '<span class="lex-badge lex-state-dormant">dormant</span>', seeding: `<span class="lex-badge lex-state-seeding">seeding (${seeds})</span>`, ready: '<span class="lex-badge lex-state-ready">✓ ready</span>', revealed: '<span class="lex-badge lex-state-revealed">revealed</span>' };
        let gateHtml = '';
        if (e.gateConditions?.length > 0) gateHtml = '<div class="lex-entry-gates">' + e.gateConditions.map((g, i) => `<span class="lex-gate-toggle ${g.met ? 'lex-gate-met' : ''}" data-gate-idx="${i}">  ${g.met ? '☑' : '☐'} ${xss(g.text)}</span>`).join('') + '</div>';
        return `<div class="lex-entry-card ${isActive ? 'lex-entry-active' : ''} lex-tier-${e.revealTier || 'background'}" data-id="${xss(e.id)}">
  <div class="lex-entry-top"><div class="lex-entry-info"><span class="lex-entry-title">${xss(e.title || 'Untitled')}</span> <span class="lex-badge lex-tier-badge" style="border-color:${tierMeta.color}">${tierMeta.icon}</span> ${e.category ? `<span class="lex-badge lex-cat-badge">${xss(e.category)}</span>` : ''} <span class="lex-badge lex-scope-badge lex-scope-${e._displayScope}">${e._displayScope}</span> ${e.pinned ? '📌' : ''} ${actionBadge} ${(e.revealTier || 'background') !== 'background' ? (stateBadges[narState] || '') : ''} ${e.fromLorebook ? '<span class="lex-badge lex-lb-badge">lorebook</span>' : ''}</div>
  <div class="lex-entry-btns">${!e.fromLorebook ? `<button class="lexicon-icon-btn lex-edit-entry" data-id="${xss(e.id)}" data-scope="${xss(e._displayScope)}"><i class="fa-solid fa-pen-to-square"></i></button><button class="lexicon-icon-btn lex-delete-entry" data-id="${xss(e.id)}" data-scope="${xss(e._displayScope)}"><i class="fa-solid fa-trash"></i></button>` : ''}</div></div>
  ${seeds > 0 ? `<div class="lex-chekhov-bar"><span class="lex-chekhov-label">Seeds:</span> ${'●'.repeat(Math.min(seeds, 10))}${'○'.repeat(Math.max(0, 10 - seeds))}</div>` : ''}${gateHtml}
  ${preview ? `<div class="lex-entry-preview">${xss(preview)}${e.content?.length > 100 ? '…' : ''}</div>` : ''}</div>`;
    }).join('');
    $('#lex-entries-list').html(html);
    $('.lex-edit-entry').off('click').on('click', function () { openEditEntry($(this).data('id'), $(this).data('scope')); });
    $('.lex-delete-entry').off('click').on('click', function () { deleteEntry($(this).data('id'), $(this).data('scope')); });
}

// ─── Render: Timeline ─────────────────────────────────────────────────────────

function renderTimeline() {
    const tl = getChatState()?.narrativeTimeline || [];
    if (!tl.length) { $('#lex-timeline-list').html('<div class="lex-empty">No events yet.</div>'); return; }
    const icons = { INJECT: '<span class="lex-tl-inject">✦</span>', HINT: '<span class="lex-tl-hint">🌙</span>', SUPPRESS: '<span class="lex-tl-suppress">🔇</span>' };
    $('#lex-timeline-list').html([...tl].reverse().map(ev => {
        const time = new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<div class="lex-timeline-event lex-tl-${(ev.action || '').toLowerCase()}"><div class="lex-tl-line"></div><div class="lex-tl-content">${icons[ev.action] || '·'} <span class="lex-tl-title">${xss(ev.entryTitle)}</span> <span class="lex-tl-action">${ev.action}</span> <span class="lex-tl-time">${time}</span>${ev.context ? `<div class="lex-tl-context">${xss(ev.context)}</div>` : ''}</div></div>`;
    }).join(''));
}

// ─── Render: Settings & Debug ─────────────────────────────────────────────────

function renderSettingsTab() {
    const s = getSettings(); const ctx = getContext();
    $('#lex-s-enabled').prop('checked', s.enabled); $('#lex-s-pacing').prop('checked', s.enableNarrativePacing);
    $('#lex-s-autohint').prop('checked', s.autoHintGeneration);
    $(`input[name="lex-trigger"][value="${s.triggerMode}"]`).prop('checked', true);
    $('#lex-every-n-row').toggle(s.triggerMode === 'every_n'); $('#lex-s-n').val(s.triggerEveryN);
    $('#lex-s-max').val(s.maxInjectedEntries); $('#lex-max-val').text(s.maxInjectedEntries);
    $('#lex-s-depth').val(s.injectionDepth); $('#lex-depth-val').text(s.injectionDepth);
    $('#lex-s-lorebook').prop('checked', s.bridgeLorebooks); $('#lex-s-debug-badge').prop('checked', s.showDebugOverlay);
    const lbH = { ok: '✅ Loaded', unavailable: '⚠️ Unavailable', disabled: '', unknown: '' };
    $('#lex-lorebook-status').text(lbH[lorebookStatus] || '');
    const $p = $('#lex-s-profile').empty().append('<option value="current">Current</option>');
    (ctx?.extensionSettings?.connectionManager?.profiles || []).forEach(p => $p.append(`<option value="${p.name}">${p.name}</option>`));
    $p.val(s.selectedProfile);
}

async function renderDebugTab() {
    const s = getSettings(); const cs = getChatState();
    $('#lex-d-time').text(cs.lastScanTime ? new Date(cs.lastScanTime).toLocaleTimeString() : 'Never');
    $('#lex-d-trigger').text(s.triggerMode); $('#lex-d-depth').text(s.injectionDepth);
    $('#lex-d-lorebook').text(lorebookStatus); $('#lex-d-pacing').text(s.enableNarrativePacing ? 'ON' : 'OFF');
    try {
        const cands = await getAllCandidateEntries(); $('#lex-d-pool').text(`${cands.length}`);
        const acts = cs.narrativeActions || {}; const scores = cs.currentRelevanceScores || {};
        const counts = { INJECT: 0, HINT: 0, SUPPRESS: 0 }; Object.values(acts).forEach(a => { if (counts[a] !== undefined) counts[a]++; });
        $('#lex-d-narrative').html(`<div class="lex-debug-counts"><span class="lex-action-inject">✦ ${counts.INJECT}</span> <span class="lex-action-hint">🌙 ${counts.HINT}</span> <span class="lex-action-suppress">🔇 ${counts.SUPPRESS}</span></div>` + Object.entries(acts).map(([id, a]) => { const e = cands.find(c => c.id === id); return `<div class="lex-debug-entry lex-debug-action-${a.toLowerCase()}">${xss(e?.title || id)} <span class="lex-badge">${a}</span></div>`; }).join(''));
        const allScored = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        $('#lex-d-all-scored').html(!allScored.length ? '<i>No data.</i>' : allScored.map(([id, sc]) => { const e = cands.find(c => c.id === id); return `<div class="lex-debug-entry">${REVEAL_TIER_META[e?.revealTier || 'background']?.icon || ''} ${xss(e?.title || id)} <span class="lex-score">${typeof sc === 'number' ? sc.toFixed(1) : sc}</span> <span class="lex-badge">${acts[id] || '—'}</span></div>`; }).join(''));
    } catch { $('#lex-d-pool').text('error'); }
}

async function runManualScan() {
    $('#lexicon-scan-now, #lex-d-scan-btn').prop('disabled', true);
    toastr.info('Scanning…', '', { timeOut: 2000 });
    await scanAndInject({ force: true });
    if ($('#lexicon-pane-debug').is(':visible')) renderDebugTab();
    if ($('#lexicon-pane-entries').is(':visible')) renderEntriesList();
    if ($('#lexicon-pane-timeline').is(':visible')) renderTimeline();
    $('#lexicon-scan-now, #lex-d-scan-btn').prop('disabled', false);
}

// ─── Edit Tab Helpers ─────────────────────────────────────────────────────────

function panelSaveEntry() {
    const title = $('#lex-f-title').val().trim(); const content = $('#lex-f-content').val().trim();
    if (!title) { toastr.warning('Enter a title'); return; } if (!content) { toastr.warning('Enter content'); return; }
    const settings = getSettings(); const chatState = getChatState(); const ctx = getContext(); const charKey = getCharacterKey(ctx);
    const scope = $('#lex-f-scope').val();
    const entry = {
        id: editingEntry?.id || generateEntryId(), title, content,
        category: $('#lex-f-category').val().trim(), pinned: $('#lex-f-pinned').prop('checked'),
        enabled: $('#lex-f-enabled').prop('checked'), scope,
        relatedIds: $('#lex-f-related').val().trim() ? $('#lex-f-related').val().trim().split(',').map(s => s.trim()).filter(Boolean) : [],
        revealTier: $('#lex-f-tier').val() || REVEAL_TIERS.BACKGROUND,
        hintText: $('#lex-f-hint').val().trim(), gateConditions: [...formGates],
        chekhov: editingEntry?.chekhov || { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null },
        narrativeState: editingEntry?.narrativeState || NARRATIVE_STATES.DORMANT,
    };
    entry.narrativeState = computeNarrativeState(entry);
    if (editingEntry) removeEntryFromStore(editingEntry.id, editingEntry._displayScope || scope, settings, chatState, charKey);
    if (scope === 'global') { settings.entries.push(entry); saveSettings(); }
    else if (scope === 'character') { if (!charKey) { settings.entries.push(entry); saveSettings(); } else { if (!settings.characterEntries[charKey]) settings.characterEntries[charKey] = []; settings.characterEntries[charKey].push(entry); saveSettings(); } }
    else if (scope === 'chat') { if (!chatState.chatEntries) chatState.chatEntries = []; chatState.chatEntries.push(entry); saveChatData(); }
    toastr.success(`"${title}" saved`); cancelEdit(); gotoTab('entries');
}

function openEditEntry(id, scope) {
    const entry = findEntry(id, scope); if (!entry) { toastr.error('Not found'); return; }
    editingEntry = { ...entry, _displayScope: scope };
    $('#lex-f-title').val(entry.title || ''); $('#lex-f-content').val(entry.content || '');
    $('#lex-f-category').val(entry.category || ''); $('#lex-f-scope').val(scope);
    $('#lex-f-pinned').prop('checked', entry.pinned || false); $('#lex-f-enabled').prop('checked', entry.enabled !== false);
    $('#lex-f-related').val((entry.relatedIds || []).join(', ')); $('#lex-f-tier').val(entry.revealTier || 'background');
    $('#lex-f-hint').val(entry.hintText || ''); $('#lex-f-id-text').text(entry.id); $('#lex-f-id-display').show(); $('#lex-cancel-btn').show();
    formGates = (entry.gateConditions || []).map(g => ({ ...g })); renderFormGates(); updateTierDesc(); gotoTab('edit');
}

function deleteEntry(id, scope) {
    if (!confirm('Delete?')) return;
    removeEntryFromStore(id, scope, getSettings(), getChatState(), getCharacterKey(getContext()));
    renderEntriesList(); toastr.info('Deleted');
}

function cancelEdit() { editingEntry = null; clearForm(); $('#lex-cancel-btn').hide(); $('#lex-f-id-display').hide(); }
function clearForm() { $('#lex-f-title, #lex-f-content, #lex-f-category, #lex-f-related, #lex-f-hint').val(''); $('#lex-f-scope').val('global'); $('#lex-f-tier').val('background'); $('#lex-f-pinned').prop('checked', false); $('#lex-f-enabled').prop('checked', true); $('#lex-f-id-display').hide(); formGates = []; renderFormGates(); editingEntry = null; $('#lex-cancel-btn').hide(); }
function updateTierDesc() { const m = REVEAL_TIER_META[$('#lex-f-tier').val() || 'background']; if (m) $('#lex-tier-desc').html(`<span style="color:${m.color}">${m.icon} ${m.desc}</span>`); }

function addGateCondition() { const t = $('#lex-f-gate-input').val().trim(); if (!t) return; formGates.push({ text: t, met: false }); $('#lex-f-gate-input').val(''); renderFormGates(); }
function renderFormGates() {
    const $l = $('#lex-f-gates');
    if (!formGates.length) { $l.html('<div class="lex-hint">No conditions.</div>'); return; }
    $l.html(formGates.map((g, i) => `<div class="lex-gate-item"><label class="lex-check"><input type="checkbox" class="lex-form-gate-check" data-idx="${i}" ${g.met ? 'checked' : ''} /> ${xss(g.text)}</label><button class="lexicon-icon-btn lex-form-gate-del" data-idx="${i}"><i class="fa-solid fa-xmark"></i></button></div>`).join(''));
    $l.find('.lex-form-gate-check').off('change').on('change', function () { if (formGates[$(this).data('idx')]) formGates[$(this).data('idx')].met = this.checked; });
    $l.find('.lex-form-gate-del').off('click').on('click', function () { formGates.splice($(this).data('idx'), 1); renderFormGates(); });
}

function toggleGateOnEntry(entryId, gateIdx) {
    const settings = getSettings(); const chatState = getChatState(); const charKey = getCharacterKey(getContext());
    const entry = findEntryAcrossStores(entryId, settings, chatState, charKey);
    if (!entry || !entry.gateConditions?.[gateIdx]) return;
    entry.gateConditions[gateIdx].met = !entry.gateConditions[gateIdx].met;
    entry.narrativeState = computeNarrativeState(entry);
    saveSettings(); saveChatData(); renderEntriesList();
}

function findEntry(id, scope) {
    const s = getSettings(); const cs = getChatState(); const ck = getCharacterKey(getContext());
    if (scope === 'global') return s.entries.find(e => e.id === id);
    if (scope === 'character' && ck) return s.characterEntries?.[ck]?.find(e => e.id === id);
    if (scope === 'chat') return cs?.chatEntries?.find(e => e.id === id);
    return null;
}
function findEntryAcrossStores(id, settings, chatState, charKey) {
    return settings.entries?.find(e => e.id === id) || (charKey && settings.characterEntries?.[charKey]?.find(e => e.id === id)) || chatState?.chatEntries?.find(e => e.id === id) || null;
}
function removeEntryFromStore(id, scope, settings, chatState, charKey) {
    if (scope === 'global') { settings.entries = settings.entries.filter(e => e.id !== id); saveSettings(); }
    else if (scope === 'character' && charKey && settings.characterEntries?.[charKey]) { settings.characterEntries[charKey] = settings.characterEntries[charKey].filter(e => e.id !== id); saveSettings(); }
    else if (scope === 'chat' && chatState?.chatEntries) { chatState.chatEntries = chatState.chatEntries.filter(e => e.id !== id); saveChatData(); }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SETTINGS PANEL (Extensions drawer)
// ═══════════════════════════════════════════════════════════════════════════════

function addExtensionSettingsPanel() {
    const s = getSettings();
    const html = `<div class="inline-drawer" id="lexicon-ext-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>📚 ${EXT_DISPLAY_NAME} — Semantic Lore Engine</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><label class="checkbox_label"><input type="checkbox" id="lexicon-master-toggle" ${s.enabled ? 'checked' : ''} /><span>Enable Lexicon</span></label><p style="margin:6px 0 0;opacity:0.7;font-size:0.85em;line-height:1.4;">Lexicon uses AI to semantically score and <b>pace</b> your lore entries. Open the 📚 button to manage entries, set reveal tiers, and watch the timeline.</p></div></div>`;
    $('#extensions_settings2').append(html);
    $('#lexicon-master-toggle').on('change', function () {
        const s = getSettings(); s.enabled = this.checked; saveSettings();
        if (s.enabled) { createFAB(); createPanel(); loadChatData(); sanitizeChatState(); registerAPI(); }
        else { clearInjection(); destroyUI(); }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════════

jQuery(async () => {
    try {
        console.log(`[${EXT_ID}] v${EXT_VERSION} init…`);
        if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = {};
        sanitizeSettings();
        try { addExtensionSettingsPanel(); } catch (e) { console.warn('[Lexicon] Settings panel:', e); }
        const settings = getSettings();
        if (!settings.enabled) { console.log('[Lexicon] Disabled'); return; }
        createFAB();
        createPanel();
        const ctx = getContext();
        if (ctx?.chat?.length > 0) { loadChatData(); sanitizeChatState(); }
        eventSource.on(event_types.MESSAGE_RECEIVED, async () => { if (getSettings().enabled && shouldScan()) await scanAndInject(); });
        eventSource.on(event_types.CHAT_CHANGED, () => { clearLorebookCache(); loadChatData(); sanitizeChatState(); if (getSettings().enabled && shouldScan()) setTimeout(() => scanAndInject(), 300); });
        registerAPI();
        console.log(`[Lexicon] ✅ v${EXT_VERSION} ready`);
        toastr.success('Lexicon v2 loaded', '', { timeOut: 2000 });
    } catch (err) {
        console.error('[Lexicon] ❌ Init:', err);
        toastr.error(`Lexicon failed: ${err.message}`, '', { timeOut: 8000 });
    }
});
