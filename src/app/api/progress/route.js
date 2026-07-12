import prisma from '@/lib/prisma';
import { LEVEL } from '@/lib/status';
import { NextResponse } from 'next/server';

// Local YYYY-MM-DD key for a date.
function dayKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// Count consecutive active days ending today (or yesterday, so a streak isn't
// lost until a full day is missed).
function computeStreak(activeDays) {
    if (activeDays.size === 0) return 0;
    const cursor = new Date();
    if (!activeDays.has(dayKey(cursor))) {
        cursor.setDate(cursor.getDate() - 1);
        if (!activeDays.has(dayKey(cursor))) return 0;
    }
    let streak = 0;
    while (activeDays.has(dayKey(cursor))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

// GET /api/progress?language=pl — daily activity + streak for motivation widgets.
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');
        if (!language) {
            return NextResponse.json({ error: 'language is required' }, { status: 400 });
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [newToday, reviewedToday, knownTotal, timestamps, reviews] = await Promise.all([
            prisma.lexeme.count({ where: { language, firstSeen: { gte: todayStart } } }),
            prisma.skillMemory.count({ where: { lexeme: { language }, lastReview: { gte: todayStart } } }),
            prisma.lexeme.count({ where: { language, status: LEVEL.KNOWN } }),
            prisma.lexeme.findMany({
                where: { language },
                select: { firstSeen: true, lastSeen: true },
            }),
            prisma.skillReview.findMany({
                where: { memory: { lexeme: { language } } },
                select: { reviewedAt: true },
            }),
        ]);

        // Days with any activity (word first seen, seen again, or reviewed).
        const activeDays = new Set();
        for (const t of timestamps) {
            for (const d of [t.firstSeen, t.lastSeen]) {
                if (d) activeDays.add(dayKey(new Date(d)));
            }
        }
        for (const review of reviews) activeDays.add(dayKey(new Date(review.reviewedAt)));

        return NextResponse.json({
            newToday,
            reviewedToday,
            activeToday: activeDays.has(dayKey(new Date())),
            streak: computeStreak(activeDays),
            knownTotal,
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
