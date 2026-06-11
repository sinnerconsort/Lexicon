import { getSettings } from './state.js';
import { getContext } from '../../../../extensions.js';
import { REVEAL_TIERS, NARRATIVE_STATES } from './config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Lorebook Bridge v2 — proper resolution + per-book loading
//
// The old bridge read ctx.world_info / module world_info, which is ST's WI
// *settings* object (scan depth, budget, charLore config) — not entry data —
// and POSTed /api/worldinfo/get with an empty body (the endpoint requires a
// name). It could only ever return entries by accident.
//
// The correct flow: resolve which book NAMES are active (five sources), then
// load each book by name via ctx.loadWorldInfo(name) with a REST fallback.
// ─────────────────────────────────────────────────────────────────────────────

let lorebookCache = null;
let lorebookCacheTime = 0;
const CACHE_TTL = 10000;

export let lorebookStatus = 'unknown';

const EMBEDDED_BOOK_KEY = '__char_embedded__';

// Lazy module imports (module export + window-global fallbacks throughout)
let _wiModule = false;   // false = not tried, null = failed
let _stScript = false;

async function getWIModule() {
    if (_wiModule !== false) return _wiModule;
    // src/lorebook.js → Lexicon → third-party → extensions → scripts/world-info.js
    try { _wiModule = await import('../../../../world-info.js'); }
    catch { _wiModule = null; }
    return _wiModule;
}

async function getSTScript() {
    if (_stScript !== false) return _stScript;
    try { _stScript = await import('../../../../../script.js'); }
    catch { _stScript = null; }
    return _stScript;
}

// ─── Source Resolution ────────────────────────────────────────────────────────

/**
 * Resolve every lorebook active for the current chat, tagged with its source.
 * Sources: global, character (primary world), character (charLore extras),
 * chat-bound (METADATA_KEY), persona-bound, plus the card-embedded book.
 * @returns {Promise<Array<{name: string, scope: string}>>}
 */
export async function getActiveLorebookSources() {
    const ctx = getContext();
    const wi = await getWIModule();
    const sources = [];
    const seen = new Set();
    const add = (name, scope) => {
        if (name && typeof name === 'string' && !seen.has(name)) {
            seen.add(name);
            sources.push({ name, scope });
        }
    };

    // 1. GLOBAL
    const globalBooks = wi?.selected_world_info || window.selected_world_info || [];
    if (Array.isArray(globalBooks)) globalBooks.forEach(n => add(n, 'global'));

    // 2. CHARACTER — primary world + charLore extras (keyed by char FILENAME)
    const charId = ctx?.characterId;
    const character = ctx?.characters?.[charId];
    if (character) {
        add(character.data?.extensions?.world || character.world, 'character');

        const fileName = (character.avatar || '').replace(/\.[^.]+$/, '');
        const charLoreList = wi?.world_info?.charLore || window.world_info?.charLore;
        if (fileName && Array.isArray(charLoreList)) {
            const extra = charLoreList.find(e => e.name === fileName);
            if (extra && Array.isArray(extra.extraBooks)) {
                extra.extraBooks.forEach(book => add(book, 'character'));
            }
        }

        // Card-embedded book (virtual — not a file on disk)
        if (character.data?.character_book?.entries?.length) {
            add(EMBEDDED_BOOK_KEY, 'character');
        }
    }

    // 3. CHAT-bound
    const wiKey = wi?.METADATA_KEY || window.WI_METADATA_KEY || 'world_info';
    add(ctx?.chatMetadata?.[wiKey], 'chat');

    // 4. PERSONA-bound
    add(ctx?.powerUserSettings?.persona_description_lorebook, 'persona');

    return sources;
}

// ─── Per-Book Loading ─────────────────────────────────────────────────────────

