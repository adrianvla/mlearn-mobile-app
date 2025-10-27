import {Flashcards, overwriteFlashcards, saveFlashcards} from "./storage.js";
import {addPitchAccent, displayFlashcard, revealAnswer} from "./display.js";
import $ from '../../lib/jquery.min.js';
import {displayHomeScreen} from "../screens/home.js";
import {displayScreen} from "../screens/displayScreen.js";
async function toUniqueIdentifier(nonLatinString) {
    // Encode the string into Base64 (handles Unicode safely)
    const utf8Bytes = new TextEncoder().encode(nonLatinString);
    const base64String = btoa(String.fromCharCode(...utf8Bytes));

    // Hash the Base64 string using SHA-256
    const hashBuffer = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(base64String)
    );

    // Convert the hash to a hexadecimal string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, "0")).join("");

    return hashHex;
}
function sortByDueDate(fs) {
    if(!fs || !Array.isArray(fs.flashcards)) return fs;
    fs.flashcards.sort((a, b) => a.dueDate - b.dueDate);
    saveFlashcards();
    return fs;
}

function getAnticipatedDueDate(_fc, q) {
    // SM-2
    const fc = JSON.parse(JSON.stringify(_fc));

    // Time constants
    const minute = 60 * 1000;
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Normalize ease factor (EF) — default to a sane SM-2 starting value
    const currentEF = typeof fc.ease === 'number' && fc.ease > 0 ? fc.ease : 2.5;
    // SM-2 EF update formula based on quality (q in 0..5), clamped to 1.3 minimum
    let newEF = currentEF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    newEF = Math.max(1.3, newEF);

    // Previous scheduled interval (not elapsed) — avoids minute-scale drift
    const lastReviewed = typeof fc.lastReviewed === 'number' ? fc.lastReviewed : now;
    const dueDate = typeof fc.dueDate === 'number' ? fc.dueDate : lastReviewed;
    const prevInterval = Math.max(0, dueDate - lastReviewed);

    let interval;

    if (q === 0){
        interval = 0;
    }else if (q < 3) {
        // Failed/hard: short retry step (learning)
        interval = 10 * minute;
        // Keep reviews count as-is on a fail (common behavior)
    } else {
        // Passed: handle first and second reviews with fixed steps, then scale
        const reviews = typeof fc.reviews === 'number' ? fc.reviews : 0;

        if (reviews === 0) {
            // First successful review: 1 day for good, 4 days for easy
            interval = q >= 5 ? 4 * day : 1 * day;
        } else if (reviews === 1) {
            // Second successful review: 6 days for good, 10 days for easy
            interval = q >= 5 ? 10 * day : 6 * day;
        } else {
            // Subsequent reviews: multiply previous scheduled interval by EF
            const base = prevInterval > 0 ? prevInterval : 1 * day;
            interval = Math.round(base * newEF);
        }
    }

    // Update fields for the returned copy
    fc.ease = newEF;
    fc.lastReviewed = now;
    fc.dueDate = now + interval;
    fc.lastUpdated = now;
    if (q >= 3) {
        fc.reviews = (typeof fc.reviews === 'number' ? fc.reviews : 0) + 1;
    }
    return fc;
}

function updateDueDate(fc, q) {
    fc = getAnticipatedDueDate(fc,q);
    return fc;
}

function dateToInString(date){
    const now = Date.now();
    let diff = date - now;
    if (diff < 0) diff = 0;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const year = 365.25 * day;
    if (diff < minute) return '< 1m';
    if (diff < hour) return `${Math.round(diff / minute)}m`;
    if (diff < day) return `${Math.round(diff / hour)}h`;
    if (diff < year) return `${Math.round(diff / day)} days`;
    return `${(diff / year).toFixed(1)} years`;
}
function getPostponeDate(){
    return Date.now() + 24 * 60 * 60 * 100 * (50 + Math.random()*100);
}

const MAX_UNDO_STACK_SIZE = 50;
const cloneFlashcardState = (state) => {
    if (typeof structuredClone === "function") {
        try {
            return structuredClone(state);
        } catch (_err) {
            // Fallback to JSON clone when structuredClone is unavailable or fails
        }
    }
    return JSON.parse(JSON.stringify(state));
};
export function getFsLeft(){
    const fs = sortByDueDate(Flashcards());
    if(!fs || !Array.isArray(fs.flashcards)) {
        displayScreen("home");
        return "-";
    }
    let flashcardsToGoThrough = 0;
    for(;flashcardsToGoThrough < fs.flashcards.length;flashcardsToGoThrough++) {
        if (fs.flashcards[flashcardsToGoThrough].dueDate > Date.now()) break;
    }
    return flashcardsToGoThrough;
}

