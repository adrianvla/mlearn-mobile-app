/**
 * HTTP Sync Service
 * Bidirectional sync with mLearn desktop Node server via REST API.
 * Replaces the old WebRTC peer-to-peer sync mechanism.
 */

const POLL_INTERVAL_MS = 60_000;
const PING_TIMEOUT_MS = 3_000;

let pollTimer = null;
let currentStatus = 'offline';
let syncMode = 'off';
let serverUrl = '';
let authToken = '';
let pendingSettingsPush = null;
let pendingFlashcardsPush = null;

let callbacks = {
    onStatusChange: () => {},
    onSettingsReceived: () => {},
    onFlashcardsReceived: () => {},
    getLocalSettings: () => ({}),
    getLocalFlashcards: () => ({}),
};

function setStatus(status) {
    currentStatus = status;
    if (callbacks.onStatusChange) callbacks.onStatusChange(status);
}

export function getSyncStatus() {
    return currentStatus;
}

export function getSyncMode() {
    return syncMode;
}

export function setSyncMode(mode) {
    syncMode = mode;
}

function buildUrl(path) {
    const base = serverUrl.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
}

async function fetchWithAuth(url, options = {}) {
    const opts = {
        ...options,
        headers: {
            ...(options.headers || {}),
            'Content-Type': 'application/json',
        },
    };
    if (authToken) {
        opts.headers['X-Auth-Token'] = authToken;
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res;
}

/* ── Auth ──────────────────────────────────────────────────────────── */

export async function authenticate(baseUrl) {
    const cleanUrl = baseUrl.replace(/\/+$/, '');
    const res = await fetch(`${cleanUrl}/api/overlay-state`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
        throw new Error(`Auth failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || !data.settings || !data.settings.serverAuthToken) {
        throw new Error('Auth failed: serverAuthToken not found in overlay-state');
    }
    serverUrl = cleanUrl;
    authToken = data.settings.serverAuthToken;
    return true;
}

export function disconnect() {
    serverUrl = '';
    authToken = '';
    syncMode = 'off';
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    setStatus('offline');
}

export function isConnected() {
    return !!serverUrl && !!authToken;
}

export function getServerUrl() {
    return serverUrl;
}

/* ── API calls ─────────────────────────────────────────────────────── */

async function apiPing() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
        const res = await fetch(buildUrl('/api/ping'), {
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return res.ok;
    } catch (_) {
        return false;
    }
}

async function apiGetSettings() {
    const res = await fetchWithAuth(buildUrl('/api/settings'));
    return await res.json();
}

async function apiSaveSettings(settings) {
    const res = await fetchWithAuth(buildUrl('/api/settings'), {
        method: 'POST',
        body: JSON.stringify(settings),
    });
    return await res.json();
}

async function apiGetFlashcards() {
    const res = await fetchWithAuth(buildUrl('/api/flashcards'));
    return await res.json();
}

async function apiSaveFlashcards(store) {
    const res = await fetchWithAuth(buildUrl('/api/flashcards'), {
        method: 'POST',
        body: JSON.stringify(store),
    });
    return await res.json();
}

/* ── Conflict resolution ───────────────────────────────────────────── */

function mergeSettings(local, remote) {
    const localTime = local.lastModified || 0;
    const remoteTime = remote.lastModified || 0;
    if (remoteTime > localTime) {
        return { ...remote };
    }
    return null;
}

function mergeFlashcardStores(local, remote) {
    const localCards = local.flashcards || {};
    const remoteCards = remote.flashcards || {};
    const allIds = new Set([...Object.keys(localCards), ...Object.keys(remoteCards)]);

    let hasChanges = false;
    const mergedCards = {};

    for (const id of allIds) {
        const lc = localCards[id];
        const rc = remoteCards[id];

        if (lc && rc) {
            if ((rc.lastUpdated || 0) > (lc.lastUpdated || 0)) {
                mergedCards[id] = rc;
                hasChanges = true;
            } else {
                mergedCards[id] = lc;
            }
        } else if (lc) {
            mergedCards[id] = lc;
        } else if (rc) {
            mergedCards[id] = rc;
            hasChanges = true;
        }
    }

    const localCandidates = local.wordCandidates || {};
    const remoteCandidates = remote.wordCandidates || {};
    const allCandidateWords = new Set([...Object.keys(localCandidates), ...Object.keys(remoteCandidates)]);
    const mergedCandidates = { ...localCandidates };

    for (const word of allCandidateWords) {
        const lw = localCandidates[word];
        const rw = remoteCandidates[word];
        if (lw && rw) {
            if ((rw.lastSeen || 0) > (lw.lastSeen || 0)) {
                mergedCandidates[word] = rw;
                hasChanges = true;
            }
        } else if (!lw && rw) {
            mergedCandidates[word] = rw;
            hasChanges = true;
        }
    }

    if (!hasChanges) return null;

    return {
        ...local,
        flashcards: mergedCards,
        wordCandidates: mergedCandidates,
    };
}

/* ── Sync operations ───────────────────────────────────────────────── */

async function pullSettings() {
    try {
        const remote = await apiGetSettings();
        if (!remote) return;
        const local = callbacks.getLocalSettings();
        const merged = mergeSettings(local, remote);
        if (merged) {
            callbacks.onSettingsReceived(merged);
        }
    } catch (e) {
        console.warn('Pull settings failed', e);
    }
}

async function pushSettings(settings) {
    await apiSaveSettings(settings);
}

async function pullFlashcards() {
    try {
        const remote = await apiGetFlashcards();
        if (!remote) return;
        const local = callbacks.getLocalFlashcards();
        const merged = mergeFlashcardStores(local, remote);
        if (merged) {
            callbacks.onFlashcardsReceived(merged);
        }
    } catch (e) {
        console.warn('Pull flashcards failed', e);
    }
}

async function pushFlashcards(store) {
    await apiSaveFlashcards(store);
}

async function syncAll() {
    if (!serverUrl || !authToken) {
        setStatus('offline');
        return;
    }

    setStatus('syncing');

    try {
        const pingOk = await apiPing();
        if (!pingOk) {
            setStatus('offline');
            return;
        }

        await pullSettings();
        await pullFlashcards();

        if (pendingSettingsPush) {
            const settings = callbacks.getLocalSettings();
            await pushSettings({ ...settings, ...pendingSettingsPush });
            pendingSettingsPush = null;
        }

        if (pendingFlashcardsPush) {
            const store = callbacks.getLocalFlashcards();
            await pushFlashcards(store);
            pendingFlashcardsPush = null;
        }

        setStatus('synced');
    } catch (e) {
        console.error('Sync failed', e);
        setStatus('error');
    }
}

/* ── Public API ────────────────────────────────────────────────────── */

export function startSync(cbs) {
    callbacks = {
        onStatusChange: () => {},
        onSettingsReceived: () => {},
        onFlashcardsReceived: () => {},
        getLocalSettings: () => ({}),
        getLocalFlashcards: () => ({}),
        ...cbs,
    };

    if (!serverUrl || !authToken) {
        setStatus('offline');
        return;
    }

    setStatus('syncing');
    syncAll();

    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => syncAll(), POLL_INTERVAL_MS);
}

export function stopSync() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    setStatus('offline');
}

export function queueSettingsPush(settings) {
    pendingSettingsPush = { ...pendingSettingsPush, ...settings };
    if (currentStatus !== 'offline' && serverUrl && authToken && callbacks) {
        const full = callbacks.getLocalSettings();
        pushSettings(full).catch(() => {});
    }
}

export function queueFlashcardsPush(store) {
    pendingFlashcardsPush = store;
    if (currentStatus !== 'offline' && serverUrl && authToken) {
        pushFlashcards(store).catch(() => {});
    }
}

export function triggerSync() {
    syncAll();
}

export async function connectWithUrl(url) {
    if (!url) throw new Error('No server URL provided');
    await authenticate(url);
    syncMode = 'tethered';
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => syncAll(), POLL_INTERVAL_MS);
    syncAll();
    return true;
}
