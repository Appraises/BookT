import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

/**
 * Anki-style SRS algorithm (SM-2 variant)
 * 
 * Buttons: Again (1), Hard (2), Good (3), Easy (4)
 * 
 * Again: interval = 1 min, ease -= 0.20
 * Hard:  interval = interval * 1.2, ease -= 0.15
 * Good:  interval = interval * ease (or graduating interval if new)
 * Easy:  interval = interval * ease * 1.3, ease += 0.15
 * 
 * Ease factor minimum: 1.3
 * 
 * Status progression:
 *   interval >= 21 days → status 4 (Known, removed from queue)
 *   interval >= 3 days  → status 3 (Familiar)
 *   otherwise           → status 2 (Recognized)
 */

const MIN_EASE = 1.3;
const GRADUATING_INTERVAL = 1;   // 1 day (first "Good" press)
const EASY_INTERVAL = 4;          // 4 days (first "Easy" press)
const FAMILIAR_THRESHOLD = 3;     // days → status 3
const KNOWN_THRESHOLD = 21;       // days → status 4

function computeSRS(currentInterval, currentEase, quality) {
    let newInterval = currentInterval;
    let newEase = currentEase;

    switch (quality) {
        case 1: // Again
            newInterval = 1 / 1440; // 1 minute in days
            newEase = Math.max(MIN_EASE, currentEase - 0.20);
            break;

        case 2: // Hard
            if (currentInterval < 1) {
                newInterval = 1 / 144; // 10 minutes
            } else {
                newInterval = currentInterval * 1.2;
            }
            newEase = Math.max(MIN_EASE, currentEase - 0.15);
            break;

        case 3: // Good
            if (currentInterval < 1) {
                // New/learning card → graduating interval
                newInterval = GRADUATING_INTERVAL;
            } else {
                newInterval = currentInterval * currentEase;
            }
            // Ease stays the same
            break;

        case 4: // Easy
            if (currentInterval < 1) {
                newInterval = EASY_INTERVAL;
            } else {
                newInterval = currentInterval * currentEase * 1.3;
            }
            newEase = currentEase + 0.15;
            break;

        default:
            break;
    }

    // Determine status based on interval
    let newStatus;
    if (newInterval >= KNOWN_THRESHOLD) {
        newStatus = '4'; // Known
    } else if (newInterval >= FAMILIAR_THRESHOLD) {
        newStatus = '3'; // Familiar
    } else {
        newStatus = '2'; // Recognized
    }

    return { newInterval, newEase, newStatus };
}

// POST /api/flashcards/review
// Body: { word, language, quality } where quality = 1 (Again), 2 (Hard), 3 (Good), 4 (Easy)
export async function POST(request) {
    try {
        const { word, language, quality } = await request.json();

        if (!word || !language || !quality) {
            return NextResponse.json(
                { error: 'word, language, and quality are required' },
                { status: 400 }
            );
        }

        // Fetch current word state
        const userWord = await prisma.userWord.findUnique({
            where: { word_language: { word, language } },
        });

        if (!userWord) {
            return NextResponse.json({ error: 'Word not found' }, { status: 404 });
        }

        const currentInterval = userWord.interval || 0;
        const currentEase = userWord.easeFactor || 2.5;

        const { newInterval, newEase, newStatus } = computeSRS(
            currentInterval,
            currentEase,
            quality
        );

        // Calculate next review date
        const now = new Date();
        const nextReview = new Date(now.getTime() + newInterval * 24 * 60 * 60 * 1000);

        // Update the word
        const isCorrect = quality >= 3;
        const updated = await prisma.userWord.update({
            where: { word_language: { word, language } },
            data: {
                status: newStatus,
                interval: newInterval,
                easeFactor: newEase,
                nextReview,
                reviewCount: { increment: 1 },
                correctCount: isCorrect ? { increment: 1 } : 0, // Reset on wrong
                lastReviewed: now,
            },
        });

        return NextResponse.json({
            word: updated.word,
            status: updated.status,
            interval: newInterval,
            easeFactor: newEase,
            nextReview,
            reviewCount: updated.reviewCount,
        });
    } catch (error) {
        console.error('Review error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
