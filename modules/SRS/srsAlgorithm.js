/**
 * SRS Algorithm — direct port from mlearn-ts srsAlgorithm.ts
 * Implements Anki-like Spaced Repetition System (SM-2 variant)
 *
 * Card states:
 * - new: Never reviewed, waiting in new card queue
 * - learning: Currently in learning phase (short intervals based on steps)
 * - review: Graduated to review phase (longer intervals)
 * - relearning: Failed review, back to learning phase
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MIN_EASE = 1.3;
const EASE_BONUS = 1.3;

/**
 * Get the effective date after applying the new day hour offset.
 * If current time is before newDayHour, the SRS day is still "yesterday".
 */
function getEffectiveDate(date, newDayHour = 4) {
    return new Date(date.getTime() - newDayHour * 60 * 60 * 1000);
}

/**
 * Get today's date string in YYYY-MM-DD format, respecting newDayHour.
 */
export function getTodayDateString(newDayHour = 4) {
    const effective = getEffectiveDate(new Date(), newDayHour);
    return `${effective.getFullYear()}-${String(effective.getMonth() + 1).padStart(2, '0')}-${String(effective.getDate()).padStart(2, '0')}`;
}

/**
 * Check if a timestamp is from today, respecting newDayHour.
 */
export function isToday(timestamp, newDayHour = 4) {
    const todayEffective = getEffectiveDate(new Date(), newDayHour);
    const dateEffective = getEffectiveDate(new Date(timestamp), newDayHour);
    return todayEffective.getFullYear() === dateEffective.getFullYear() &&
        todayEffective.getMonth() === dateEffective.getMonth() &&
        todayEffective.getDate() === dateEffective.getDate();
}

/**
 * Get the timestamp for the end of the current SRS day.
 */
export function getEndOfSRSDay(newDayHour = 4) {
    const now = new Date();
    const boundary = new Date(now);
    boundary.setHours(newDayHour, 0, 0, 0);
    if (now.getTime() >= boundary.getTime()) {
        boundary.setDate(boundary.getDate() + 1);
    }
    return boundary.getTime();
}

/**
 * Generate UUID v4
 */
export function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * Generate hash for word lookups using SHA-256 with fallback.
 * Matches mlearn-ts hashWord implementation exactly.
 */
export async function hashWord(word) {
    try {
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const encoder = new TextEncoder();
            const data = encoder.encode(word);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (e) {
        // fallback below
    }
    let hash = 5381;
    for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) + hash) ^ word.charCodeAt(i);
    }
    return 'djb2_' + Math.abs(hash).toString(16);
}

/**
 * Convert interval in milliseconds to human-readable string.
 */
export function intervalToString(intervalMs) {
    if (intervalMs < 0) intervalMs = 0;
    if (intervalMs < MINUTE) return '< 1m';
    if (intervalMs < HOUR) return `${Math.round(intervalMs / MINUTE)}m`;
    if (intervalMs < DAY) return `${Math.round(intervalMs / HOUR)}h`;
    if (intervalMs < 365 * DAY) return `${Math.round(intervalMs / DAY)}d`;
    return `${(intervalMs / (365 * DAY)).toFixed(1)}y`;
}

/**
 * Convert due date to relative string.
 */
export function dueDateToString(dueDate) {
    const diff = dueDate - Date.now();
    if (diff <= 0) return 'now';
    return intervalToString(diff);
}

/**
 * Default metadata matching mlearn-ts defaults.
 */
export function getDefaultMeta(newDayHour = 4) {
    return {
        newCardsToday: 0,
        reviewsToday: 0,
        newCardsDate: getTodayDateString(newDayHour),
        maxNewCardsPerDay: 20,
        maxNewCardsPerDayLearning: 20,
        maxReviewsPerDay: -1,
        learningSteps: [1, 10],
        relearnSteps: [10],
        graduatingInterval: 1,
        easyInterval: 4,
        newIntervalModifier: 100,
        reviewIntervalModifier: 100,
        maxInterval: 36500,
    };
}

