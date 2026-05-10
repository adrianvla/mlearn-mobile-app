import $ from '../lib/jquery.min.js';
import { displayHomeScreen, updateSyncIndicator } from './screens/home.js';
import { storageReady, getFlashcards, overwriteFlashcards, getSettings, overwriteSettings } from './SRS/storage.js';
import { startSync } from './networking/syncService.js';

export const init = async () => {
    try {
        await storageReady;
    } catch (err) {
        console.warn('Storage not ready, continuing anyway', err);
    }

    startSync({
        onStatusChange: (status) => {
            updateSyncIndicator();
            const $settingsStatus = $('.screen[data-screen="settings"] .sync-status-text');
            if ($settingsStatus.length) {
                $settingsStatus.text(status);
            }
        },
        onSettingsReceived: (remoteSettings) => {
            overwriteSettings(remoteSettings);
        },
        onFlashcardsReceived: (mergedStore) => {
            overwriteFlashcards(mergedStore);
            const count = Object.keys(mergedStore.flashcards || {}).length;
            $('.cards-left').text(count);
        },
        getLocalSettings: () => getSettings(),
        getLocalFlashcards: () => getFlashcards(),
    });

    $('.loading').remove();
    displayHomeScreen();
    $('.close').on('click', displayHomeScreen);
};

const CSSifSafariFix = `
.mLearn-pitch-accent{
    position:absolute;
    bottom: 3.5em !important;
    left: 0;
    right: 0;
    top: 0;
    }
`;
function isSafari() {
    const ua = navigator.userAgent;
    const isSafari = /safari/i.test(ua);
    const isNotChrome = !/chrome|crios|crmo/i.test(ua);
    const isNotEdge = !/edg/i.test(ua);
    const isNotOpera = !/opr\//i.test(ua);
    return isSafari && isNotChrome && isNotEdge && isNotOpera;
}

function injectCSS(cssText) {
    const style = document.createElement('style');
    style.type = 'text/css';
    style.textContent = cssText;
    document.head.appendChild(style);
}
if (isSafari()) injectCSS(CSSifSafariFix);
