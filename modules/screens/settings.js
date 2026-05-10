import $ from '../../lib/jquery.min.js';
import { displayScreen } from './displayScreen.js';
import { updateSyncIndicator } from './home.js';
import {
    connectWithUrl,
    disconnect,
    triggerSync,
    getSyncStatus,
    getServerUrl,
    getSyncMode,
    isConnected,
} from '../networking/syncService.js';
import {
    getSettings,
    overwriteSettings,
    updateServerUrl,
} from '../SRS/storage.js';

export const displaySettingsScreen = () => {
    displayScreen('settings');
    renderSettingsUI();
};

function renderSettingsUI() {
    const $screen = $('.screen[data-screen="settings"]');
    const settings = getSettings();
    const serverUrl = settings.serverUrl || '';
    const connected = isConnected();
    const status = getSyncStatus();
    const mode = getSyncMode();

    let modeText = 'None';
    let modeStatus = 'Offline';
    if (mode === 'tethered') {
        modeText = 'Tethered';
        modeStatus = status;
    } else if (mode === 'p2p') {
        modeText = 'P2P';
        modeStatus = 'Connected';
    }

    $screen.html(`
        <h1>Settings</h1>
        <div class="settings-group">
            <label>Active Mode</label>
            <div class="sync-status">${modeText} — <span class="sync-status-text">${modeStatus}</span></div>
        </div>
        <div class="settings-group">
            <label>Tethered Mode</label>
            <input type="text" class="server-url-input" placeholder="http://192.168.1.x:7753" value="${escapeHtml(serverUrl)}">
            <div class="settings-buttons">
                <button class="btn-connect">${connected ? 'Reconnect' : 'Connect'}</button>
                ${mode === 'tethered' ? '<button class="btn-disconnect">Disconnect</button>' : ''}
                <button class="btn-sync-now">Sync Now</button>
            </div>
        </div>
        <div class="settings-group">
            <label>P2P Mode</label>
            <p>Tap the camera button and scan the QR codes shown on your computer.</p>
        </div>
    `);

    $screen.find('.server-url-input').off('change').on('change', (e) => {
        updateServerUrl(e.target.value.trim());
    });

    $screen.find('.btn-connect').off('click').on('click', async () => {
        const url = $screen.find('.server-url-input').val().trim();
        if (!url) {
            alert('Please enter a server URL');
            return;
        }
        try {
            await connectWithUrl(url);
            updateServerUrl(url);
            updateSyncIndicator();
            renderSettingsUI();
            alert('Connected successfully');
        } catch (e) {
            alert('Connection failed: ' + e.message);
        }
    });

    $screen.find('.btn-disconnect').off('click').on('click', () => {
        if (mode !== 'tethered') return;
        disconnect();
        updateServerUrl('');
        updateSyncIndicator();
        renderSettingsUI();
    });

    $screen.find('.btn-sync-now').off('click').on('click', async () => {
        if (!isConnected()) {
            alert('Not connected to a server');
            return;
        }
        try {
            await triggerSync();
            updateSyncIndicator();
            renderSettingsUI();
        } catch (e) {
            alert('Sync failed: ' + e.message);
        }
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
