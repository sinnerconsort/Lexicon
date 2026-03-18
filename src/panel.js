import { getContext } from '../../../../extensions.js';
import {
    getSettings, getChatState, sanitizeChatState, generateEntryId,
    getCharacterKey, computeNarrativeState, areGatesMet,
} from './state.js';
import { saveSettings, saveChatData, exportCompendium, importCompendium } from './persistence.js';
import { getAllCandidateEntries } from './scanner.js';
import { scanAndInject, clearInjection } from './injector.js';
import { clearLorebookCache, lorebookStatus } from './lorebook.js';
import {
    EXT_DISPLAY_NAME, CATEGORIES, REVEAL_TIERS, REVEAL_TIER_META,
    NARRATIVE_ACTIONS, NARRATIVE_STATES,
} from './config.js';

let editingEntry = null;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export function initPanel() {
    if ($('#lexicon-fab').length) return;
    createFAB();
    createDebugBadge();
    createPanel();
    bindAllEvents();
    syncDebugBadge();
}

export function destroyPanel() {
    $('#lexicon-fab').remove();
    $('#lexicon-panel').remove();
    $('#lexicon-debug-badge').remove();
}

// ─── FAB + Debug Badge ────────────────────────────────────────────────────────

function createFAB() {
    $('body').append(`
        <button id="lexicon-fab" class="lexicon-fab" title="Lexicon - Semantic Lore Engine">
            <i class="fa-solid fa-book-open"></i>
        </button>
    `);
}

function createDebugBadge() {
    $('body').append(`
        <div id="lexicon-debug-badge" class="lexicon-debug-badge" title="Lexicon: active injections (click to debug)">
            📚 0
        </div>
    `);
}

export function syncDebugBadge() {
    const settings = getSettings();
    const chatState = getChatState();

    if (!settings.showDebugOverlay) {
        $('#lexicon-debug-badge').hide();
        return;
    }

    sanitizeChatState();
    const actions = chatState.narrativeActions || {};
    const injectCount = Object.values(actions).filter(a => a === NARRATIVE_ACTIONS.INJECT).length;
    const hintCount = Object.values(actions).filter(a => a === NARRATIVE_ACTIONS.HINT).length;
    const total = injectCount + hintCount;

    const label = hintCount > 0 ? `📚 ${injectCount}+${hintCount}🌙` : `📚 ${total}`;

    $('#lexicon-debug-badge')
        .show()
        .text(label)
        .toggleClass('lexicon-badge-active', total > 0);
}

// ─── Panel Structure ──────────────────────────────────────────────────────────

