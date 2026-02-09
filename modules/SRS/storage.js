/**
 * Flashcard Storage Module
 * Dual-layer persistence: IndexedDB (primary) with localStorage fallback.
 * Data format matches mlearn-ts FlashcardStore v3 (UUID-keyed flashcards).
 */

import { getDefaultMeta, generateUUID, hashWord } from './srsAlgorithm.js';

const DB_NAME = "mlearn-pwa-storage";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const FLASHCARDS_KEY = "flashcards";
const WORD_FREQ_KEY = "wordFreq";
const CURRENT_STORE_VERSION = 3;

const DEFAULT_WORD_FREQ = {};

function buildDefaultStore() {
    return {
        flashcards: {},
        wordCandidates: {},
        wordToCardMap: {},
        wordStatsMap: {},
        knownUntracked: {},
        meta: getDefaultMeta(),
        dailyStats: {},
        version: CURRENT_STORE_VERSION,
    };
}

function clone(value) {
    if (value === undefined || value === null) return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (err) {
        return undefined;
    }
}

/* ── Migration from old array-based format ─────────────────────────── */

function isOldArrayFormat(data) {
    return data && Array.isArray(data.flashcards);
}

async function migrateFromArrayFormat(oldData) {
    const store = buildDefaultStore();
    if (!oldData || !Array.isArray(oldData.flashcards)) return store;

    for (const card of oldData.flashcards) {
        const id = generateUUID();
        const content = card.content || {};
        const now = Date.now();

        const back = Array.isArray(content.translation)
            ? content.translation.join(', ')
            : (content.translation || '');

        const newContent = {
            type: 'word',
            front: content.word || '',
            back,
            reading: content.pronunciation || undefined,
            pitchAccent: content.pitchAccent,
            pos: content.pos || undefined,
            level: content.level,
            example: content.example || undefined,
            exampleMeaning: content.exampleMeaning || undefined,
            imageUrl: content.screenshotUrl || undefined,
            extra: {},
            word: content.word,
            pronunciation: content.pronunciation,
            translation: content.translation,
            definition: content.definition,
            screenshotUrl: content.screenshotUrl,
        };

        const reviews = typeof card.reviews === 'number' ? card.reviews : 0;
        const rawEase = (typeof card.ease === 'number' && card.ease > 0) ? card.ease : 2.5;
        const dueDate = typeof card.dueDate === 'number' ? card.dueDate : now;
        const lastReviewed = typeof card.lastReviewed === 'number' ? card.lastReviewed : 0;
        const interval = lastReviewed > 0 ? Math.max(0, dueDate - lastReviewed) : 0;
        const state = reviews > 0 ? 'review' : 'new';

        store.flashcards[id] = {
            id,
            content: newContent,
            state,
            ease: rawEase,
            interval,
            dueDate,
            reviews,
            lapses: 0,
            learningStep: 0,
            createdAt: lastReviewed || now,
            lastReviewed,
            lastUpdated: card.lastUpdated || now,
        };

        const word = newContent.front;
        if (word) {
            const wordHash = await hashWord(word);
            if (!store.wordToCardMap[wordHash]) store.wordToCardMap[wordHash] = [];
            store.wordToCardMap[wordHash].push(id);
        }
    }

    if (oldData.knownUnTracked && typeof oldData.knownUnTracked === 'object') {
        Object.assign(store.knownUntracked, oldData.knownUnTracked);
    }
    if (oldData.knownUntracked && typeof oldData.knownUntracked === 'object') {
        Object.assign(store.knownUntracked, oldData.knownUntracked);
    }
    if (oldData.wordCandidates && typeof oldData.wordCandidates === 'object') {
        store.wordCandidates = { ...oldData.wordCandidates };
    }

    rebuildWordStatsMap(store);
    return store;
}

/* ── Word stats helpers ────────────────────────────────────────────── */

const STATE_ORDER = { 'new': 0, 'learning': 1, 'relearning': 2, 'review': 3 };

