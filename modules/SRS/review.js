import {getFlashcards, overwriteFlashcards} from "./storage.js";
import {displayFlashcard, revealAnswer} from "./display.js";
import $ from '../../lib/jquery.min.js';
import {displayHomeScreen} from "../screens/home.js";
import {displayScreen} from "../screens/displayScreen.js";

function sortByDueDate(fs) {
    if(fs?.flashcards == undefined) {
        displayScreen("home");
        // alert("No flashcards exist. Please add some first.");
        return;
    }
    fs.flashcards.sort((a, b) => a.dueDate - b.dueDate);
    overwriteFlashcards(fs);
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
export function getFsLeft(){
    let flashcardsToGoThrough = 0;
    let fs = sortByDueDate(getFlashcards());
    if(fs?.flashcards == undefined) {
        displayScreen("home");
        // alert("No flashcards exist. Please add some first.");
        return "-";
    }
    for(;flashcardsToGoThrough < fs.flashcards.length;flashcardsToGoThrough++) {
        if (fs.flashcards[flashcardsToGoThrough].dueDate > Date.now()) break;
    }
    return flashcardsToGoThrough;
}

export const review = () => {
    displayScreen("flashcards");
    let fs = sortByDueDate(getFlashcards());
    if(fs?.flashcards == undefined) {
        displayScreen("home");
        // alert("No flashcards exist. Please add some first.");
        return;
    }

    let flashcardsToGoThrough = 0;
    function getFlashcardsLeft(){
        for(flashcardsToGoThrough = 0;flashcardsToGoThrough < fs.flashcards.length;flashcardsToGoThrough++) {
            if (fs.flashcards[flashcardsToGoThrough].dueDate > Date.now()) break;
        }
    }
    getFlashcardsLeft();

    function displayLast(){
        fs = sortByDueDate(fs);
        $(".btn.again,.btn.hard,.btn.medium,.btn.easy").hide();
        $(".btn.show-answer").show();
        if(fs.flashcards.length === 0) { //TODO: change this
            displayHomeScreen();
            alert("No flashcards to review");
            return;
        }
        getFlashcardsLeft();
        $(".p .to-review").text(flashcardsToGoThrough);
        if(fs.flashcards[0].dueDate <= Date.now()){
            displayFlashcard(fs.flashcards[0]);
            $(".btn.again").attr("data-content",`${dateToInString(getAnticipatedDueDate(fs.flashcards[0], 0).dueDate)}`);
            $(".btn.hard").attr("data-content",`${dateToInString(getAnticipatedDueDate(fs.flashcards[0], 1).dueDate)}`);
            $(".btn.medium").attr("data-content",`${dateToInString(getAnticipatedDueDate(fs.flashcards[0], 3).dueDate)}`);
            $(".btn.easy").attr("data-content",`${dateToInString(getAnticipatedDueDate(fs.flashcards[0], 5).dueDate)}`);
        }else{
            displayHomeScreen();
            alert("All flashcards have been reviewed");
        }
    }
    displayLast();
    function updateFlashcard(q){
        fs.flashcards[0] = updateDueDate(fs.flashcards[0], q);
        displayLast();
    }
    function removeFlashcard(){
        if(fs.flashcards.length === 0) return;
        fs.flashcards.shift();
        displayLast();
    }
    $(document).on('keydown', (e) => {
        console.log(e.key);
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
    $(".btn.show-answer").on('click',()=>{
        $(".btn.again,.btn.hard,.btn.medium,.btn.easy").show();
        $(".btn.show-answer").hide();
        revealAnswer(fs.flashcards[0]);
    });
    $(".btn.bin").on('click',()=>removeFlashcard());
    $(".btn.close").on('click',displayHomeScreen);
    let isInEditMode = false;
    $(".editMode").hide();
    $(".btn.edit").on('click',()=>{
        if(isInEditMode){
            $(".editMode").hide();
            $(".can-be-edited").attr("contenteditable", "false");
            fs.flashcards[0].content.translation = $(".answer").text();
            fs.flashcards[0].content.example = $(".sentence").html();
            fs.flashcards[0].content.exampleMeaning = $(".example .translation p").html();
            fs.flashcards[0].content.definition = $(".definition").html();
            fs.flashcards[0].lastUpdated = Date.now();
            fs = sortByDueDate(fs);
        }else{
            $(".can-be-edited").attr("contenteditable", "true");
            $(".editMode").text("Edit Mode").show();
        }
        isInEditMode = !isInEditMode;
    });

};