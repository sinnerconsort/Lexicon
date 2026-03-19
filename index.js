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

// ─── Visual Debug Logger (bypasses toastr entirely) ──────────────────────────

const DEBUG_ENABLED = true; // Flip to false once things work

function _dbg(msg) {
    if (!DEBUG_ENABLED) return;
    console.log(`[Lexicon] ${msg}`);
    let $el = $('#lexicon-debug-log');
    if (!$el.length) {
        $('body').append(`
            <div id="lexicon-debug-log" style="
                position:fixed; bottom:10px; left:10px; right:60px;
                max-height:180px; overflow:auto;
                background:rgba(0,0,0,0.92); color:#0f0;
                font:11px/1.4 monospace; padding:8px; border-radius:8px;
                z-index:999999; pointer-events:auto;
                border:1px solid #0f0;
            "><div style="color:#ff0;font-weight:bold;margin-bottom:4px;">LEXICON DEBUG LOG</div></div>
        `);
        $el = $('#lexicon-debug-log');
    }
    $el.append(`<div>${new Date().toLocaleTimeString()} — ${msg}</div>`);
    $el.scrollTop($el[0].scrollHeight);
}

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
    _dbg('INIT START');

    try {
        _dbg('1. sanitizeSettings');
        if (!extension_settings[EXT_ID]) {
            extension_settings[EXT_ID] = {};
        }
        sanitizeSettings();
        _dbg('1. ✓ settings ok');

        _dbg('2. addSettingsPanel');
        try {
            addExtensionSettingsPanel();
            _dbg('2. ✓ settings panel added');
        } catch (e) {
            _dbg(`2. ✗ settings panel FAILED: ${e.message}`);
        }

        const settings = getSettings();
        _dbg(`3. enabled=${settings.enabled}`);

        if (!settings.enabled) {
            _dbg('3. STOPPED — extension disabled');
            return;
        }

        _dbg('4. calling initPanel()');
        try {
            initPanel();
            _dbg('4. ✓ initPanel returned');
        } catch (e) {
            _dbg(`4. ✗ initPanel THREW: ${e.message}`);
            _dbg(`   stack: ${e.stack?.substring(0, 200)}`);
        }

        // Check what actually ended up in the DOM
        const fabCount = $('#lexicon-fab').length;
        const panelCount = $('#lexicon-panel').length;
        const badgeCount = $('#lexicon-debug-badge').length;
        _dbg(`5. DOM — FAB:${fabCount} Panel:${panelCount} Badge:${badgeCount}`);

        if (fabCount > 0) {
            const fab = document.getElementById('lexicon-fab');
            if (fab) {
                const cs = window.getComputedStyle(fab);
                _dbg(`5a. FAB css — display:${cs.display} vis:${cs.visibility} opacity:${cs.opacity} z:${cs.zIndex} pos:${cs.position} bottom:${cs.bottom} right:${cs.right}`);
            }
        } else {
            _dbg('5. ✗ FAB NOT in DOM!');
        }

        _dbg('6. chat data');
        const ctx = getContext();
        if (ctx?.chat?.length > 0) {
            loadChatData();
            sanitizeChatState();
            syncDebugBadge();
            _dbg('6. ✓ loaded');
        } else {
            _dbg('6. no chat, skipped');
        }

        _dbg('7. events');
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        _dbg('7. ✓ registered');

        _dbg('8. API');
        registerAPI();
        _dbg(`8. ✓ LexiconAPI: ${!!window.LexiconAPI}`);

        _dbg('✅ INIT COMPLETE');

    } catch (err) {
        _dbg(`❌ CRASHED: ${err.message}`);
        _dbg(`stack: ${err.stack?.substring(0, 300)}`);
    }
});
