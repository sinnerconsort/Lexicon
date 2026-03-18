import { extension_settings } from '../../../extensions.js';
import { getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';
import { EXT_ID, EXT_DISPLAY_NAME, EXT_VERSION } from './src/config.js';
import { getSettings, sanitizeSettings, sanitizeChatState } from './src/state.js';
import { saveSettings, loadChatData } from './src/persistence.js';
import { scanAndInject, clearInjection } from './src/injector.js';
import { initPanel, destroyPanel, syncDebugBadge } from './src/panel.js';
import { shouldScan } from './src/scanner.js';
import { clearLorebookCache } from './src/lorebook.js';
import { registerAPI, unregisterAPI } from './src/api.js';

// ─── Event Handlers ───────────────────────────────────────────────────────────

async function onMessageReceived() {
    const settings = getSettings();
    if (!settings.enabled) return;
    if (shouldScan()) {
        await scanAndInject();
    }
}

function onChatChanged() {
    clearLorebookCache();
    loadChatData();
    sanitizeChatState();
    syncDebugBadge();

    const settings = getSettings();
    if (settings.enabled && shouldScan()) {
        setTimeout(() => scanAndInject(), 300);
    }
}

// ─── Settings Panel (Extensions tab) ─────────────────────────────────────────

function addExtensionSettingsPanel() {
    const settings = getSettings();

    const html = `
<div class="inline-drawer" id="lexicon-ext-drawer">
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>📚 ${EXT_DISPLAY_NAME} — Semantic Lore Engine</b>
    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
  </div>
  <div class="inline-drawer-content">
    <label class="checkbox_label">
      <input type="checkbox" id="lexicon-master-toggle" ${settings.enabled ? 'checked' : ''} />
      <span>Enable Lexicon</span>
    </label>
    <p style="margin:6px 0 0; opacity:0.7; font-size:0.85em; line-height:1.4;">
      Lexicon uses AI to semantically score and <b>pace</b> your lore entries each turn.
      It decides what to reveal, what to hint at, and what to hold back for maximum narrative impact.
      Open the 📚 button in chat to manage entries, set reveal tiers, configure gates, and watch the timeline.
    </p>
  </div>
</div>`;

    $('#extensions_settings2').append(html);

    $('#lexicon-master-toggle').on('change', function () {
        const s = getSettings();
        s.enabled = this.checked;
        saveSettings();

        if (s.enabled) {
            initPanel();
            loadChatData();
            sanitizeChatState();
            registerAPI();
        } else {
            clearInjection();
            destroyPanel();
            unregisterAPI();
        }
    });
}

// ─── Slash Command Fallback ───────────────────────────────────────────────────

function registerSlashCommand() {
    try {
        const { registerSlashCommand: regCmd } = SillyTavern.getContext();
        if (regCmd) {
            regCmd('lexicon', () => {
                initPanel();
                const $panel = $('#lexicon-panel');
                if ($panel.length) {
                    $panel.show();
                    toastr.info('Lexicon panel opened', '', { timeOut: 1500 });
                } else {
                    toastr.warning('Lexicon panel not found — trying re-init');
                    destroyPanel();
                    initPanel();
                    $('#lexicon-panel').show();
                }
            }, [], '<span>Opens the Lexicon panel</span>', true, true);
        }
    } catch (e) {
        // Slash commands may not be available in all ST versions
        console.warn(`[${EXT_ID}] Slash command registration skipped:`, e.message);
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

jQuery(async () => {
    try {
        console.log(`[${EXT_ID}] ${EXT_DISPLAY_NAME} v${EXT_VERSION} initializing…`);

        if (!extension_settings[EXT_ID]) {
            extension_settings[EXT_ID] = {};
        }
        sanitizeSettings();

        try {
            addExtensionSettingsPanel();
        } catch (e) {
            console.warn(`[${EXT_ID}] Settings panel error:`, e);
        }

        const settings = getSettings();

        if (!settings.enabled) {
            console.log(`[${EXT_ID}] Extension is disabled — skipping UI init`);
            return;
        }

        // Init panel with visible feedback since we can't check console on mobile
        try {
            initPanel();
            const fabExists = $('#lexicon-fab').length > 0;
            const panelExists = $('#lexicon-panel').length > 0;
            console.log(`[${EXT_ID}] FAB: ${fabExists}, Panel: ${panelExists}`);

            if (!fabExists) {
                toastr.warning('Lexicon FAB failed to mount — use /lexicon command to open panel', 'Lexicon', { timeOut: 6000 });
            }
        } catch (panelErr) {
            console.error(`[${EXT_ID}] Panel init failed:`, panelErr);
            toastr.error(`Panel init failed: ${panelErr.message}`, 'Lexicon', { timeOut: 8000 });
        }

        const ctx = getContext();
        if (ctx?.chat?.length > 0) {
            loadChatData();
            sanitizeChatState();
            syncDebugBadge();
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

        // Register public API for other extensions (Spark, etc.)
        registerAPI();

        // Slash command fallback for mobile users
        registerSlashCommand();

        console.log(`[${EXT_ID}] ✅ ${EXT_DISPLAY_NAME} v${EXT_VERSION} ready`);

    } catch (err) {
        console.error(`[${EXT_ID}] ❌ Init failed:`, err);
        toastr.error(
            `${EXT_DISPLAY_NAME} failed to initialize: ${err.message}`,
            'Lexicon Error',
            { timeOut: 8000 }
        );
    }
});
