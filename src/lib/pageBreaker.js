/**
 * Smart page breaking with chapter detection.
 * Splits extracted PDF/EPUB text into screen-sized pages,
 * with chapter headings always starting on a new page.
 */

// Chapter headings: word + arabic or roman numeral ("CHAPTER 4", "Rozdział I")
const ROMAN = '[IVXLCDM]+';
const CHAPTER_PATTERNS = [
    new RegExp(`^(CHAPTER|CHAPITRE|CAP[ÍI]TULO|KAPITEL|CAPITOLO|ROZDZIA[ŁL]|HOOFDSTUK|ГЛАВА)[\\s.:]+(\\d+|${ROMAN})\\b`, 'iu'),
    new RegExp(`^(PART|PARTIE|PARTE|CZ[ĘE][ŚS][ĆC]|TEIL|ЧАСТЬ)[\\s.:]+(\\d+|${ROMAN})\\b`, 'iu'),
    new RegExp(`^(BOOK|LIVRE|LIBRO|LIVRO|BUCH|KSI[ĘE]GA|КНИГА)[\\s.:]+(\\d+|${ROMAN})\\b`, 'iu'),
    /^第\s*\d+\s*章/, // Chinese/Japanese
];

/**
 * Check if a line looks like a chapter heading.
 */
function isChapterHeading(line) {
    const trimmed = line.trim();
    if (!trimmed) return false;

    for (const pattern of CHAPTER_PATTERNS) {
        if (pattern.test(trimmed)) return true;
    }

    // Heuristic: short ALL-CAPS line (likely a heading)
    if (trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-ZÀ-Ü]/.test(trimmed)) {
        // Skip identifier-like lines (ISBN, serial numbers, years…)
        if (/\d{3,}/.test(trimmed)) return false;
        // Must have at least 3 letters to avoid matching stray symbols
        const wordChars = trimmed.replace(/[^A-ZÀ-Üa-zà-ü]/g, '');
        if (wordChars.length >= 3) return true;
    }

    return false;
}

// A localized "Chapter N" / "Chapitre IV" heading at the very start of a section.
const CHAPTER_NUMBER_HEAD = new RegExp(
    `^\\s*(?:CHAP(?:TER|ITRE)|CAP[ÍI]TULO|KAPITEL|CAPITOLO|ROZDZIA[ŁL]|HOOFDSTUK|ГЛАВА)[\\s.:]*(?:\\d+|${ROMAN})\\b`,
    'iu'
);
// A bare leading chapter number + capitalized title ("1 Hibou express").
const BARE_NUMBER_HEAD = /^\s*\d{1,3}[\s.):]+\p{Lu}/u;
// Front-/back-matter giveaways: legal pages, contents, author bio.
const MATTER_KEYWORDS = /(tous droits réservés|all rights reserved|dépôt légal|achevé d'imprimer|copyright|©|\bisbn\b|table des matières|table of contents|\bsommaire\b|about the author|about the publisher|l['’]auteur\b)/i;

/**
 * Classify an EPUB spine section as a real chapter or as front/back matter
 * (cover, dedication, copyright, table of contents, author bio…).
 *
 * EPUB spines list front matter as their own sections, so numbering every
 * section as "Chapter N" pushes the real chapters up by however many
 * front-matter sections precede them — which silently misaligns per-chapter
 * audio. Only sections classified as 'chapter' get a chapter number.
 *
 * @param {string} text - the section's plain text
 * @param {number} index - its position in the spine (0-based)
 * @param {number} total - number of spine sections
 * @returns {'chapter' | 'matter'}
 */
export function classifyEpubSection(text, index, total) {
    const trimmed = (text || '').trim();
    if (!trimmed) return 'matter';

    // A clear chapter heading always wins, even if the section is short.
    if (CHAPTER_NUMBER_HEAD.test(trimmed) || BARE_NUMBER_HEAD.test(trimmed)) return 'chapter';

    if (MATTER_KEYWORDS.test(trimmed)) return 'matter';

    // Cover/dedication/half-title pages are short and cluster at the very ends
    // of the spine. Real chapters are long, so a short edge section is matter.
    const nearEdge = index < 4 || index >= total - 3;
    if (nearEdge && trimmed.length < 350) return 'matter';

    return 'chapter';
}

/**
 * Split a block of text into paragraphs.
 */
