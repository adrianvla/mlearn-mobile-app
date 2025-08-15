export function getFlashcards() {
    //localstorage
    let flashcards = localStorage.getItem("flashcards");
    if(flashcards) flashcards = JSON.parse(flashcards);
    else flashcards = [];
    return flashcards;
}
export function getWordFreq() {
    //localstorage
    let wf = localStorage.getItem("wordFreq");
    if(wf) return JSON.parse(wf);
    else return {};
}


export function overwriteFlashcards(flashcards){
    localStorage.setItem("flashcards", JSON.stringify(flashcards));
}

export function overwriteWordFreq(wf){
    localStorage.setItem("wordFreq", JSON.stringify(wf));
}