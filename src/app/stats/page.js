'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import LangSwitcher from '@/components/LangSwitcher';

const LANGUAGE_NAMES = {
    fr: 'French',
    es: 'Spanish',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    pl: 'Polish',
    ja: 'Japanese',
    zh: 'Chinese',
    ru: 'Russian',
    ko: 'Korean',
    en: 'English',
    nl: 'Dutch',
};

const EMPTY_STATS = {
    vocab: {
        total: 0,
        learning: 0,
        known: 0,
        breakdown: { new: 0, recognized: 0, familiar: 0, known: 0 },
    },
    flashcards: {
        totalInDeck: 0,
        dueToday: 0,
        totalReviews: 0,
        retentionRate: 0,
    },
};

function languageName(code) {
    return LANGUAGE_NAMES[code] || code.toUpperCase();
}

function percent(value, total) {
    return total > 0 ? Math.round((value / total) * 100) : 0;
}

const DAILY_GOAL_KEY = 'bookt-daily-goal';
const DEFAULT_GOAL = 15;

export default function StatsDashboard() {
    const [language, setLanguage] = useState('');
    const [languages, setLanguages] = useState([]);
    const [stats, setStats] = useState(null);
    const [progress, setProgress] = useState(null);
    const [conjugation, setConjugation] = useState([]);
    const [goal, setGoal] = useState(DEFAULT_GOAL);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const saved = parseInt(localStorage.getItem(DAILY_GOAL_KEY) || '', 10);
        if (!Number.isNaN(saved) && saved > 0) setGoal(saved);
    }, []);

    const changeGoal = (value) => {
        setGoal(value);
        localStorage.setItem(DAILY_GOAL_KEY, String(value));
    };

    useEffect(() => {
        let cancelled = false;

        const loadOverview = async () => {
            setLoading(true);
            try {
                const res = await fetch('/api/stats');
                if (!res.ok) throw new Error('Failed to load language overview');

                const data = await res.json();
                const nextLanguages = Array.isArray(data.languages) ? data.languages : [];

                if (cancelled) return;
                setLanguages(nextLanguages);
                setLanguage((current) => current || nextLanguages[0]?.language || '');
                if (nextLanguages.length === 0) setLoading(false);
            } catch (err) {
                console.error('Failed to load language overview:', err);
                if (!cancelled) setLoading(false);
            }
        };

        loadOverview();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!language) {
            setStats(null);
            return;
        }

        let cancelled = false;

        const loadStats = async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/stats?language=${encodeURIComponent(language)}`);
                if (!res.ok) throw new Error('Failed to load language stats');

                const data = await res.json();
                if (cancelled) return;

                setStats(data);
                if (Array.isArray(data.languages)) setLanguages(data.languages);
            } catch (err) {
                console.error('Failed to load stats:', err);
                if (!cancelled) setStats(null);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        loadStats();
        return () => { cancelled = true; };
    }, [language]);

    useEffect(() => {
        if (!language) { setProgress(null); return; }
        let cancelled = false;
        fetch(`/api/progress?language=${encodeURIComponent(language)}`)
            .then((res) => res.ok ? res.json() : null)
            .then((data) => { if (!cancelled) setProgress(data); })
            .catch(() => { if (!cancelled) setProgress(null); });
        return () => { cancelled = true; };
    }, [language]);

    useEffect(() => {
        if (!language) { setConjugation([]); return; }
        let cancelled = false;
        fetch(`/api/conjugation/stats?language=${encodeURIComponent(language)}`)
            .then((res) => res.ok ? res.json() : null)
            .then((data) => { if (!cancelled) setConjugation(data?.verbs || []); })
            .catch(() => { if (!cancelled) setConjugation([]); });
        return () => { cancelled = true; };
    }, [language]);

    const vocab = stats?.vocab || EMPTY_STATS.vocab;
    const flashcards = stats?.flashcards || EMPTY_STATS.flashcards;
    const knownPercent = percent(vocab.known, vocab.total);
    const learningPercent = percent(vocab.learning, vocab.total);
    const selectedLanguage = languages.find((item) => item.language === language);
    const totalKnownWords = languages.reduce((sum, item) => sum + item.known, 0);

    if (loading && !stats && languages.length === 0) {
        return (
            <>
                <nav className="navbar">
                    <Link href="/" className="navbar-brand">
                        <span className="navbar-brand-text">BookT</span>
                    </Link>
                </nav>
                <div className="loading-overlay" style={{ padding: '80px' }}>
                    <div className="spinner" />
                </div>
            </>
        );
    }

    return (
        <>
            <nav className="navbar">
                <Link href="/" className="navbar-brand">
                    <span className="navbar-brand-text">BookT</span>
                </Link>
                <div className="navbar-actions">
                    <Link href="/grammar" className="nav-chip" title="Casos gramaticais">Casos</Link>
                    <Link href="/" className="nav-chip" title="Library">
                        <svg className="nav-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H12v17H4.5A2.5 2.5 0 0 0 2 21.5v-17z" />
                            <path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H12v17h7.5a2.5 2.5 0 0 1 2.5 2.5v-17z" />
                        </svg>
                    </Link>
                    <Link href="/flashcards" className="nav-chip" title="Flashcards">
                        <svg className="nav-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="6" width="13" height="15" rx="2" />
                            <path d="M8 6V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-1" />
                        </svg>
                    </Link>
                    <ThemeToggle />
                </div>
            </nav>

            <main className="stats-container">
                <div className="stats-header">
                    <div className="stats-header-title">
                        <h1>Your Progress</h1>
                    </div>
                    <LangSwitcher
                        languages={languages.map((item) => item.language)}
                        value={language}
                        onChange={setLanguage}
                        count={selectedLanguage ? selectedLanguage.total : undefined}
                        counts={Object.fromEntries(languages.map((item) => [item.language, item.total]))}
                    />
                </div>

                {progress && languages.length > 0 && (
                    <section className="daily-strip" aria-label="Today">
                        <div className={`daily-card daily-streak ${progress.streak > 0 ? 'active' : ''}`}>
                            <div className="daily-value">{progress.streak}</div>
                            <div className="daily-label">day streak</div>
                        </div>
                        <div className="daily-card daily-goal">
                            <div className="daily-goal-head">
                                <span className="daily-value">{progress.newToday}<span className="daily-goal-target">/{goal}</span></span>
                                <select
                                    className="daily-goal-select"
                                    value={goal}
                                    onChange={(e) => changeGoal(parseInt(e.target.value, 10))}
                                    title="Daily new-word goal"
                                >
                                    {[5, 10, 15, 20, 30, 50].map((g) => <option key={g} value={g}>{g}/day</option>)}
                                </select>
                            </div>
                            <div className="daily-goal-track">
                                <div
                                    className="daily-goal-fill"
                                    style={{ width: `${Math.min(100, Math.round((progress.newToday / goal) * 100))}%` }}
                                />
                            </div>
                            <div className="daily-label">new words today {progress.newToday >= goal ? '· goal met 🎉' : ''}</div>
                        </div>
                        <div className="daily-card">
                            <div className="daily-value">{progress.reviewedToday}</div>
                            <div className="daily-label">reviewed today</div>
                        </div>
                    </section>
                )}

                {languages.length === 0 ? (
                    <div className="stats-empty">
                        <h2>No Data Yet</h2>
                        <p style={{ color: 'var(--text-secondary)' }}>Upload a book to start tracking your progress.</p>
                        <Link href="/" className="btn btn-primary" style={{ marginTop: '24px' }}>Go to Library</Link>
                    </div>
                ) : (
                    <>
                        <section className="stats-language-panel" aria-label="Language progress">
                            <div className="stats-language-panel-header">
                                <div>
                                    <h2>Language Progress</h2>
                                    <p>Choose a language to inspect vocabulary and flashcard progress.</p>
                                </div>
                                <div className="stats-language-total">
                                    <span>{totalKnownWords}</span>
                                    <small>known lemmas total</small>
                                </div>
                            </div>

                            <div className="stats-language-grid">
                                {languages.map((item) => {
                                    const itemKnownPercent = percent(item.known, item.total);
                                    const isActive = item.language === language;

                                    return (
                                        <button
                                            key={item.language}
                                            type="button"
                                            className={`stats-language-card ${isActive ? 'active' : ''}`}
                                            onClick={() => setLanguage(item.language)}
                                        >
                                            <div className="stats-language-card-top">
                                                <div>
                                                    <div className="stats-language-name">{languageName(item.language)}</div>
                                                    <div className="stats-language-code">{item.language.toUpperCase()}</div>
                                                </div>
                                                <div className="stats-language-books">{item.bookCount} books</div>
                                            </div>

                                            <div className="stats-language-known">
                                                <span>{item.known}</span>
                                                <small>known lemmas</small>
                                            </div>

                                            <div className="stats-language-progress">
                                                <div
                                                    className="stats-language-progress-fill"
                                                    style={{ width: `${itemKnownPercent}%` }}
                                                />
                                            </div>

                                            <div className="stats-language-meta">
                                                <span>{item.learning} learning</span>
                                                <span>{item.total} seen</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        <div className="stats-selected-summary">
                            <span>Viewing {languageName(language)}</span>
                            <strong>{selectedLanguage?.known || 0} known / {selectedLanguage?.total || 0} seen</strong>
                        </div>

                        <div className="stats-grid">
                            <div className="stats-card stats-card-main">
                                <h2 className="stats-card-title">Vocabulary Knowledge</h2>
                                <div className="stats-knowledge-ring">
                                    <svg viewBox="0 0 36 36" className="circular-chart">
                                        <path
                                            className="circle-bg"
                                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                        />
                                        <path
                                            className="circle-learning"
                                            strokeDasharray={`${learningPercent + knownPercent}, 100`}
                                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                        />
                                        <path
                                            className="circle-known"
                                            strokeDasharray={`${knownPercent}, 100`}
                                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                        />
                                        <text x="18" y="20.35" className="percentage">{knownPercent}%</text>
                                    </svg>
                                    <div className="stats-legend">
                                        <div className="legend-item"><span className="dot dot-known"></span> {vocab.known} Known</div>
                                        <div className="legend-item"><span className="dot dot-learning"></span> {vocab.learning} Learning</div>
                                    </div>
                                </div>
                            </div>

                            <div className="stats-card">
                                <h2 className="stats-card-title">Flashcard Deck Needs</h2>
                                <div className="stats-metric-list">
                                    <div className="stats-metric-item highlight-red">
                                        <div className="metric-val">{flashcards.dueToday}</div>
                                        <div className="metric-label">Due Reviews</div>
                                    </div>
                                    <div className="stats-metric-item">
                                        <div className="metric-val">{flashcards.totalInDeck}</div>
                                        <div className="metric-label">Total Cards in Deck</div>
                                    </div>
                                    <Link href="/flashcards" className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>
                                        Start Review
                                    </Link>
                                </div>
                            </div>

                            <div className="stats-card span-2">
                                <h2 className="stats-card-title">Lemma Status Breakdown</h2>
                                <div className="stats-breakdown-bars">
                                    <div className="breakdown-bar-row">
                                        <div className="breakdown-label">1 - New</div>
                                        <div className="breakdown-track">
                                            <div className="breakdown-fill fill-1" style={{ width: `${percent(vocab.breakdown.new, vocab.total)}%` }}></div>
                                        </div>
                                        <div className="breakdown-num">{vocab.breakdown.new}</div>
                                    </div>
                                    <div className="breakdown-bar-row">
                                        <div className="breakdown-label">2 - Recognized</div>
                                        <div className="breakdown-track">
                                            <div className="breakdown-fill fill-2" style={{ width: `${percent(vocab.breakdown.recognized, vocab.total)}%` }}></div>
                                        </div>
                                        <div className="breakdown-num">{vocab.breakdown.recognized}</div>
                                    </div>
                                    <div className="breakdown-bar-row">
                                        <div className="breakdown-label">3 - Familiar</div>
                                        <div className="breakdown-track">
                                            <div className="breakdown-fill fill-3" style={{ width: `${percent(vocab.breakdown.familiar, vocab.total)}%` }}></div>
                                        </div>
                                        <div className="breakdown-num">{vocab.breakdown.familiar}</div>
                                    </div>
                                    <div className="breakdown-bar-row">
                                        <div className="breakdown-label">4 - Known</div>
                                        <div className="breakdown-track">
                                            <div className="breakdown-fill fill-4" style={{ width: `${percent(vocab.breakdown.known, vocab.total)}%` }}></div>
                                        </div>
                                        <div className="breakdown-num">{vocab.breakdown.known}</div>
                                    </div>
                                </div>
                            </div>

                            {conjugation.length > 0 && (
                                <div className="stats-card span-2">
                                    <h2 className="stats-card-title">Conjugação por Verbo</h2>
                                    <div className="conj-stats-list">
                                        {conjugation.slice(0, 12).map((v) => (
                                            <div key={v.lexemeId} className="conj-stats-row">
                                                <div className="conj-stats-verb">
                                                    <strong>{v.verb}</strong>
                                                    {v.translation && <span>{v.translation}</span>}
                                                </div>
                                                <div className="conj-stats-tenses">
                                                    {v.tenses.map((t) => (
                                                        <span
                                                            key={t.tense}
                                                            className={`conj-stats-tense ${t.lapses > t.correctCount ? 'weak' : t.stability >= 21 ? 'strong' : ''}`}
                                                            title={`${t.tense}: ${t.reps} treinos, ${t.lapses} erros`}
                                                        >
                                                            {t.tense.replace('-', ' ')}
                                                        </span>
                                                    ))}
                                                </div>
                                                <div className="breakdown-track conj-stats-track">
                                                    <div className="breakdown-fill fill-4" style={{ width: `${v.mastery}%` }} />
                                                </div>
                                                <div className="breakdown-num">{v.mastery}%</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="stats-card">
                                <h2 className="stats-card-title">Study Metrics</h2>
                                <div className="stats-metric-list row">
                                    <div className="stats-metric-item">
                                        <div className="metric-val">{flashcards.totalReviews}</div>
                                        <div className="metric-label">Total Reviews</div>
                                    </div>
                                    <div className="stats-metric-item">
                                        <div className="metric-val">{flashcards.retentionRate}%</div>
                                        <div className="metric-label">Retention Rate</div>
                                    </div>
                                    <div className="stats-metric-item">
                                        <div className="metric-val">{stats?.formsSeen || 0}</div>
                                        <div className="metric-label">Inflected Forms Seen</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </main>
        </>
    );
}
