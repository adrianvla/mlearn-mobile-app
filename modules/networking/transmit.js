import {displayScreen} from "../screens/displayScreen.js";
import {getFlashcards, overwriteFlashcards} from "../SRS/storage.js";

export const setFlashcards = (fs)=>{
    overwriteFlashcards(fs);
    displayScreen("done");
    setTimeout(()=>{
        displayScreen("home");
    },2000);
}


function splitTextIntoChunks(text, n) {
    if (typeof text !== "string") {
        throw new TypeError("First argument must be a string");
    }
    if (typeof n !== "number" || n <= 0) {
        throw new RangeError("Chunk size must be a positive number");
    }

    let chunks = [];
    for (let i = 0; i < text.length; i += n) {
        chunks.push(text.slice(i, i + n));
    }
    return chunks;
}

function sendByChunks(peer, data) {
    let chunks = splitTextIntoChunks(data, 1000);
    chunks.forEach((chunk,i) => {
        peer.send(JSON.stringify({
            type: "sync-chunk",
            data: [i,chunk,chunks.length]
        }));
    });
}

export const startSync = (p)=>{
    displayScreen("connecting");
    sendByChunks(p, JSON.stringify(getFlashcards()));
};