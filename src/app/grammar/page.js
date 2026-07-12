'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import LangSwitcher from '@/components/LangSwitcher';
import ThemeToggle from '@/components/ThemeToggle';
import { normalizeWord, tokenizeText } from '@/lib/normalizer';

function ClozeSentence({ sentence, word }) {
    return tokenizeText(sentence).map((token, index) => {
        if (token.isWord && normalizeWord(token.text) === normalizeWord(word)) {
            return <span className="grammar-blank" key={index} aria-label="lacuna" />;
        }
        return <span key={index}>{token.text}</span>;
    });
}

function formatInterval(due) {
    if (!due) return '';
    const minutes = Math.max(1, Math.round((new Date(due).getTime() - Date.now()) / 60000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    return days < 30 ? `${days}d` : `${Math.round(days / 30)}mo`;
}

export default function GrammarPage() {
    const [languages, setLanguages] = useState([]);
    const [language, setLanguage] = useState('');
    const [cards, setCards] = useState([]);
    const [index, setIndex] = useState(0);
    const [answer, setAnswer] = useState('');
    const [result, setResult] = useState(null);
    const [stats, setStats] = useState({ due: 0, reviewed: 0, total: 0 });
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef(null);
    const card = cards[index];

    useEffect(() => {
        fetch('/api/books')
            .then((response) => response.json())
            .then((books) => {
                const next = [...new Set(books.map((book) => book.language))];
                setLanguages(next);
                setLanguage((current) => current || next[0] || '');
            })
            .catch((error) => console.error('Failed to load languages:', error));
    }, []);

    const loadCards = useCallback(async () => {
        if (!language) return;
        setLoading(true);
        try {
            const response = await fetch(`/api/grammar?language=${language}&limit=30`);
            const data = await response.json();
            setCards(data.cards || []);
            setStats(data.stats || { due: 0, reviewed: 0, total: 0 });
            setIndex(0);
            setAnswer('');
            setResult(null);
        } finally {
            setLoading(false);
        }
    }, [language]);

    useEffect(() => { loadCards(); }, [loadCards]);
    useEffect(() => { inputRef.current?.focus(); }, [index, result]);

    const progress = useMemo(() => cards.length ? Math.round((index / cards.length) * 100) : 0, [cards.length, index]);

    const checkAnswer = async (event) => {
        event.preventDefault();
        if (!card || !answer.trim() || result) return;
        setSubmitting(true);
        try {
            const response = await fetch('/api/grammar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: card.id, answer }),
            });
            setResult(await response.json());
        } finally {
            setSubmitting(false);
        }
    };

    const review = async (quality) => {
        if (!card || submitting) return;
        setSubmitting(true);
        try {
            await fetch('/api/flashcards/review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ memoryKey: card.memoryKey, quality }),
            });
            if (index + 1 < cards.length) {
                setIndex((current) => current + 1);
                setAnswer('');
                setResult(null);
            } else {
                await loadCards();
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <nav className="navbar">
                <Link href="/" className="navbar-brand"><span className="navbar-brand-text">BookT</span></Link>
                <div className="navbar-actions">
                    <Link href="/flashcards" className="nav-chip">Flashcards</Link>
                    <Link href="/stats" className="nav-chip">Stats</Link>
                    <ThemeToggle />
                </div>
            </nav>
            <main className="grammar-container">
                <header className="grammar-header">
                    <div>
                        <p className="grammar-eyebrow">Pratica contextual</p>
                        <h1>Casos gramaticais</h1>
                    </div>
                    <LangSwitcher languages={languages} value={language} onChange={setLanguage} />
                </header>

                <div className="grammar-stats" aria-label="progresso">
                    <span><strong>{stats.due}</strong> pendentes</span>
                    <span><strong>{stats.reviewed}</strong> revisados</span>
                    <span><strong>{stats.total}</strong> contextos</span>
                </div>
                <div className="grammar-progress"><span style={{ width: `${progress}%` }} /></div>

                {loading ? (
                    <div className="grammar-state"><div className="spinner" /></div>
                ) : !card ? (
                    <div className="grammar-state">
                        <h2>Nenhum caso pendente</h2>
                        <p>Ao consultar palavras flexionadas durante a leitura, os casos identificados aparecem aqui.</p>
                        <Link href="/" className="btn btn-primary">Voltar para a biblioteca</Link>
                    </div>
                ) : (
                    <section className="grammar-exercise">
                        <div className="grammar-meta">
                            <span>{card.caseLabel}</span>
                            <span>Forma base: <strong>{card.lemma}</strong></span>
                        </div>
                        <p className="grammar-sentence"><ClozeSentence sentence={card.sentence} word={card.word} /></p>
                        <form onSubmit={checkAnswer} className="grammar-answer-form">
                            <label htmlFor="grammar-answer">Digite a forma correta</label>
                            <div className="grammar-answer-row">
                                <input
                                    id="grammar-answer"
                                    ref={inputRef}
                                    value={answer}
                                    onChange={(event) => setAnswer(event.target.value)}
                                    disabled={Boolean(result) || submitting}
                                    autoComplete="off"
                                    spellCheck="false"
                                />
                                <button className="btn btn-primary" disabled={!answer.trim() || Boolean(result) || submitting}>Conferir</button>
                            </div>
                        </form>

                        {result && (
                            <div className={`grammar-feedback ${result.correct ? 'correct' : 'incorrect'}`}>
                                <div className="grammar-feedback-title">
                                    {result.correct ? 'Correto' : <>Resposta: <strong>{result.expected}</strong></>}
                                </div>
                                <p>{result.reason}</p>
                                {result.pattern && <p className="grammar-pattern">Regencia: {result.pattern}</p>}
                            </div>
                        )}

                        {result && (
                            <div className="grammar-review-actions">
                                {[1, 2, 3, 4].map((quality) => (
                                    <button key={quality} onClick={() => review(quality)} disabled={submitting}>
                                        <span>{formatInterval(card.preview?.[quality]?.due)}</span>
                                        {['De novo', 'Dificil', 'Bom', 'Facil'][quality - 1]}
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                )}
            </main>
        </>
    );
}