function createPanel() {
    const tierOptions = Object.entries(REVEAL_TIER_META)
        .map(([val, m]) => `<option value="${val}">${m.icon} ${m.label}</option>`)
        .join('');

    const html = `
<div id="lexicon-panel" class="lexicon-panel" style="display:none;">

  <div class="lexicon-header">
    <span class="lexicon-title">
      <i class="fa-solid fa-book-open"></i>
      ${EXT_DISPLAY_NAME} <span class="lex-version-tag">v2</span>
    </span>
    <div class="lexicon-header-btns">
      <button class="lexicon-icon-btn" id="lexicon-scan-now" title="Scan &amp; inject now">
        <i class="fa-solid fa-wand-magic-sparkles"></i>
      </button>
      <button class="lexicon-icon-btn" id="lexicon-close" title="Close">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  </div>

  <div class="lexicon-tabs">
    <button class="lexicon-tab active" data-tab="entries">Entries</button>
    <button class="lexicon-tab" data-tab="edit">Add / Edit</button>
    <button class="lexicon-tab" data-tab="timeline">Timeline</button>
    <button class="lexicon-tab" data-tab="settings">Settings</button>
    <button class="lexicon-tab" data-tab="debug">Debug</button>
  </div>

  <!-- ── ENTRIES TAB ── -->
  <div class="lexicon-pane" id="lexicon-pane-entries">
    <div class="lexicon-filter-row">
      <select id="lex-scope-filter">
        <option value="all">All scopes</option>
        <option value="global">Global</option>
        <option value="character">Character</option>
        <option value="chat">This chat</option>
        <option value="lorebook">Lorebook</option>
      </select>
      <select id="lex-tier-filter">
        <option value="all">All tiers</option>
        <option value="background">🌍 Background</option>
        <option value="foreshadow">🌙 Foreshadow</option>
        <option value="gated">🔒 Gated</option>
        <option value="twist">⚡ Twist</option>
      </select>
      <input type="text" id="lex-search" placeholder="Search…" />
    </div>
    <div id="lex-entries-list" class="lex-entries-list">
      <div class="lex-empty">No entries yet. Use <b>Add / Edit</b> to create some.</div>
    </div>
  </div>

  <!-- ── EDIT TAB ── -->
  <div class="lexicon-pane" id="lexicon-pane-edit" style="display:none;">
    <div class="lex-form">
      <label>Title</label>
      <input type="text" id="lex-f-title" placeholder="Entry title…" />

      <label>Category</label>
      <input type="text" id="lex-f-category" placeholder="Character, Location, Item…" list="lex-cat-list" />
      <datalist id="lex-cat-list">
        ${CATEGORIES.map(c => `<option value="${c}">`).join('')}
      </datalist>

      <label>Scope</label>
      <select id="lex-f-scope">
        <option value="global">Global (all chats)</option>
        <option value="character">Character (this character only)</option>
        <option value="chat">Chat (this chat only)</option>
      </select>

      <div class="lex-inline-checks">
        <label class="lex-check"><input type="checkbox" id="lex-f-pinned" /> Always inject (📌 pinned)</label>
        <label class="lex-check"><input type="checkbox" id="lex-f-enabled" checked /> Enabled</label>
      </div>

      <label>Content</label>
      <textarea id="lex-f-content" rows="5" placeholder="Lore content…"></textarea>

      <!-- v2: Narrative Pacing Section -->
      <div class="lex-form-section-header">🎭 Narrative Pacing</div>

      <label>Reveal Tier</label>
      <select id="lex-f-tier">${tierOptions}</select>
      <div class="lex-tier-desc" id="lex-tier-desc"></div>

      <label>Hint / Breadcrumb Text <span class="lex-hint">(optional — AI auto-generates if empty)</span></label>
      <textarea id="lex-f-hint" rows="2" placeholder="A vague breadcrumb the AI will weave into narration…"></textarea>

      <label>Gate Conditions <span class="lex-hint">(for Gated/Twist tiers — when should this reveal?)</span></label>
      <div id="lex-f-gates" class="lex-gate-list"></div>
      <div class="lex-gate-add-row">
        <input type="text" id="lex-f-gate-input" placeholder="e.g. Player has visited the Whirling…" />
        <button class="lexicon-btn lexicon-btn-sm" id="lex-f-gate-add">+ Add</button>
      </div>

      <label>Related entry IDs <span class="lex-hint">(comma separated — relevance boost)</span></label>
      <input type="text" id="lex-f-related" placeholder="lex_abc123, lex_def456…" />

      <div class="lex-entry-id-display" id="lex-f-id-display" style="display:none;">
        ID: <code id="lex-f-id-text"></code>
      </div>

      <div class="lex-form-actions">
        <button class="lexicon-btn lexicon-btn-primary" id="lex-save-btn">
          <i class="fa-solid fa-floppy-disk"></i> Save
        </button>
        <button class="lexicon-btn" id="lex-cancel-btn" style="display:none;">
          <i class="fa-solid fa-xmark"></i> Cancel
        </button>
        <button class="lexicon-btn" id="lex-clear-form-btn">
          <i class="fa-solid fa-eraser"></i> Clear
        </button>
      </div>
    </div>
  </div>

  <!-- ── TIMELINE TAB ── -->
  <div class="lexicon-pane" id="lexicon-pane-timeline" style="display:none;">
    <div class="lex-timeline-header">
      <span class="lex-timeline-title">Narrative Timeline</span>
      <button class="lexicon-btn lexicon-btn-sm" id="lex-timeline-clear">Clear</button>
    </div>
    <div id="lex-timeline-list" class="lex-timeline-list">
      <div class="lex-empty">No narrative events yet. Run a scan to start tracking.</div>
    </div>
  </div>

  <!-- ── SETTINGS TAB ── -->
  <div class="lexicon-pane lex-settings-pane" id="lexicon-pane-settings" style="display:none;">

    <div class="lex-setting-group">
      <label class="lex-check">
        <input type="checkbox" id="lex-s-enabled" />
        <b>Enable Lexicon</b>
      </label>
    </div>

    <div class="lex-setting-group">
      <label class="lex-check">
        <input type="checkbox" id="lex-s-pacing" />
        <b>Enable Narrative Pacing</b>
      </label>
      <div class="lex-hint">When off, all entries use relevance-only scoring (v1 mode).</div>
    </div>

    <div class="lex-setting-group">
      <label class="lex-check">
        <input type="checkbox" id="lex-s-autohint" />
        Auto-generate hints for entries without manual hint text
      </label>
      <div class="lex-hint">Uses an extra AI call per hint. Hints are cached after first generation.</div>
    </div>

    <div class="lex-setting-group">
      <div class="lex-setting-label"><b>Scan Trigger</b></div>
      <label class="lex-check"><input type="radio" name="lex-trigger" value="every_message" /> Every AI response</label>
      <label class="lex-check"><input type="radio" name="lex-trigger" value="every_n" /> Every N messages</label>
      <div class="lex-every-n-row" id="lex-every-n-row" style="display:none;">
        <input type="number" id="lex-s-n" min="1" max="20" value="3" />
        <span>messages between scans</span>
      </div>
      <label class="lex-check"><input type="radio" name="lex-trigger" value="manual" /> Manual only (use 🪄 button)</label>
    </div>

    <div class="lex-setting-group">
      <div class="lex-setting-label"><b>Max injected entries</b> <span id="lex-max-val">5</span></div>
      <input type="range" id="lex-s-max" min="1" max="10" value="5" />
    </div>

    <div class="lex-setting-group">
      <div class="lex-setting-label"><b>Injection depth</b> <span id="lex-depth-val">1</span>
        <span class="lex-hint">(higher = earlier in AI context window)</span>
      </div>
      <input type="range" id="lex-s-depth" min="0" max="6" value="1" />
    </div>

    <div class="lex-setting-group">
      <div class="lex-setting-label"><b>Connection profile for scoring</b></div>
      <select id="lex-s-profile">
        <option value="current">Use current connection</option>
      </select>
      <div class="lex-hint">Tip: point this at a cheap/fast model to save costs.</div>
    </div>

    <div class="lex-setting-group">
      <label class="lex-check">
        <input type="checkbox" id="lex-s-lorebook" />
        Bridge ST lorebooks into scoring pool
      </label>
      <div class="lex-hint" id="lex-lorebook-status"></div>
    </div>

    <div class="lex-setting-group">
      <label class="lex-check">
        <input type="checkbox" id="lex-s-debug-badge" />
        Show injection count badge
      </label>
    </div>

    <div class="lex-setting-group">
      <div class="lex-setting-label"><b>Import / Export</b></div>
      <div class="lex-btn-row">
        <button class="lexicon-btn" id="lex-export-btn">
          <i class="fa-solid fa-download"></i> Export JSON
        </button>
        <button class="lexicon-btn" id="lex-import-btn">
          <i class="fa-solid fa-upload"></i> Import JSON
        </button>
        <input type="file" id="lex-import-file" accept=".json" style="display:none;" />
      </div>
    </div>

    <div class="lex-setting-group">
      <button class="lexicon-btn lexicon-btn-danger" id="lex-clear-all-btn">
        <i class="fa-solid fa-trash"></i> Clear all compendium entries
      </button>
    </div>

  </div>

  <!-- ── DEBUG TAB ── -->
  <div class="lexicon-pane" id="lexicon-pane-debug" style="display:none;">
    <div class="lex-debug-block" id="lex-debug-status">
      <span class="lex-debug-label">Last scan</span> <span id="lex-d-time">never</span><br/>
      <span class="lex-debug-label">Trigger mode</span> <span id="lex-d-trigger">—</span><br/>
      <span class="lex-debug-label">Injection depth</span> <span id="lex-d-depth">—</span><br/>
      <span class="lex-debug-label">Candidate pool</span> <span id="lex-d-pool">—</span><br/>
      <span class="lex-debug-label">Lorebook bridge</span> <span id="lex-d-lorebook">—</span><br/>
      <span class="lex-debug-label">Pacing mode</span> <span id="lex-d-pacing">—</span>
    </div>

    <div class="lex-debug-section">
      <div class="lex-debug-heading">Narrative Actions (last scan)</div>
      <div id="lex-d-narrative">No scan yet.</div>
    </div>

    <div class="lex-debug-section">
      <div class="lex-debug-heading">All Scored Entries</div>
      <div id="lex-d-all-scored">No scan yet.</div>
    </div>

    <div class="lex-btn-row" style="margin-top:12px;">
      <button class="lexicon-btn lexicon-btn-primary" id="lex-d-scan-btn">
        <i class="fa-solid fa-wand-magic-sparkles"></i> Scan now
      </button>
      <button class="lexicon-btn" id="lex-d-clear-btn">
        <i class="fa-solid fa-ban"></i> Clear injection
      </button>
    </div>
  </div>

</div>
    `;
    $('body').append(html);
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindAllEvents() {
    $('#lexicon-fab').on('click', togglePanel);
    $('#lexicon-debug-badge').on('click', () => { openPanel(); gotoTab('debug'); });
    $('#lexicon-close').on('click', closePanel);
    $('#lexicon-scan-now').on('click', runManualScan);

    $(document).on('click', '.lexicon-tab[data-tab]', function () {
        gotoTab($(this).data('tab'));
    });

    // Entries tab
    $(document).on('input', '#lex-search', () => renderEntriesList());
    $(document).on('change', '#lex-scope-filter', () => renderEntriesList());
    $(document).on('change', '#lex-tier-filter', () => renderEntriesList());

    // Edit tab
    $('#lex-save-btn').on('click', saveEntry);
    $('#lex-cancel-btn').on('click', cancelEdit);
    $('#lex-clear-form-btn').on('click', clearForm);
    $('#lex-f-tier').on('change', updateTierDesc);
    $('#lex-f-gate-add').on('click', addGateCondition);
    // Allow Enter key in gate input
    $('#lex-f-gate-input').on('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addGateCondition(); }
    });

    // Settings tab
    $('#lex-s-enabled').on('change', function () {
        getSettings().enabled = this.checked;
        saveSettings();
        if (!this.checked) clearInjection();
    });

    $('#lex-s-pacing').on('change', function () {
        getSettings().enableNarrativePacing = this.checked;
        saveSettings();
    });

    $('#lex-s-autohint').on('change', function () {
        getSettings().autoHintGeneration = this.checked;
        saveSettings();
    });

    $(document).on('change', 'input[name="lex-trigger"]', function () {
        getSettings().triggerMode = this.value;
        saveSettings();
        $('#lex-every-n-row').toggle(this.value === 'every_n');
    });

    $('#lex-s-n').on('change', function () {
        getSettings().triggerEveryN = parseInt(this.value) || 3;
        saveSettings();
    });

    $('#lex-s-max').on('input', function () {
        const v = parseInt(this.value);
        getSettings().maxInjectedEntries = v;
        $('#lex-max-val').text(v);
        saveSettings();
    });

    $('#lex-s-depth').on('input', function () {
        const v = parseInt(this.value);
        getSettings().injectionDepth = v;
        $('#lex-depth-val').text(v);
        saveSettings();
    });

    $('#lex-s-profile').on('change', function () {
        getSettings().selectedProfile = this.value;
        saveSettings();
    });

    $('#lex-s-lorebook').on('change', function () {
        getSettings().bridgeLorebooks = this.checked;
        clearLorebookCache();
        saveSettings();
    });

    $('#lex-s-debug-badge').on('change', function () {
        getSettings().showDebugOverlay = this.checked;
        saveSettings();
        syncDebugBadge();
    });

    $('#lex-export-btn').on('click', doExport);
    $('#lex-import-btn').on('click', () => $('#lex-import-file').click());
    $('#lex-import-file').on('change', doImport);

    $('#lex-clear-all-btn').on('click', () => {
        if (!confirm('Clear ALL compendium entries? This cannot be undone.')) return;
        const s = getSettings();
        s.entries = [];
        s.characterEntries = {};
        saveSettings();
        clearInjection();
        renderEntriesList();
        toastr.info('All entries cleared');
    });

    // Timeline tab
    $('#lex-timeline-clear').on('click', () => {
        if (!confirm('Clear the narrative timeline for this chat?')) return;
        const state = getChatState();
        state.narrativeTimeline = [];
        saveChatData();
        renderTimeline();
        toastr.info('Timeline cleared');
    });

    // Debug tab
    $('#lex-d-scan-btn').on('click', runManualScan);
    $('#lex-d-clear-btn').on('click', () => {
        clearInjection();
        const state = getChatState();
        state.currentInjectedIds = [];
        state.currentRelevanceScores = {};
        state.narrativeActions = {};
        saveChatData();
        syncDebugBadge();
        renderDebugTab();
        toastr.info('Injection cleared');
    });

    // Gate toggle on entry cards
    $(document).on('click', '.lex-gate-toggle', function () {
        const entryId = $(this).closest('.lex-entry-card').data('id');
        const gateIdx = $(this).data('gate-idx');
        toggleGateOnEntry(entryId, gateIdx);
    });

    // Listen for scanner updates
    document.addEventListener('lexicon:updated', () => {
        syncDebugBadge();
        if ($('#lexicon-pane-entries').is(':visible')) renderEntriesList();
        if ($('#lexicon-pane-debug').is(':visible')) renderDebugTab();
        if ($('#lexicon-pane-timeline').is(':visible')) renderTimeline();
    });
}

