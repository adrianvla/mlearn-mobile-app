/**
 * Home Screen Module
 */

import $ from '../../lib/jquery.min.js';
import { displaySettingsScreen } from './settings.js';
import { displayScreen } from './displayScreen.js';
import { getFsLeft, review } from '../SRS/review.js';
import {
    connectWithUrl,
    triggerSync,
    getSyncStatus,
    getServerUrl,
    getSyncMode,
    setSyncMode,
} from '../networking/syncService.js';
import { connectAsReceiver } from '../networking/workerSync.js';
import jsQR from '../../lib/jsqr.min.js';

let isInit = false;

function updateSyncIndicator() {
    const status = getSyncStatus();
    const mode = getSyncMode();
    const serverUrl = getServerUrl();
    const $indicator = $('.sync-indicator');

    let text = 'Offline';
    let color = '#888';

    if (mode === 'tethered') {
        if (status === 'syncing') { text = 'Syncing...'; color = '#5e84ff'; }
        else if (status === 'synced') { text = serverUrl ? 'Synced' : 'Offline'; color = '#6d8867'; }
        else if (status === 'error') { text = 'Sync Error'; color = '#9f554c'; }
    } else if (mode === 'p2p') {
        text = 'P2P Connected';
        color = '#6d8867';
    }

    $indicator.text(text).css('color', color);
}

function startCameraForQR() {
    displayScreen('camera');
    $('.close').show();
    const video = document.getElementById('qr-video');
    if (!video) return;
    video.style.display = 'block';

    let stream = null;
    let stopVideo = false;
    let stopCameraFn = null;

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(s => {
            stream = s;
            video.srcObject = stream;
            video.setAttribute('playsinline', true);
            video.play();
            requestAnimationFrame(tick);
        })
        .catch(err => {
            alert('Camera access denied or not available.');
            displayScreen('home');
        });

    stopCameraFn = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        video.style.display = 'none';
        $(video).off();
    };

    $('.close').off('click.qr').on('click.qr', () => {
        stopCameraFn();
        stopVideo = true;
        displayScreen('home');
    });

    function drawQR(qr) {
        const canvas = document.getElementById('qr-box');
        if (!canvas) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        if (!qr) return;
        ctx.fillStyle = '#f00';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(qr.topLeftCorner.x, qr.topLeftCorner.y);
        ctx.lineTo(qr.topRightCorner.x, qr.topRightCorner.y);
        ctx.lineTo(qr.bottomRightCorner.x, qr.bottomRightCorner.y);
        ctx.lineTo(qr.bottomLeftCorner.x, qr.bottomLeftCorner.y);
        ctx.closePath();
        ctx.fill();
    }

    async function tick() {
        const box = document.getElementById('qr-box');
        if (box && video) {
            const rect = video.getBoundingClientRect();
            box.style.top = rect.top + 'px';
            box.style.left = rect.left + 'px';
            box.style.width = rect.width + 'px';
            box.style.height = rect.height + 'px';
        }

        if (stopVideo) {
            stopVideo = false;
            return;
        }

        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, canvas.width, canvas.height);
            drawQR(code?.location);

            if (code && code.data) {
                const scanned = code.data.trim();
                if (scanned && (scanned.startsWith('http://') || scanned.startsWith('https://'))) {
                    stopCameraFn();
                    stopVideo = true;
                    try {
                        await connectWithUrl(scanned);
                        updateSyncIndicator();
                        alert('Connected to ' + scanned);
                    } catch (e) {
                        alert('Connection failed: ' + e.message);
                    }
                    displayScreen('home');
                    return;
                } else if (scanned) {
                    stopCameraFn();
                    stopVideo = true;
                    setSyncMode('p2p');
                    updateSyncIndicator();
                    displayScreen('connecting');
                    connectAsReceiver(
                        scanned,
                        () => {
                            console.log('Sync completed');
                            updateSyncIndicator();
                        },
                        (err) => {
                            console.error('Sync error:', err);
                            alert('Sync failed: ' + err);
                            displayScreen('home');
                        }
                    );
                    return;
                }
            }
        }
        requestAnimationFrame(tick);
    }
}

function init() {
    $('.settings').on('click', displaySettingsScreen);
    $('.camera').on('click', startCameraForQR);
    $('button.review').on('click', review);
}

export const displayHomeScreen = () => {
    displayScreen('home');
    const count = getFsLeft();
    $('.cards-left').text(count);
    updateSyncIndicator();

    if (!isInit) {
        init();
        isInit = true;
    }
};

export { updateSyncIndicator };
