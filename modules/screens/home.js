/**
 * Home Screen Module
 */

import $ from '../../lib/jquery.min.js';
import { displaySettingsScreen } from './settings.js';
import { displayScreen } from './displayScreen.js';
import { getFsLeft, review } from '../SRS/review.js';
import { connectAsReceiver } from '../networking/workerSync.js';
import {
    login,
    register,
    logout,
    getUserEmail,
    isAuthenticated,
} from '../networking/cloudAuth.js';
import jsQR from '../../lib/jsqr.min.js';

let isInit = false;

function updateAuthUI() {
    const $authStatus = $('.auth-status');
    const $loginBtn = $('.login-btn');

    if (isAuthenticated()) {
        $authStatus.text(getUserEmail() || 'Signed in');
        $loginBtn.text('Sign Out');
    } else {
        $authStatus.text('Not signed in');
        $loginBtn.text('Sign In');
    }
}

function showLoginScreen() {
    displayScreen('login');
}

function showHomeScreen() {
    displayScreen('home');
    updateAuthUI();
}

async function handleLoginSubmit() {
    const email = $('.login-email').val()?.trim();
    const password = $('.login-password').val();

    if (!email || !password) {
        alert('Please enter both email and password.');
        return;
    }

    try {
        await login(email, password);
        $('.login-email').val('');
        $('.login-password').val('');
        showHomeScreen();
    } catch (e) {
        alert('Sign in failed: ' + e.message);
    }
}

async function handleRegisterSubmit() {
    const email = $('.login-email').val()?.trim();
    const password = $('.login-password').val();

    if (!email || !password) {
        alert('Please enter both email and password.');
        return;
    }

    if (password.length < 8) {
        alert('Password must be at least 8 characters long.');
        return;
    }

    try {
        await register(email, password);
        alert('Account created. Please sign in.');
    } catch (e) {
        alert('Registration failed: ' + e.message);
    }
}

function handleLoginCancel() {
    $('.login-email').val('');
    $('.login-password').val('');
    showHomeScreen();
}

function handleAuthButtonClick() {
    if (isAuthenticated()) {
        logout();
        updateAuthUI();
    } else {
        showLoginScreen();
    }
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
                if (scanned) {
                    stopCameraFn();
                    stopVideo = true;
                    displayScreen('connecting');
                    connectAsReceiver(
                        scanned,
                        () => {
                            console.log('Sync completed');
                        },
                        (err) => {
                            console.error('Sync error:', err);
                            if (err && err.includes && err.includes('Authentication required')) {
                                alert('Please sign in to sync flashcards.');
                                showLoginScreen();
                            } else {
                                alert('Sync failed: ' + err);
                                displayScreen('home');
                            }
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
    $('.login-btn').on('click', handleAuthButtonClick);
    $('.login-submit').on('click', handleLoginSubmit);
    $('.login-register').on('click', handleRegisterSubmit);
    $('.login-cancel').on('click', handleLoginCancel);
}

export const displayHomeScreen = () => {
    displayScreen('home');
    const count = getFsLeft();
    $('.cards-left').text(count);
    updateAuthUI();

    if (!isInit) {
        init();
        isInit = true;
    }
};