function calculateWordStats(cards) {
    if (cards.length === 0) {
        return { cardCount: 0, bestEase: 2.5, totalReviews: 0, totalLapses: 0, lastReviewed: 0, bestInterval: 0, bestState: 'new' };
    }
    let bestEase = 0, totalReviews = 0, totalLapses = 0, lastReviewed = 0, bestInterval = 0, bestState = 'new';
    for (const card of cards) {
        if (card.ease > bestEase) bestEase = card.ease;
        totalReviews += card.reviews || 0;
        totalLapses += card.lapses || 0;
        if (card.lastReviewed > lastReviewed) lastReviewed = card.lastReviewed;
        if (card.interval > bestInterval) bestInterval = card.interval;
        if ((STATE_ORDER[card.state] || 0) > (STATE_ORDER[bestState] || 0)) bestState = card.state;
    }
    return { cardCount: cards.length, bestEase, totalReviews, totalLapses, lastReviewed, bestInterval, bestState };
}

function rebuildWordStatsMap(store) {
    store.wordStatsMap = {};
    for (const [wordHash, cardIds] of Object.entries(store.wordToCardMap)) {
        const cards = cardIds.map(id => store.flashcards[id]).filter(Boolean);
        if (cards.length > 0) {
            store.wordStatsMap[wordHash] = calculateWordStats(cards);
        }
    }
}

/* ── Normalization ─────────────────────────────────────────────────── */

function normalizeStore(data) {
    const defaults = buildDefaultStore();
    if (!data || typeof data !== 'object') return defaults;

    const flashcards = (typeof data.flashcards === 'object' && !Array.isArray(data.flashcards))
        ? data.flashcards : {};

    const knownUntracked = {};
    if (typeof data.knownUntracked === 'object' && data.knownUntracked !== null) {
        Object.assign(knownUntracked, data.knownUntracked);
    }
    if (typeof data.knownUnTracked === 'object' && data.knownUnTracked !== null) {
        Object.assign(knownUntracked, data.knownUnTracked);
    }

    return {
        flashcards,
        wordCandidates: (typeof data.wordCandidates === 'object' && data.wordCandidates !== null) ? data.wordCandidates : {},
        wordToCardMap: (typeof data.wordToCardMap === 'object' && data.wordToCardMap !== null) ? data.wordToCardMap : {},
        wordStatsMap: (typeof data.wordStatsMap === 'object' && data.wordStatsMap !== null) ? data.wordStatsMap : {},
        knownUntracked,
        meta: { ...defaults.meta, ...(typeof data.meta === 'object' && data.meta !== null ? data.meta : {}) },
        dailyStats: (typeof data.dailyStats === 'object' && data.dailyStats !== null) ? data.dailyStats : {},
        version: typeof data.version === 'number' ? data.version : CURRENT_STORE_VERSION,
    };
}

/* ── localStorage helpers ──────────────────────────────────────────── */

function readFromLocalStorage(key, fallback) {
    if (typeof localStorage === 'undefined') return clone(fallback);
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return clone(fallback);
        return JSON.parse(raw);
    } catch (err) {
        return clone(fallback);
    }
}

function writeToLocalStorage(key, value) {
    if (typeof localStorage === 'undefined') return false;
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (err) {
        return false;
    }
}

function removeFromLocalStorage(key) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(key); } catch (_) {}
}

/* ── IndexedDB helpers ─────────────────────────────────────────────── */

function isIndexedDBAvailable() {
    try { return typeof indexedDB !== 'undefined'; } catch (_) { return false; }
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => {};
    });
}