async function loadBook(name) {
    if (name === EMBEDDED_BOOK_KEY) return getEmbeddedCharBook();

    const ctx = getContext();

    // Primary: core API
    try {
        if (typeof ctx?.loadWorldInfo === 'function') {
            const data = await ctx.loadWorldInfo(name);
            if (data) return data;
        }
    } catch (e) {
        console.warn(`[Lexicon] loadWorldInfo failed for "${name}":`, e.message);
    }

    // Fallback: REST — the name in the body is REQUIRED
    try {
        const st = await getSTScript();
        const headers = { 'Content-Type': 'application/json' };
        if (typeof st?.getRequestHeaders === 'function') {
            Object.assign(headers, st.getRequestHeaders());
        }
        const response = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name }),
        });
        if (response.ok) return await response.json();
    } catch (e) {
        console.warn(`[Lexicon] REST WI load failed for "${name}":`, e.message);
    }

    return null;
}

function getEmbeddedCharBook() {
    const ctx = getContext();
    const char = ctx?.characters?.[ctx?.characterId];
    const book = char?.data?.character_book;
    if (!book?.entries?.length) return null;
    // Normalize card-book shape (keys/secondary_keys/name/enabled) to WI shape
    const data = { entries: {} };
    (book.entries || []).forEach((e, idx) => {
        const uid = e.id ?? idx;
        data.entries[uid] = {
            uid,
            key: Array.isArray(e.keys) ? e.keys : (e.key || []),
            keysecondary: e.secondary_keys || e.keysecondary || [],
            content: e.content || '',
            comment: e.name || e.comment || '',
            disable: e.enabled === false,   // note the inversion
            constant: !!e.constant,
        };
    });
    return data;
}

// ─── Public API (same exports as before — drop-in) ────────────────────────────

export async function getLorebookEntries() {
    const settings = getSettings();
    if (!settings.bridgeLorebooks) {
        lorebookStatus = 'disabled';
        return [];
    }

    if (lorebookCache && (Date.now() - lorebookCacheTime) < CACHE_TTL) {
        return lorebookCache;
    }

    let entries = [];
    let booksLoaded = 0;

    try {
        const sources = await getActiveLorebookSources();
        const loaded = await Promise.all(sources.map(async (src) => {
            const data = await loadBook(src.name);
            return { ...src, data };
        }));

        for (const { name, scope, data } of loaded) {
            if (!data?.entries) continue;
            booksLoaded++;
            entries = entries.concat(mapBookEntries(name, scope, data));
        }

        if (booksLoaded > 0) {
            console.log(`[Lexicon] Lorebook bridge: ${entries.length} entries from ${booksLoaded} book(s) [${sources.map(s => s.name === EMBEDDED_BOOK_KEY ? '(embedded)' : s.name).join(', ')}]`);
        }
    } catch (e) {
        console.warn('[Lexicon] Lorebook bridge failed:', e.message);
    }

    lorebookCache = entries;
    lorebookCacheTime = Date.now();
    lorebookStatus = booksLoaded > 0 ? 'ok' : 'unavailable';
    return entries;
}

function mapBookEntries(bookName, scope, data) {
    return Object.values(data.entries)
        .filter(e => e && e.content && !e.disable && !e.disabled)
        .map(e => ({
            // Stable across cache refreshes: book + uid (old code used Math.random fallback)
            id: `lb_${bookName}_${e.uid ?? e.id ?? 0}`,
            title: e.comment || (Array.isArray(e.key) ? e.key[0] : e.key) || 'Lorebook Entry',
            content: e.content,
            category: 'Lorebook',
            pinned: e.constant || false,
            relatedIds: [],
            scope,                          // real source, not hardcoded 'global'
            enabled: true,
            fromLorebook: true,
            lorebookName: bookName === EMBEDDED_BOOK_KEY ? '(embedded)' : bookName,
            lorebookKey: Array.isArray(e.key) ? e.key : [e.key].filter(Boolean),
            lorebookKeySecondary: Array.isArray(e.keysecondary) ? e.keysecondary : [],
            revealTier: REVEAL_TIERS.BACKGROUND,
            hintText: '',
            gateConditions: [],
            chekhov: { seedCount: 0, plantedAt: null, firedAt: null, lastHintAt: null },
            narrativeState: NARRATIVE_STATES.DORMANT,
        }));
}

export function clearLorebookCache() {
    lorebookCache = null;
    lorebookCacheTime = 0;
}