function splitIntoParagraphs(text) {
    // Split on double newlines or paragraph-like gaps
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

    // If no paragraph breaks, split on single newlines
    if (paragraphs.length <= 1 && text.length > 500) {
        const byLine = text.split(/\n/).map(p => p.trim()).filter(Boolean);
        if (byLine.length > 1) return byLine;
    }

    return paragraphs;
}

/**
 * Break an oversized paragraph into chunks of at most maxChars,
 * cutting on sentence boundaries (falling back to word boundaries).
 * Extraction collapses whitespace, so a whole EPUB chapter often
 * arrives as one giant "paragraph" — without this it would become
 * a single enormous page.
 */
function splitLongParagraph(paragraph, maxChars) {
    if (paragraph.length <= maxChars) return [paragraph];

    const sentences = paragraph.split(/(?<=[.!?…»”"])\s+/u);
    const chunks = [];
    let current = '';

    for (let sentence of sentences) {
        // A single sentence longer than a page: hard-split on word boundaries
        while (sentence.length > maxChars) {
            let cut = sentence.lastIndexOf(' ', maxChars);
            if (cut <= 0) cut = maxChars;
            if (current) {
                chunks.push(current);
                current = '';
            }
            chunks.push(sentence.slice(0, cut).trim());
            sentence = sentence.slice(cut).trim();
        }
        if (!sentence) continue;

        if (current && current.length + sentence.length + 1 > maxChars) {
            chunks.push(current);
            current = sentence;
        } else {
            current = current ? `${current} ${sentence}` : sentence;
        }
    }

    if (current) chunks.push(current);
    return chunks;
}

/**
 * Split extracted text into readable pages.
 *
 * @param {string} fullText - The complete text from one source page/chapter
 * @param {number} maxChars - Max characters per reading page
 * @returns {string[]} - Array of page texts
 */
export function splitIntoReadablePages(fullText, maxChars = 1500) {
    if (!fullText || fullText.trim().length === 0) return [];

    const paragraphs = splitIntoParagraphs(fullText);
    const pages = [];
    let currentPage = '';

    const pushCurrent = () => {
        if (currentPage.trim()) pages.push(currentPage.trim());
        currentPage = '';
    };

    for (const paragraph of paragraphs) {
        const isHeading = isChapterHeading(paragraph);

        // Chapter heading: force new page
        if (isHeading && currentPage.trim()) {
            pushCurrent();
            currentPage = paragraph + '\n\n';
            continue;
        }

        for (const piece of splitLongParagraph(paragraph, maxChars)) {
            const potentialLength = currentPage.length + piece.length + 2; // +2 for \n\n

            if (potentialLength > maxChars && currentPage.trim()) {
                pushCurrent();
            }
            currentPage += piece + '\n\n';
        }
    }

    pushCurrent();
    return pages;
}

/**
 * Process all source pages — split each into readable chunks,
 * renumber them sequentially, and detect chapter breaks.
 *
 * @param {Array<{pageNumber: number, content: string}>} pdfPages - Raw source pages
 * @param {number} maxChars - Max chars per reading page
 * @returns {{pages: Array<{pageNumber: number, content: string}>, chapters: Array<{number: number, title: string, startPage: number, endPage: number}>}}
 */
export function processPages(pdfPages, maxChars = 1500) {
    const readingPages = [];
    const chapters = [];
    let pageNum = 1;
    let currentChapter = null;
    let chapterNum = 0;

    for (const pdfPage of pdfPages) {
        const chunks = splitIntoReadablePages(pdfPage.content, maxChars);

        for (const chunk of chunks) {
            // Check if this chunk starts with a chapter heading
            const firstLine = chunk.split('\n')[0].trim();
            if (isChapterHeading(firstLine)) {
                // Close previous chapter
                if (currentChapter) {
                    currentChapter.endPage = pageNum - 1;
                    chapters.push(currentChapter);
                }
                chapterNum++;
                currentChapter = {
                    number: chapterNum,
                    title: firstLine,
                    startPage: pageNum,
                    endPage: pageNum, // will be updated
                };
            }

            readingPages.push({
                pageNumber: pageNum++,
                content: chunk,
            });
        }
    }

    // Close the last chapter
    if (currentChapter) {
        currentChapter.endPage = pageNum - 1;
        chapters.push(currentChapter);
    }

    // If no chapters detected, create one default chapter
    if (chapters.length === 0 && readingPages.length > 0) {
        chapters.push({
            number: 1,
            title: 'Full Book',
            startPage: 1,
            endPage: readingPages.length,
        });
    }

    return { pages: readingPages, chapters };
}

export { isChapterHeading };
