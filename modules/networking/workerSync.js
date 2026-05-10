import { displayScreen } from '../screens/displayScreen.js';
import { overwriteFlashcards, getFlashcards } from '../SRS/storage.js';
import { getAccessToken, isAuthenticated } from './cloudAuth.js';

const WORKER_API_URL = 'https://mlearn-cloud.kikan.net';
const CHUNK_SIZE = 16000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;

let socket = null;
let receivedChunks = {};
let totalChunksExpected = 0;
let onCompleteCallback = null;
let onErrorCallback = null;

function buildSyncSocketUrl(roomId, role) {
    const accessToken = getAccessToken();
    return `wss://${new URL(WORKER_API_URL).host}/api/flashcard-sync/rooms/${roomId}/socket?_role=${role}&_token=${encodeURIComponent(accessToken)}`;
}

function splitTextIntoChunks(text, chunkSize) {
    if (typeof text !== 'string') {
        throw new TypeError('First argument must be a string');
    }
    if (typeof chunkSize !== 'number' || chunkSize <= 0) {
        throw new RangeError('Chunk size must be a positive number');
    }
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}

function stripMediaUrls(store) {
    const stripped = JSON.parse(JSON.stringify(store));

    for (const card of Object.values(stripped.flashcards || {})) {
        if (card.content) {
            delete card.content.imageUrl;
            delete card.content.audioUrl;
            delete card.content.videoUrl;
        }
    }

    return stripped;
}

export async function createSyncRoom() {
    const accessToken = getAccessToken();
    const response = await fetch(`${WORKER_API_URL}/api/flashcard-sync/rooms`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('Authentication required. Please sign in to sync.');
        }
        throw new Error(`Failed to create sync room: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

function connectWithRetry(url, role, onMessage) {
    let retriesLeft = MAX_RETRIES;

    const attempt = () => {
        socket = new WebSocket(url, 'mlearn-flashcard-sync-v1');

        socket.onopen = () => {
            console.log(`[WorkerSync] Connected as ${role}`);
        };

        socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                onMessage(msg);
            } catch (e) {
                console.error('[WorkerSync] Invalid message:', e);
            }
        };

        socket.onclose = () => {
            console.log('[WorkerSync] Disconnected');
        };

        socket.onerror = (err) => {
            console.error('[WorkerSync] WebSocket error:', err);
            if (retriesLeft > 0) {
                retriesLeft--;
                socket = null;
                setTimeout(attempt, RETRY_DELAY_MS);
            } else if (onErrorCallback) {
                onErrorCallback('WebSocket connection failed');
            }
        };
    };

    attempt();
}

export function connectAsReceiver(roomId, onComplete, onError) {
    if (!isAuthenticated()) {
        if (onError) onError('Authentication required. Please sign in to sync.');
        return;
    }

    onCompleteCallback = onComplete;
    onErrorCallback = onError;
    receivedChunks = {};
    totalChunksExpected = 0;

    const url = buildSyncSocketUrl(roomId, 'receiver');
    connectWithRetry(url, 'receiver', handleReceiverMessage);
}

export function connectAsSender(roomId, onComplete, onError) {
    onCompleteCallback = onComplete;
    onErrorCallback = onError;
    receivedChunks = {};
    totalChunksExpected = 0;

    const url = buildSyncSocketUrl(roomId, 'sender');
    connectWithRetry(url, 'sender', handleSenderMessage);
}

function handleReceiverMessage(msg) {
    switch (msg.type) {
        case 'offer': {
            totalChunksExpected = msg.totalChunks || 0;
            requestChunk(0);
            break;
        }

        case 'chunk_data': {
            if (msg.index !== undefined && msg.data) {
                receivedChunks[msg.index] = msg.data;
                const current = Object.keys(receivedChunks).length;
                updateProgress(current, totalChunksExpected);

                socket.send(JSON.stringify({
                    type: 'chunk_received',
                    index: msg.index,
                }));

                if (current < totalChunksExpected) {
                    requestChunk(current);
                } else {
                    completeReceive();
                }
            }
            break;
        }

        case 'complete': {
            if (onCompleteCallback) {
                onCompleteCallback();
            }
            disconnect();
            break;
        }

        case 'error': {
            if (onErrorCallback) {
                onErrorCallback(msg.message || 'Sync error');
            }
            disconnect();
            break;
        }

        case 'peer_disconnected': {
            if (onErrorCallback) {
                onErrorCallback('Peer disconnected');
            }
            disconnect();
            break;
        }
    }
}

function handleSenderMessage(msg) {
    switch (msg.type) {
        case 'peer_connected': {
            if (msg.role === 'receiver') {
                sendOffer();
            }
            break;
        }

        case 'request_chunk': {
            if (msg.index !== undefined) {
                sendChunk(msg.index);
            }
            break;
        }

        case 'complete': {
            if (onCompleteCallback) {
                onCompleteCallback();
            }
            disconnect();
            break;
        }

        case 'error': {
            if (onErrorCallback) {
                onErrorCallback(msg.message || 'Sync error');
            }
            disconnect();
            break;
        }

        case 'peer_disconnected': {
            if (onErrorCallback) {
                onErrorCallback('Peer disconnected');
            }
            disconnect();
            break;
        }
    }
}

let chunksToSend = [];

function sendOffer() {
    const stripped = stripMediaUrls(getFlashcards());
    const storeData = JSON.stringify(stripped);
    chunksToSend = splitTextIntoChunks(storeData, CHUNK_SIZE);

    socket.send(JSON.stringify({
        type: 'offer',
        totalChunks: chunksToSend.length,
        totalSize: storeData.length,
    }));
}

function sendChunk(index) {
    if (index >= chunksToSend.length) return;

    socket.send(JSON.stringify({
        type: 'chunk_data',
        index: index,
        data: chunksToSend[index],
    }));

    const current = index + 1;
    updateProgress(current, chunksToSend.length);
}

function requestChunk(index) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({
        type: 'request_chunk',
        index: index,
    }));
}

function completeReceive() {
    try {
        let assembled = '';
        for (let i = 0; i < totalChunksExpected; i++) {
            assembled += receivedChunks[i];
        }

        const remoteStore = JSON.parse(assembled);
        overwriteFlashcards(remoteStore);

        socket.send(JSON.stringify({ type: 'complete' }));

        displayScreen('done');
        setTimeout(() => {
            displayScreen('home');
        }, 2000);

        if (onCompleteCallback) {
            onCompleteCallback();
        }
    } catch (e) {
        console.error('[WorkerSync] Error completing receive:', e);
        if (onErrorCallback) {
            onErrorCallback('Failed to process received data');
        }
    }

    disconnect();
}

function updateProgress(current, total) {
    const percent = total > 0 ? (current / total) * 100 : 0;
    const progressBar = document.querySelector('.sync-progress-bar');
    if (progressBar) {
        progressBar.style.width = percent + '%';
    }
}

export function disconnect() {
    if (socket) {
        socket.close();
        socket = null;
    }
    receivedChunks = {};
    totalChunksExpected = 0;
    chunksToSend = [];
}

export function getSyncProgress() {
    const current = Object.keys(receivedChunks).length;
    return {
        current,
        total: totalChunksExpected,
        percent: totalChunksExpected > 0 ? (current / totalChunksExpected) * 100 : 0,
    };
}
