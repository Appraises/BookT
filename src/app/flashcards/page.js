'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import LangSwitcher from '@/components/LangSwitcher';
import ConjugationDrill from '@/components/ConjugationDrill';
import { tokenizeText, normalizeWord } from '@/lib/normalizer';

// A conjugation drill interrupts the deck every N graded cards.
const DRILL_EVERY = 15;

// Shuffle array (Fisher-Yates)
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Render a context sentence with the target word either blanked out (cloze)
// or emphasized. Matching is on the normalized form so inflection/casing align.
function renderContext(sentence, word, cloze) {
    return tokenizeText(sentence).map((t, i) => {
        if (t.isWord && normalizeWord(t.text) === word) {
            return cloze
                ? <span key={i} className="fc-cloze-blank" aria-label="blank" />
                : <strong key={i} className="fc-context-word">{t.text}</strong>;
        }
        return <span key={i}>{t.text}</span>;
    });
}

export default function FlashcardsPage() {
    const [language, setLanguage] = useState('');
    const [languages, setLanguages] = useState([]);
    const [rawCards, setRawCards] = useState([]);     // Cards from API
    const [deck, setDeck] = useState([]);             // Processed deck with direction
    const [currentIndex, setCurrentIndex] = useState(0);
    const [flipped, setFlipped] = useState(false);
    const [stats, setStats] = useState({ due: 0, reviewed: 0, total: 0 });
    const [sessionReviewed, setSessionReviewed] = useState(0);
    const [loading, setLoading] = useState(false);
    const [reviewing, setReviewing] = useState(false);
    const [direction, setDirection] = useState('both'); // 'both' | 'recognize' | 'produce'
    const [drill, setDrill] = useState(null); // conjugation drill interrupting the deck
    const [editing, setEditing] = useState(false); // hand-editing the current card's translation
    const [editValue, setEditValue] = useState('');
    const [savingEdit, setSavingEdit] = useState(false);
    const skipDeckRebuild = useRef(false); // in-place edits must not reshuffle/reset the deck
    const clipRef = useRef(null);

    // Play just the narrated clip for a context sentence (audioUrl + start..end).
    const playClip = (ctx) => {
        const a = clipRef.current;
        if (!a || !ctx?.audioUrl || ctx.start == null || ctx.end == null) return;

        const seekAndPlay = () => {
            try { a.currentTime = ctx.start; } catch { /* seek before ready */ }
            a.play().catch(() => { });
        };
        const onTime = () => {
            if (a.currentTime >= ctx.end) {
                a.pause();
                a.removeEventListener('timeupdate', onTime);
            }
        };
        if (a.__onTime) a.removeEventListener('timeupdate', a.__onTime);
        a.__onTime = onTime;
        a.addEventListener('timeupdate', onTime);

        const sameSrc = a.src && a.src.endsWith(ctx.audioUrl);
        if (sameSrc && a.readyState >= 1) {
            seekAndPlay();
        } else {
            if (!sameSrc) a.src = ctx.audioUrl;
            a.addEventListener('loadedmetadata', seekAndPlay, { once: true });
            a.load(); // preload=none: force fetch of metadata so we can seek
        }
    };

    // Load available languages
    useEffect(() => {
        const loadLanguages = async () => {
            try {
                const res = await fetch('/api/books');
                const books = await res.json();
                const langs = [...new Set(books.map(b => b.language))];
                setLanguages(langs);
                if (langs.length > 0 && !language) {
                    setLanguage(langs[0]);
                }
            } catch (err) {
                console.error('Failed to load languages:', err);
            }
        };
        loadLanguages();
    }, [language]);

    // Load flashcards
    const loadCards = useCallback(async () => {
        if (!language) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/flashcards?language=${language}&limit=50`);
            const data = await res.json();
            setRawCards(data.cards || []);
            setStats(data.stats || { due: 0, reviewed: 0, total: 0 });
            setSessionReviewed(0);
            setFlipped(false);
        } catch (err) {
            console.error('Failed to load flashcards:', err);
        } finally {
            setLoading(false);
        }
    }, [language]);

    useEffect(() => {
        loadCards();
    }, [loadCards]);

    // Build deck based on direction setting
    useEffect(() => {
        // A hand-edit patched rawCards in place — keep the current position and
        // order instead of rebuilding (which would reshuffle and jump to card 1).
        if (skipDeckRebuild.current) {
            skipDeckRebuild.current = false;
            return;
        }
        if (!rawCards.length) {
            setDeck([]);
            setCurrentIndex(0);
            return;
        }

        let newDeck = [];

        if (direction === 'recognize') {
            // Foreign word → show translation (front: word, back: translation)
            newDeck = rawCards
                .filter(c => c.skill === 'recognition')
                .map(c => ({ ...c, dir: 'recognize' }));
        } else if (direction === 'produce') {
            // Translation → recall foreign word (front: translation, back: word)
            // Only include cards that have a translation
            newDeck = rawCards
                .filter(c => c.skill === 'production' && c.translation)
                .map(c => ({ ...c, dir: 'produce' }));
        } else if (direction === 'listen') {
            // Listening — hear the narrated sentence, recall the word/meaning.
            // Only cards whose word was captured with an aligned audio clip.
            newDeck = rawCards
                .filter(c => c.skill === 'listening' && c.context?.audioUrl && c.context.start != null)
                .map(c => ({ ...c, dir: 'listen' }));
        } else {
            // Both directions — duplicate cards & shuffle
            newDeck = shuffle(rawCards
                .filter(c => c.skill === 'recognition' || (c.skill === 'production' && c.translation))
                .map(c => ({ ...c, dir: c.skill === 'production' ? 'produce' : 'recognize' })));
        }

        setDeck(newDeck);
        setCurrentIndex(0);
        setFlipped(false);
    }, [rawCards, direction]);

    const currentCard = deck[currentIndex];

    // Auto-play the clip when a listening card appears.
    useEffect(() => {
        if (currentCard?.dir === 'listen' && !flipped) {
            const id = setTimeout(() => playClip(currentCard.context), 250);
            return () => clearTimeout(id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentCard?.memoryKey, currentCard?.dir]);

    // Verbs are studied by their infinitive — the card shows the lemma while
    // the context sentence still highlights the conjugated form encountered.
    const isVerbCard = currentCard
        && (currentCard.partOfSpeech === 'VERB' || currentCard.partOfSpeech === 'AUX');
    const cardWord = (card) => (isVerbCard ? card.word : (card.surfaceForm || card.word));

    // What shows on front and back depends on direction
    const getFront = () => {
        if (!currentCard) return { main: '', sub: '' };
        if (currentCard.dir === 'produce') {
            return {
                main: currentCard.translation,
                sub: isVerbCard ? 'Produce the infinitive' : 'Produce the missing form',
                tag: langNames['pt'] || '🇧🇷 Portuguese',
            };
        }
        if (currentCard.dir === 'listen') {
            return { main: '', sub: 'Listen and recall the form', tag: langNames[language] || language };
        }
        return {
            main: cardWord(currentCard),
            sub: 'What does it mean?',
            tag: langNames[language] || language,
        };
    };

    const getBack = () => {
        if (!currentCard) return { word: '', translation: '' };
        const surface = currentCard.surfaceForm || currentCard.word;
        return {
            word: cardWord(currentCard),
            lemma: currentCard.lemma,
            // For verb cards the main word IS the lemma; surface the inflected
            // spelling the book actually used instead.
            encountered: isVerbCard && surface !== currentCard.word ? surface : null,
            ipa: currentCard.ipa,
            translation: currentCard.translation,
            meanings: currentCard.meanings,
            tag: currentCard.dir === 'produce'
                ? (langNames[language] || language)
                : (langNames['pt'] || '🇧🇷 Portuguese'),
        };
    };

    // Submit review
    const submitReview = async (quality) => {
        if (!currentCard || reviewing) return;
        setReviewing(true);

        try {
            await fetch('/api/flashcards/review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    memoryKey: currentCard.memoryKey,
                    quality,
                }),
            });

            const reviewedNow = sessionReviewed + 1;
            setSessionReviewed(reviewedNow);

            // Every DRILL_EVERY cards, a verb shows up to be conjugated.
            if (reviewedNow % DRILL_EVERY === 0) {
                try {
                    const res = await fetch(`/api/conjugation?language=${language}`);
                    const data = await res.json();
                    if (res.ok && data.drill) setDrill(data.drill);
                } catch {
                    // No drill — the deck just continues.
                }
            }

            if (currentIndex + 1 < deck.length) {
                setCurrentIndex(prev => prev + 1);
                setFlipped(false);
            } else {
                await loadCards();
            }
        } catch (err) {
            console.error('Review failed:', err);
        } finally {
            setReviewing(false);
        }
    };

    // Hand-correct the current card's translation (machine translations are
    // sometimes wrong). Patches the deck in place and persists to the lexeme.
    const openEditor = () => {
        if (!currentCard) return;
        setEditValue(currentCard.translation || '');
        setEditing(true);
    };

    const saveEdit = async () => {
        const next = editValue.trim();
        if (!currentCard || !next || savingEdit) return;
        const { lexemeId } = currentCard;
        const meanings = [{ meaning: next, partOfSpeech: currentCard.partOfSpeech || '' }];
        const patch = (c) => (c.lexemeId === lexemeId ? { ...c, translation: next, meanings } : c);

        setSavingEdit(true);
        try {
            const res = await fetch(`/api/lexemes/${lexemeId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ translation: next }),
            });
            if (!res.ok) throw new Error('save failed');
            // Update every card of this lexeme without reshuffling/reordering.
            skipDeckRebuild.current = true;
            setRawCards(cards => cards.map(patch));
            setDeck(d => d.map(patch));
            setEditing(false);
        } catch (err) {
            console.error('Card edit failed:', err);
        } finally {
            setSavingEdit(false);
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKey = (e) => {
            if (drill || editing) return; // drill/editor own the keyboard
            if (!currentCard) return;

            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                if (!flipped) setFlipped(true);
            } else if (flipped) {
                if (e.key === '1') submitReview(1);
                else if (e.key === '2') submitReview(2);
                else if (e.key === '3') submitReview(3);
                else if (e.key === '4') submitReview(4);
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    });

    // Format interval
    const formatInterval = (quality) => {
        if (!currentCard) return '';
        const due = currentCard.memory?.preview?.[quality]?.due;
        if (!due) return '';
        const minutes = Math.max(1, Math.round((new Date(due).getTime() - Date.now()) / 60000));
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `${hours}h`;
        const days = Math.round(hours / 24);
        if (days < 30) return `${days}d`;
        return `${Math.round(days / 30)}mo`;
    };

    const langNames = {
        fr: '🇫🇷 French', es: '🇪🇸 Spanish', de: '🇩🇪 German',
        it: '🇮🇹 Italian', pt: '🇧🇷 Portuguese', pl: '🇵🇱 Polish', ja: '🇯🇵 Japanese',
        zh: '🇨🇳 Chinese', ru: '🇷🇺 Russian', ko: '🇰🇷 Korean',
        en: '🇬🇧 English', nl: '🇳🇱 Dutch',
    };

    const sessionProgress = deck.length > 0
        ? Math.round((sessionReviewed / deck.length) * 100)
        : 0;

    const front = getFront();
    const back = getBack();

    return (
        <>
            <nav className="navbar">
                <Link href="/" className="navbar-brand">
                    <span className="navbar-brand-text">BookT</span>
                </Link>
                <div className="navbar-actions">
                    <Link href="/grammar" className="nav-chip" title="Casos gramaticais">
                        Casos
                    </Link>
                    <Link href="/" className="nav-chip" title="Library">
                        <svg className="nav-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H12v17H4.5A2.5 2.5 0 0 0 2 21.5v-17z" />
                            <path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H12v17h7.5a2.5 2.5 0 0 1 2.5 2.5v-17z" />
                        </svg>
                    </Link>
                    <Link href="/stats" className="nav-chip" title="Stats">
                        <svg className="nav-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
                        </svg>
                    </Link>
                    <ThemeToggle />
                </div>
            </nav>

            <div className="fc-container">
                {/* Header */}
                <div className="fc-header">
                    <h1 className="fc-title">Flashcards</h1>
                    <LangSwitcher
                        languages={languages}
                        value={language}
                        onChange={setLanguage}
                    />
                </div>

                {/* Direction toggle */}
                <div className="fc-direction-toggle">
                    <button
                        className={`fc-dir-btn ${direction === 'both' ? 'active' : ''}`}
                        onClick={() => setDirection('both')}
                    >
                        Both
                    </button>
                    <button
                        className={`fc-dir-btn ${direction === 'recognize' ? 'active' : ''}`}
                        onClick={() => setDirection('recognize')}
                    >
                        {langNames[language]?.split(' ')[0] || '🌍'} → 🇧🇷
                    </button>
                    <button
                        className={`fc-dir-btn ${direction === 'produce' ? 'active' : ''}`}
                        onClick={() => setDirection('produce')}
                    >
                        🇧🇷 → {langNames[language]?.split(' ')[0] || '🌍'}
                    </button>
                    <button
                        className={`fc-dir-btn ${direction === 'listen' ? 'active' : ''}`}
                        onClick={() => setDirection('listen')}
                        title="Listening practice — hear the sentence, recall the word"
                    >
                        Listen
                    </button>
                </div>

                {/* Stats bar */}
                <div className="fc-stats">
                    <div className="fc-stat">
                        <span className="fc-stat-num fc-stat-due">{stats.due}</span>
                        <span className="fc-stat-label">Due</span>
                    </div>
                    <div className="fc-stat">
                        <span className="fc-stat-num fc-stat-total">{stats.new ?? 0}</span>
                        <span className="fc-stat-label">New</span>
                    </div>
                    <div className="fc-stat">
                        <span className="fc-stat-num fc-stat-reviewed">{sessionReviewed}</span>
                        <span className="fc-stat-label">Reviewed</span>
                    </div>
                    <div className="fc-stat">
                        <span className="fc-stat-num fc-stat-total">{deck.length}</span>
                        <span className="fc-stat-label">In Deck</span>
                    </div>
                </div>

                {/* Session progress */}
                {deck.length > 0 && (
                    <div className="fc-progress">
                        <div className="fc-progress-track">
                            <div className="fc-progress-fill" style={{ width: `${sessionProgress}%` }} />
                        </div>
                        <span className="fc-progress-text">{sessionReviewed} / {deck.length}</span>
                    </div>
                )}

                {/* Card area */}
                {drill ? (
                    <ConjugationDrill
                        key={`${drill.lexemeId}:${drill.tense}`}
                        drill={drill}
                        onDone={() => setDrill(null)}
                    />
                ) : loading ? (
                    <div className="loading-overlay" style={{ padding: '80px' }}>
                        <div className="spinner" />
                    </div>
                ) : !currentCard ? (
                    <div className="fc-empty">
                        <div className="fc-empty-icon">🎉</div>
                        <div className="fc-empty-title">All caught up!</div>
                        <div className="fc-empty-text">
                            No cards to review right now. Keep reading to add more words!
                        </div>
                        <Link href="/" className="btn btn-primary" style={{ marginTop: '20px' }}>
                            Back to Library
                        </Link>
                    </div>
                ) : (
                    <>
                        <div
                            className={`fc-card ${flipped ? 'flipped' : ''}`}
                            onClick={() => !flipped && setFlipped(true)}
                        >
                            <div className="fc-card-inner">
                                {/* Front */}
                                <div className="fc-card-front">
                                    <div className="fc-card-lang-tag">{front.tag}</div>
                                    {currentCard.dir === 'listen' ? (
                                        <button
                                            className="fc-listen-play"
                                            onClick={(e) => { e.stopPropagation(); playClip(currentCard.context); }}
                                            title="Replay"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                                                <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                                            </svg>
                                        </button>
                                    ) : (
                                        <div className="fc-card-word">{front.main}</div>
                                    )}
                                    <div className="fc-card-hint">{front.sub}</div>
                                    {currentCard.dir !== 'listen' && currentCard.context && (
                                        <div className="fc-context">
                                            {/* recognize: word shown in context; produce: blank to fill */}
                                            {renderContext(
                                                currentCard.context.sentence,
                                                currentCard.context.surfaceForm || currentCard.surfaceForm || currentCard.word,
                                                currentCard.dir === 'produce',
                                            )}
                                        </div>
                                    )}
                                    <div className="fc-card-hint" style={{ marginTop: '4px', fontSize: '11px' }}>
                                        Press Space
                                    </div>
                                </div>

                                {/* Back */}
                                <div className="fc-card-back">
                                    <div className="fc-card-lang-tag">{back.tag}</div>
                                    {currentCard.dir === 'produce' ? (
                                        <>
                                            <div className="fc-card-word">{back.word}</div>
                                            {back.ipa && <div className="fc-card-ipa">{back.ipa}</div>}
                                            {back.lemma && back.lemma !== back.word && (
                                                <div className="fc-card-ipa">Base: {back.lemma}</div>
                                            )}
                                            {back.encountered && (
                                                <div className="fc-card-ipa">In text: {back.encountered}</div>
                                            )}
                                        </>
                                    ) : currentCard.dir === 'listen' ? (
                                        <>
                                            <div className="fc-card-word">{back.word}</div>
                                            {back.ipa && <div className="fc-card-ipa">{back.ipa}</div>}
                                            {back.lemma && back.lemma !== back.word && (
                                                <div className="fc-card-ipa">Base: {back.lemma}</div>
                                            )}
                                            {back.encountered && (
                                                <div className="fc-card-ipa">In text: {back.encountered}</div>
                                            )}
                                            <div className="fc-card-divider" />
                                            <div className="fc-card-translation">{back.translation}</div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="fc-card-word" style={{ fontSize: '20px', opacity: 0.6 }}>{back.word}</div>
                                            {back.ipa && <div className="fc-card-ipa">{back.ipa}</div>}
                                            {back.lemma && back.lemma !== back.word && (
                                                <div className="fc-card-ipa">Base: {back.lemma}</div>
                                            )}
                                            {back.encountered && (
                                                <div className="fc-card-ipa">In text: {back.encountered}</div>
                                            )}
                                            <div className="fc-card-divider" />
                                            <div className="fc-card-translation">{back.translation}</div>
                                        </>
                                    )}
                                    {back.meanings?.length > 0 && (
                                        <div className="fc-card-meanings">
                                            {back.meanings.slice(0, 3).map((m, i) => (
                                                <div key={i} className="fc-card-meaning">
                                                    {m.partOfSpeech && (
                                                        <span className="fc-meaning-pos">{m.partOfSpeech}</span>
                                                    )}
                                                    <span>{m.meaning}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {currentCard.context && (
                                        <div className="fc-context-back">
                                            <div className="fc-context">
                                                {renderContext(
                                                    currentCard.context.sentence,
                                                    currentCard.context.surfaceForm || currentCard.surfaceForm || currentCard.word,
                                                    false,
                                                )}
                                            </div>
                                            {currentCard.context.audioUrl && currentCard.context.start != null && (
                                                <button
                                                    className="fc-context-audio"
                                                    onClick={(e) => { e.stopPropagation(); playClip(currentCard.context); }}
                                                    title="Play this sentence"
                                                >
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                                                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                                                    </svg>
                                                    Listen
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <audio ref={clipRef} hidden preload="none" />
                        {currentCard.context?.audioUrl && currentCard.context.start != null && !flipped && (
                            <div className="fc-listen-hint">
                                <button
                                    className="fc-context-audio"
                                    onClick={(e) => { e.stopPropagation(); playClip(currentCard.context); }}
                                    title="Play this sentence"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                                    </svg>
                                    Listen
                                </button>
                            </div>
                        )}

                        {/* Action buttons */}
                        {flipped && (
                            <div className="fc-actions">
                                <button className="fc-btn fc-btn-again" onClick={() => submitReview(1)} disabled={reviewing}>
                                    <span className="fc-btn-interval">{formatInterval(1)}</span>
                                    <span className="fc-btn-label">Again</span>
                                    <span className="fc-btn-key">1</span>
                                </button>
                                <button className="fc-btn fc-btn-hard" onClick={() => submitReview(2)} disabled={reviewing}>
                                    <span className="fc-btn-interval">{formatInterval(2)}</span>
                                    <span className="fc-btn-label">Hard</span>
                                    <span className="fc-btn-key">2</span>
                                </button>
                                <button className="fc-btn fc-btn-good" onClick={() => submitReview(3)} disabled={reviewing}>
                                    <span className="fc-btn-interval">{formatInterval(3)}</span>
                                    <span className="fc-btn-label">Good</span>
                                    <span className="fc-btn-key">3</span>
                                </button>
                                <button className="fc-btn fc-btn-easy" onClick={() => submitReview(4)} disabled={reviewing}>
                                    <span className="fc-btn-interval">{formatInterval(4)}</span>
                                    <span className="fc-btn-label">Easy</span>
                                    <span className="fc-btn-key">4</span>
                                </button>
                            </div>
                        )}
                    </>
                )}

                {/* Discreet corner button to hand-fix a wrong translation */}
                {currentCard && !drill && !loading && (
                    <button
                        className="fc-edit-toggle"
                        onClick={openEditor}
                        title="Editar a tradução deste card"
                        aria-label="Editar card"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                        </svg>
                    </button>
                )}

                {editing && currentCard && (
                    <div className="fc-edit-overlay" onClick={() => !savingEdit && setEditing(false)}>
                        <div className="fc-edit-panel" onClick={(e) => e.stopPropagation()}>
                            <div className="fc-edit-word">
                                {currentCard.surfaceForm || currentCard.word}
                                {currentCard.lemma && currentCard.lemma !== (currentCard.surfaceForm || currentCard.word) && (
                                    <span className="fc-edit-lemma"> · {currentCard.lemma}</span>
                                )}
                            </div>
                            {currentCard.context?.sentence && (
                                <div className="fc-edit-context">{currentCard.context.sentence}</div>
                            )}
                            <label className="fc-edit-label">Tradução</label>
                            <input
                                className="fc-edit-input"
                                value={editValue}
                                autoFocus
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveEdit();
                                    else if (e.key === 'Escape') setEditing(false);
                                }}
                            />
                            <div className="fc-edit-actions">
                                <button className="fc-edit-cancel" onClick={() => setEditing(false)} disabled={savingEdit}>
                                    Cancelar
                                </button>
                                <button className="btn btn-primary" onClick={saveEdit} disabled={savingEdit || !editValue.trim()}>
                                    {savingEdit ? 'Salvando…' : 'Salvar'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
