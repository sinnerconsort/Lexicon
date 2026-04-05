/**
 * Lexicon v2.1 — Semantic Lore Engine + Narrative Pacing
 * Thin entry point — imports from src/ modules
 */
import {
    getContext,
    extension_settings,
} from '../../../extensions.js';

import {
    eventSource,
    event_types,
} from '../../../../script.js';

// ─── Module imports ──────────────────────────────────────────────────────────

import { EXT_ID, EXT_DISPLAY_NAME, EXT_VERSION } from './src/config.js';
import { getSettings, sanitizeSettings, sanitizeChatState } from './src/state.js';
import { loadChatData } from './src/persistence.js';
import { scanAndInject, clearInjection } from './src/injector.js';
import { shouldScan } from './src/scanner.js';
import { clearLorebookCache } from './src/lorebook.js';
import { initPanel, destroyPanel } from './src/panel.js';
import { registerAPI, unregisterAPI } from './src/api.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  EXTENSION SETTINGS DRAWER (ST sidebar toggle)
// ═══════════════════════════════════════════════════════════════════════════════

function addExtensionSettingsPanel() {
    const s = getSettings();
    const html = `
    <div class="inline-drawer" id="lexicon-ext-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>📚 ${EXT_DISPLAY_NAME} — Semantic Lore Engine</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <label class="checkbox_label">
          <input type="checkbox" id="lexicon-master-toggle" ${s.enabled ? 'checked' : ''} />
          <span>Enable Lexicon</span>
        </label>
        <p style="margin:6px 0 0;opacity:0.7;font-size:0.85em;line-height:1.4;">
          Lexicon uses AI to semantically score and <b>pace</b> your lore entries.
          Open the 📚 button to manage entries, set reveal tiers, and watch the timeline.
        </p>
      </div>
    </div>`;

    $('#extensions_settings2').append(html);

    $('#lexicon-master-toggle').on('change', function () {
        const s = getSettings();
        s.enabled = this.checked;
        import('./src/persistence.js').then(m => m.saveSettings());
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

// ═══════════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════════

jQuery(async () => {
    try {
        console.log(`[${EXT_ID}] v${EXT_VERSION} init…`);

        if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = {};
        sanitizeSettings();

        try {
            addExtensionSettingsPanel();
        } catch (e) {
            console.warn('[Lexicon] Settings panel:', e);
        }

        const settings = getSettings();
        if (!settings.enabled) {
            console.log('[Lexicon] Disabled');
            return;
        }

        // Initialize UI
        initPanel();

        // Load chat state if we have an active chat
        const ctx = getContext();
        if (ctx?.chat?.length > 0) {
            loadChatData();
            sanitizeChatState();
        }

        // Wire event listeners
        eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
            if (getSettings().enabled && shouldScan()) {
                await scanAndInject();
            }
        });

        eventSource.on(event_types.CHAT_CHANGED, () => {
            clearLorebookCache();
            loadChatData();
            sanitizeChatState();
            if (getSettings().enabled && shouldScan()) {
                setTimeout(() => scanAndInject(), 300);
            }
        });

        // Register public API
        registerAPI();

        console.log(`[Lexicon] ✅ v${EXT_VERSION} ready`);
        toastr.success(`Lexicon v${EXT_VERSION} loaded`, '', { timeOut: 2000 });

    } catch (err) {
        console.error('[Lexicon] ❌ Init:', err);
        toastr.error(`Lexicon failed: ${err.message}`, '', { timeOut: 8000 });
    }
});
