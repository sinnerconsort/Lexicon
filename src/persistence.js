import { saveSettingsDebounced, saveChatDebounced, chat_metadata } from '../../../../script.js';
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
        if (!data.entries || !Array.isArray(data.entries)) {
            throw new Error('Invalid compendium: missing entries array');
        }

        const settings = getSettings();

        if (mode === 'replace') {
            settings.entries = data.entries;
            settings.characterEntries = data.characterEntries || {};
        } else {
            const existingIds = new Set(settings.entries.map(e => e.id));
            const newEntries = data.entries.filter(e => !existingIds.has(e.id));
            settings.entries = [...settings.entries, ...newEntries];

            if (data.characterEntries) {
                for (const [key, entries] of Object.entries(data.characterEntries)) {
                    if (!settings.characterEntries[key]) {
                        settings.characterEntries[key] = entries;
                    } else {
                        const existingCharIds = new Set(settings.characterEntries[key].map(e => e.id));
                        const newCharEntries = entries.filter(e => !existingCharIds.has(e.id));
                        settings.characterEntries[key] = [
                            ...settings.characterEntries[key],
                            ...newCharEntries,
                        ];
                    }
                }
            }
        }

        saveSettings();
        return { success: true, count: data.entries.length };
    } catch (e) {
        return { success: false, error: e.message };
    }
}
