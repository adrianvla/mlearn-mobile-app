/**
 * Flashcard Display Module
 * Handles rendering flashcard content to the DOM.
 * Supports both new FlashcardContent format (front/back) and legacy (word/translation).
 */

import $ from '../../lib/jquery.min.js';
import { buildPitchAccentHtml, getPitchAccentInfo } from '../common/pitchAccent.js';

/* ── Content field accessors (new format + legacy fallback) ────────── */

export function getWord(content) {
    return content.front || content.word || '';
}

export function getBack(content) {
    if (content.back) return content.back;
    if (Array.isArray(content.translation)) return content.translation.join(', ');
    if (content.translation) return content.translation;
    return '';
}

export function getReading(content) {
    return content.reading || content.pronunciation || '';
}

export function getDefinition(content) {
    if (typeof content.definition === 'string') return content.definition;
    if (Array.isArray(content.definition)) return content.definition.join('<br>');
    if (content.extra && content.extra.definition) {
        if (typeof content.extra.definition === 'string') return content.extra.definition;
        if (Array.isArray(content.extra.definition)) return content.extra.definition.join('<br>');
    }
    return '';
}

export function getImageUrl(content) {
    return content.imageUrl || content.screenshotUrl || '';
}

export function getExample(content) {
    return content.example || '';
}

export function getExampleMeaning(content) {
    return content.exampleMeaning || '';
}

/* ── Pitch accent rendering ────────────────────────────────────────── */

function hasComplexScript(word) {
    const nonKanaRegex = /[^\u3040-\u30FF]/;
    return nonKanaRegex.test(word);
}

export const addPitchAccent = (accentType, reading, realWord, pos) => {
    const safeReading = typeof reading === 'string' ? reading : String(reading ?? '');
    const safeRealWord = typeof realWord === 'string' ? realWord : String(realWord ?? '');

    const buildBasicRuby = () => {
        if (hasComplexScript(safeRealWord)) {
            return $(`<ruby>${safeRealWord}<rt>${safeReading}</rt></ruby>`);
        }
        return $(`<span>${safeRealWord}</span>`);
    };

    const accentInfo = getPitchAccentInfo(accentType, safeReading);
    if (!accentInfo) return buildBasicRuby();

    const htmlString = buildPitchAccentHtml(accentInfo, safeRealWord.length, {
        includeParticleBox: !(pos === '動詞'),
    });
    const pitchAccentContainer = $('<div class="mLearn-pitch-accent"></div>').html(htmlString);
    const accentMarkup = pitchAccentContainer[0]?.outerHTML ?? '';

    if (hasComplexScript(safeRealWord)) {
        return $(`<ruby>${safeRealWord}<rt style="--pitch-accent-height: 2px">${safeReading}${accentMarkup}</rt></ruby>`);
    }
    return $(`<span style="--pitch-accent-height: 5px">${safeRealWord}${accentMarkup}</span>`);
};

/* ── Card rendering ────────────────────────────────────────────────── */

export function displayFlashcard(card, wordFreq) {
    const content = card.content || {};
    const word = getWord(content);
    const example = getExample(content);
    const definition = getDefinition(content);
    const imageUrl = getImageUrl(content);

    $('.answer').hide().html(getBack(content));
    $('.question').html(word);
    $('.sentence').html(example);
    $('.definition').html(definition);
    $('.card-item:has(.definition)').hide();
    $('.example .translation p').html('');
    $('.card-item img').attr('src', imageUrl);
    $('.card-c').css('padding-top', '10px').css('padding-bottom', '10px');

    if (!example || ['', '-', ' '].includes(example)) {
        $('.card-item:has(.example)').hide();
    } else {
        $('.card-item:has(.example)').show();
    }

    $('.divider').hide();

    const level = content.level;
    if (wordFreq && word in wordFreq && wordFreq[word].level) {
        const entry = wordFreq[word];
        const displayLevel = typeof entry.raw_level === 'number' ? entry.raw_level : level;
        $('.pill').html(entry.level).attr('level', displayLevel).show();
    } else if (typeof level === 'number' && level >= 0) {
        $('.pill').html('Level ' + level).attr('level', level).show();
    } else {
        $('.pill').hide();
    }
}

export function revealAnswer(card) {
    const content = card.content || {};
    const word = getWord(content);
    const reading = getReading(content);
    const definition = getDefinition(content);

    $('.answer,.divider').show();
    $('.card-c').css('padding-top', '0px').css('padding-bottom', '20px');

    if (reading && content.pitchAccent !== undefined && content.pitchAccent !== null) {
        $('.question').html('').append(addPitchAccent(content.pitchAccent, reading, word, content.pos));
    } else if (reading && reading !== word) {
        $('.question').html(`<ruby>${word}<rt>${reading}</rt></ruby>`);
    }

    $('.example .translation p').html(getExampleMeaning(content));

    if (definition) {
        $('.card-item:has(.definition)').show();
    }
}
