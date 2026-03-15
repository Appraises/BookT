'use client';

import { useState, useEffect } from 'react';
import ThemeToggle from '@/components/ThemeToggle';

export default function StatsDashboard() {
    const [language, setLanguage] = useState('');
    const [languages, setLanguages] = useState([]);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    // Load available languages from user's books
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
                setLoading(false);
            }
        };
        loadLanguages();
    }, []);

    // Load stats when language changes
    useEffect(() => {
        const loadStats = async () => {
            if (!language) {
                setLoading(false);
                return;
            }
            setLoading(true);
            try {
                const res = await fetch(`/api/stats?language=${language}`);
                if (res.ok) {
                    const data = await res.json();
                    setStats(data);
                }
            } catch (err) {
                console.error('Failed to load stats:', err);
            } finally {
                setLoading(false);
            }
        };
        loadStats();
    }, [language]);

    const langNames = {
        fr: '🇫🇷 French', es: '🇪🇸 Spanish', de: '🇩🇪 German',
        it: '🇮🇹 Italian', pt: '🇧🇷 Portuguese', ja: '🇯🇵 Japanese',
        zh: '🇨🇳 Chinese', ru: '🇷🇺 Russian', ko: '🇰🇷 Korean',
        en: '🇬🇧 English', nl: '🇳🇱 Dutch',
    };

    if (loading && !stats) {
        return (
            <>
                <nav className="navbar">
                    <a href="/" className="navbar-brand">
                        <span className="navbar-brand-icon">📚</span>
                        <span className="navbar-brand-text">BookT</span>
                    </a>
                </nav>
                <div className="loading-overlay" style={{ padding: '80px' }}>
                    <div className="spinner" />
                </div>
            </>
        );
    }

    // Default empty stats if none exist yet
    const vocab = stats?.vocab || { total: 0, learning: 0, known: 0, breakdown: { new: 0, recognized: 0, familiar: 0, known: 0 } };
    const flashcards = stats?.flashcards || { totalInDeck: 0, dueToday: 0, totalReviews: 0, retentionRate: 0 };

    const knownPercent = vocab.total > 0 ? Math.round((vocab.known / vocab.total) * 100) : 0;
    const learningPercent = vocab.total > 0 ? Math.round((vocab.learning / vocab.total) * 100) : 0;

    return (
        <>
            <nav className="navbar">
                <a href="/" className="navbar-brand">
                    <span className="navbar-brand-icon">📚</span>
                    <span className="navbar-brand-text">BookT</span>
                </a>
                <div className="navbar-actions">
                    <a href="/" className="btn btn-ghost">← Library</a>
                    <ThemeToggle />
                </div>
            </nav>

            <main className="stats-container">
                <div className="stats-header">
                    <div className="stats-header-title">
                        <span className="stats-header-icon" style={{ fontSize: '2rem', marginRight: '16px' }}>📊</span>
                        <h1>Your Progress</h1>
                    </div>
                    {languages.length > 0 && (
                        <select
                            className="stats-lang-select"
                            value={language}
                            onChange={(e) => setLanguage(e.target.value)}
                        >
                            {languages.map(l => (
                                <option key={l} value={l}>{langNames[l] || l}</option>
                            ))}
                        </select>
                    )}
                </div>

                {!language || languages.length === 0 ? (
                    <div className="stats-empty">
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📖</div>
                        <h2>No Data Yet</h2>
                        <p style={{ color: 'var(--text-secondary)' }}>Upload a book to start tracking your progress!</p>
                        <a href="/" className="btn btn-primary" style={{ marginTop: '24px' }}>Go to Library</a>
                    </div>
                ) : (
                    <div className="stats-grid">

                        {/* Overall Knowledge Card */}
                        <div className="stats-card stats-card-main">
                            <h2 className="stats-card-title">Vocabulary Knowledge</h2>
                            <div className="stats-knowledge-ring">
                                <svg viewBox="0 0 36 36" className="circular-chart">
                                    <path className="circle-bg"
                                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                    />
                                    <path className="circle-learning"
                                        strokeDasharray={`${learningPercent + knownPercent}, 100`}
                                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                    />
                                    <path className="circle-known"
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

                        {/* Flashcard Health */}
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
                                <a href="/flashcards" className="btn btn-primary" style={{ width: '100%', marginTop: '16px' }}>
                                    Start Review
                                </a>
                            </div>
                        </div>

                        {/* Learning Breakdown */}
                        <div className="stats-card span-2">
                            <h2 className="stats-card-title">Word Status Breakdown</h2>
                            <div className="stats-breakdown-bars">
                                <div className="breakdown-bar-row">
                                    <div className="breakdown-label">1 - New</div>
                                    <div className="breakdown-track">
                                        <div className="breakdown-fill fill-1" style={{ width: `${(vocab.breakdown.new / Math.max(vocab.total, 1)) * 100}%` }}></div>
                                    </div>
                                    <div className="breakdown-num">{vocab.breakdown.new}</div>
                                </div>
                                <div className="breakdown-bar-row">
                                    <div className="breakdown-label">2 - Recognized</div>
                                    <div className="breakdown-track">
                                        <div className="breakdown-fill fill-2" style={{ width: `${(vocab.breakdown.recognized / Math.max(vocab.total, 1)) * 100}%` }}></div>
                                    </div>
                                    <div className="breakdown-num">{vocab.breakdown.recognized}</div>
                                </div>
                                <div className="breakdown-bar-row">
                                    <div className="breakdown-label">3 - Familiar</div>
                                    <div className="breakdown-track">
                                        <div className="breakdown-fill fill-3" style={{ width: `${(vocab.breakdown.familiar / Math.max(vocab.total, 1)) * 100}%` }}></div>
                                    </div>
                                    <div className="breakdown-num">{vocab.breakdown.familiar}</div>
                                </div>
                                <div className="breakdown-bar-row">
                                    <div className="breakdown-label">4 - Known</div>
                                    <div className="breakdown-track">
                                        <div className="breakdown-fill fill-4" style={{ width: `${(vocab.breakdown.known / Math.max(vocab.total, 1)) * 100}%` }}></div>
                                    </div>
                                    <div className="breakdown-num">{vocab.breakdown.known}</div>
                                </div>
                            </div>
                        </div>

                        {/* Study Metrics */}
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
                            </div>
                        </div>

                    </div>
                )}
            </main>
        </>
    );
}