function calculateNewEase(currentEase, rating) {
    let ease = currentEase;
    switch (rating) {
        case 'again': ease = Math.max(MIN_EASE, ease - 0.2); break;
        case 'hard': ease = Math.max(MIN_EASE, ease - 0.15); break;
        case 'good': break;
        case 'easy': ease += 0.15; break;
    }
    return ease;
}

/**
 * Answer a card with a rating and return the updated card.
 */
export function answerCard(card, rating, meta) {
    const now = Date.now();
    const updated = { ...card, lastReviewed: now, lastUpdated: now };
    switch (card.state) {
        case 'new': return answerNewCard(updated, rating, meta);
        case 'learning': return answerLearningCard(updated, rating, meta);
        case 'review': return answerReviewCard(updated, rating, meta);
        case 'relearning': return answerRelearningCard(updated, rating, meta);
        default: return updated;
    }
}

function answerNewCard(card, rating, meta) {
    const now = Date.now();
    const steps = meta.learningSteps;
    const firstStep = steps.length > 0 ? steps[0] : 1;
    switch (rating) {
        case 'again':
            return { ...card, state: 'learning', learningStep: 0, dueDate: now + firstStep * MINUTE };
        case 'hard':
            return { ...card, state: 'learning', learningStep: 0, dueDate: now + firstStep * MINUTE * 1.5 };
        case 'good':
            if (steps.length <= 1) {
                return { ...card, state: 'review', learningStep: 0, interval: meta.graduatingInterval * DAY, dueDate: now + meta.graduatingInterval * DAY, reviews: 1 };
            }
            return { ...card, state: 'learning', learningStep: 1, dueDate: now + steps[1] * MINUTE };
        case 'easy':
            return { ...card, state: 'review', learningStep: 0, ease: card.ease + 0.15, interval: meta.easyInterval * DAY, dueDate: now + meta.easyInterval * DAY, reviews: 1 };
    }
}

function answerLearningCard(card, rating, meta) {
    const now = Date.now();
    const steps = meta.learningSteps;
    const currentStep = Math.min(card.learningStep, Math.max(0, steps.length - 1));
    const currentDelay = steps.length > 0 ? steps[currentStep] : 1;
    switch (rating) {
        case 'again':
            return { ...card, learningStep: 0, dueDate: now + (steps.length > 0 ? steps[0] : 1) * MINUTE };
        case 'hard':
            return { ...card, dueDate: now + currentDelay * MINUTE * 1.5 };
        case 'good': {
            const nextStep = currentStep + 1;
            if (nextStep >= steps.length) {
                return { ...card, state: 'review', learningStep: 0, interval: meta.graduatingInterval * DAY, dueDate: now + meta.graduatingInterval * DAY, reviews: (card.reviews || 0) + 1 };
            }
            return { ...card, learningStep: nextStep, dueDate: now + steps[nextStep] * MINUTE };
        }
        case 'easy':
            return { ...card, state: 'review', learningStep: 0, ease: card.ease + 0.15, interval: meta.easyInterval * DAY, dueDate: now + meta.easyInterval * DAY, reviews: (card.reviews || 0) + 1 };
    }
}

function answerReviewCard(card, rating, meta) {
    const now = Date.now();
    const relearnSteps = meta.relearnSteps;
    const firstRelearnStep = relearnSteps.length > 0 ? relearnSteps[0] : 10;
    switch (rating) {
        case 'again': {
            const lapseInterval = Math.max(1 * DAY, card.interval * 0.5);
            return { ...card, state: 'relearning', learningStep: 0, lapses: (card.lapses || 0) + 1, ease: calculateNewEase(card.ease, rating), interval: lapseInterval, dueDate: now + firstRelearnStep * MINUTE };
        }
        case 'hard': {
            const hardInterval = Math.min(card.interval * 1.2, meta.maxInterval * DAY);
            return { ...card, ease: calculateNewEase(card.ease, rating), interval: hardInterval, dueDate: now + hardInterval, reviews: (card.reviews || 0) + 1 };
        }
        case 'good': {
            const modifier = meta.reviewIntervalModifier / 100;
            const goodInterval = Math.min(card.interval * card.ease * modifier, meta.maxInterval * DAY);
            return { ...card, ease: calculateNewEase(card.ease, rating), interval: goodInterval, dueDate: now + goodInterval, reviews: (card.reviews || 0) + 1 };
        }
        case 'easy': {
            const easyModifier = meta.reviewIntervalModifier / 100;
            const easyInterval = Math.min(card.interval * card.ease * EASE_BONUS * easyModifier, meta.maxInterval * DAY);
            return { ...card, ease: calculateNewEase(card.ease, rating), interval: easyInterval, dueDate: now + easyInterval, reviews: (card.reviews || 0) + 1 };
        }
    }
}