// ─── Panel Navigation ─────────────────────────────────────────────────────────

function togglePanel() {
    $('#lexicon-panel').is(':visible') ? closePanel() : openPanel();
}

function openPanel() {
    $('#lexicon-panel').show();
    const activeTab = $('.lexicon-tab.active').data('tab') || 'entries';
    gotoTab(activeTab);
}

function closePanel() {
    $('#lexicon-panel').hide();
}

export function gotoTab(name) {
    $('.lexicon-tab').removeClass('active');
    $(`.lexicon-tab[data-tab="${name}"]`).addClass('active');
    $('.lexicon-pane').hide();
    $(`#lexicon-pane-${name}`).show();

    if (name === 'entries') renderEntriesList();
    if (name === 'edit') updateTierDesc();
    if (name === 'timeline') renderTimeline();
    if (name === 'settings') renderSettingsTab();
    if (name === 'debug') renderDebugTab();
}

// ─── Entries Tab ──────────────────────────────────────────────────────────────

export function renderEntriesList() {
    const settings = getSettings();
    const chatState = getChatState();
    const ctx = getContext();
    const charKey = getCharacterKey(ctx);

    const scopeFilter = $('#lex-scope-filter').val() || 'all';
    const tierFilter = $('#lex-tier-filter').val() || 'all';
    const searchRaw = ($('#lex-search').val() || '').toLowerCase().trim();

    let all = [];

    for (const e of (settings.entries || [])) {
        all.push({ ...e, _displayScope: 'global' });
    }
    if (charKey && settings.characterEntries?.[charKey]) {
        for (const e of settings.characterEntries[charKey]) {
            all.push({ ...e, _displayScope: 'character' });
        }
    }
    if (chatState?.chatEntries) {
        for (const e of chatState.chatEntries) {
            all.push({ ...e, _displayScope: 'chat' });
        }
    }

    // Filters
    if (scopeFilter !== 'all') {
        all = all.filter(e =>
            scopeFilter === 'lorebook' ? e.fromLorebook : e._displayScope === scopeFilter
        );
    }
    if (tierFilter !== 'all') {
        all = all.filter(e => (e.revealTier || 'background') === tierFilter);
    }
    if (searchRaw) {
        all = all.filter(e =>
            (e.title || '').toLowerCase().includes(searchRaw) ||
            (e.content || '').toLowerCase().includes(searchRaw) ||
            (e.category || '').toLowerCase().includes(searchRaw)
        );
    }

    if (!all.length) {
        $('#lex-entries-list').html('<div class="lex-empty">No entries match. Try a different filter or add some in <b>Add / Edit</b>.</div>');
        return;
    }

    const actions = chatState?.narrativeActions || {};
    const scores = chatState?.currentRelevanceScores || {};

    const html = all.map(e => {
        const action = actions[e.id];
        const score = scores[e.id];
        const tierMeta = REVEAL_TIER_META[e.revealTier || 'background'];
        const narState = computeNarrativeState(e);
        const seeds = e.chekhov?.seedCount || 0;
        const isActive = action === NARRATIVE_ACTIONS.INJECT || action === NARRATIVE_ACTIONS.HINT;
        const preview = (e.content || '').substring(0, 100).replace(/\n/g, ' ');

        // Action badge
        let actionBadge = '';
        if (action === NARRATIVE_ACTIONS.INJECT) {
            actionBadge = '<span class="lex-badge lex-action-inject">✓ INJECTED</span>';
        } else if (action === NARRATIVE_ACTIONS.HINT) {
            actionBadge = '<span class="lex-badge lex-action-hint">🌙 HINTED</span>';
        } else if (action === NARRATIVE_ACTIONS.SUPPRESS) {
            actionBadge = '<span class="lex-badge lex-action-suppress">🔇 SUPPRESSED</span>';
        }

        // Narrative state badge
        const stateBadges = {
            dormant: '<span class="lex-badge lex-state-dormant">dormant</span>',
            seeding: `<span class="lex-badge lex-state-seeding">seeding (${seeds})</span>`,
            ready: '<span class="lex-badge lex-state-ready">✓ ready</span>',
            revealed: '<span class="lex-badge lex-state-revealed">revealed</span>',
        };

        // Gate conditions mini-checklist (for gated/twist)
        let gateHtml = '';
        if (e.gateConditions?.length > 0) {
            gateHtml = '<div class="lex-entry-gates">' +
                e.gateConditions.map((g, i) =>
                    `<span class="lex-gate-toggle ${g.met ? 'lex-gate-met' : ''}" data-gate-idx="${i}" title="Click to toggle">
                        ${g.met ? '☑' : '☐'} ${xss(g.text)}
                    </span>`
                ).join('') + '</div>';
        }

        return `
<div class="lex-entry-card ${isActive ? 'lex-entry-active' : ''} lex-tier-${e.revealTier || 'background'}" data-id="${xss(e.id)}">
  <div class="lex-entry-top">
    <div class="lex-entry-info">
      <span class="lex-entry-title">${xss(e.title || 'Untitled')}</span>
      <span class="lex-badge lex-tier-badge" style="border-color:${tierMeta.color}" title="${tierMeta.desc}">${tierMeta.icon}</span>
      ${e.category ? `<span class="lex-badge lex-cat-badge">${xss(e.category)}</span>` : ''}
      <span class="lex-badge lex-scope-badge lex-scope-${e._displayScope}">${e._displayScope}</span>
      ${e.pinned ? '<span class="lex-pin-icon" title="Pinned">📌</span>' : ''}
      ${actionBadge}
      ${(e.revealTier || 'background') !== 'background' ? (stateBadges[narState] || '') : ''}
      ${e.fromLorebook ? '<span class="lex-badge lex-lb-badge">lorebook</span>' : ''}
    </div>
    <div class="lex-entry-btns">
      ${!e.fromLorebook ? `
        <button class="lexicon-icon-btn lex-edit-entry" data-id="${xss(e.id)}" data-scope="${xss(e._displayScope)}" title="Edit">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button class="lexicon-icon-btn lex-delete-entry" data-id="${xss(e.id)}" data-scope="${xss(e._displayScope)}" title="Delete">
          <i class="fa-solid fa-trash"></i>
        </button>
      ` : ''}
    </div>
  </div>
  ${seeds > 0 ? `<div class="lex-chekhov-bar"><span class="lex-chekhov-label">Seeds planted:</span> <span class="lex-chekhov-pips">${'●'.repeat(Math.min(seeds, 10))}${'○'.repeat(Math.max(0, 10 - seeds))}</span></div>` : ''}
  ${gateHtml}
  ${preview ? `<div class="lex-entry-preview">${xss(preview)}${e.content?.length > 100 ? '…' : ''}</div>` : ''}
</div>`;
    }).join('');

    $('#lex-entries-list').html(html);

    // Bind entry action buttons
    $('.lex-edit-entry').off('click').on('click', function () {
        openEditEntry($(this).data('id'), $(this).data('scope'));
    });
    $('.lex-delete-entry').off('click').on('click', function () {
        deleteEntry($(this).data('id'), $(this).data('scope'));
    });
}

