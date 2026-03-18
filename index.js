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

        initPanel();

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

        console.log(`[${EXT_ID}] ✅ ${EXT_DISPLAY_NAME} v${EXT_VERSION} ready`);

    } catch (err) {
        console.error(`[${EXT_ID}] ❌ Init failed:`, err);
        toastr.error(
            `${EXT_DISPLAY_NAME} failed to initialize. Check the console.`,
            'Lexicon Error',
            { timeOut: 8000 }
        );
    }
});
