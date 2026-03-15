/**
 * Smart page breaking with chapter detection.
 * Splits extracted PDF text into screen-sized pages,
 * with chapter headings always starting on a new page.
 */

// Chapter heading patterns (multi-language)
const CHAPTER_PATTERNS = [
    /^CHAPITRE\s+\d+/i,       // French
    /^CHAPTER\s+\d+/i,        // English
    /^CAPÍTULO\s+\d+/i,       // Portuguese/Spanish
    /^KAPITEL\s+\d+/i,        // German
    /^CAPITOLO\s+\d+/i,       // Italian
    /^ГЛАВА\s+\d+/i,          // Russian
    /^第\s*\d+\s*章/,          // Chinese/Japanese
    /^PARTIE\s+\d+/i,         // French (Part)
    /^PART\s+\d+/i,           // English (Part)
    /^LIVRE\s+\d+/i,          // French (Book)
    /^BOOK\s+\d+/i,           // English (Book)
];

/**
 * Check if a line looks like a chapter heading.
 */
function isChapterHeading(line) {
    const trimmed = line.trim();
    if (!trimmed) return false;

    // Check known patterns
    for (const pattern of CHAPTER_PATTERNS) {
        if (pattern.test(trimmed)) return true;
    }

    // Heuristic: short ALL-CAPS line (likely a heading)
    if (trimmed.length < 80 && trimmed === trimmed.toUpperCase() && /[A-ZÀ-Ü]/.test(trimmed)) {
        // Must have at least 2 "word" characters to avoid matching stray symbols
        const wordChars = trimmed.replace(/[^A-ZÀ-Üa-zà-ü]/g, '');
        if (wordChars.length >= 3) return true;
    }

    return false;
}

/**
 * Split a block of text into paragraphs.
 */
function splitIntoParagraphs(text) {
    // Split on double newlines or paragraph-like gaps
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

    // If no paragraph breaks, split on single newlines
    if (paragraphs.length <= 1 && text.length > 500) {
        return text.split(/\n/).map(p => p.trim()).filter(Boolean);
    }

    return paragraphs;
}

/**
 * Split extracted PDF text into readable pages.
 * 
 * @param {string} fullText - The complete text from one PDF page
 * @param {number} maxChars - Max characters per reading page (default ~1500)
 * @returns {string[]} - Array of page texts
 */
export function splitIntoReadablePages(fullText, maxChars = 1500) {
    if (!fullText || fullText.trim().length === 0) return [];

    const paragraphs = splitIntoParagraphs(fullText);
    const pages = [];
    let currentPage = '';

    for (const paragraph of paragraphs) {
        const isHeading = isChapterHeading(paragraph);

        // Chapter heading: force new page
        if (isHeading && currentPage.trim()) {
            pages.push(currentPage.trim());
            currentPage = paragraph + '\n\n';
            continue;
        }

        // Would adding this paragraph exceed the limit?
        const potentialLength = currentPage.length + paragraph.length + 2; // +2 for \n\n

        if (potentialLength > maxChars && currentPage.trim()) {
            // Current page is full, start new one
            pages.push(currentPage.trim());
            currentPage = paragraph + '\n\n';
        } else {
            // Add paragraph to current page
            currentPage += paragraph + '\n\n';
        }
    }

    // Don't forget the last page
    if (currentPage.trim()) {
        pages.push(currentPage.trim());
    }

    return pages;
}

/**
 * Process all PDF pages — split each into readable chunks,
 * renumber them sequentially, and detect chapter breaks.
 * 
 * @param {Array<{pageNumber: number, content: string}>} pdfPages - Raw PDF pages
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
