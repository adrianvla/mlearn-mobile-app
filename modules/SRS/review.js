/**
 * Flashcard Review Module
 * Handles the review session UI and card scheduling.
 * Uses the Anki-like SRS algorithm from srsAlgorithm.js.
 */

import { getFlashcards, overwriteFlashcards, getWordFreq } from './storage.js';
import {
    answerCard, previewAnswers, dueDateToString,
    buildReviewQueue, getNextCard, getQueueCounts,
    generateUUID, hashWord, getTodayDateString, buryCard,
} from './srsAlgorithm.js';
import { displayFlashcard, revealAnswer, addPitchAccent, getWord, getReading } from './display.js';
import $ from '../../lib/jquery.min.js';
import { displayHomeScreen } from '../screens/home.js';
import { displayScreen } from '../screens/displayScreen.js';

const MAX_UNDO_STACK_SIZE = 50;

function cloneState(state) {
    if (typeof structuredClone === 'function') {
        try { return structuredClone(state); } catch (_) {}
    }
    return JSON.parse(JSON.stringify(state));
}

/* ── Public helpers ────────────────────────────────────────────────── */

export function getFsLeft() {
    const store = getFlashcards();
    if (!store || typeof store.flashcards !== 'object') return '-';
    const queue = buildReviewQueue(store.flashcards, store.meta);
    const counts = getQueueCounts(queue, store.flashcards);
    return counts.total;
}

/* ── Review session ────────────────────────────────────────────────── */

