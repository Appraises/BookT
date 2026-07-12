'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { tokenizeText, normalizeWord } from '@/lib/normalizer';
import { detectProperNouns } from '@/lib/properNouns';
import { normalizeSyncText, matchSentenceInTokens, findSubPageForSentence } from '@/lib/audioSync';
import ThemeToggle from '@/components/ThemeToggle';
import WordSpan from '@/components/WordSpan';
import SidePanel from '@/components/SidePanel';
import ChapterModal from '@/components/ChapterModal';
import Flag from '@/components/Flag';

const EMPTY_TOKENS = [];
const EMPTY_SET = new Set();

// Sentence boundary for the no-audio context fallback.
const SENTENCE_SPLIT = /(?<=[.!?…»""])\s+/u;

// Find the sentence a word appears in, preferring an aligned audio sentence
// (which also gives us the narrated clip) and falling back to the page text.
function findWordContext(norm, syncEntries, audioUrl, pageContent) {
    for (const entry of syncEntries) {
        const tokens = tokenizeText(entry.text);
        if (tokens.some((t) => t.isWord && normalizeWord(t.text) === norm)) {
            return { sentence: entry.text, audioUrl: audioUrl || null, start: entry.startTime, end: entry.endTime };
        }
    }
    if (pageContent) {
        for (const raw of pageContent.split(SENTENCE_SPLIT)) {
            const sentence = raw.trim();
            if (!sentence) continue;
            const tokens = tokenizeText(sentence);
            if (tokens.some((t) => t.isWord && normalizeWord(t.text) === norm)) {
                return { sentence, audioUrl: null, start: null, end: null };
            }
        }
    }
    return null;
}

