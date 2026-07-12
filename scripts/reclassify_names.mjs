/**
 * One-shot: reclassify existing vocabulary so proper nouns (names, places) and
 * junk tokens stop appearing as flashcards. Safe to re-run.
 *
 *   node scripts/reclassify_names.mjs
 */
import { PrismaClient } from '@prisma/client';
import { detectProperNouns } from '../src/lib/properNouns.js';
import { normalizeWord, isLearnableWord } from '../src/lib/normalizer.js';

const prisma = new PrismaClient();

const books = await prisma.book.findMany({
    include: { pages: { orderBy: { pageNumber: 'asc' } } },
});

// Aggregate proper nouns per language from the full-book original-case text.
// Threshold 1 (same as the live reader path) so low-frequency names are caught;
// the structural stoplist inside detectProperNouns handles heading words.
const namesByLang = new Map();
for (const book of books) {
    const text = book.pages.map((pg) => pg.content).join('\n');
    const names = detectProperNouns(text, book.language, { minTitleMid: 1 });
    if (!namesByLang.has(book.language)) namesByLang.set(book.language, new Set());
    const set = namesByLang.get(book.language);
    for (const n of names) set.add(n);
    console.log(`scanned "${book.title}" (${book.language}): ${names.size} names`);
}

const isJunk = (w) => !isLearnableWord(w) || /\d/.test(w) || w.length > 40;

// Authoritative: recompute isStudyable in both directions so a re-run fixes
// earlier over-flagging. (Names, POS=PROPN, and junk are the only exclusions.)
let toFalse = 0;
let toTrue = 0;
for (const [language, names] of namesByLang) {
    const words = await prisma.userWord.findMany({ where: { language } });
    const flipFalse = [];
    const flipTrue = [];
    for (const w of words) {
        const shouldStudy = !(names.has(w.word) || w.partOfSpeech === 'PROPN' || isJunk(w.word));
        if (shouldStudy === w.isStudyable) continue;
        (shouldStudy ? flipTrue : flipFalse).push(w);
    }
    if (flipFalse.length) {
        await prisma.userWord.updateMany({ where: { id: { in: flipFalse.map((w) => w.id) } }, data: { isStudyable: false } });
        console.log(`\n[${language}] -> non-studyable (+${flipFalse.length}): ${flipFalse.map((w) => w.word).sort().join(', ')}`);
    }
    if (flipTrue.length) {
        await prisma.userWord.updateMany({ where: { id: { in: flipTrue.map((w) => w.id) } }, data: { isStudyable: true } });
        console.log(`\n[${language}] -> re-enabled (+${flipTrue.length}): ${flipTrue.map((w) => w.word).sort().join(', ')}`);
    }
    toFalse += flipFalse.length;
    toTrue += flipTrue.length;
}

console.log(`\nDone. non-studyable: ${toFalse}, re-enabled: ${toTrue}`);
await prisma.$disconnect();
