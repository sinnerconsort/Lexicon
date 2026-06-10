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

        // ── Scan wiring (v2.3) ───────────────────────────────────────────
        // before_generation: ST awaits this handler during Generate(), so the
        // scan finishes and the injection is in place before the prompt is
        // built — lore selection reacts to the user's just-sent message.
        // after_ai: legacy behavior — scan after the AI replies (faster sends,
        // but lore is always one message behind).

        const GEN_EVENT = event_types.GENERATION_AFTER_COMMANDS;

        if (GEN_EVENT) {
            eventSource.on(GEN_EVENT, async (type, _options, dryRun) => {
                const s = getSettings();
                if (!s.enabled || s.scanTiming !== 'before_generation') return;
                if (dryRun) return; // Prompt preview — don't burn a scan
                // Only fresh generations: skip swipe/regenerate/continue/quiet etc.
                // (context hasn't changed since the last scan for those)
                if (type && type !== 'normal') return;
                if (!shouldScan()) return;

                // Never let a hung scoring call brick the send
                const timeoutMs = s.scanTimeoutMs || 12000;
                await Promise.race([
                    scanAndInject(),
                    new Promise(resolve => setTimeout(() => {
                        console.warn(`[Lexicon] Scan timed out after ${timeoutMs}ms — generating with previous injection`);
                        resolve();
                    }, timeoutMs)),
                ]);
            });
        }

        eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
            const s = getSettings();
            if (!s.enabled || !shouldScan()) return;
            // In before_generation mode this hook is redundant (and would
            // double the AI calls per round trip) — unless the gen event
            // isn't available on this ST version, in which case it's the
            // only scan we have.
            if (s.scanTiming === 'before_generation' && GEN_EVENT) return;
            await scanAndInject();
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