export const review = () => {
    displayScreen("flashcards");
    let fs = sortByDueDate(Flashcards());
    if(!fs || !Array.isArray(fs.flashcards)) {
        displayScreen("home");
        return;
    }

    let mutationEpoch = 0;
    const undoStack = [];
    const pushUndoState = (options = {}) => {
        if (!fs) return;
        mutationEpoch++;
        const snapshot = cloneFlashcardState(fs);
        undoStack.push({state: snapshot, ...options});
        if (undoStack.length > MAX_UNDO_STACK_SIZE) undoStack.shift();
    };

    const undoLastAction = () => {
        if (undoStack.length === 0) return;
        mutationEpoch++;
        const entry = undoStack.pop();
        overwriteFlashcards(entry.state);
        fs = Flashcards();
        displayLast();
    };

    let flashcardsToGoThrough = 0;
    const getFlashcardsLeft = () => {
        for(flashcardsToGoThrough = 0;flashcardsToGoThrough < fs.flashcards.length;flashcardsToGoThrough++) {
            if (fs.flashcards[flashcardsToGoThrough].dueDate > Date.now()) break;
        }
    };
    getFlashcardsLeft();

    const postponeFlashcard = () => {
        if(!Array.isArray(fs.flashcards) || fs.flashcards.length === 0) return;
        pushUndoState({type: "postpone"});
        fs.flashcards[0].dueDate = getPostponeDate();
        displayLast();
    };

    function displayLast(){
        fs = sortByDueDate(fs);
        const hasFlashcards = Array.isArray(fs.flashcards) && fs.flashcards.length > 0;
        $(".btn.again,.btn.hard,.btn.medium,.btn.easy,.btn.already-known,.btn.postpone").hide();
        $(".btn.show-answer").show();
        if(!hasFlashcards) {
            displayHomeScreen();
            alert("No flashcards to review");
            return;
        }
        getFlashcardsLeft();
        $(".p .to-review").text(flashcardsToGoThrough);
        const active = fs.flashcards[0];
        if(active.dueDate <= Date.now()){
            displayFlashcard(active);
            $(".btn.again").attr("data-content",`${dateToInString(getAnticipatedDueDate(active, 0).dueDate)}`);
            $(".btn.hard").attr("data-content",`${dateToInString(getAnticipatedDueDate(active, 1).dueDate)}`);
            $(".btn.medium").attr("data-content",`${dateToInString(getAnticipatedDueDate(active, 3).dueDate)}`);
            $(".btn.easy").attr("data-content",`${dateToInString(getAnticipatedDueDate(active, 5).dueDate)}`);
            $(".btn.postpone").attr("data-content",`${dateToInString(getPostponeDate())}`);
            $(".btn.already-known").attr("data-content",`∞`);
        }else{
            displayHomeScreen();
            alert("All flashcards have been reviewed");
        }
    }
    displayLast();

    const updateFlashcard = (q) => {
        if(!Array.isArray(fs.flashcards) || fs.flashcards.length === 0) return;
        pushUndoState({type: "review", quality: q});
        fs.flashcards[0] = updateDueDate(fs.flashcards[0], q);
        displayLast();
    };

    const removeFlashcard = async (neverShowAgain = true) => {
        if(!Array.isArray(fs.flashcards) || fs.flashcards.length === 0) return false;
        const activeCard = fs.flashcards[0];
        const word = activeCard?.content?.word;
        if(!word) return false;
        const epochAtStart = mutationEpoch;
        let uuid;
        try{
            uuid = await toUniqueIdentifier(word);
        }catch(err){
            console.error(err);
            return false;
        }
        if(epochAtStart !== mutationEpoch) return false;
        pushUndoState({type: "remove", neverShowAgain});
        if(fs.alreadyCreated && uuid in fs.alreadyCreated){
            delete fs.alreadyCreated[uuid];
        }
        if(neverShowAgain){
            fs.knownUnTracked[uuid] = true;
        }else if(fs.knownUnTracked && uuid in fs.knownUnTracked){
            delete fs.knownUnTracked[uuid];
        }
        fs.flashcards.shift();
        displayLast();
        return true;
    };

    let isInEditMode = false;
    let isInCreateMode = false;

    const $addFlashcardBtn = $(".btn.add-flashcard");
    const addFlashcardDefaultIcon = $addFlashcardBtn.html();
    const addFlashcardSaveIcon = `<svg width="800px" height="800px" viewBox="0 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" sketch:type="MSPage"><g id="Icon-Set" sketch:type="MSLayerGroup" transform="translate(-152.000000, -515.000000)" fill="currentColor"><path d="M171,525 C171.552,525 172,524.553 172,524 L172,520 C172,519.447 171.552,519 171,519 C170.448,519 170,519.447 170,520 L170,524 C170,524.553 170.448,525 171,525 L171,525 Z M182,543 C182,544.104 181.104,545 180,545 L156,545 C154.896,545 154,544.104 154,543 L154,519 C154,517.896 154.896,517 156,517 L158,517 L158,527 C158,528.104 158.896,529 160,529 L176,529 C177.104,529 178,528.104 178,527 L178,517 L180,517 C181.104,517 182,517.896 182,519 L182,543 L182,543 Z M160,517 L176,517 L176,526 C176,526.553 175.552,527 175,527 L161,527 C160.448,527 160,526.553 160,526 L160,517 L160,517 Z M180,515 L156,515 C153.791,515 152,516.791 152,519 L152,543 C152,545.209 153.791,547 156,547 L180,547 C182.209,547 184,545.209 184,543 L184,519 C184,516.791 182.209,515 180,515 L180,515 Z" id="save-floppy" sketch:type="MSShapeGroup"></path></g></g></svg>`;

    const createTemporaryFlashcard = () => {
        const now = Date.now();
        return {
            content: {
                word: "word",
                pitchAccent: undefined,
                pronunciation: "pronunciation",
                translation: "translation",
                definition: "definition",
                example: "example",
                exampleMeaning: "example meaning",
                screenshotUrl: "-",
                pos: "",
                level: -1
            },
            dueDate: now,
            lastReviewed: now,
            lastUpdated: now,
            ease: 0,
            reviews: 0
        };
    };

    const enterCreateMode = () => {
        $(".btn.edit,.buttons").hide();
        $(".editMode").text("Add Flashcard").show();
        $(".can-be-edited").attr("contenteditable", "true");
        const template = createTemporaryFlashcard();
        displayFlashcard(template);
        revealAnswer(template);
        $(".answer,.pronunciation").show();
        $(".pronunciation span").text(template.content.pronunciation);
        $(".example .translation p").html(template.content.exampleMeaning);
        $(".card-item:has(.definition)").show();
        $(".pill").text("Level ID").attr("level", "-1").show();
        $(".card-item:has(.img-src),.pitch").show();
        $(".img-src").text(template.content.screenshotUrl);
        $(".pitch span").text("-1");
        $addFlashcardBtn.html(addFlashcardSaveIcon);
        isInCreateMode = true;
    };

    const exitCreateMode = () => {
        $(".btn.edit,.buttons,.card-item:has(.example)").show();
        $(".editMode,.pronunciation").hide();
        $(".can-be-edited").attr("contenteditable", "false");
        $(".card-item:has(.img-src),.pitch").hide();

        const now = Date.now();
        const pitchAccentRaw = parseInt($(".pitch span").text(), 10);
        const levelRaw = parseInt($(".pill").attr("level"), 10);
        const newFlashcard = {
            content: {
                word: $(".word").text(),
                pitchAccent: Number.isFinite(pitchAccentRaw) ? pitchAccentRaw : 0,
                pronunciation: $(".pronunciation span").text(),
                translation: $(".translation").text(),
                definition: $(".definition").html(),
                example: $(".sentence").html(),
                exampleMeaning: $(".example .translation p").html(),
                screenshotUrl: $(".img-src").text(),
                pos: $(".pill").text(),
                level: Number.isFinite(levelRaw) ? levelRaw : -1
            },
            dueDate: now,
            lastReviewed: now,
            lastUpdated: now,
            ease: 0,
            reviews: 0
        };

        pushUndoState({type: "create"});
        fs.flashcards.unshift(newFlashcard);
        fs = sortByDueDate(fs);
        displayLast();
        $addFlashcardBtn.html(addFlashcardDefaultIcon);
        isInCreateMode = false;
    };

    const $document = $(document);
    $document.off('keydown.review');
    $document.on('keydown.review', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && typeof e.key === "string" && e.key.toLowerCase() === "z") {
            if(!isInEditMode && !isInCreateMode){
                e.preventDefault();
                undoLastAction();
            }
            return;
        }
        if(isInEditMode || isInCreateMode) return;
        switch(e.key){
            case "1":
                $(".btn.again").click();
                break;
            case "2":
                $(".btn.hard").click();
                break;
            case "3":
                $(".btn.medium").click();
                break;
            case "4":
                $(".btn.easy").click();
                break;
            case "p":
                $(".btn.postone").click();
                break;
            case "-":
                $(".btn.already-known").click();
                break;
            case "x":
                $(".btn.bin").click();
                break;
            case " ":
                $(".btn.show-answer").click();
                break;
        }
    });

    $(".btn.again").on('click',()=>{
        updateFlashcard(0);
    });
    $(".btn.hard").on('click',()=>{
        updateFlashcard(1);
    });
    $(".btn.medium").on('click',()=>{
        updateFlashcard(3);
    });
    $(".btn.easy").on('click',()=>{
        updateFlashcard(5);
    });
    $(".btn.postone").on('click',postponeFlashcard);
    $(".btn.already-known").on('click',async ()=>{
        const word = fs.flashcards[0]?.content?.word;
        const removed = await removeFlashcard(true);
        if(!removed || !word) return;
        try{
            changeKnownStatus(word, WORD_STATUS_KNOWN);
        }catch(e){console.error(e);}
    });
    $(".btn.show-answer").on('click',()=>{
        $(".btn.again,.btn.hard,.btn.medium,.btn.easy,.btn.already-known,.btn.postpone").show();
        $(".btn.show-answer").hide();
        revealAnswer(fs.flashcards[0]);
    });
    $(".btn.bin").on('click',()=>{
        removeFlashcard(false);
    });
    $(".btn.close").on('click',displayHomeScreen);

    $(".editMode").hide();
    $(".btn.edit").on('click',()=>{
        const $pitchSpan = $(".pitch span");
        const $pill = $(".pill");
        const $pronunciationSpan = $(".pronunciation span");
        const $pronunciationPreview = $(".pronunciation-preview");
        if(isInEditMode){
            $pitchSpan.off('input.review-edit');
            $pronunciationSpan.off('input.review-edit');
            if(fs.flashcards.length > 0) pushUndoState({type: "edit"});
            $(".editMode,.pill,.pitch,.pronunciation,.pronunciation-preview").hide();
            $(".can-be-edited").attr("contenteditable", "false");
            if(fs.flashcards.length > 0){
                const active = fs.flashcards[0];
                active.content.translation = $(".answer").text();
                active.content.example = $(".sentence").html();
                active.content.exampleMeaning = $(".example .translation p").html();
                active.content.definition = $(".definition").html();
                active.content.word = $(".question").text();
                const pitchVal = parseInt($pitchSpan.text(), 10);
                active.content.pitchAccent = Number.isFinite(pitchVal) ? pitchVal : 0;
                active.content.pronunciation = $pronunciationSpan.text();
                const levelVal = parseInt($pill.attr("level"), 10);
                active.content.level = Number.isFinite(levelVal) ? levelVal : active.content.level || -1;
                active.lastUpdated = Date.now();
                fs = sortByDueDate(fs);
                displayFlashcard(fs.flashcards[0]);
            }
            $(".buttons,.btn.add-flashcard,.card-item:has(.example)").show();
            $(".btn.edit").html(`<svg width="800px" height="800px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g id="Complete"><g id="edit"><g><path d="M20,16v4a2,2,0,0,1-2,2H4a2,2,0,0,1-2-2V6A2,2,0,0,1,4,4H8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><polygon fill="none" points="12.5 15.8 22 6.2 17.8 2 8.3 11.5 8 16 12.5 15.8" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></g></g></g></svg>`);
        }else{
            if(fs.flashcards.length === 0) return;
            displayFlashcard(fs.flashcards[0]);
            revealAnswer(fs.flashcards[0]);
            $(".can-be-edited").attr("contenteditable", "true");
            $(".pitch, .pronunciation, .pronunciation-preview, .pill").show();
            $(".question").text(fs.flashcards[0].content.word);
            const pitchValue = fs.flashcards[0].content.pitchAccent ?? 0;
            $pitchSpan.text(pitchValue);
            $pronunciationSpan.text(fs.flashcards[0].content.pronunciation || "");
            const updatePreview = () => {
                const reading = $pronunciationSpan.text();
                let pitch = parseInt($pitchSpan.text(), 10);
                if(!Number.isFinite(pitch) || pitch < 0) pitch = 0;
                $pitchSpan.text(String(pitch));
                if($pronunciationPreview.length){
                    try{
                        const preview = addPitchAccent(pitch, reading, reading, null).html();
                        $pronunciationPreview.html(preview || "");
                    }catch(err){
                        console.error(err);
                    }
                }
            };
            $pitchSpan.on('input.review-edit', updatePreview);
            $pronunciationSpan.on('input.review-edit', updatePreview);
            updatePreview();
            if(fs.flashcards[0].content.level < 0){
                $pill.text('LEVEL UNSET').attr("level", "-1");
            }else{
                $pill.attr("level", String(fs.flashcards[0].content.level));
            }
            $(".editMode").text("Edit Mode").show();
            $(".buttons,.btn.add-flashcard").hide();
            $(".btn.edit").html(addFlashcardSaveIcon);
        }
        isInEditMode = !isInEditMode;
    });

    $(".btn.save").hide();
    $addFlashcardBtn.on('click', () => {
        if (isInCreateMode) {
            exitCreateMode();
        } else {
            enterCreateMode();
        }
    });
};