// ─── Gate Toggle on Entry Cards ───────────────────────────────────────────────

function toggleGateOnEntry(entryId, gateIdx) {
    const settings = getSettings();
    const chatState = getChatState();
    const ctx = getContext();
    const charKey = getCharacterKey(ctx);

    // Find the entry across all stores
    const entry = findEntryAcrossStores(entryId, settings, chatState, charKey);
    if (!entry || !entry.gateConditions?.[gateIdx]) return;

    entry.gateConditions[gateIdx].met = !entry.gateConditions[gateIdx].met;

    // Update narrative state
    entry.narrativeState = computeNarrativeState(entry);

    saveSettings();
    saveChatData();
    renderEntriesList();
}

function findEntryAcrossStores(id, settings, chatState, charKey) {
    let found = settings.entries?.find(e => e.id === id);
    if (found) return found;
    if (charKey && settings.characterEntries?.[charKey]) {
        found = settings.characterEntries[charKey].find(e => e.id === id);
        if (found) return found;
    }
    if (chatState?.chatEntries) {
        found = chatState.chatEntries.find(e => e.id === id);
        if (found) return found;
    }
    return null;
}

// ─── Edit Tab ─────────────────────────────────────────────────────────────────

// Temporary gate conditions for the form
let formGates = [];

function saveEntry() {
    const title = $('#lex-f-title').val().trim();
    const content = $('#lex-f-content').val().trim();
    const category = $('#lex-f-category').val().trim();
    const scope = $('#lex-f-scope').val();
    const pinned = $('#lex-f-pinned').prop('checked');
    const enabled = $('#lex-f-enabled').prop('checked');
    const relatedRaw = $('#lex-f-related').val().trim();
    const relatedIds = relatedRaw ? relatedRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const revealTier = $('#lex-f-tier').val() || REVEAL_TIERS.BACKGROUND;
    const hintText = $('#lex-f-hint').val().trim();

    if (!title) { toastr.warning('Please enter a title'); return; }
    if (!content) { toastr.warning('Please enter content'); return; }

    const settings = getSettings();
    const chatState = getChatState();
    const ctx = getContext();
    const charKey = getCharacterKey(ctx);

    // Preserve existing Chekhov data if editing
    const existingChekhov = editingEntry?.chekhov || { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null };

    const entry = {
        id: editingEntry?.id || generateEntryId(),
        title, content, category, pinned, enabled, relatedIds, scope,
        revealTier,
        hintText,
        gateConditions: [...formGates],
        chekhov: existingChekhov,
        narrativeState: editingEntry?.narrativeState || NARRATIVE_STATES.DORMANT,
    };

    // Recompute narrative state
    entry.narrativeState = computeNarrativeState(entry);

    if (editingEntry) {
        removeEntryFromStore(editingEntry.id, editingEntry._displayScope || scope, settings, chatState, charKey);
    }

    if (scope === 'global') {
        settings.entries.push(entry);
        saveSettings();
    } else if (scope === 'character') {
        if (!charKey) {
            toastr.warning('No active character — saving as global instead');
            settings.entries.push(entry);
            saveSettings();
        } else {
            if (!settings.characterEntries[charKey]) settings.characterEntries[charKey] = [];
            settings.characterEntries[charKey].push(entry);
            saveSettings();
        }
    } else if (scope === 'chat') {
        if (!chatState.chatEntries) chatState.chatEntries = [];
        chatState.chatEntries.push(entry);
        saveChatData();
    }

    toastr.success(`"${title}" saved`);
    cancelEdit();
    gotoTab('entries');
}

