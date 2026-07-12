/**
 * One-shot: re-translate French verb infinitives that were backfilled with the
 * bad bare-infinitive MT (e.g. "sortir" -> "Sai."). The /translate endpoint now
 * frames verbs as "pour X" so the pivot reads them as verbs; this refreshes the
 * stored lexeme translation and the Word cache accordingly. Safe to re-run.
 *
 * Needs the local AI service running.
 *
 *   node scripts/retranslate_verbs.mjs [language=fr]
 */
import { PrismaClient } from '@prisma/client';

const AI = process.env.BOOKT_AI_URL || 'http://127.0.0.1:8000';
const language = process.argv[2] || 'fr';
const prisma = new PrismaClient();

async function translateWord(word) {
    const res = await fetch(`${AI}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, language }),
        signal: AbortSignal.timeout(40000),
    });
    if (!res.ok) throw new Error(`/translate ${word} -> ${res.status}`);
    return res.json();
}

const verbs = await prisma.lexeme.findMany({
    where: { language, partOfSpeech: { in: ['VERB', 'AUX'] } },
    select: { id: true, lemma: true, translation: true },
    orderBy: { lemma: 'asc' },
});
console.log(`${verbs.length} verbos em "${language}"`);

let changed = 0;
for (const verb of verbs) {
    let result;
    try {
        result = await translateWord(verb.lemma);
    } catch (err) {
        console.log(`  ! ${verb.lemma}: ${err.message}`);
        continue;
    }
    const translation = (result.lemmaTranslation || result.translation || '').trim();
    if (!translation) continue;
    if (translation === verb.translation) continue;

    await prisma.lexeme.update({
        where: { id: verb.id },
        data: { translation, meanings: JSON.stringify([{ meaning: translation, partOfSpeech: 'verb' }]) },
    });
    // Keep the Word cache consistent so a later lookup doesn't re-serve the junk.
    await prisma.word.upsert({
        where: { word_language: { word: verb.lemma, language } },
        update: { translation, meanings: JSON.stringify([{ meaning: translation, partOfSpeech: 'verb' }]) },
        create: {
            word: verb.lemma, language, translation,
            meanings: JSON.stringify([{ meaning: translation, partOfSpeech: 'verb' }]),
        },
    });
    console.log(`  ${verb.lemma}: ${JSON.stringify(verb.translation)} -> ${JSON.stringify(translation)}`);
    changed += 1;
}

console.log(`\nAtualizados: ${changed}/${verbs.length}`);
await prisma.$disconnect();
