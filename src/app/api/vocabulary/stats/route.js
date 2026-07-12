import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { LEVEL } from '@/lib/status';

// GET /api/vocabulary/stats?language=fr — Get word counts per status
export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const language = searchParams.get('language');

        const where = language ? { language } : {};

        const [total, level1, level2, level3, knownCount, forms, skillGroups] = await Promise.all([
            prisma.lexeme.count({ where }),
            prisma.lexeme.count({
                where: { ...where, status: LEVEL.NEW },
            }),
            prisma.lexeme.count({
                where: { ...where, status: LEVEL.RECOGNIZED },
            }),
            prisma.lexeme.count({
                where: { ...where, status: LEVEL.FAMILIAR },
            }),
            prisma.lexeme.count({
                where: { ...where, status: LEVEL.KNOWN },
            }),
            prisma.userWord.count({ where: { ...where, isStudyable: true } }),
            prisma.skillMemory.groupBy({
                by: ['skill'],
                where: language ? { lexeme: { language } } : { lexemeId: { not: null } },
                _count: { id: true },
                _sum: { reps: true },
            }),
        ]);

        return NextResponse.json({
            total,
            forms,
            known: knownCount,
            learning: total - knownCount,
            levels: {
                1: level1,
                2: level2,
                3: level3,
                4: knownCount,
            },
            skills: Object.fromEntries(skillGroups.map((group) => [group.skill, {
                total: group._count.id,
                reviews: group._sum.reps || 0,
            }])),
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