function openEditEntry(id, scope) {
    const { entry } = findEntry(id, scope);
    if (!entry) { toastr.error('Could not find entry'); return; }

    editingEntry = { ...entry, _displayScope: scope };

    $('#lex-f-title').val(entry.title || '');
    $('#lex-f-content').val(entry.content || '');
    $('#lex-f-category').val(entry.category || '');
    $('#lex-f-scope').val(scope);
    $('#lex-f-pinned').prop('checked', entry.pinned || false);
    $('#lex-f-enabled').prop('checked', entry.enabled !== false);
    $('#lex-f-related').val((entry.relatedIds || []).join(', '));
    $('#lex-f-tier').val(entry.revealTier || 'background');
    $('#lex-f-hint').val(entry.hintText || '');
    $('#lex-f-id-text').text(entry.id);
    $('#lex-f-id-display').show();
    $('#lex-cancel-btn').show();

    // Load gate conditions
    formGates = (entry.gateConditions || []).map(g => ({ ...g }));
    renderFormGates();
    updateTierDesc();

    gotoTab('edit');
}

function deleteEntry(id, scope) {
    if (!confirm('Delete this entry?')) return;
    const settings = getSettings();
    const chatState = getChatState();
    const ctx = getContext();
    const charKey = getCharacterKey(ctx);
    removeEntryFromStore(id, scope, settings, chatState, charKey);
    renderEntriesList();
    toastr.info('Entry deleted');
}

