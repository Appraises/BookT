import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

// GET /api/vocabulary/stats?language=fr — Get word counts per status
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');

        const where = language ? { language } : {};

        const [total, known, learning] = await Promise.all([
            prisma.userWord.count({ where }),
            prisma.userWord.count({ where: { ...where, status: 'KNOWN' } }),
            prisma.userWord.count({
                where: {
                    ...where,
                    status: { notIn: ['KNOWN', '4'] },
                },
            }),
        ]);

        // Also count by numeric levels
        const levels = {};
        for (const level of ['1', '2', '3']) {
            levels[level] = await prisma.userWord.count({
                where: { ...where, status: level },
            });
        }

        // Count status=4 and status=KNOWN together as "known"
        const knownCount = await prisma.userWord.count({
            where: {
                ...where,
                status: { in: ['KNOWN', '4'] },
            },
        });

        return NextResponse.json({
            total,
            known: knownCount,
            learning: total - knownCount,
            levels: {
                1: levels['1'] || 0,
                2: levels['2'] || 0,
                3: levels['3'] || 0,
                4: knownCount,
            },
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
