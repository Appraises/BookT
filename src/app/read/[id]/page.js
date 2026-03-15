'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { tokenizeText, normalizeWord } from '@/lib/normalizer';
import ThemeToggle from '@/components/ThemeToggle';
import WordSpan from '@/components/WordSpan';
import SidePanel from '@/components/SidePanel';
import ChapterModal from '@/components/ChapterModal';

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
    const [wordStatuses, setWordStatuses] = useState({});
    const [wordTranslations, setWordTranslations] = useState({});
    const [pageWords, setPageWords] = useState([]);
    const [wordStats, setWordStats] = useState({ known: 0, total: 0 });

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
    const audioRef = useRef(null);

    // Virtual sub-page pagination
    const [virtualPages, setVirtualPages] = useState([]);
    const [subPage, setSubPage] = useState(0);
    const contentRef = useRef(null);

    // Load book details
    useEffect(() => {
        if (!bookId) return;
        const loadBook = async () => {
            try {
                const res = await fetch(`/api/books/${bookId}`);
                const data = await res.json();
                setBook(data);
                setCurrentPage(data.currentPage || 1);
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

    // Audio URL from current chapter
    const audioUrl = currentChapter?.audioUrl || null;
    const anyChapterHasAudio = chapters.some(ch => ch.audioUrl);

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

    // Load user vocabulary
    useEffect(() => {
        const loadVocab = async () => {
            try {
                const res = await fetch('/api/vocabulary');
                const data = await res.json();
                const statuses = {};
                data.forEach((w) => {
                    const numStatus = w.status === 'KNOWN' ? 4 : parseInt(w.status) || 1;
                    statuses[w.word] = numStatus;
                });
                setWordStatuses(statuses);
            } catch (err) {
                console.error('Failed to load vocabulary:', err);
            }
        };
        loadVocab();
    }, []);

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

    // Tokenize text
    const allTokens = tokenizeText(pageContent);

    // Dynamic pagination: split tokens into screen-fitting virtual pages
    useEffect(() => {
        if (!allTokens.length || !contentRef.current) {
            setVirtualPages([allTokens]);
            setSubPage(0);
            return;
        }

        // Measure available height for text
        const container = contentRef.current;
        const containerHeight = container.clientHeight;
        const headerHeight = 90; // chapter header
        const navHeight = 65;    // page nav bar
        const available = containerHeight - headerHeight - navHeight;

        // Calculate chars that fit
        const lineHeight = 38;   // 18px font * 2.1 line-height
        const charsPerLine = 50; // conservative estimate for the text width
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

        setVirtualPages(pages.length > 0 ? pages : [[]]);
        setSubPage(0);
    }, [pageContent, allTokens.length]);

    // Recalculate on window resize
    useEffect(() => {
        const handleResize = () => {
            // Force re-render by toggling a dummy state
            setPageContent(prev => prev + '');
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Build page word list
    useEffect(() => {
        if (!pageContent) return;
        const tokens = tokenizeText(pageContent);
        const seen = new Set();
        const words = [];
        tokens.forEach((t) => {
            if (!t.isWord) return;
            const norm = normalizeWord(t.text);
            if (!norm || seen.has(norm)) return;
            seen.add(norm);
            const status = wordStatuses[norm] || 0;
            words.push({
                word: norm,
                display: t.text,
                status,
                translation: wordTranslations[norm]?.translation || '',
                meanings: wordTranslations[norm]?.meanings || [],
                ipa: wordTranslations[norm]?.ipa || '',
            });
        });
        setPageWords(words);
    }, [pageContent, wordStatuses, wordTranslations]);

    // Mark unseen page words as NEW (status 1)
    useEffect(() => {
        if (!pageContent || !book) return;
        const tokens = tokenizeText(pageContent);
        const newWords = [];
        tokens.forEach((t) => {
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
        fetch('/api/vocabulary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words: uniqueNewWords, language: book.language, bookId: book.id }),
        }).catch((err) => console.error('Failed to mark words:', err));
    }, [pageContent, book]);

    // Handle word click
    const handleWordClick = useCallback(async (word) => {
        const norm = normalizeWord(word);
        if (!norm || !book) return;
        setSelectedWord(norm);
        if (wordTranslations[norm]) return;

        try {
            const res = await fetch('/api/words/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word: norm, language: book.language }),
            });
            const data = await res.json();
            setWordTranslations((prev) => ({
                ...prev,
                [norm]: {
                    translation: data.translation || '',
                    meanings: data.meanings || [],
                    ipa: data.ipa || '',
                },
            }));
        } catch (err) {
            console.error('Word lookup failed:', err);
        }
    }, [book, wordTranslations]);

    // Handle status change
    const handleStatusChange = async (word, newStatus) => {
        setWordStatuses((prev) => ({ ...prev, [word]: newStatus }));
        const statusStr = newStatus === 4 ? 'KNOWN' : String(newStatus);
        try {
            await fetch(`/api/vocabulary/${encodeURIComponent(word)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: statusStr, language: book.language }),
            });
            refreshStats();
        } catch (err) {
            console.error('Failed to update status:', err);
        }
    };

    // Auto-mark words as Recognized when leaving a sub-page
    const markCurrentPageWords = async () => {
        // Only mark words visible on the current sub-page, not the entire DB page
        const currentTokens = virtualPages[subPage] || [];
        const subPageWords = new Set();
        currentTokens.forEach(t => {
            if (t.isWord) {
                const norm = normalizeWord(t.text);
                if (norm) subPageWords.add(norm);
            }
        });

        const wordsToMark = [...subPageWords].filter(w => (wordStatuses[w] || 0) <= 1);
        if (wordsToMark.length === 0) return;

        setWordStatuses(prev => {
            const updated = { ...prev };
            wordsToMark.forEach(w => {
                if ((updated[w] || 0) <= 1) updated[w] = 2;
            });
            return updated;
        });

        const updates = wordsToMark.map(w =>
            fetch(`/api/vocabulary/${encodeURIComponent(w)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: '2', language: book.language }),
            }).catch(() => { })
        );
        await Promise.all(updates);
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
    const goNext = async () => {
        if (!book) return;

        // Always mark current page words as seen before leaving
        await markCurrentPageWords();

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

    // Keyboard navigation
    useEffect(() => {
        const handleKey = (e) => {
            if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
            else if (e.key === 'Escape') { setSelectedWord(null); }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    });

    // Current tokens to display
    const currentTokens = virtualPages[subPage] || [];
    const totalVirtualPages = virtualPages.length;

    // Progress
    const progress = book
        ? Math.round(((currentPage - 1 + (subPage + 1) / totalVirtualPages) / book.totalPages) * 100)
        : 0;

    const isFirstPage = currentPage === 1 && subPage === 0;
    const isLastPage = currentPage >= (book?.totalPages || 1) && subPage >= totalVirtualPages - 1;

    return (
        <>
            <nav className="navbar">
                <a href="/" className="navbar-brand">
                    <span className="navbar-brand-icon">📚</span>
                    <span className="navbar-brand-text">BookT</span>
                </a>
                <div className="navbar-actions">
                    {book && (
                        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                            {book.title}
                        </span>
                    )}
                    <div className="word-counter">
                        <span className="word-counter-num">{wordStats.total}</span>
                        <span className="word-counter-label">words seen</span>
                    </div>
                    <ThemeToggle />
                </div>
            </nav>

            <div className="reader-container">
                <div className="reader-main">
                    <div className="reader-progress-wrapper">
                        <div className="reader-progress-bar">
                            <div className="reader-progress-fill" style={{ width: `${progress}%` }} />
                        </div>
                        <div className="reader-progress-text">{progress}% complete</div>
                    </div>

                    <div className="reader-content" ref={contentRef}>
                        {loading ? (
                            <div className="loading-overlay">
                                <div className="spinner" />
                            </div>
                        ) : (
                            <>
                                <div className="reader-chapter-header">
                                    <div className="reader-chapter-icon">📖</div>
                                    <div>
                                        <div className="reader-chapter-title">{book?.title}</div>
                                        <div className="reader-chapter-subtitle">
                                            Page {currentPage}{totalVirtualPages > 1 ? `.${subPage + 1}` : ''} of {book?.totalPages}
                                        </div>
                                    </div>
                                    <button
                                        className="btn btn-ghost" style={{ marginLeft: 'auto' }}
                                        onClick={() => setShowChapters(true)}
                                        title="Manage chapters & audio"
                                    >
                                        🎧 Chapters
                                    </button>
                                </div>

                                <div className="reader-text">
                                    {(() => {
                                        // Compute which token indices should be audio-highlighted
                                        let highlightedSet = new Set();
                                        if (activeSyncIdx >= 0 && syncEntries[activeSyncIdx]) {
                                            const syncEntry = syncEntries[activeSyncIdx];
                                            const syncText = syncEntry.text.toLowerCase()
                                                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                                                .replace(/[.,!?;:'"«»\u201c\u201d\u2018\u2019]/g, '');
                                            const syncWords = syncText.split(/\s+/).filter(w => w.length > 0);

                                            // Build word token list
                                            const wordTokenIndices = [];
                                            currentTokens.forEach((t, i) => {
                                                if (t.isWord) wordTokenIndices.push(i);
                                            });

                                            // Try to find matching contiguous run of tokens
                                            let bestStart = -1;
                                            let bestScore = 0;

                                            for (let start = 0; start < wordTokenIndices.length; start++) {
                                                let matched = 0;
                                                const compareLen = Math.min(syncWords.length, wordTokenIndices.length - start);
                                                for (let j = 0; j < compareLen; j++) {
                                                    const tokenText = currentTokens[wordTokenIndices[start + j]].text
                                                        .toLowerCase()
                                                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                                                        .replace(/[.,!?;:'"«»\u201c\u201d\u2018\u2019]/g, '');
                                                    const syncWord = syncWords[j];
                                                    if (tokenText === syncWord ||
                                                        tokenText.startsWith(syncWord) ||
                                                        syncWord.startsWith(tokenText)) {
                                                        matched++;
                                                    }
                                                }
                                                const score = matched / Math.max(syncWords.length, 1);
                                                if (score > bestScore && matched >= 2) {
                                                    bestScore = score;
                                                    bestStart = start;
                                                }
                                                if (bestScore >= 0.6) break; // Good enough match
                                            }

                                            if (bestStart >= 0 && bestScore >= 0.3) {
                                                console.log(`[AudioMatch] Success: Score ${bestScore.toFixed(2)} at token ${bestStart}`);
                                                for (let j = 0; j < syncWords.length && bestStart + j < wordTokenIndices.length; j++) {
                                                    highlightedSet.add(wordTokenIndices[bestStart + j]);
                                                }
                                            } else {
                                                console.log(`[AudioMatch] Failed: Best score ${bestScore.toFixed(2)} < 0.3 or matched < 2`);
                                            }
                                        }

                                        // Only log if something is active to avoid spam
                                        if (activeSyncIdx >= 0 && !highlightedSet.size) {
                                            // We failed to highlight despite having an active sync entry
                                        }

                                        return currentTokens.map((token, i) =>
                                            token.isWord ? (
                                                <WordSpan
                                                    key={`${currentPage}-${subPage}-${i}`}
                                                    text={token.text}
                                                    status={wordStatuses[normalizeWord(token.text)] || 0}
                                                    isActive={selectedWord === normalizeWord(token.text)}
                                                    isAudioHighlighted={highlightedSet.has(i)}
                                                    onClick={() => handleWordClick(token.text)}
                                                />
                                            ) : (
                                                <span key={`${currentPage}-${subPage}-${i}`}>{token.text}</span>
                                            )
                                        );
                                    })()}
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
                                        {currentPage}{totalVirtualPages > 1 ? `.${subPage + 1}` : ''} / {book?.totalPages}
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
                    selectedSentence={selectedSentence}
                    sentenceTranslation={sentenceTranslation}
                    sentenceLoading={sentenceLoading}
                    language={book?.language}
                    onWordClick={handleWordClick}
                    onStatusChange={handleStatusChange}
                />
            </div>

            {/* Audio Player Bar */}
            {chapters.some(ch => ch.audioUrl) && (
                <div className="audio-player-bar">
                    {audioUrl && <audio
                        ref={audioRef}
                        src={audioUrl}
                        onTimeUpdate={() => {
                            if (!audioRef.current) return;
                            const t = audioRef.current.currentTime;
                            setAudioTime(t);
                            const idx = syncEntries.findIndex(s => t >= s.startTime && t < s.endTime);
                            setActiveSyncIdx(idx);
                        }}
                        onLoadedMetadata={() => {
                            if (audioRef.current) setAudioDuration(audioRef.current.duration);
                        }}
                        onEnded={() => setIsPlaying(false)}
                    />}

                    {/* Play / Pause button */}
                    <button
                        className="audio-btn-play"
                        onClick={() => {
                            if (!audioRef.current || !audioUrl) return;
                            if (isPlaying) {
                                audioRef.current.pause();
                            } else {
                                audioRef.current.play();
                            }
                            setIsPlaying(!isPlaying);
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
                    {currentChapter && (
                        <span className="audio-chapter-label" title={currentChapter.title}>
                            Ch.{currentChapter.number}
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
