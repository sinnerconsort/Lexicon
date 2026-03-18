export const EXT_ID = 'lexicon';
export const EXT_DISPLAY_NAME = 'Lexicon';
export const EXT_VERSION = '2.0.0';

export const TRIGGER_MODES = {
    EVERY_MESSAGE: 'every_message',
    EVERY_N: 'every_n',
    MANUAL: 'manual',
};

export const ENTRY_SCOPES = {
    GLOBAL: 'global',
    CHARACTER: 'character',
    CHAT: 'chat',
};

export const CATEGORIES = [
    'Character', 'Location', 'Item', 'Faction',
    'Event', 'Concept', 'Rule', 'Lore', 'Relationship', 'History', 'Other',
];

// ─── Narrative Pacing ─────────────────────────────────────────────────────────

export const REVEAL_TIERS = {
    BACKGROUND: 'background',     // Always safe to know — geography, general facts
    FORESHADOW: 'foreshadow',     // Hint but don't reveal details
    GATED: 'gated',               // Only reveal when conditions are met
    TWIST: 'twist',               // Actively suppress until perfect moment
};

export const NARRATIVE_ACTIONS = {
    INJECT: 'INJECT',     // Full entry content injected
    HINT: 'HINT',         // Breadcrumb/hint version injected
    SUPPRESS: 'SUPPRESS', // Entry withheld entirely
};

export const NARRATIVE_STATES = {
    DORMANT: 'dormant',       // Not yet relevant to the story
    SEEDING: 'seeding',       // Being hinted at — seeds planted
    READY: 'ready',           // Conditions met, ready for reveal
    REVEALED: 'revealed',     // Has been fully injected/revealed
};

export const REVEAL_TIER_META = {
    background: { label: 'Background', icon: '🌍', color: '#7a9e7e', desc: 'Always safe — facts, geography, basic info' },
    foreshadow: { label: 'Foreshadow', icon: '🌙', color: '#b8a460', desc: 'Hint obliquely, don\'t reveal details' },
    gated: { label: 'Gated', icon: '🔒', color: '#8a7eb8', desc: 'Locked until conditions are met' },
    twist: { label: 'Twist', icon: '⚡', color: '#c45c5c', desc: 'Actively suppressed until the perfect moment' },
};

// ─── Default Entry Shape ──────────────────────────────────────────────────────

export const DEFAULT_ENTRY = {
    id: '',
    title: '',
    content: '',
    category: '',
    scope: 'global',
    pinned: false,
    enabled: true,
    relatedIds: [],
    fromLorebook: false,
    // Narrative pacing fields (v2)
    revealTier: REVEAL_TIERS.BACKGROUND,
    hintText: '',              // Manual breadcrumb — if empty, AI generates from content
    gateConditions: [],        // [{ text: 'Player visited the Whirling', met: false }]
    chekhov: {
        seedCount: 0,          // Times this entry has been hinted at
        plantedAt: null,       // Timestamp of first hint
        firedAt: null,         // Timestamp of full reveal
        lastHintAt: null,      // Timestamp of most recent hint
    },
    narrativeState: NARRATIVE_STATES.DORMANT,
};

// ─── Settings Defaults ────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS = {
    enabled: true,
    selectedProfile: 'current',
    triggerMode: TRIGGER_MODES.EVERY_MESSAGE,
    triggerEveryN: 3,
    maxInjectedEntries: 5,
    injectionDepth: 1,
    showDebugOverlay: true,
    bridgeLorebooks: true,
    enableNarrativePacing: true,   // v2: enable the pacing layer
    autoHintGeneration: true,      // v2: AI generates hints when hintText is empty
    entries: [],
    characterEntries: {},
    settingsVersion: 2,
};

export const DEFAULT_CHAT_STATE = {
    chatEntries: [],
    lastScanAt: 0,
    lastScanTime: 0,
    currentInjectedIds: [],
    currentRelevanceScores: {},
    // v2: Narrative tracking
    narrativeActions: {},          // { entryId: 'INJECT' | 'HINT' | 'SUPPRESS' }
    narrativeTimeline: [],         // [{ timestamp, entryId, entryTitle, action, context }]
};
