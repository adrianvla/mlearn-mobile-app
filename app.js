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
    window.scrollTo(0, 0);
    init();
});