function answerRelearningCard(card, rating, meta) {
    const now = Date.now();
    const steps = meta.relearnSteps;
    const currentStep = Math.min(card.learningStep, Math.max(0, steps.length - 1));
    const currentDelay = steps.length > 0 ? steps[currentStep] : 10;
    switch (rating) {
        case 'again':
            return { ...card, learningStep: 0, dueDate: now + (steps.length > 0 ? steps[0] : 10) * MINUTE };
        case 'hard':
            return { ...card, dueDate: now + currentDelay * MINUTE * 1.5 };
        case 'good': {
            const nextStep = currentStep + 1;
            if (nextStep >= steps.length) {
                return { ...card, state: 'review', learningStep: 0, dueDate: now + card.interval };
            }
            return { ...card, learningStep: nextStep, dueDate: now + steps[nextStep] * MINUTE };
        }
        case 'easy': {
            const easyInterval = Math.min(card.interval * 1.5, meta.maxInterval * DAY);
            return { ...card, state: 'review', learningStep: 0, interval: easyInterval, dueDate: now + easyInterval };
        }
    }
}

/**
 * Preview what would happen with each rating.
 */
export function previewAnswers(card, meta) {
    return {
        again: answerCard(card, 'again', meta).dueDate,
        hard: answerCard(card, 'hard', meta).dueDate,
        good: answerCard(card, 'good', meta).dueDate,
        easy: answerCard(card, 'easy', meta).dueDate,
    };
}

/**
 * Get new cards (never reviewed).
 */
