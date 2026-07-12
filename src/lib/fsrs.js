import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';
import { LEVEL } from '@/lib/status';

export const SKILL = {
    RECOGNITION: 'recognition',
    PRODUCTION: 'production',
    LISTENING: 'listening',
    GRAMMAR: 'grammar',
    CONJUGATION: 'conjugation',
};

const scheduler = fsrs();

export const memoryKey = (lexemeId, skill) => `${lexemeId}:${skill}`;
export const grammarMemoryKey = (encounterId) => `grammar:${encounterId}`;
// Conjugation is remembered per verb AND tense — knowing the présent of
// "faire" says nothing about its passé composé.
export const conjugationMemoryKey = (lexemeId, tense) => `${lexemeId}:conjugation:${tense}`;

export function memoryToCard(memory, now = new Date()) {
    if (!memory) return createEmptyCard(now);
    const reviewed = (memory.reps || 0) > 0;
    return {
        due: new Date(memory.due),
        stability: reviewed ? Math.max(0.001, memory.stability || 0) : 0,
        difficulty: reviewed ? Math.min(10, Math.max(1, memory.difficulty || 5)) : 0,
        elapsed_days: memory.elapsedDays || 0,
        scheduled_days: memory.scheduledDays || 0,
        reps: memory.reps || 0,
        lapses: memory.lapses || 0,
        learning_steps: memory.learningSteps || 0,
        state: memory.state || 0,
        last_review: memory.lastReview ? new Date(memory.lastReview) : undefined,
    };
}

export function cardToMemoryData(card) {
    return {
        due: new Date(card.due),
        stability: card.stability,
        difficulty: card.difficulty,
        elapsedDays: card.elapsed_days,
        scheduledDays: card.scheduled_days,
        reps: card.reps,
        lapses: card.lapses,
        learningSteps: card.learning_steps || 0,
        state: card.state,
        lastReview: card.last_review ? new Date(card.last_review) : null,
    };
}

export function scheduleReview(memory, quality, now = new Date()) {
    const rating = {
        1: Rating.Again,
        2: Rating.Hard,
        3: Rating.Good,
        4: Rating.Easy,
    }[quality];
    if (!rating) throw new Error('quality must be 1..4');
    return scheduler.next(memoryToCard(memory, now), now, rating);
}

export function previewSchedule(memory, now = new Date()) {
    const preview = scheduler.repeat(memoryToCard(memory, now), now);
    return Object.fromEntries(
        [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].map((rating) => [
            rating,
            {
                due: preview[rating].card.due,
                scheduledDays: preview[rating].card.scheduled_days,
            },
        ])
    );
}

export function statusFromSkillMemories(memories) {
    const bySkill = new Map(memories.map((memory) => [memory.skill, memory]));
    const recognition = bySkill.get(SKILL.RECOGNITION);
    const production = bySkill.get(SKILL.PRODUCTION);
    const practiced = [recognition, production].filter((memory) => memory?.reps > 0);

    if (practiced.length === 0) return LEVEL.NEW;
    if (
        recognition?.reps > 0 && production?.reps > 0 &&
        Math.min(recognition.stability, production.stability) >= 21
    ) return LEVEL.KNOWN;
    if (
        recognition?.reps > 0 && production?.reps > 0 &&
        Math.min(recognition.stability, production.stability) >= 3
    ) return LEVEL.FAMILIAR;
    return LEVEL.RECOGNIZED;
}

export function formatDueInterval(due, now = new Date()) {
    const minutes = Math.max(1, Math.round((new Date(due).getTime() - now.getTime()) / 60000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d`;
    return `${Math.round(days / 30)}mo`;
}
