'use client';

import { useState, useEffect, useCallback } from 'react';
import ThemeToggle from '@/components/ThemeToggle';

// Shuffle array (Fisher-Yates)
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
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
    }, []);

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
        if (!rawCards.length) {
            setDeck([]);
            setCurrentIndex(0);
            return;
        }

        let newDeck = [];

        if (direction === 'recognize') {
            // Foreign word → show translation (front: word, back: translation)
            newDeck = rawCards.map(c => ({ ...c, dir: 'recognize' }));
        } else if (direction === 'produce') {
            // Translation → recall foreign word (front: translation, back: word)
            // Only include cards that have a translation
            newDeck = rawCards
                .filter(c => c.translation)
                .map(c => ({ ...c, dir: 'produce' }));
        } else {
            // Both directions — duplicate cards & shuffle
            const recognize = rawCards.map(c => ({ ...c, dir: 'recognize' }));
            const produce = rawCards
                .filter(c => c.translation)
                .map(c => ({ ...c, dir: 'produce' }));
            newDeck = shuffle([...recognize, ...produce]);
        }

        setDeck(newDeck);
        setCurrentIndex(0);
        setFlipped(false);
    }, [rawCards, direction]);

    const currentCard = deck[currentIndex];

    // What shows on front and back depends on direction
    const getFront = () => {
        if (!currentCard) return { main: '', sub: '' };
        if (currentCard.dir === 'produce') {
            return {
                main: currentCard.translation,
                sub: 'What\'s the word?',
                tag: langNames['pt'] || '🇧🇷 Portuguese',
            };
        }
        return {
            main: currentCard.word,
            sub: 'What does it mean?',
            tag: langNames[language] || language,
        };
    };

    const getBack = () => {
        if (!currentCard) return { word: '', translation: '' };
        if (currentCard.dir === 'produce') {
            return {
                word: currentCard.word,
                ipa: currentCard.ipa,
                translation: currentCard.translation,
                meanings: currentCard.meanings,
                tag: langNames[language] || language,
            };
        }
        return {
            word: currentCard.word,
            ipa: currentCard.ipa,
            translation: currentCard.translation,
            meanings: currentCard.meanings,
            tag: langNames['pt'] || '🇧🇷 Portuguese',
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
                    word: currentCard.word,
                    language: currentCard.language,
                    quality,
                }),
            });

            setSessionReviewed(prev => prev + 1);

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

    // Keyboard shortcuts
    useEffect(() => {
        const handleKey = (e) => {
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
        const interval = currentCard.interval || 0;
        const ease = currentCard.easeFactor || 2.5;

        let nextInterval;
        switch (quality) {
            case 1: return '1m';
            case 2:
                nextInterval = interval < 1 ? 10 / 1440 : interval * 1.2;
                break;
            case 3:
                nextInterval = interval < 1 ? 1 : interval * ease;
                break;
            case 4:
                nextInterval = interval < 1 ? 4 : interval * ease * 1.3;
                break;
        }

        if (nextInterval < 1 / 24) return `${Math.round(nextInterval * 24 * 60)}m`;
        if (nextInterval < 1) return `${Math.round(nextInterval * 24)}h`;
        if (nextInterval < 30) return `${Math.round(nextInterval)}d`;
        return `${Math.round(nextInterval / 30)}mo`;
    };

    const langNames = {
        fr: '🇫🇷 French', es: '🇪🇸 Spanish', de: '🇩🇪 German',
        it: '🇮🇹 Italian', pt: '🇧🇷 Portuguese', ja: '🇯🇵 Japanese',
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
                <a href="/" className="navbar-brand">
                    <span className="navbar-brand-icon">📚</span>
                    <span className="navbar-brand-text">BookT</span>
                </a>
                <div className="navbar-actions">
                    <a href="/stats" className="btn btn-ghost">📊 Stats</a>
                    <a href="/" className="btn btn-ghost">← Library</a>
                    <ThemeToggle />
                </div>
            </nav>

            <div className="fc-container">
                {/* Header */}
                <div className="fc-header">
                    <h1 className="fc-title">Flashcards</h1>
                    <select
                        className="fc-lang-select"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                    >
                        {languages.map(l => (
                            <option key={l} value={l}>{langNames[l] || l}</option>
                        ))}
                    </select>
                </div>

                {/* Direction toggle */}
                <div className="fc-direction-toggle">
                    <button
                        className={`fc-dir-btn ${direction === 'both' ? 'active' : ''}`}
                        onClick={() => setDirection('both')}
                    >
                        🔄 Both
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
                </div>

                {/* Stats bar */}
                <div className="fc-stats">
                    <div className="fc-stat">
                        <span className="fc-stat-num fc-stat-due">{stats.due}</span>
                        <span className="fc-stat-label">Due</span>
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
                {loading ? (
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
                        <a href="/" className="btn btn-primary" style={{ marginTop: '20px' }}>
                            Back to Library
                        </a>
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
                                    <div className="fc-card-word">{front.main}</div>
                                    <div className="fc-card-hint">{front.sub}</div>
                                    <div className="fc-card-hint" style={{ marginTop: '4px', fontSize: '11px' }}>
                                        {currentCard.dir === 'produce' ? '🇧🇷 → ' : ''}{currentCard.dir === 'recognize' ? `${langNames[language]?.split(' ')[0]} → ` : ''}
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
                                        </>
                                    ) : (
                                        <>
                                            <div className="fc-card-word" style={{ fontSize: '20px', opacity: 0.6 }}>{back.word}</div>
                                            {back.ipa && <div className="fc-card-ipa">{back.ipa}</div>}
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
                                </div>
                            </div>
                        </div>

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
            </div>
        </>
    );
}