export function getNewCards(cards) {
    return Object.values(cards)
        .filter(c => c.state === 'new' && !c.suspended && !c.buried)
        .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Get learning cards (in learning or relearning phase, due now).
 */
export function getLearningCards(cards) {
    const now = Date.now();
    return Object.values(cards)
        .filter(c => (c.state === 'learning' || c.state === 'relearning') && !c.suspended && !c.buried && c.dueDate <= now)
        .sort((a, b) => a.dueDate - b.dueDate);
}

/**
 * Get review cards due by end of SRS day.
 */
export function getReviewCards(cards, newDayHour = 4) {
    const dayEnd = getEndOfSRSDay(newDayHour);
    return Object.values(cards)
        .filter(c => c.state === 'review' && !c.suspended && !c.buried && c.dueDate <= dayEnd)
        .sort((a, b) => a.dueDate - b.dueDate);
}

/**
 * Build the review queue for a study session.
 */
export function buildReviewQueue(cards, meta, newDayHour = 4) {
    const now = Date.now();

    const allNewCards = getNewCards(cards);
    const learningCards = getLearningCards(cards);
    const reviewCards = getReviewCards(cards, newDayHour);
    const relearnCards = Object.values(cards)
        .filter(c => c.state === 'relearning' && !c.suspended && !c.buried && c.dueDate <= now)
        .sort((a, b) => a.dueDate - b.dueDate);

    const remainingNewCards = Math.max(0, (meta.maxNewCardsPerDay || 20) - (meta.newCardsToday || 0));
    let newCardsToShow = allNewCards.slice(0, remainingNewCards);

    if (meta.maxNewCardsPerDayLearning !== undefined && meta.maxNewCardsPerDayLearning >= 0) {
        const remainingLearning = Math.max(0, meta.maxNewCardsPerDayLearning - (meta.newCardsToday || 0));
        newCardsToShow = newCardsToShow.slice(0, remainingLearning);
    }

    let reviewCardsToShow = reviewCards;
    if (meta.maxReviewsPerDay !== undefined && meta.maxReviewsPerDay >= 0) {
        const remainingReviews = Math.max(0, meta.maxReviewsPerDay - (meta.reviewsToday || 0));
        reviewCardsToShow = reviewCards.slice(0, remainingReviews);
    }

    return {
        newQueue: newCardsToShow.map(c => c.id),
        learningQueue: learningCards.map(c => c.id),
        reviewQueue: reviewCardsToShow.map(c => c.id),
        relearnQueue: relearnCards.map(c => c.id),
    };
}

/**
 * Get the next card to review from the queue.
 * Priority: relearning > learning > new (interleaved) > review
 */
export function getNextCard(queue, cards) {
    const now = Date.now();

    for (const id of queue.relearnQueue) {
        const card = cards[id];
        if (card && card.dueDate <= now && !card.suspended && !card.buried) return card;
    }

    for (const id of queue.learningQueue) {
        const card = cards[id];
        if (card && card.dueDate <= now && !card.suspended && !card.buried) return card;
    }

    const hasNewCards = queue.newQueue.length > 0;
    const hasReviewCards = queue.reviewQueue.some(id => {
        const card = cards[id];
        return card && !card.suspended && !card.buried;
    });

    if (hasNewCards && (!hasReviewCards || Math.random() < 0.1)) {
        const id = queue.newQueue[0];
        const card = cards[id];
        if (card && !card.suspended && !card.buried) return card;
    }

    for (const id of queue.reviewQueue) {
        const card = cards[id];
        if (card && !card.suspended && !card.buried) return card;
    }

    if (hasNewCards) {
        return cards[queue.newQueue[0]] || null;
    }

    return null;
}

/**
 * Remove a card from the queue.
 */
export function removeFromQueue(queue, cardId) {
    return {
        newQueue: queue.newQueue.filter(id => id !== cardId),
        learningQueue: queue.learningQueue.filter(id => id !== cardId),
        reviewQueue: queue.reviewQueue.filter(id => id !== cardId),
        relearnQueue: queue.relearnQueue.filter(id => id !== cardId),
    };
}

/**
 * Add a card to the appropriate queue based on its state.
 */
export function addToQueue(queue, card) {
    const cleanQueue = removeFromQueue(queue, card.id);
    switch (card.state) {
        case 'new': return { ...cleanQueue, newQueue: [...cleanQueue.newQueue, card.id] };
        case 'learning': return { ...cleanQueue, learningQueue: [...cleanQueue.learningQueue, card.id] };
        case 'review': return { ...cleanQueue, reviewQueue: [...cleanQueue.reviewQueue, card.id] };
        case 'relearning': return { ...cleanQueue, relearnQueue: [...cleanQueue.relearnQueue, card.id] };
        default: return cleanQueue;
    }
}

/**
 * Get queue counts for display.
 */
export function getQueueCounts(queue, cards) {
    const now = Date.now();
    const learning = [...queue.learningQueue, ...queue.relearnQueue]
        .filter(id => { const card = cards[id]; return card && card.dueDate <= now; }).length;
    const review = queue.reviewQueue
        .filter(id => { const card = cards[id]; return card && !card.suspended && !card.buried; }).length;
    return {
        new: queue.newQueue.length,
        learning,
        review,
        total: queue.newQueue.length + learning + review,
    };
}

/**
 * Bury a card until the next day.
 */
export function buryCard(card) {
    return { ...card, buried: true, lastUpdated: Date.now() };
}

/**
 * Unbury all cards.
 */
export function unburyCards(cards) {
    const result = {};
    for (const [id, card] of Object.entries(cards)) {
        result[id] = card.buried ? { ...card, buried: false, lastUpdated: Date.now() } : card;
    }
    return result;
}