function cancelEdit() {
    editingEntry = null;
    clearForm();
    $('#lex-cancel-btn').hide();
    $('#lex-f-id-display').hide();
}

function clearForm() {
    $('#lex-f-title').val('');
    $('#lex-f-content').val('');
    $('#lex-f-category').val('');
    $('#lex-f-scope').val('global');
    $('#lex-f-pinned').prop('checked', false);
    $('#lex-f-enabled').prop('checked', true);
    $('#lex-f-related').val('');
    $('#lex-f-tier').val('background');
    $('#lex-f-hint').val('');
    $('#lex-f-id-display').hide();
    formGates = [];
    renderFormGates();
    editingEntry = null;
    $('#lex-cancel-btn').hide();
}

function updateTierDesc() {
    const tier = $('#lex-f-tier').val() || 'background';
    const meta = REVEAL_TIER_META[tier];
    if (meta) {
        $('#lex-tier-desc').html(`<span style="color:${meta.color}">${meta.icon} ${meta.desc}</span>`);
    }
}

// ─── Gate Conditions in Form ──────────────────────────────────────────────────

function addGateCondition() {
    const text = $('#lex-f-gate-input').val().trim();
    if (!text) return;
    formGates.push({ text, met: false });
    $('#lex-f-gate-input').val('');
    renderFormGates();
}

