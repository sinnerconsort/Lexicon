import { saveSettingsDebounced, saveChatDebounced, chat_metadata } from '../../../../../script.js';
import { getSettings, getChatState } from './state.js';
import { EXT_ID, DEFAULT_CHAT_STATE } from './config.js';

export function saveSettings() {
    saveSettingsDebounced();
}

export function saveChatData() {
    if (!chat_metadata) return;
    saveChatDebounced();
}

export function loadChatData() {
    const state = getChatState();
    return state;
}

export function resetChatData() {
    if (!chat_metadata) return;
    chat_metadata[EXT_ID] = JSON.parse(JSON.stringify(DEFAULT_CHAT_STATE));
    saveChatDebounced();
}

export function exportCompendium() {
    const settings = getSettings();
    const chatState = getChatState();
    const exportData = {
        version: 2,
        exported: new Date().toISOString(),
        entries: settings.entries,
        characterEntries: settings.characterEntries,
        // v2: include narrative timeline from current chat
        narrativeTimeline: chatState?.narrativeTimeline || [],
    };
    return JSON.stringify(exportData, null, 2);
}

export function importCompendium(jsonString, mode = 'merge') {
    try {
        const data = JSON.parse(jsonString);
        let convertedEntries = [];

        // ── Detect format ─────────────────────────────────────────────
        if (data.entries && Array.isArray(data.entries) && data.entries[0]?.revealTier) {
            // Lexicon native format
            convertedEntries = data.entries;

        } else if (data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
            // ST World Info format: { entries: { "0": { uid, key, content, comment }, "1": {...} } }
            convertedEntries = convertSTLorebookEntries(Object.values(data.entries));

        } else if (data.entries && Array.isArray(data.entries) && data.entries[0]?.key !== undefined) {
            // ST Character Book format: { entries: [ { uid, key, content, comment }, ... ] }
            convertedEntries = convertSTLorebookEntries(data.entries);

        } else if (data.character_book?.entries) {
            // Embedded in a character card export
            const raw = Array.isArray(data.character_book.entries)
                ? data.character_book.entries
                : Object.values(data.character_book.entries);
            convertedEntries = convertSTLorebookEntries(raw);

        } else if (data.data?.character_book?.entries) {
            // V2 card spec: { data: { character_book: { entries: [...] } } }
            const raw = Array.isArray(data.data.character_book.entries)
                ? data.data.character_book.entries
                : Object.values(data.data.character_book.entries);
            convertedEntries = convertSTLorebookEntries(raw);

        } else {
            throw new Error('Unrecognized format — expected Lexicon export, ST lorebook, or character book JSON');
        }

        if (!convertedEntries.length) {
            throw new Error('No valid entries found in file');
        }

        // ── Merge or replace ──────────────────────────────────────────
        const settings = getSettings();

        if (mode === 'replace') {
            settings.entries = convertedEntries;
            settings.characterEntries = data.characterEntries || settings.characterEntries;
        } else {
            const existingIds = new Set(settings.entries.map(e => e.id));
            // Also deduplicate by title+content hash to catch re-imports
            const existingHashes = new Set(settings.entries.map(e => `${e.title}|||${(e.content || '').substring(0, 100)}`));
            const newEntries = convertedEntries.filter(e => {
                if (existingIds.has(e.id)) return false;
                const hash = `${e.title}|||${(e.content || '').substring(0, 100)}`;
                if (existingHashes.has(hash)) return false;
                return true;
            });
            settings.entries = [...settings.entries, ...newEntries];

            // Handle Lexicon native characterEntries if present
            if (data.characterEntries) {
                for (const [key, entries] of Object.entries(data.characterEntries)) {
                    if (!settings.characterEntries[key]) {
                        settings.characterEntries[key] = entries;
                    } else {
                        const eIds = new Set(settings.characterEntries[key].map(e => e.id));
                        settings.characterEntries[key] = [
                            ...settings.characterEntries[key],
                            ...entries.filter(e => !eIds.has(e.id)),
                        ];
                    }
                }
            }
        }

        saveSettings();
        return { success: true, count: convertedEntries.length };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Convert ST lorebook/world-info entries to Lexicon format.
 * All entries come in as "Background" tier — user tags them after import.
 */
function convertSTLorebookEntries(rawEntries) {
    return rawEntries
        .filter(e => e && (e.content || e.comment))
        .map(e => {
            const keywords = Array.isArray(e.key) ? e.key : (e.key ? [e.key] : []);
            const title = e.comment || keywords[0] || 'Lorebook Entry';
            return {
                id: `lb_${e.uid ?? e.id ?? Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                title,
                content: e.content || '',
                category: guessCategory(title, e.content || ''),
                scope: 'global',
                pinned: e.constant || false,
                enabled: e.enabled !== false && !e.disable && !e.disabled,
                relatedIds: [],
                fromLorebook: true,
                lorebookKey: keywords,
                // Narrative pacing — defaults, user tags after import
                revealTier: 'background',
                hintText: '',
                gateConditions: [],
                chekhov: { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null },
                narrativeState: 'dormant',
            };
        });
}

/**
 * Rough auto-guess for entry category based on title/content keywords.
 */
function guessCategory(title, content) {
    const text = `${title} ${content}`.toLowerCase();
    if (/\b(city|town|village|district|street|building|tavern|palace|ruin|forest|mountain|river|sea|region|ward|quarter)\b/.test(text)) return 'Location';
    if (/\b(faction|guild|order|organization|church|army|group|gang|syndicate|party|union)\b/.test(text)) return 'Faction';
    if (/\b(sword|weapon|armor|potion|artifact|ring|amulet|scroll|item|tool)\b/.test(text)) return 'Item';
    if (/\b(war|battle|event|festival|ritual|ceremony|treaty|incident|rebellion|revolution)\b/.test(text)) return 'Event';
    if (/\b(magic|spell|rule|mechanic|system|law|physics|lore)\b/.test(text)) return 'Concept';
    if (/\b(history|ancient|origin|founding|era|age|century|legacy)\b/.test(text)) return 'History';
    return 'Lore';
}