function getIDBStore(db, mode) {
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function readFromIndexedDB(db, key) {
    return new Promise((resolve, reject) => {
        const store = getIDBStore(db, 'readonly');
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function writeToIndexedDB(db, key, value) {
    return new Promise((resolve, reject) => {
        const store = getIDBStore(db, 'readwrite');
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/* ── Cache + init ──────────────────────────────────────────────────── */

let flashcardsCache = buildDefaultStore();
let wordFreqCache = {};

function initialLoad() {
    const rawFc = readFromLocalStorage(FLASHCARDS_KEY, null);
    if (rawFc) {
        if (isOldArrayFormat(rawFc)) {
            flashcardsCache = buildDefaultStore();
        } else {
            flashcardsCache = normalizeStore(rawFc);
        }
    }
    const rawWf = readFromLocalStorage(WORD_FREQ_KEY, DEFAULT_WORD_FREQ);
    wordFreqCache = (typeof rawWf === 'object' && rawWf !== null) ? rawWf : {};
}

initialLoad();

async function hydrateCacheFromIndexedDB(db) {
    try {
        const [fc, wf] = await Promise.all([
            readFromIndexedDB(db, FLASHCARDS_KEY),
            readFromIndexedDB(db, WORD_FREQ_KEY),
        ]);

        if (fc) {
            if (isOldArrayFormat(fc)) {
                flashcardsCache = await migrateFromArrayFormat(fc);
                await writeToIndexedDB(db, FLASHCARDS_KEY, flashcardsCache);
            } else {
                flashcardsCache = normalizeStore(fc);
            }
        } else {
            const rawLocal = readFromLocalStorage(FLASHCARDS_KEY, null);
            if (rawLocal && isOldArrayFormat(rawLocal)) {
                flashcardsCache = await migrateFromArrayFormat(rawLocal);
            } else if (rawLocal) {
                flashcardsCache = normalizeStore(rawLocal);
            }
            await writeToIndexedDB(db, FLASHCARDS_KEY, flashcardsCache);
        }

        if (wf) {
            wordFreqCache = (typeof wf === 'object' && wf !== null) ? wf : wordFreqCache;
        } else {
            await writeToIndexedDB(db, WORD_FREQ_KEY, wordFreqCache);
        }

        removeFromLocalStorage(FLASHCARDS_KEY);
        removeFromLocalStorage(WORD_FREQ_KEY);
    } catch (err) {
        console.warn('Failed to hydrate IndexedDB cache', err);
    }
}

function initIndexedDB() {
    if (!isIndexedDBAvailable()) return Promise.resolve(null);
    return openDatabase()
        .then(async (db) => {
            await hydrateCacheFromIndexedDB(db);
            return db;
        })
        .catch((err) => {
            console.warn('IndexedDB unavailable, staying on localStorage', err);
            return null;
        });
}

const dbPromise = initIndexedDB();

function persistValue(key, value) {
    dbPromise
        .then((db) => {
            if (db) {
                return writeToIndexedDB(db, key, value).catch(() => {
                    writeToLocalStorage(key, value);
                });
            }
            writeToLocalStorage(key, value);
            return null;
        })
        .catch(() => {
            writeToLocalStorage(key, value);
        });
}

/* ── Public API ────────────────────────────────────────────────────── */

export const storageReady = dbPromise.then(() => true).catch(() => false);

export function getFlashcards() {
    const data = (flashcardsCache && typeof flashcardsCache === 'object')
        ? flashcardsCache
        : buildDefaultStore();
    return clone(data) || clone(buildDefaultStore());
}

export function Flashcards() {
    return getFlashcards();
}

export function getWordFreq() {
    const data = (wordFreqCache && typeof wordFreqCache === 'object') ? wordFreqCache : DEFAULT_WORD_FREQ;
    return clone(data) || {};
}

export function overwriteFlashcards(store) {
    flashcardsCache = normalizeStore(store);
    persistValue(FLASHCARDS_KEY, flashcardsCache);
}

export function overwriteWordFreq(wf) {
    wordFreqCache = (typeof wf === 'object' && wf !== null) ? wf : {};
    persistValue(WORD_FREQ_KEY, wordFreqCache);
}

export function saveFlashcards() {
    overwriteFlashcards(getFlashcards());
}
