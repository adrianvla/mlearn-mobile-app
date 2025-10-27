import $ from '../../lib/jquery.min.js';
import {getWordFreq} from "./storage.js";
import {buildPitchAccentHtml, getPitchAccentInfo} from "../common/pitchAccent.js";

function isNotAllKana(word) {
    // Regular expression to match any character that is not Hiragana or Katakana
    const nonKanaRegex = /[^\u3040-\u30FF]/;
    return nonKanaRegex.test(word);
}

export const addPitchAccent = (accentType, reading, realWord, pos) => {
    const safeReading = typeof reading === "string" ? reading : String(reading ?? "");
    const safeRealWord = typeof realWord === "string" ? realWord : String(realWord ?? "");
    const buildBasicRuby = () => {
        if(isNotAllKana(safeRealWord)){
            return $(`<ruby>${safeRealWord}<rt>${safeReading}</rt></ruby>`);
        }
        return $(`<span>${safeRealWord}</span>`);
    };

    const accentInfo = getPitchAccentInfo(accentType, safeReading);
    if(!accentInfo){
        return buildBasicRuby();
    }

    const htmlString = buildPitchAccentHtml(accentInfo, safeRealWord.length, {
        includeParticleBox: !(pos === "動詞"),
    });
    const pitchAccentContainer = $('<div class="mLearn-pitch-accent"></div>').html(htmlString);
    const accentMarkup = pitchAccentContainer[0]?.outerHTML ?? "";

    if(isNotAllKana(safeRealWord)){
        return $(`<ruby>${safeRealWord}<rt style="--pitch-accent-height: 2px">${safeReading}${accentMarkup}</rt></ruby>`);
    }
    return $(`<span style="--pitch-accent-height: 5px">${safeRealWord}${accentMarkup}</span>`);
};
export function displayFlashcard(card){
    /* Flashcards look like this:
        {
            "content":{
                "word":"感じ",
                "pitchAccent":0,
                "pronunciation":"かんじ",
                "translation":"Feeling, sense, impression",
                "definition":"HTML BEGIN CONTENT",
                "example":"こういう感じだった",
                "exampleMeaning":"MEANING",
                "screenshotUrl":"no",
                "pos": "名詞",
                "level": -1
            },
            "dueDate":1755100026393,
            "lastReviewed":1755100026393,
            "lastUpdated":1755100026393,
            "ease":0,
            "reviews":0
        }
    * */
    const wordFreq = getWordFreq();
    console.log("Displaying flashcard", card);
    $(".answer").hide().html(card.content.translation);
    $(".question").html(card.content.word);
    $(".sentence").html(card.content.example);
    $(".definition").html(card.content.definition);
    $(".card-item:has(.definition)").hide();
    $(".example .translation p").html("");
    $(".card-item img").attr("src", card.content.screenshotUrl);
    $(".card-c").css("padding-top", "10px").css("padding-bottom", "10px");
    if(["","-"," "].includes(card.content.example)) $(".card-item:has(.example)").hide();
    else $(".card-item:has(.example)").show();
    $(".divider").hide();
    if(card.content.word in wordFreq)
        $(".pill").html(wordFreq[card.content.word].level).attr("level",card.content.level).show();
    else $(".pill").hide();
}

export function revealAnswer(card){
    $(".answer,.divider").show();
    $(".card-c").css("padding-top", "0px").css("padding-bottom", "20px");
    $(".question").html("").append(addPitchAccent(card.content.pitchAccent, card.content.pronunciation, card.content.word, card.content.pos));
    $(".example .translation p").html(card.content.exampleMeaning);
    $(".card-item:has(.definition)").show();
}