import { displayScreen } from '../screens/displayScreen.js';
import { overwriteFlashcards, getFlashcards } from '../SRS/storage.js';

const WORKER_API_URL = 'https://mlearn-cloud.kikan.net';
const CHUNK_SIZE = 16000;

let socket = null;
let receivedChunks = {};
let totalChunksExpected = 0;
let onCompleteCallback = null;
let onErrorCallback = null;

function buildSyncSocketUrl(roomId, role) {
    return `wss://${new URL(WORKER_API_URL).host}/api/flashcard-sync/rooms/${roomId}/socket?_role=${role}`;
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

export async function createSyncRoom() {
    const response = await fetch(`${WORKER_API_URL}/api/flashcard-sync/rooms`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to create sync room: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

export function connectAsReceiver(roomId, onComplete, onError) {
    onCompleteCallback = onComplete;
    onErrorCallback = onError;
    receivedChunks = {};
    totalChunksExpected = 0;

    const url = buildSyncSocketUrl(roomId, 'receiver');
    socket = new WebSocket(url, 'mlearn-flashcard-sync-v1');

    socket.onopen = () => {
        console.log('[WorkerSync] Connected as receiver');
    };

    socket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleReceiverMessage(msg);
        } catch (e) {
            console.error('[WorkerSync] Invalid message:', e);
        }
    };

    socket.onclose = () => {
        console.log('[WorkerSync] Disconnected');
    };

    socket.onerror = (err) => {
        console.error('[WorkerSync] WebSocket error:', err);
        if (onErrorCallback) {
            onErrorCallback('WebSocket connection failed');
        }
    };
}

export function connectAsSender(roomId, onComplete, onError) {
    onCompleteCallback = onComplete;
    onErrorCallback = onError;
    receivedChunks = {};
    totalChunksExpected = 0;

    const url = buildSyncSocketUrl(roomId, 'sender');
    socket = new WebSocket(url, 'mlearn-flashcard-sync-v1');

    socket.onopen = () => {
        console.log('[WorkerSync] Connected as sender');
    };

    socket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleSenderMessage(msg);
        } catch (e) {
            console.error('[WorkerSync] Invalid message:', e);
        }
    };

    socket.onclose = () => {
        console.log('[WorkerSync] Disconnected');
    };

    socket.onerror = (err) => {
        console.error('[WorkerSync] WebSocket error:', err);
        if (onErrorCallback) {
            onErrorCallback('WebSocket connection failed');
        }
    };
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
    const storeData = JSON.stringify(getFlashcards());
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