function renderFormGates() {
    const $list = $('#lex-f-gates');
    if (!formGates.length) {
        $list.html('<div class="lex-hint" style="padding:4px 0;">No conditions set.</div>');
        return;
    }
    $list.html(formGates.map((g, i) => `
        <div class="lex-gate-item">
            <label class="lex-check">
                <input type="checkbox" class="lex-form-gate-check" data-idx="${i}" ${g.met ? 'checked' : ''} />
                <span>${xss(g.text)}</span>
            </label>
            <button class="lexicon-icon-btn lex-form-gate-del" data-idx="${i}" title="Remove">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
    `).join(''));

    $list.find('.lex-form-gate-check').off('change').on('change', function () {
        const idx = $(this).data('idx');
        if (formGates[idx]) formGates[idx].met = this.checked;
    });
    $list.find('.lex-form-gate-del').off('click').on('click', function () {
        const idx = $(this).data('idx');
        formGates.splice(idx, 1);
        renderFormGates();
    });
}

// ─── Timeline Tab ─────────────────────────────────────────────────────────────

function renderTimeline() {
    const chatState = getChatState();
    const timeline = chatState?.narrativeTimeline || [];

    if (!timeline.length) {
        $('#lex-timeline-list').html('<div class="lex-empty">No narrative events yet. Run a scan to start tracking.</div>');
        return;
    }

    // Reverse: newest first
    const reversed = [...timeline].reverse();

    const actionIcons = {
        INJECT: '<span class="lex-tl-icon lex-tl-inject">✦</span>',
        HINT: '<span class="lex-tl-icon lex-tl-hint">🌙</span>',
        SUPPRESS: '<span class="lex-tl-icon lex-tl-suppress">🔇</span>',
    };

    const html = reversed.map(ev => {
        const time = new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const date = new Date(ev.timestamp).toLocaleDateString();
        const icon = actionIcons[ev.action] || '·';
        return `
<div class="lex-timeline-event lex-tl-${(ev.action || '').toLowerCase()}">
  <div class="lex-tl-line"></div>
  <div class="lex-tl-content">
    ${icon}
    <span class="lex-tl-title">${xss(ev.entryTitle)}</span>
    <span class="lex-tl-action">${ev.action}</span>
    <span class="lex-tl-time" title="${date}">${time}</span>
    ${ev.context ? `<div class="lex-tl-context">${xss(ev.context)}</div>` : ''}
  </div>
</div>`;
    }).join('');

    $('#lex-timeline-list').html(html);
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function renderSettingsTab() {
    const settings = getSettings();
    const ctx = getContext();

    $('#lex-s-enabled').prop('checked', settings.enabled);
    $('#lex-s-pacing').prop('checked', settings.enableNarrativePacing);
    $('#lex-s-autohint').prop('checked', settings.autoHintGeneration);
    $(`input[name="lex-trigger"][value="${settings.triggerMode}"]`).prop('checked', true);
    $('#lex-every-n-row').toggle(settings.triggerMode === 'every_n');
    $('#lex-s-n').val(settings.triggerEveryN);
    $('#lex-s-max').val(settings.maxInjectedEntries);
    $('#lex-max-val').text(settings.maxInjectedEntries);
    $('#lex-s-depth').val(settings.injectionDepth);
    $('#lex-depth-val').text(settings.injectionDepth);
    $('#lex-s-lorebook').prop('checked', settings.bridgeLorebooks);
    $('#lex-s-debug-badge').prop('checked', settings.showDebugOverlay);

    const lbHints = { ok: '✅ Entries loaded', unavailable: '⚠️ Not available in this ST version', disabled: '', unknown: '' };
    $('#lex-lorebook-status').text(lbHints[lorebookStatus] || '');

    const $prof = $('#lex-s-profile').empty().append('<option value="current">Use current connection</option>');
    const profiles = ctx?.extensionSettings?.connectionManager?.profiles || [];
    profiles.forEach(p => $prof.append(`<option value="${p.name}">${p.name}</option>`));
    $prof.val(settings.selectedProfile);
}

// ─── Debug Tab ────────────────────────────────────────────────────────────────

async function renderDebugTab() {
    const settings = getSettings();
    const chatState = getChatState();

    const scanTime = chatState.lastScanTime
        ? new Date(chatState.lastScanTime).toLocaleTimeString()
        : 'Never';

    $('#lex-d-time').text(scanTime);
    $('#lex-d-trigger').text(settings.triggerMode.replace('_', ' '));
    $('#lex-d-depth').text(settings.injectionDepth);
    $('#lex-d-lorebook').text(lorebookStatus);
    $('#lex-d-pacing').text(settings.enableNarrativePacing ? 'ON — narrative director' : 'OFF — relevance only');

    try {
        const candidates = await getAllCandidateEntries();
        $('#lex-d-pool').text(`${candidates.length} entries`);

        // Narrative actions breakdown
        const actions = chatState.narrativeActions || {};
        const actionCounts = { INJECT: 0, HINT: 0, SUPPRESS: 0 };
        Object.values(actions).forEach(a => { if (actionCounts[a] !== undefined) actionCounts[a]++; });

        const narrativeHtml = `
            <div class="lex-debug-counts">
                <span class="lex-action-inject">✦ Injected: ${actionCounts.INJECT}</span>
                <span class="lex-action-hint">🌙 Hinted: ${actionCounts.HINT}</span>
                <span class="lex-action-suppress">🔇 Suppressed: ${actionCounts.SUPPRESS}</span>
            </div>
            ${Object.entries(actions).map(([id, action]) => {
                const entry = candidates.find(e => e.id === id);
                const score = chatState.currentRelevanceScores?.[id];
                const scoreStr = score != null ? ` (${typeof score === 'number' ? score.toFixed(1) : score})` : '';
                return `<div class="lex-debug-entry lex-debug-action-${action.toLowerCase()}">
                    ${xss(entry?.title || id)}${scoreStr}
                    <span class="lex-badge lex-action-${action.toLowerCase()}">${action}</span>
                </div>`;
            }).join('')}
        `;
        $('#lex-d-narrative').html(narrativeHtml || '<i>No actions — run a scan.</i>');

        // All scored
        const scores = chatState.currentRelevanceScores || {};
        const allScored = Object.entries(scores).sort((a, b) => b[1] - a[1]);

        if (!allScored.length) {
            $('#lex-d-all-scored').html('<i>No score data — run a scan first.</i>');
        } else {
            const html = allScored.map(([id, score]) => {
                const entry = candidates.find(e => e.id === id);
                const action = actions[id] || '—';
                const tierMeta = REVEAL_TIER_META[entry?.revealTier || 'background'];
                return `<div class="lex-debug-entry">
                    ${tierMeta?.icon || ''} ${xss(entry?.title || id)}
                    <span class="lex-score">${typeof score === 'number' ? score.toFixed(1) : score}</span>
                    <span class="lex-badge">${action}</span>
                </div>`;
            }).join('');
            $('#lex-d-all-scored').html(html);
        }

    } catch (e) {
        $('#lex-d-pool').text('error');
    }
}

// ─── Manual Scan ──────────────────────────────────────────────────────────────

async function runManualScan() {
    const $btns = $('#lexicon-scan-now, #lex-d-scan-btn');
    $btns.prop('disabled', true);
    toastr.info('Scanning lore…', '', { timeOut: 2000 });

    await scanAndInject({ force: true });

    syncDebugBadge();
    if ($('#lexicon-pane-debug').is(':visible')) renderDebugTab();
    if ($('#lexicon-pane-entries').is(':visible')) renderEntriesList();
    if ($('#lexicon-pane-timeline').is(':visible')) renderTimeline();

    $btns.prop('disabled', false);
}

// ─── Import / Export ──────────────────────────────────────────────────────────

function doExport() {
    const json = exportCompendium();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lexicon_compendium_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success('Compendium exported');
}

function doImport() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const result = importCompendium(ev.target.result);
        if (result.success) {
            toastr.success(`Imported ${result.count} entries`);
            renderEntriesList();
        } else {
            toastr.error(`Import failed: ${result.error}`);
        }
    };
    reader.readAsText(file);
    this.value = '';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findEntry(id, scope) {
    const settings = getSettings();
    const chatState = getChatState();
    const ctx = getContext();
    const charKey = getCharacterKey(ctx);

    if (scope === 'global') return { entry: settings.entries.find(e => e.id === id), store: 'global' };
    if (scope === 'character' && charKey) return { entry: settings.characterEntries?.[charKey]?.find(e => e.id === id), store: 'character' };
    if (scope === 'chat') return { entry: chatState?.chatEntries?.find(e => e.id === id), store: 'chat' };
    return { entry: null, store: null };
}

function removeEntryFromStore(id, scope, settings, chatState, charKey) {
    if (scope === 'global') {
        settings.entries = settings.entries.filter(e => e.id !== id);
        saveSettings();
    } else if (scope === 'character' && charKey && settings.characterEntries?.[charKey]) {
        settings.characterEntries[charKey] = settings.characterEntries[charKey].filter(e => e.id !== id);
        saveSettings();
    } else if (scope === 'chat' && chatState?.chatEntries) {
        chatState.chatEntries = chatState.chatEntries.filter(e => e.id !== id);
        saveChatData();
    }
}

function xss(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
