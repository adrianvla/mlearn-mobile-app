/**
 * WebRTC Connection Module
 * Handles peer-to-peer connection via QR code signal exchange.
 * Processes incoming flashcard and wordFreq data from the desktop app.
 */

import { displayScreen } from '../screens/displayScreen.js';
import SimplePeer from '../../lib/simplepeer.min.js';
import { stopDetection } from './startConnectionByQR.js';
import { NumberOfChunks, stopTransmitByQRChunks, transmitByQRChunks } from './showQR.js';
import { setFlashcards, startSync } from './transmit.js';
import { overwriteWordFreq } from '../SRS/storage.js';
import $ from '../../lib/jquery.min.js';

let p = null;
let collectedChunks = {};

export const collectChunk = (chunk) => {
    try { chunk = JSON.parse(chunk); } catch (e) { return; }
    collectedChunks[chunk[0]] = chunk[1];
    $('.camera .progress-bar .easy').css('width', (Object.keys(collectedChunks).length / NumberOfChunks()) * 100 + '%');
    if (Object.keys(collectedChunks).length === NumberOfChunks()) {
        let data = '';
        for (let i = 0; i < NumberOfChunks(); i++) {
            data += collectedChunks[i];
        }
        connectUsingData(JSON.parse(data));
        collectedChunks = {};
    }
};

export const connectUsingData = (data) => {
    displayScreen('loading-webrtc');
    stopDetection();

    try {
        if (p) p.destroy();
        p = null;
    } catch (_) {}

    p = new SimplePeer({
        initiator: false,
        trickle: false,
    });

    p.on('error', err => console.log('error', err));

    p.on('signal', d => {
        displayScreen('qr');
        transmitByQRChunks(JSON.stringify(d));
    });

    p.signal(data);

    let queuedEvents = [];
    const chunks = {};

    function processChunk(c, name) {
        if (!(name in chunks)) chunks[name] = {};
        chunks[name][c[0]] = c[1];
        const total = c[2];
        if (Object.keys(chunks[name]).length < total) return;
        let assembled = '';
        for (let i = 0; i < total; i++) {
            if (!(i in chunks[name])) {
                console.error('Missing chunk', i);
                return;
            }
            assembled += chunks[name][i];
        }
        onTransmissionEnd(name, assembled);
        chunks[name] = {};
    }

    function onTransmissionEnd(name, data) {
        switch (name) {
            case 'sync':
                setFlashcards(JSON.parse(data));
                break;
            case 'wordFreq':
                overwriteWordFreq(JSON.parse(data));
                break;
        }
    }

    function processEvent(d) {
        d = JSON.parse(d);
        switch (d.type) {
            case 'ping':
                break;
            case 'sync-chunk':
                processChunk(d.data, 'sync');
                break;
            case 'wordFreq-chunk':
                processChunk(d.data, 'wordFreq');
                break;
        }
    }

    let isConnected = false;
    p.on('connect', () => {
        stopTransmitByQRChunks();
        startSync(p);
        queuedEvents.forEach(processEvent);
        queuedEvents = [];
        isConnected = true;
    });

    p.on('data', d => {
        if (!isConnected) queuedEvents.push(d);
        else processEvent(d);
    });
};
