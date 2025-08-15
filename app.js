import $ from './lib/jquery.min.js';
import {init} from "./modules/init.js";


if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('Service worker registered:' + reg);

        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data.type === 'debug') {
                console.log('[SW DEBUG]', event.data.message);
            }
        });
    });
}

$(document).ready(function () {
    // Reset Cache button logic
    window.scrollTo(0, 0);
    document.querySelector('.reset-cache').addEventListener('click', async () => {

        // Unregister all service workers
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) {
                await reg.unregister();
            }
        }

        // Delete all caches
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            for (const name of cacheNames) {
                await caches.delete(name);
            }
        }

        window.location.reload();
    });
    init();
});