export const review = () => {
    displayScreen('flashcards');
    let store = getFlashcards();
    if (!store || typeof store.flashcards !== 'object' || Object.keys(store.flashcards).length === 0) {
        displayHomeScreen();
        return;
    }

    // Reset daily counters if it's a new day
    const today = getTodayDateString();
    if (store.meta.newCardsDate !== today) {
        store.meta.newCardsDate = today;
        store.meta.newCardsToday = 0;
        store.meta.reviewsToday = 0;
    }

    let mutationEpoch = 0;
    const undoStack = [];

    const pushUndoState = () => {
        mutationEpoch++;
        undoStack.push(cloneState(store));
        if (undoStack.length > MAX_UNDO_STACK_SIZE) undoStack.shift();
    };

    const undoLastAction = () => {
        if (undoStack.length === 0) return;
        mutationEpoch++;
        store = undoStack.pop();
        overwriteFlashcards(store);
        refreshDisplay();
    };

    let queue = buildReviewQueue(store.flashcards, store.meta);
    let currentCard = null;

    function refreshDisplay() {
        queue = buildReviewQueue(store.flashcards, store.meta);
        const counts = getQueueCounts(queue, store.flashcards);
        const wordFreq = getWordFreq();

        $('.btn.again,.btn.hard,.btn.medium,.btn.easy').hide();
        $('.btn.show-answer').show();

        currentCard = getNextCard(queue, store.flashcards);
        if (!currentCard) {
            overwriteFlashcards(store);
            displayHomeScreen();
            return;
        }

        $('.p .to-review').text(counts.total);
        displayFlashcard(currentCard, wordFreq);

        const previews = previewAnswers(currentCard, store.meta);
        $('.btn.again').attr('data-content', dueDateToString(previews.again));
        $('.btn.hard').attr('data-content', dueDateToString(previews.hard));
        $('.btn.medium').attr('data-content', dueDateToString(previews.good));
        $('.btn.easy').attr('data-content', dueDateToString(previews.easy));
    }

    refreshDisplay();

    /* ── Answer a card ──────────────────────────────────────────── */

    const doAnswer = (rating) => {
        if (!currentCard) return;

        pushUndoState();

        const was = currentCard.state;
        const updated = answerCard(currentCard, rating, store.meta);
        store.flashcards[currentCard.id] = updated;

        // Update daily counters
        if (was === 'new') {
            store.meta.newCardsToday = (store.meta.newCardsToday || 0) + 1;
        }
        if (was === 'review' || was === 'relearning') {
            store.meta.reviewsToday = (store.meta.reviewsToday || 0) + 1;
        }

        // Track daily stats
        const today = getTodayDateString();
        if (!store.dailyStats) store.dailyStats = {};
        if (!store.dailyStats[today]) {
            store.dailyStats[today] = { date: today, newCardsStudied: 0, reviewCardsStudied: 0, lapses: 0, timeSpent: 0, graduated: 0 };
        }
        const ds = store.dailyStats[today];
        if (was === 'new') ds.newCardsStudied++;
        if (was === 'review') ds.reviewCardsStudied++;
        if (rating === 'again' && was === 'review') ds.lapses++;
        if (updated.state === 'review' && (was === 'learning' || was === 'new')) ds.graduated++;

        overwriteFlashcards(store);
        refreshDisplay();
    };

    /* ── Bury ──────────────────────────────────────────────── */

    const buryCurrentCard = () => {
        if (!currentCard) return;
        pushUndoState();
        store.flashcards[currentCard.id] = buryCard(currentCard);
        overwriteFlashcards(store);
        refreshDisplay();
    };

    /* ── Remove ────────────────────────────────────────────────── */

    const removeFlashcard = async (neverShowAgain = true) => {
        if (!currentCard) return false;
        const word = getWord(currentCard.content);
        if (!word) return false;

        const epochAtStart = mutationEpoch;
        let wordHash;
        try { wordHash = await hashWord(word); } catch (e) { return false; }
        if (epochAtStart !== mutationEpoch) return false;

        pushUndoState();

        delete store.flashcards[currentCard.id];

        if (wordHash && store.wordToCardMap && store.wordToCardMap[wordHash]) {
            store.wordToCardMap[wordHash] = store.wordToCardMap[wordHash].filter(id => id !== currentCard.id);
            if (store.wordToCardMap[wordHash].length === 0) {
                delete store.wordToCardMap[wordHash];
            }
        }

        if (neverShowAgain && wordHash) {
            if (!store.knownUntracked) store.knownUntracked = {};
            store.knownUntracked[wordHash] = true;
        }

        overwriteFlashcards(store);
        refreshDisplay();
        return true;
    };

    /* ── Edit mode ─────────────────────────────────────────────── */

    let isInEditMode = false;
    let isInCreateMode = false;

    const $addFlashcardBtn = $('.btn.add-flashcard');
    const addFlashcardDefaultIcon = $addFlashcardBtn.html();
    const saveIcon = '<svg width="800px" height="800px" viewBox="0 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd"><g id="Icon-Set" transform="translate(-152.000000, -515.000000)" fill="currentColor"><path d="M171,525 C171.552,525 172,524.553 172,524 L172,520 C172,519.447 171.552,519 171,519 C170.448,519 170,519.447 170,520 L170,524 C170,524.553 170.448,525 171,525 L171,525 Z M182,543 C182,544.104 181.104,545 180,545 L156,545 C154.896,545 154,544.104 154,543 L154,519 C154,517.896 154.896,517 156,517 L158,517 L158,527 C158,528.104 158.896,529 160,529 L176,529 C177.104,529 178,528.104 178,527 L178,517 L180,517 C181.104,517 182,517.896 182,519 L182,543 L182,543 Z M160,517 L176,517 L176,526 C176,526.553 175.552,527 175,527 L161,527 C160.448,527 160,526.553 160,526 L160,517 L160,517 Z M180,515 L156,515 C153.791,515 152,516.791 152,519 L152,543 C152,545.209 153.791,547 156,547 L180,547 C182.209,547 184,545.209 184,543 L184,519 C184,516.791 182.209,515 180,515 L180,515 Z" id="save-floppy"></path></g></g></svg>';
    const editIcon = '<svg width="800px" height="800px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g id="Complete"><g id="edit"><g><path d="M20,16v4a2,2,0,0,1-2,2H4a2,2,0,0,1-2-2V6A2,2,0,0,1,4,4H8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><polygon fill="none" points="12.5 15.8 22 6.2 17.8 2 8.3 11.5 8 16 12.5 15.8" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></g></g></g></svg>';

    const enterEditMode = () => {
        if (!currentCard) return;
        const content = currentCard.content;

        displayFlashcard(currentCard, getWordFreq());
        revealAnswer(currentCard);

        $('.can-be-edited').attr('contenteditable', 'true');
        $('.pitch, .pronunciation, .pronunciation-preview, .pill').show();
        $('.question').text(getWord(content));

        const pitchValue = content.pitchAccent ?? 0;
        const $pitchSpan = $('.pitch span');
        const $pronunciationSpan = $('.pronunciation span');
        const $pronunciationPreview = $('.pronunciation-preview');

        $pitchSpan.text(pitchValue);
        $pronunciationSpan.text(getReading(content));

        const updatePreview = () => {
            const reading = $pronunciationSpan.text();
            let pitch = parseInt($pitchSpan.text(), 10);
            if (!Number.isFinite(pitch) || pitch < 0) pitch = 0;
            $pitchSpan.text(String(pitch));
            if ($pronunciationPreview.length) {
                try {
                    const preview = addPitchAccent(pitch, reading, reading, null).html();
                    $pronunciationPreview.html(preview || '');
                } catch (_) {}
            }
        };
        $pitchSpan.on('input.review-edit', updatePreview);
        $pronunciationSpan.on('input.review-edit', updatePreview);
        updatePreview();

        const level = content.level;
        if (typeof level !== 'number' || level < 0) {
            $('.pill').text('-').attr('level', '-1');
        } else {
            $('.pill').text(String(level)).attr('level', String(level));
        }

        $('.editMode').text('Edit Mode').show();
        $('.buttons,.btn.add-flashcard').hide();
        $('.btn.edit').html(saveIcon);
        isInEditMode = true;
    };

    const exitEditMode = () => {
        $('.pitch span').off('input.review-edit');
        $('.pronunciation span').off('input.review-edit');

        if (currentCard) {
            pushUndoState();
            const card = store.flashcards[currentCard.id];
            if (card) {
                const pitchVal = parseInt($('.pitch span').text(), 10);
                const levelVal = parseInt($('.pill').attr('level'), 10);

                card.content.front = $('.question').text();
                card.content.word = card.content.front;
                card.content.back = $('.answer').text();
                card.content.translation = card.content.back;
                card.content.reading = $('.pronunciation span').text();
                card.content.pronunciation = card.content.reading;
                card.content.pitchAccent = Number.isFinite(pitchVal) ? pitchVal : 0;
                card.content.example = $('.sentence').html();
                card.content.exampleMeaning = $('.example .translation p').html();
                card.content.definition = $('.definition').html();
                card.content.level = Number.isFinite(levelVal) ? levelVal : card.content.level || -1;
                card.lastUpdated = Date.now();

                overwriteFlashcards(store);
            }
        }

        $('.editMode,.pill,.pitch,.pronunciation,.pronunciation-preview').hide();
        $('.can-be-edited').attr('contenteditable', 'false');
        $('.buttons,.btn.add-flashcard,.card-item:has(.example)').show();
        $('.btn.edit').html(editIcon);
        isInEditMode = false;

        refreshDisplay();
    };

    /* ── Create mode ───────────────────────────────────────────── */

    const enterCreateMode = () => {
        const now = Date.now();
        const template = {
            content: {
                type: 'word',
                front: 'word',
                back: 'translation',
                reading: 'pronunciation',
                pitchAccent: undefined,
                pos: '',
                level: -1,
                example: 'example',
                exampleMeaning: 'example meaning',
                imageUrl: '-',
                word: 'word',
                pronunciation: 'pronunciation',
                translation: 'translation',
                definition: 'definition',
                screenshotUrl: '-',
            },
            state: 'new',
            ease: 2.5,
            interval: 0,
            dueDate: now,
            reviews: 0,
            lapses: 0,
            learningStep: 0,
            createdAt: now,
            lastReviewed: now,
            lastUpdated: now,
        };

        $('.btn.edit,.buttons').hide();
        $('.editMode').text('Add Flashcard').show();
        $('.can-be-edited').attr('contenteditable', 'true');

        displayFlashcard(template, getWordFreq());
        revealAnswer(template);

        $('.answer,.pronunciation').show();
        $('.pronunciation span').text(template.content.reading);
        $('.example .translation p').html(template.content.exampleMeaning);
        $('.card-item:has(.definition)').show();
        $('.pill').text('-').attr('level', '-1').show();
        $('.card-item:has(.img-src),.pitch').show();
        $('.img-src').text(template.content.imageUrl);
        $('.pitch span').text('-1');
        $addFlashcardBtn.html(saveIcon);
        isInCreateMode = true;
    };

    const exitCreateMode = async () => {
        $('.btn.edit,.buttons,.card-item:has(.example)').show();
        $('.editMode,.pronunciation').hide();
        $('.can-be-edited').attr('contenteditable', 'false');
        $('.card-item:has(.img-src),.pitch').hide();

        const now = Date.now();
        const pitchAccentRaw = parseInt($('.pitch span').text(), 10);
        const levelRaw = parseInt($('.pill').attr('level'), 10);
        const front = $('.question').text();

        const id = generateUUID();
        const newCard = {
            id,
            content: {
                type: 'word',
                front,
                back: $('.answer').text(),
                reading: $('.pronunciation span').text(),
                pitchAccent: Number.isFinite(pitchAccentRaw) ? pitchAccentRaw : 0,
                pos: '',
                level: Number.isFinite(levelRaw) ? levelRaw : -1,
                example: $('.sentence').html(),
                exampleMeaning: $('.example .translation p').html(),
                imageUrl: $('.img-src').text(),
                word: front,
                pronunciation: $('.pronunciation span').text(),
                translation: $('.answer').text(),
                definition: $('.definition').html(),
                screenshotUrl: $('.img-src').text(),
            },
            state: 'new',
            ease: 2.5,
            interval: 0,
            dueDate: now,
            reviews: 0,
            lapses: 0,
            learningStep: 0,
            createdAt: now,
            lastReviewed: 0,
            lastUpdated: now,
        };

        pushUndoState();
        store.flashcards[id] = newCard;

        if (front) {
            try {
                const wordHash = await hashWord(front);
                if (!store.wordToCardMap) store.wordToCardMap = {};
                if (!store.wordToCardMap[wordHash]) store.wordToCardMap[wordHash] = [];
                store.wordToCardMap[wordHash].push(id);
            } catch (_) {}
        }

        overwriteFlashcards(store);
        $addFlashcardBtn.html(addFlashcardDefaultIcon);
        isInCreateMode = false;
        refreshDisplay();
    };

    /* ── Keyboard shortcuts ────────────────────────────────────── */

    const $document = $(document);
    $document.off('keydown.review');
    $document.on('keydown.review', (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && typeof e.key === 'string' && e.key.toLowerCase() === 'z') {
            if (!isInEditMode && !isInCreateMode) {
                e.preventDefault();
                undoLastAction();
            }
            return;
        }
        if (isInEditMode || isInCreateMode) return;
        switch (e.key) {
            case '1': $('.btn.again').click(); break;
            case '2': $('.btn.hard').click(); break;
            case '3': $('.btn.medium').click(); break;
            case '4': $('.btn.easy').click(); break;
            case 'b': $('.btn.bury').click(); break;
            case 'x': $('.btn.bin').click(); break;
            case ' ': e.preventDefault(); $('.btn.show-answer').click(); break;
        }
    });

    /* ── Button event handlers ─────────────────────────────────── */

    $('.btn.again').off('click').on('click', () => doAnswer('again'));
    $('.btn.hard').off('click').on('click', () => doAnswer('hard'));
    $('.btn.medium').off('click').on('click', () => doAnswer('good'));
    $('.btn.easy').off('click').on('click', () => doAnswer('easy'));
    $('.btn.bury').off('click').on('click', buryCurrentCard);
    $('.btn.bin').off('click').on('click', () => removeFlashcard(true));

    $('.btn.show-answer').off('click').on('click', () => {
        if (!currentCard) return;
        $('.btn.again,.btn.hard,.btn.medium,.btn.easy').show();
        $('.btn.show-answer').hide();
        revealAnswer(currentCard);
    });

    $('.btn.close').off('click').on('click', () => {
        $document.off('keydown.review');
        displayHomeScreen();
    });

    $('.editMode').hide();
    $('.btn.edit').off('click').on('click', () => {
        if (isInEditMode) {
            exitEditMode();
        } else {
            enterEditMode();
        }
    });

    $addFlashcardBtn.off('click').on('click', () => {
        if (isInCreateMode) {
            exitCreateMode();
        } else {
            enterCreateMode();
        }
    });
};
