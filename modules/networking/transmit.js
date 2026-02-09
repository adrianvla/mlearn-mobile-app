/**
 * Sync Transmission Module
 * Handles sending and receiving flashcard data over WebRTC.
 * Sends/receives data in mlearn-ts FlashcardStore v3 format.
 */

import { displayScreen } from '../screens/displayScreen.js';
import { getFlashcards, overwriteFlashcards } from '../SRS/storage.js';

/**
 * Max buffered amount (bytes) before waiting for the data channel to drain.
 */
const MAX_BUFFERED_AMOUNT = 64 * 1024;

/**
 * Receive flashcard store from desktop and overwrite local data.
 */
export const setFlashcards = (fs) => {
    overwriteFlashcards(fs);
    displayScreen('done');
    setTimeout(() => {
        displayScreen('home');
    }, 2000);
};

/**
 * Split text into chunks for WebRTC transmission.
 */
function splitTextIntoChunks(text, n) {
    if (typeof text !== 'string') {
        throw new TypeError('First argument must be a string');
    }
    if (typeof n !== 'number' || n <= 0) {
        throw new RangeError('Chunk size must be a positive number');
    }
    const chunks = [];
    for (let i = 0; i < text.length; i += n) {
        chunks.push(text.slice(i, i + n));
    }
    return chunks;
}

/**
 * Wait until the data channel's buffered amount drops below the threshold.
 */
function waitForBufferDrain(channel) {
    return new Promise((resolve) => {
        const check = () => {
            if (channel.bufferedAmount <= MAX_BUFFERED_AMOUNT) {
                resolve();
            } else {
                setTimeout(check, 5);
            }
        };
        setTimeout(check, 5);
    });
}

/**
 * Send data over WebRTC in 16KB chunks with backpressure handling.
 * Waits for the send buffer to drain when it gets too full, preventing
 * "RTCDataChannel send queue is full" errors.
 */
async function sendByChunks(peer, data) {
    const chunks = splitTextIntoChunks(data, 16000);
    const channel = peer._channel;

    for (let i = 0; i < chunks.length; i++) {
        if (channel && channel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
            await waitForBufferDrain(channel);
        }

        peer.send(JSON.stringify({
            type: 'sync-chunk',
            data: [i, chunks[i], chunks.length],
        }));
    }
}

/**
 * Begin sync: send local FlashcardStore to peer.
 */
export const startSync = (p) => {
    displayScreen('connecting');
    sendByChunks(p, JSON.stringify(getFlashcards()));
};