export default function ReaderPage() {
    const router = useRouter();
    const params = useParams();
    const bookId = params.id;

    const [book, setBook] = useState(null);
    const [pageContent, setPageContent] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [loading, setLoading] = useState(true);

    // Word state
    const [selectedWord, setSelectedWord] = useState(null);
    const [selectedContext, setSelectedContext] = useState(null); // { sentence } for the selected word
    const [wordStatuses, setWordStatuses] = useState({});
    const [studyableMap, setStudyableMap] = useState({});
    const [wordTranslations, setWordTranslations] = useState({});
    const [pageWords, setPageWords] = useState([]);
    const [wordStats, setWordStats] = useState({ known: 0, total: 0 });
    const prefetchedRef = useRef(new Set()); // sub-pages already warmed

    // Sentence translation state
    const [selectedSentence, setSelectedSentence] = useState('');
    const [sentenceTranslation, setSentenceTranslation] = useState('');
    const [sentenceLoading, setSentenceLoading] = useState(false);
    const selectionTimeoutRef = useRef(null);

    // Audio sync state
    const [chapters, setChapters] = useState([]);
    const [showChapters, setShowChapters] = useState(false);
    const [syncEntries, setSyncEntries] = useState([]);
    const [activeSyncIdx, setActiveSyncIdx] = useState(-1);
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioTime, setAudioTime] = useState(0);
    const [audioDuration, setAudioDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [playerChapterId, setPlayerChapterId] = useState(null);
    const audioRef = useRef(null);
    const audioUrlRef = useRef(null);
    const resumeAfterSourceSwapRef = useRef(false);

    // Virtual sub-page pagination
    const [virtualPages, setVirtualPages] = useState([]);
    const [subPage, setSubPage] = useState(0);
    const [measureTick, setMeasureTick] = useState(0); // bumped on resize to re-measure
    const contentRef = useRef(null);
    const [pendingRestore, setPendingRestore] = useState(null); // { page, sub } to restore once
    const restoreAudioRef = useRef(null); // { chapterId, time } to restore into the player
    const lastAudioSaveRef = useRef(0);   // throttle for persisting audio position
    const paginatedPageRef = useRef(null); // DB page the current pagination is for

    // Load book details
    useEffect(() => {
        if (!bookId) return;
        const loadBook = async () => {
            try {
                const res = await fetch(`/api/books/${bookId}`);
                const data = await res.json();
                setBook(data);
                setCurrentPage(data.currentPage || 1);

                // Restore saved reading position (sub-page + audio spot).
                try {
                    const savedPos = JSON.parse(localStorage.getItem(`bookt-pos-${bookId}`) || 'null');
                    if (savedPos && savedPos.page === (data.currentPage || 1) && savedPos.sub > 0) {
                        setPendingRestore(savedPos);
                    }
                    const savedAudio = JSON.parse(localStorage.getItem(`bookt-audio-${bookId}`) || 'null');
                    if (savedAudio && savedAudio.time > 0) restoreAudioRef.current = savedAudio;
                } catch { /* ignore malformed storage */ }
            } catch (err) {
                console.error('Failed to load book:', err);
            }
        };
        loadBook();
    }, [bookId]);

    // Load chapters for this book
    useEffect(() => {
        if (!bookId) return;
        fetch(`/api/books/${bookId}/chapters`)
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) setChapters(data);
            })
            .catch(() => { });
    }, [bookId]);

    // Current chapter based on page number
    const currentChapter = useMemo(() => {
        return chapters.find(ch => currentPage >= ch.startPage && currentPage <= ch.endPage);
    }, [chapters, currentPage]);

    // Keep the player source stable while pages change. The visible page can move
    // faster than the audio, so the player chapter is tracked separately.
    const playerChapter = useMemo(() => {
        const selectedChapter = chapters.find(ch => ch.id === playerChapterId && ch.audioUrl);
        return selectedChapter || (currentChapter?.audioUrl ? currentChapter : null);
    }, [chapters, playerChapterId, currentChapter]);

    const audioUrl = playerChapter?.audioUrl || null;
    const anyChapterHasAudio = chapters.some(ch => ch.audioUrl);

    useEffect(() => {
        if (!currentChapter?.audioUrl) return;

        setPlayerChapterId((prevChapterId) => {
            if (prevChapterId === currentChapter.id) return prevChapterId;

            const audio = audioRef.current;
            resumeAfterSourceSwapRef.current = Boolean(audio && !audio.paused && !audio.ended);
            return currentChapter.id;
        });
    }, [currentChapter?.id, currentChapter?.audioUrl]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = playbackRate;
        }
    }, [playbackRate, audioUrl]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        if (!audioUrl) {
            audioUrlRef.current = null;
            setAudioTime(0);
            setAudioDuration(0);
            setActiveSyncIdx(-1);
            setIsPlaying(false);
            return;
        }

        if (audioUrlRef.current === audioUrl) return;

        audioUrlRef.current = audioUrl;
        setAudioTime(0);
        setAudioDuration(0);
        setActiveSyncIdx(-1);
        audio.playbackRate = playbackRate;

        if (!resumeAfterSourceSwapRef.current) return;

        resumeAfterSourceSwapRef.current = false;

        const resumePlayback = () => {
            audio.playbackRate = playbackRate;
            audio.play().catch((err) => {
                console.warn('Could not resume audio after chapter change:', err);
                setIsPlaying(false);
            });
        };

        if (audio.readyState >= 2) {
            resumePlayback();
            return;
        }

        audio.addEventListener('canplay', resumePlayback, { once: true });
        return () => audio.removeEventListener('canplay', resumePlayback);
    }, [audioUrl, playbackRate]);

    // Load sync entries when page changes
    useEffect(() => {
        if (!bookId || !anyChapterHasAudio || !currentPage) return;
        fetch(`/api/books/${bookId}/sync?page=${currentPage}`)
            .then(r => r.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setSyncEntries(data);
                    console.log(`[AudioSync] Loaded ${data.length} sync entries for page ${currentPage}`);
                }
            })
            .catch(() => { });
    }, [bookId, anyChapterHasAudio, currentPage]);

    // Load user vocabulary for this book's language
    useEffect(() => {
        if (!book?.language) return;
        const loadVocab = async () => {
            try {
                const res = await fetch(`/api/vocabulary?language=${encodeURIComponent(book.language)}`);
                const data = await res.json();
                const statuses = {};
                const studyable = {};
                data.forEach((w) => {
                    statuses[w.word] = w.status ?? 1;
                    studyable[w.word] = w.isStudyable !== false;
                });
                setWordStatuses(statuses);
                setStudyableMap(studyable);
            } catch (err) {
                console.error('Failed to load vocabulary:', err);
            }
        };
        loadVocab();
    }, [book?.language]);

    // Load global word stats
    const refreshStats = useCallback(async () => {
        if (!book) return;
        try {
            const res = await fetch(`/api/vocabulary/stats?language=${book.language}`);
            const data = await res.json();
            setWordStats({ known: data.known || 0, total: data.total || 0 });
        } catch (err) {
            console.error('Failed to load stats:', err);
        }
    }, [book]);

    useEffect(() => {
        refreshStats();
    }, [refreshStats]);

    // Load page content
    useEffect(() => {
        if (!bookId || !currentPage) return;
        const loadPage = async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/books/${bookId}/pages/${currentPage}`);
                const data = await res.json();
                setPageContent(data.content || '');
            } catch (err) {
                console.error('Failed to load page:', err);
                setPageContent('');
            } finally {
                setLoading(false);
            }
        };
        loadPage();
    }, [bookId, currentPage]);

    // Tokenize text once per page
    const allTokens = useMemo(() => tokenizeText(pageContent), [pageContent]);

    // Dynamic pagination: split tokens into screen-fitting virtual pages
    useEffect(() => {
        if (!allTokens.length || !contentRef.current) {
            setVirtualPages([allTokens]);
            setSubPage(0);
            return;
        }

        // Measure available height for text. Use the fixed-height reader-main
        // (the parent), not reader-content — the content box grows with its own
        // text, which would make the measurement circular.
        const container = contentRef.current;
        const containerHeight = container.parentElement?.clientHeight ?? container.clientHeight;
        const paddingHeight = 54; // reader-content vertical padding + slack
        const navHeight = 65;     // page nav bar
        const dockHeight = anyChapterHasAudio ? 100 : 0; // floating audio dock
        const available = containerHeight - paddingHeight - navHeight - dockHeight;

        // Calculate chars that fit — estimate line capacity from the real
        // column width (~10.5px average char at 19px Newsreader, safe side)
        const style = getComputedStyle(container);
        const textWidth = container.clientWidth
            - parseFloat(style.paddingLeft || '0')
            - parseFloat(style.paddingRight || '0');
        const lineHeight = 38; // 19px font * 2.0 line-height
        const charsPerLine = Math.max(30, Math.floor(textWidth / 10.5));
        const maxLines = Math.max(5, Math.floor(available / lineHeight));
        const maxChars = maxLines * charsPerLine;

        // Split tokens into virtual pages
        const pages = [];
        let currentTokens = [];
        let currentChars = 0;

        for (const token of allTokens) {
            const tokenLen = token.text.length;

            if (currentChars + tokenLen > maxChars && currentTokens.length > 0) {
                pages.push(currentTokens);
                currentTokens = [];
                currentChars = 0;
            }

            currentTokens.push(token);
            currentChars += tokenLen;
        }

        if (currentTokens.length > 0) {
            pages.push(currentTokens);
        }

        const finalPages = pages.length > 0 ? pages : [[]];
        setVirtualPages(finalPages);

        // Re-paginating the SAME page (audio loaded, window resized) keeps the
        // reader's spot; a NEW page starts at the top. A saved position, when
        // present, is applied by the restore effect below.
        const lastIdx = finalPages.length - 1;
        if (paginatedPageRef.current === currentPage) {
            setSubPage(s => Math.min(s, lastIdx));
        } else {
            paginatedPageRef.current = currentPage;
            setSubPage(0);
        }
        // currentPage is read fresh from the closure when content (allTokens) changes;
        // adding it as a dep would run this against stale tokens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allTokens, anyChapterHasAudio, measureTick]);

    // Apply a saved sub-page once the correct page is fully paginated — i.e. the
    // target sub-page actually exists (guards against the transient 1-page state).
    useEffect(() => {
        if (!pendingRestore) return;
        if (pendingRestore.page !== currentPage || virtualPages.length <= pendingRestore.sub) return;
        setSubPage(pendingRestore.sub);
        setPendingRestore(null);
    }, [pendingRestore, currentPage, virtualPages]);

    // Recalculate pagination on window resize (debounced)
    useEffect(() => {
        let timeout;
        const handleResize = () => {
            clearTimeout(timeout);
            timeout = setTimeout(() => setMeasureTick(t => t + 1), 200);
        };
        window.addEventListener('resize', handleResize);
        return () => {
            clearTimeout(timeout);
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    // Persist reading position so reopening the book returns to the same spot.
    // Only save once the current page is actually paginated AND any pending
    // restore has been applied — otherwise the transient load state (sub 0)
    // would overwrite the saved position before it can be read/restored.
    useEffect(() => {
        if (!bookId || !book || pendingRestore) return;
        if (paginatedPageRef.current !== currentPage) return;
        localStorage.setItem(`bookt-pos-${bookId}`, JSON.stringify({ page: currentPage, sub: subPage }));
    }, [bookId, book, currentPage, subPage, pendingRestore]);

    // Build page word list
    useEffect(() => {
        if (!allTokens.length) return;
        const seen = new Set();
        const words = [];
        allTokens.forEach((t) => {
            if (!t.isWord) return;
            const norm = normalizeWord(t.text);
            if (!norm || seen.has(norm)) return;
            seen.add(norm);
            const status = wordStatuses[norm] || 0;
            const lookup = wordTranslations[norm] || {};
            words.push({
                word: norm,
                display: t.text,
                status,
                translation: lookup.translation || '',
                meanings: lookup.meanings || [],
                ipa: lookup.ipa || '',
                lemma: lookup.lemma || '',
                partOfSpeech: lookup.partOfSpeech || '',
                morphology: lookup.morphology || '',
                caseExplanation: lookup.caseExplanation || null,
                alternatives: lookup.alternatives || [],
                contextTranslation: lookup.contextTranslation || '',
                contextSentence: lookup.contextSentence || '',
                contextAnalyzed: lookup.contextAnalyzed || false,
                lookupLoading: lookup.lookupLoading || false,
                isStudyable: studyableMap[norm] !== false,
            });
        });
        setPageWords(words);
    }, [allTokens, wordStatuses, wordTranslations, studyableMap]);

    // Prefetch translations for the visible sub-page so clicking a word is
    // instant. Best-effort, deduped per sub-page.
    useEffect(() => {
        if (!book) return;
        const tokens = virtualPages[subPage] || [];
        if (tokens.length === 0) return; // page not paginated yet — wait
        const key = `${currentPage}-${subPage}`;
        if (prefetchedRef.current.has(key)) return;
        prefetchedRef.current.add(key);

        const words = [...new Set(
            tokens.filter(t => t.isWord).map(t => normalizeWord(t.text)).filter(Boolean)
        )].filter(w => !wordTranslations[w]);
        if (words.length === 0) return;

        fetch('/api/words/lookup/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words, language: book.language, cacheOnly: false }),
        })
            .then(res => res.ok ? res.json() : { translations: {} })
            .then(({ translations }) => {
                if (translations && Object.keys(translations).length) {
                    setWordTranslations(prev => ({ ...translations, ...prev }));
                }
            })
            .catch(() => { /* prefetch is best-effort */ });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, subPage, virtualPages, book]);

    // Mark unseen page words as NEW (status 1)
    useEffect(() => {
        if (!allTokens.length || !book) return;
        const newWords = [];
        allTokens.forEach((t) => {
            if (!t.isWord) return;
            const norm = normalizeWord(t.text);
            if (norm && !(norm in wordStatuses)) {
                newWords.push(norm);
            }
        });
        if (newWords.length === 0) return;

        setWordStatuses((prev) => {
            const updated = { ...prev };
            newWords.forEach((w) => { if (!(w in updated)) updated[w] = 1; });
            return updated;
        });

        const uniqueNewWords = [...new Set(newWords)];
        // Flag names so they don't become flashcards (capitalization heuristic
        // over the original-case page text).
        const properNouns = [...detectProperNouns(pageContent, book.language)];
        fetch('/api/vocabulary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words: uniqueNewWords, language: book.language, bookId: book.id, properNouns }),
        }).catch((err) => console.error('Failed to mark words:', err));
    }, [allTokens, book, wordStatuses, pageContent]);

    // Handle word click
    const handleWordClick = useCallback(async (word) => {
        const norm = normalizeWord(word);
        if (!norm || !book) return;
        setSelectedWord(norm);

        // Capture the sentence (and audio clip) this word was studied in, so
        // flashcards can show it in context. Fire and forget.
        const ctx = findWordContext(norm, syncEntries, audioUrl, pageContent);
        const contextSentence = ctx?.sentence || '';
        setSelectedContext(ctx ? { sentence: ctx.sentence, word: norm } : null);
        if (ctx) {
            fetch('/api/vocabulary/context', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word: norm, language: book.language, ...ctx }),
            }).catch(() => { });
        }

        if (
            wordTranslations[norm]?.contextAnalyzed &&
            wordTranslations[norm]?.contextSentence === contextSentence
        ) return;

        setWordTranslations((prev) => ({
            ...prev,
            [norm]: {
                ...(prev[norm] || {}),
                lookupLoading: true,
                contextSentence,
            },
        }));

        try {
            const res = await fetch('/api/words/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word: norm, language: book.language, context: contextSentence }),
            });
            if (!res.ok) throw new Error(`Word lookup returned ${res.status}`);
            const data = await res.json();
            setWordTranslations((prev) => ({
                ...prev,
                [norm]: {
                    ...(prev[norm] || {}),
                    translation: data.translation || '',
                    meanings: data.meanings || [],
                    ipa: data.ipa || '',
                    lemma: data.lemma || norm,
                    partOfSpeech: data.partOfSpeech || '',
                    morphology: data.morphology || '',
                    caseExplanation: data.caseExplanation || null,
                    alternatives: data.alternatives || [],
                    contextTranslation: data.contextTranslation || '',
                    contextSentence,
                    contextAnalyzed: true,
                    lookupLoading: false,
                },
            }));
        } catch (err) {
            console.error('Word lookup failed:', err);
            setWordTranslations((prev) => ({
                ...prev,
                [norm]: { ...(prev[norm] || {}), lookupLoading: false },
            }));
        }
    }, [book, wordTranslations, syncEntries, audioUrl, pageContent]);

    // Handle status change
    const handleStatusChange = async (word, newStatus) => {
        setWordStatuses((prev) => ({ ...prev, [word]: newStatus }));
        try {
            await fetch(`/api/vocabulary/${encodeURIComponent(word)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus, language: book.language, bookId: book.id }),
            });
            refreshStats();
        } catch (err) {
            console.error('Failed to update status:', err);
        }
    };

    // Record passive exposure for New words on the sub-page just read.
    const registerExposure = () => {
        const currentTokens = virtualPages[subPage] || [];
        const subPageWords = new Set();
        currentTokens.forEach(t => {
            if (t.isWord) {
                const norm = normalizeWord(t.text);
                if (norm) subPageWords.add(norm);
            }
        });

        // Exposure helps prioritization but never changes demonstrated knowledge.
        const seen = [...subPageWords].filter(w => (wordStatuses[w] || 0) === 1);
        if (seen.length === 0) return;

        fetch('/api/vocabulary/expose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words: seen, language: book.language }),
        })
            .then(res => res.ok ? res.json() : { promoted: [] })
            .then(({ promoted }) => {
                if (promoted?.length) {
                    setWordStatuses(prev => {
                        const updated = { ...prev };
                        promoted.forEach(w => { updated[w] = 2; });
                        return updated;
                    });
                    refreshStats();
                }
            })
            .catch(() => { /* exposure is best-effort */ });
    };

    // Text Selection for Sentence Translation
    useEffect(() => {
        const handleSelectionChange = () => {
            if (selectionTimeoutRef.current) clearTimeout(selectionTimeoutRef.current);

            selectionTimeoutRef.current = setTimeout(async () => {
                const selection = window.getSelection();
                const text = selection.toString().trim();

                // Only translate if selection is inside .reader-text and has multiple characters
                if (!text || text.length < 3) {
                    if (!text) {
                        setSelectedSentence('');
                        setSentenceTranslation('');
                    }
                    return;
                }

                const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
                if (!range) return;

                // Check if selection is within the reader-text
                let node = range.commonAncestorContainer;
                let isInsideReader = false;
                while (node) {
                    if (node.nodeType === 1 && node.classList && node.classList.contains('reader-text')) {
                        isInsideReader = true;
                        break;
                    }
                    node = node.parentNode;
                }

                if (!isInsideReader) return;

                // Valid selection
                setSelectedSentence(text);
                setSelectedWord(null); // Clear single word selection
                setSentenceLoading(true);
                setSentenceTranslation('');

                try {
                    const res = await fetch('/api/translate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text, language: book?.language }),
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setSentenceTranslation(data.translation);
                    } else {
                        setSentenceTranslation('Failed to translate.');
                    }
                } catch (err) {
                    console.error('Sentence translation error:', err);
                    setSentenceTranslation('Error connecting to translation service.');
                } finally {
                    setSentenceLoading(false);
                }
            }, 600); // 600ms debounce
        };

        document.addEventListener('selectionchange', handleSelectionChange);
        return () => {
            document.removeEventListener('selectionchange', handleSelectionChange);
            if (selectionTimeoutRef.current) clearTimeout(selectionTimeoutRef.current);
        };
    }, [book]);

    // Navigation: handles sub-pages first, then moves to next/prev DB page
    const goNext = () => {
        if (!book) return;

        // Record exposure in the background so page navigation stays instant.
        registerExposure();

        if (subPage + 1 < virtualPages.length) {
            // Next sub-page within current DB page
            setSubPage(prev => prev + 1);
            setSelectedWord(null);
        } else if (currentPage < book.totalPages) {
            // Move to next DB page
            const nextPage = currentPage + 1;
            setCurrentPage(nextPage);
            setSubPage(0);
            setSelectedWord(null);
            refreshStats();
            fetch(`/api/books/${bookId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPage: nextPage }),
            }).catch(() => { });
        }
    };

    const goPrev = () => {
        if (subPage > 0) {
            setSubPage(prev => prev - 1);
            setSelectedWord(null);
        } else if (currentPage > 1) {
            setCurrentPage(prev => prev - 1);
            setSubPage(999);
            setSelectedWord(null);
            fetch(`/api/books/${bookId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPage: currentPage - 1 }),
            }).catch(() => { });
        }
    };

    // Clamp subPage when going to previous page (subPage=999 trick)
    useEffect(() => {
        if (subPage >= virtualPages.length && virtualPages.length > 0) {
            setSubPage(virtualPages.length - 1);
        }
    }, [virtualPages, subPage]);

    // Audio cross-page follow: when the narration plays past the current page's
    // sentences into the next page of the same chapter, turn the DB page so the
    // highlight keeps up. Guarded so it never acts on stale (still-loading) sync.
    useEffect(() => {
        if (!isPlaying || !playerChapter || syncEntries.length === 0) return;
        if (syncEntries[0].pageNumber !== currentPage) return; // entries not for this page yet

        let maxEnd = -Infinity;
        let minStart = Infinity;
        for (const s of syncEntries) {
            if (s.endTime > maxEnd) maxEnd = s.endTime;
            if (s.startTime < minStart) minStart = s.startTime;
        }

        let target = null;
        if (audioTime > maxEnd + 0.3 && currentPage < playerChapter.endPage) target = currentPage + 1;
        else if (audioTime < minStart - 0.3 && currentPage > playerChapter.startPage) target = currentPage - 1;
        if (target == null) return;

        setCurrentPage(target);
        setSubPage(0);
        setSelectedWord(null);
        fetch(`/api/books/${bookId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPage: target }),
        }).catch(() => { });
    }, [audioTime, isPlaying, playerChapter, syncEntries, currentPage, bookId]);

    // Keyboard navigation
    useEffect(() => {
        const handleKey = (e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
            else if (e.key === 'Escape') { setSelectedWord(null); setSelectedContext(null); }
            // Grade the selected word without leaving the text (1-4, or 0 to ignore).
            else if (selectedWord && ['0', '1', '2', '3', '4'].includes(e.key)) {
                e.preventDefault();
                handleStatusChange(selectedWord, parseInt(e.key, 10));
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    });

    // Current tokens to display (stable empty array so memos don't churn)
    const currentTokens = virtualPages[subPage] || EMPTY_TOKENS;
    const totalVirtualPages = virtualPages.length;

    // Words of the sentence currently playing (normalized). Recomputed only
    // when the active sync entry changes, not on every audio timeupdate.
    const activeSyncWords = useMemo(() => {
        const entry = activeSyncIdx >= 0 ? syncEntries[activeSyncIdx] : null;
        if (!entry) return null;
        const words = normalizeSyncText(entry.text).split(/\s+/).filter(Boolean);
        return words.length ? words : null;
    }, [activeSyncIdx, syncEntries]);

    // Which token indices on the visible sub-page belong to the playing sentence.
    const highlightedTokens = useMemo(() => {
        if (!activeSyncWords) return EMPTY_SET;
        return matchSentenceInTokens(activeSyncWords, currentTokens).set;
    }, [activeSyncWords, currentTokens]);

    // Follow-along: when the playing sentence isn't on the visible sub-page,
    // turn to the sub-page that contains it so the highlight stays in view.
    // Only while playing, so manual navigation isn't fought when paused.
    useEffect(() => {
        if (!isPlaying || !activeSyncWords) return;
        const target = findSubPageForSentence(activeSyncWords, virtualPages, subPage);
        if (target >= 0) {
            setSubPage(target);
            setSelectedWord(null);
        }
    }, [activeSyncWords, isPlaying, virtualPages, subPage]);

    // Progress
    const progress = book
        ? Math.round(((currentPage - 1 + (subPage + 1) / totalVirtualPages) / book.totalPages) * 100)
        : 0;

    // Token coverage of the visible page. Repeated words count because this
    // represents how much text can actually be read without interruption.
    const coverageTokens = virtualPages[subPage]?.filter((token) => token.isWord) || [];
    const pageCoverage = coverageTokens.length
        ? Math.round((coverageTokens.filter((token) => {
            const status = wordStatuses[normalizeWord(token.text)] || 0;
            return status >= 2;
        }).length / coverageTokens.length) * 100)
        : null;

    const isFirstPage = currentPage === 1 && subPage === 0;
    const isLastPage = currentPage >= (book?.totalPages || 1) && subPage >= totalVirtualPages - 1;

    return (
        <>
            <nav className="navbar">
                <Link href="/" className="navbar-brand">
                    <span className="navbar-brand-text">BookT</span>
                </Link>
                {book && (
                    <div className="reader-navbar-book">
                        <span className="reader-navbar-title">{book.title}</span>
                        <span className="reader-navbar-page">
                            Page {currentPage}{totalVirtualPages > 1 ? `.${subPage + 1}` : ''} of {book.totalPages}
                            {pageCoverage != null && <> · {pageCoverage}% known</>}
                        </span>
                    </div>
                )}
                <div className="navbar-actions">
                    {book && (
                        <div className="nav-chip nav-chip-static" title={`${wordStats.total} lemmas seen in this language`}>
                            <Flag code={book.language} />
                            <span className="nav-chip-num">{wordStats.total}</span>
                        </div>
                    )}
                    <button
                        className="nav-chip"
                        onClick={() => setShowChapters(true)}
                        title="Manage chapters & audio"
                    >
                        <svg className="nav-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                        </svg>
                    </button>
                    <ThemeToggle />
                </div>
            </nav>

            <div className="reader-container">
                <div className="reader-main">
                    <div className="reader-progress-wrapper">
                        <div className="reader-progress-bar">
                            <div className="reader-progress-fill" style={{ width: `${progress}%` }} />
                        </div>
                    </div>

                    <div className="reader-content" ref={contentRef}>
                        {loading ? (
                            <div className="loading-overlay">
                                <div className="spinner" />
                            </div>
                        ) : (
                            <>
                                <div className="reader-text">
                                    {currentTokens.map((token, i) =>
                                        token.isWord ? (
                                            <WordSpan
                                                key={`${currentPage}-${subPage}-${i}`}
                                                text={token.text}
                                                status={wordStatuses[normalizeWord(token.text)] || 0}
                                                isActive={selectedWord === normalizeWord(token.text)}
                                                isAudioHighlighted={highlightedTokens.has(i)}
                                                onClick={() => handleWordClick(token.text)}
                                            />
                                        ) : (
                                            <span key={`${currentPage}-${subPage}-${i}`}>{token.text}</span>
                                        )
                                    )}
                                </div>

                                <div className="reader-nav">
                                    <button
                                        className="btn btn-secondary"
                                        onClick={goPrev}
                                        disabled={isFirstPage}
                                    >
                                        ← Previous
                                    </button>
                                    <span className="reader-nav-info">
                                        {currentPage}{totalVirtualPages > 1 ? `.${subPage + 1}` : ''} / {book?.totalPages} · {progress}%
                                    </span>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={goNext}
                                        disabled={isLastPage}
                                    >
                                        Next →
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                <SidePanel
                    pageWords={pageWords}
                    selectedWord={selectedWord}
                    selectedContext={selectedContext}
                    selectedSentence={selectedSentence}
                    sentenceTranslation={sentenceTranslation}
                    sentenceLoading={sentenceLoading}
                    language={book?.language}
                    onWordClick={handleWordClick}
                    onStatusChange={handleStatusChange}
                    onDeselect={() => { setSelectedWord(null); setSelectedContext(null); }}
                />
            </div>

            {/* Audio Player Bar */}
            {anyChapterHasAudio && (
                <div className="audio-player-bar">
                    <audio
                        ref={audioRef}
                        src={audioUrl || undefined}
                        preload="metadata"
                        onTimeUpdate={() => {
                            if (!audioRef.current) return;
                            const t = audioRef.current.currentTime;
                            setAudioTime(t);
                            const idx = syncEntries.findIndex(s => t >= s.startTime && t < s.endTime);
                            setActiveSyncIdx(idx);
                            // Persist audio spot (throttled to ~1/sec).
                            if (playerChapter && Math.abs(t - (lastAudioSaveRef.current || 0)) > 1) {
                                lastAudioSaveRef.current = t;
                                localStorage.setItem(`bookt-audio-${bookId}`, JSON.stringify({ chapterId: playerChapter.id, time: t }));
                            }
                        }}
                        onLoadedMetadata={() => {
                            if (!audioRef.current) return;
                            audioRef.current.playbackRate = playbackRate;
                            setAudioDuration(audioRef.current.duration);
                            // Restore a saved audio spot for this chapter, once.
                            const saved = restoreAudioRef.current;
                            if (saved && playerChapter && saved.chapterId === playerChapter.id) {
                                restoreAudioRef.current = null;
                                if (saved.time < audioRef.current.duration) audioRef.current.currentTime = saved.time;
                            }
                        }}
                        onPlay={() => setIsPlaying(true)}
                        onPause={() => setIsPlaying(false)}
                        onEnded={() => setIsPlaying(false)}
                    />

                    {/* Play / Pause button */}
                    <button
                        className="audio-btn-play"
                        onClick={() => {
                            if (!audioRef.current || !audioUrl) return;
                            const audio = audioRef.current;
                            if (!audio.paused) {
                                audio.pause();
                            } else {
                                audio.play().catch((err) => {
                                    console.warn('Could not play audio:', err);
                                    setIsPlaying(false);
                                });
                            }
                        }}
                        disabled={!audioUrl}
                        title={audioUrl ? (isPlaying ? 'Pause' : 'Play') : 'No audio for this chapter'}
                    >
                        {isPlaying ? '⏸' : '▶'}
                    </button>

                    {/* Skip back 5s */}
                    <button
                        className="audio-btn-skip"
                        onClick={() => {
                            if (audioRef.current) {
                                audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
                            }
                        }}
                        disabled={!audioUrl}
                        title="Back 5s"
                    >
                        ⟲5
                    </button>

                    {/* Skip forward 5s */}
                    <button
                        className="audio-btn-skip"
                        onClick={() => {
                            if (audioRef.current) {
                                audioRef.current.currentTime = Math.min(audioDuration, audioRef.current.currentTime + 5);
                            }
                        }}
                        disabled={!audioUrl}
                        title="Forward 5s"
                    >
                        5⟳
                    </button>

                    {/* Current time */}
                    <span className="audio-time-left">{formatTime(audioTime)}</span>

                    {/* Seek bar */}
                    <div className="audio-seek-wrapper">
                        <input
                            type="range"
                            className="audio-seek"
                            min={0}
                            max={audioDuration || 0}
                            step={0.1}
                            value={audioTime}
                            onChange={(e) => {
                                const t = parseFloat(e.target.value);
                                if (audioRef.current) audioRef.current.currentTime = t;
                                setAudioTime(t);
                            }}
                        />
                    </div>

                    {/* Duration */}
                    <span className="audio-time-right">{formatTime(audioDuration)}</span>

                    {/* Speed toggle */}
                    <button
                        className="audio-btn-speed"
                        onClick={() => {
                            const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];
                            const idx = rates.indexOf(playbackRate);
                            const next = rates[(idx + 1) % rates.length];
                            setPlaybackRate(next);
                            if (audioRef.current) audioRef.current.playbackRate = next;
                        }}
                        title="Change speed"
                    >
                        {playbackRate}×
                    </button>

                    {/* Chapter info */}
                    {playerChapter && (
                        <span className="audio-chapter-label" title={playerChapter.title}>
                            Ch.{playerChapter.number}
                        </span>
                    )}
                </div>
            )}

            <ChapterModal
                open={showChapters}
                onClose={() => setShowChapters(false)}
                bookId={bookId}
                chapters={chapters}
                onChapterUpdate={(chapterId, audioUrl, status) => {
                    setChapters(prev => prev.map(ch =>
                        ch.id === chapterId ? { ...ch, audioUrl } : ch
                    ));
                }}
            />
        </>
    );
}

function formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
