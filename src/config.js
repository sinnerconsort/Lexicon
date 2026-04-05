export const EXT_ID = 'lexicon';
export const EXT_DISPLAY_NAME = 'Lexicon';
export const EXT_VERSION = '2.1.0';

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
    BACKGROUND: 'background',
    FORESHADOW: 'foreshadow',
    GATED: 'gated',
    TWIST: 'twist',
};

export const NARRATIVE_ACTIONS = {
    INJECT: 'INJECT',
    HINT: 'HINT',
    SUPPRESS: 'SUPPRESS',
};

export const NARRATIVE_STATES = {
    DORMANT: 'dormant',
    SEEDING: 'seeding',
    READY: 'ready',
    REVEALED: 'revealed',
};

export const REVEAL_TIER_META = {
    background: { label: 'Background', icon: '🌍', color: '#7a9e7e', desc: 'Always safe — facts, geography, basic info' },
    foreshadow: { label: 'Foreshadow', icon: '🌙', color: '#b8a460', desc: 'Hint obliquely, don\'t reveal details' },
    gated: { label: 'Gated', icon: '🔒', color: '#8a7eb8', desc: 'Locked until conditions are met' },
    twist: { label: 'Twist', icon: '⚡', color: '#c45c5c', desc: 'Actively suppressed until the perfect moment' },
};

// ─── v2.1: Scene Types ───────────────────────────────────────────────────────

export const SCENE_TYPES = {
    SOCIAL: 'social',
    PRIVATE: 'private',
    INVESTIGATION: 'investigation',
    ACTION: 'action',
    INTIMATE: 'intimate',
    RITUAL: 'ritual',
};

export const SCENE_TYPE_META = {
    social:        { label: 'Social',        icon: '💬', desc: 'Conversation, casual encounters, group interaction' },
    private:       { label: 'Private',       icon: '🌙', desc: 'Character alone, reflection, preparation' },
    investigation: { label: 'Investigation', icon: '🔍', desc: 'Questioning, evidence, suspicion, discovery' },
    action:        { label: 'Action',        icon: '⚔️', desc: 'Confrontation, chase, violence, stealth' },
    intimate:      { label: 'Intimate',      icon: '💛', desc: 'Emotional vulnerability, trust, genuine connection' },
    ritual:        { label: 'Ritual',        icon: '🕯️', desc: 'Post-event processing, cleanup, personal routines' },
};

export const SCENE_TYPE_KEYWORDS = {
    social: [
        'said', 'laughed', 'smiled', 'joked', 'chatted', 'conversation',
        'bar', 'cafe', 'restaurant', 'office', 'meeting', 'party', 'crowd',
        'greeted', 'introduced', 'waved', 'shook hands', 'group',
    ],
    private: [
        'alone', 'solitude', 'mirror', 'reflected', 'thought to',
        'prepared', 'planning', 'bedroom', 'shower', 'quiet',
        'diary', 'journal', 'muttered to', 'by himself', 'by herself',
    ],
    investigation: [
        'evidence', 'clue', 'suspect', 'questioned', 'interrogat',
        'searched', 'discovered', 'investigated', 'police', 'detective',
        'noticed something', 'looked closer', 'file', 'report', 'hidden',
    ],
    action: [
        'ran', 'chased', 'fought', 'attacked', 'dodged', 'knife',
        'weapon', 'blood', 'broke in', 'stalked', 'followed',
        'punched', 'kicked', 'grabbed', 'escaped', 'dark alley',
    ],
    intimate: [
        'trust', 'vulnerable', 'confession', 'whispered', 'held',
        'tears', 'opened up', 'honest', 'kissed', 'embrace',
        'comfort', 'safe', 'gentle', 'heart', 'feelings',
    ],
    ritual: [
        'cleaned', 'trophy', 'collected', 'arranged', 'routine',
        'ritual', 'ceremony', 'aftermath', 'processed', 'cataloged',
        'writing', 'article', 'documented',
    ],
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
    // v2: Narrative pacing
    revealTier: REVEAL_TIERS.BACKGROUND,
    hintText: '',
    gateConditions: [],
    chekhov: {
        seedCount: 0,
        plantedAt: null,
        firedAt: null,
        lastHintAt: null,
    },
    narrativeState: NARRATIVE_STATES.DORMANT,
    // v2.1
    scene_types: [],
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
    enableNarrativePacing: true,
    autoHintGeneration: true,
    // v2.1
    enableSceneDetection: true,
    injectionCooldownThreshold: 3,
    entries: [],
    characterEntries: {},
    settingsVersion: 3,
};

export const DEFAULT_CHAT_STATE = {
    chatEntries: [],
    lastScanAt: 0,
    lastScanTime: 0,
    currentInjectedIds: [],
    currentRelevanceScores: {},
    // v2: Narrative tracking
    narrativeActions: {},
    narrativeTimeline: [],
    // v2.1: Injection history
    injectionHistory: {
        log: [],
        frequency_map: {},
    },
    // v2.1: Scene detection
    detectedSceneType: null,
    sceneTypeOverride: null,
    // v2.1: Related entry next-cycle boost
    pendingRelatedBoosts: [],
};
