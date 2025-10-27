const DB_NAME = "mlearn-pwa-storage";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const FLASHCARDS_KEY = "flashcards";
const WORD_FREQ_KEY = "wordFreq";

const DEFAULT_WORD_FREQ = {};

function buildDefaultFlashcards() {
    return {
        flashcards: [],
        wordCandidates: {},
        alreadyCreated: {},
        knownUnTracked: {},
        meta: {
            flashcardsCreatedToday: 0,
            lastFlashcardCreatedDate: Date.now()
        }
    };
}

let flashcardsCache = readFlashcardsFromLocal();
let wordFreqCache = readWordFreqFromLocal(DEFAULT_WORD_FREQ);

const dbPromise = initIndexedDB();

function clone(value) {
    if (value === undefined || value === null) return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (err) {
        console.warn("Failed to clone value", err);
        return undefined;
    }
}

function readFlashcardsFromLocal() {
    const fallback = buildDefaultFlashcards();
    const data = readFromLocalStorage(FLASHCARDS_KEY, fallback);
    return normalizeFlashcards(data);
}

function readWordFreqFromLocal(fallback) {
    const data = readFromLocalStorage(WORD_FREQ_KEY, fallback);
    return typeof data === "object" && data !== null ? data : clone(fallback) ?? {};
}

function normalizeFlashcards(data) {
    const defaults = buildDefaultFlashcards();
    const safe = data && typeof data === "object" ? data : {};
    const normalized = {
        ...defaults,
        ...safe,
        flashcards: Array.isArray(safe.flashcards) ? safe.flashcards : [],
        wordCandidates: typeof safe.wordCandidates === "object" && safe.wordCandidates !== null ? safe.wordCandidates : {},
        alreadyCreated: typeof safe.alreadyCreated === "object" && safe.alreadyCreated !== null ? safe.alreadyCreated : {},
        knownUnTracked: typeof safe.knownUnTracked === "object" && safe.knownUnTracked !== null ? safe.knownUnTracked : {},
        meta: {
            ...defaults.meta,
            ...(typeof safe.meta === "object" && safe.meta !== null ? safe.meta : {})
        }
    };
    return normalized;
}

function readFromLocalStorage(key, fallback) {
    if (typeof localStorage === "undefined") {
        return clone(fallback);
    }
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return clone(fallback);
        return JSON.parse(raw);
    } catch (err) {
        console.warn("Failed to read", key, "from localStorage", err);
        return clone(fallback);
    }
}

function writeToLocalStorage(key, value) {
    if (typeof localStorage === "undefined") return false;
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (err) {
        const quotaHit = err && (err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014);
        if (!quotaHit) console.warn("localStorage write failed", err);
        return false;
    }
}

function removeFromLocalStorage(key) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.removeItem(key);
    } catch (err) {
        console.warn("Failed to remove", key, "from localStorage", err);
    }
}

function isIndexedDBAvailable() {
    try {
        return typeof indexedDB !== "undefined";
    } catch (_err) {
        return false;
    }
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
        request.onblocked = () => {
            console.warn("IndexedDB upgrade blocked for", DB_NAME);
        };
    });
}

function getStore(db, mode) {
    const tx = db.transaction(STORE_NAME, mode);
    return tx.objectStore(STORE_NAME);
}

function readFromIndexedDB(db, key) {
    return new Promise((resolve, reject) => {
        const store = getStore(db, "readonly");
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function writeToIndexedDB(db, key, value) {
    return new Promise((resolve, reject) => {
        const store = getStore(db, "readwrite");
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function hydrateCacheFromIndexedDB(db) {
    try {
        const [fc, wf] = await Promise.all([
            readFromIndexedDB(db, FLASHCARDS_KEY),
            readFromIndexedDB(db, WORD_FREQ_KEY)
        ]);
        if (fc) flashcardsCache = normalizeFlashcards(fc);
        if (wf) wordFreqCache = typeof wf === "object" && wf !== null ? wf : wordFreqCache;
        if (!fc) await writeToIndexedDB(db, FLASHCARDS_KEY, flashcardsCache);
        if (!wf) await writeToIndexedDB(db, WORD_FREQ_KEY, wordFreqCache);
        removeFromLocalStorage(FLASHCARDS_KEY);
        removeFromLocalStorage(WORD_FREQ_KEY);
    } catch (err) {
        console.warn("Failed to hydrate IndexedDB cache", err);
    }
}

function initIndexedDB() {
    if (!isIndexedDBAvailable()) {
        return Promise.resolve(null);
    }
    return openDatabase()
        .then(async (db) => {
            await hydrateCacheFromIndexedDB(db);
            return db;
        })
        .catch((err) => {
            console.warn("IndexedDB unavailable, staying on localStorage", err);
            return null;
        });
}

function persistValue(key, value) {
    dbPromise
        .then((db) => {
            if (db) {
                return writeToIndexedDB(db, key, value).catch((err) => {
                    console.warn("IndexedDB write failed", err);
                    writeToLocalStorage(key, value);
                });
            }
            writeToLocalStorage(key, value);
            return null;
        })
        .catch((err) => {
            console.warn("Storage persistence failed", err);
            writeToLocalStorage(key, value);
        });
}

export const storageReady = dbPromise.then(() => true).catch(() => false);

export function getFlashcards() {
    const data = flashcardsCache && typeof flashcardsCache === "object" ? flashcardsCache : buildDefaultFlashcards();
    const cloned = clone(data);
    if (cloned) return cloned;
    return clone(buildDefaultFlashcards());
}

export function Flashcards() {
    return getFlashcards();
}

export function getWordFreq() {
    const data = wordFreqCache && typeof wordFreqCache === "object" ? wordFreqCache : DEFAULT_WORD_FREQ;
    return clone(data) ?? {};
}

export function overwriteFlashcards(flashcards) {
    flashcardsCache = normalizeFlashcards(flashcards);
    persistValue(FLASHCARDS_KEY, flashcardsCache);
}

export function overwriteWordFreq(wf) {
    wordFreqCache = typeof wf === "object" && wf !== null ? wf : {};
    persistValue(WORD_FREQ_KEY, wordFreqCache);
}

export function saveFlashcards() {
    overwriteFlashcards(getFlashcards());
}
