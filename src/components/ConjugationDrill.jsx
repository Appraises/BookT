'use client';

import { useState, useRef, useEffect } from 'react';

// Accents count — that's the exercise — but apostrophe variants and casing
// shouldn't fail an otherwise correct answer.
const clean = (s) => s.trim().toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ');

/**
 * Conjugation drill panel: the verb (infinitive) + one tense, six person
 * inputs. Grades all six at once, shows the expected form where the answer
 * was wrong, and records an FSRS review for verb+tense.
 */
export default function ConjugationDrill({ drill, onDone }) {
    const [answers, setAnswers] = useState(() => drill.forms.map(() => ''));
    const [results, setResults] = useState(null); // bool[] once checked
    const [saving, setSaving] = useState(false);
    const inputRefs = useRef([]);

    useEffect(() => { inputRefs.current[0]?.focus(); }, []);

    const check = async () => {
        if (results) return;
        const graded = drill.forms.map((form, i) => clean(answers[i]) === clean(form.value));
        setResults(graded);
        setSaving(true);
        try {
            await fetch('/api/conjugation/review', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lexemeId: drill.lexemeId,
                    tense: drill.tense,
                    correct: graded.filter(Boolean).length,
                    total: graded.length,
                }),
            });
        } catch {
            // Offline review is lost, but the drill result stays visible.
        } finally {
            setSaving(false);
        }
    };

    const handleKey = (e, i) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (i < drill.forms.length - 1) inputRefs.current[i + 1]?.focus();
        else check();
    };

    const correctCount = results ? results.filter(Boolean).length : 0;
    const perfect = results && correctCount === drill.forms.length;

    return (
        <div className="conj-panel">
            <div className="conj-head">
                <span className="conj-kicker">
                    Conjugação{drill.isReview ? ' · revisão' : ''}
                </span>
                <div className="conj-verb">{drill.verb}</div>
                {drill.translation && <div className="conj-translation">{drill.translation}</div>}
                <span className="conj-tense">{drill.tenseLabel}</span>
            </div>

            <div className="conj-grid">
                {drill.forms.map((form, i) => (
                    <div
                        key={form.person + i}
                        className={`conj-row ${results ? (results[i] ? 'correct' : 'wrong') : ''}`}
                    >
                        <span className="conj-person">{form.person}</span>
                        <input
                            ref={(el) => { inputRefs.current[i] = el; }}
                            className="conj-input"
                            value={answers[i]}
                            disabled={Boolean(results)}
                            onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
                            onKeyDown={(e) => handleKey(e, i)}
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                        {results && !results[i] && (
                            <span className="conj-expected">{form.value}</span>
                        )}
                    </div>
                ))}
            </div>

            <div className="conj-actions">
                {!results ? (
                    <>
                        <button className="conj-skip" onClick={onDone}>Pular</button>
                        <button className="btn btn-primary" onClick={check}>Corrigir</button>
                    </>
                ) : (
                    <>
                        <div className={`conj-score ${perfect ? 'perfect' : ''}`}>
                            {perfect ? 'Perfeito — ' : ''}{correctCount}/{drill.forms.length}
                        </div>
                        <button className="btn btn-primary" onClick={onDone} disabled={saving}>
                            Continuar
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
