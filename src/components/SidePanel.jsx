'use client';

import { useState, useRef, useEffect } from 'react';
import { tokenizeText, normalizeWord } from '@/lib/normalizer';

const LEVEL_LABELS = {
    0: 'Ignored',
    1: 'New',
    2: 'Recognized',
    3: 'Familiar',
    4: 'Known',
};

const PART_OF_SPEECH_LABELS = {
    ADJ: 'Adjective', ADP: 'Preposition', ADV: 'Adverb', AUX: 'Auxiliary verb',
    CCONJ: 'Conjunction', DET: 'Determiner', INTJ: 'Interjection', NOUN: 'Noun',
    NUM: 'Number', PART: 'Particle', PRON: 'Pronoun', PROPN: 'Proper noun',
    SCONJ: 'Conjunction', VERB: 'Verb',
};

const MORPHOLOGY_LABELS = {
    'Number=Sing': 'singular', 'Number=Plur': 'plural',
    'Tense=Past': 'past', 'Tense=Pres': 'present', 'Tense=Fut': 'future',
    'Person=1': 'first person', 'Person=2': 'second person', 'Person=3': 'third person',
    'Gender=Fem': 'feminine', 'Gender=Masc': 'masculine', 'Gender=Neut': 'neuter',
    'Case=Nom': 'nominative', 'Case=Acc': 'accusative', 'Case=Gen': 'genitive',
    'Case=Dat': 'dative', 'Case=Ins': 'instrumental', 'Case=Loc': 'locative',
};

function grammarSummary(partOfSpeech, morphology) {
    const labels = [];
    if (partOfSpeech) labels.push(PART_OF_SPEECH_LABELS[partOfSpeech] || partOfSpeech);
    if (morphology) {
        morphology.split('|').forEach((feature) => {
            if (MORPHOLOGY_LABELS[feature]) labels.push(MORPHOLOGY_LABELS[feature]);
        });
    }
    return labels.slice(0, 4).join(' · ');
}

// Render a sentence with the studied word emphasized.
function highlightWord(sentence, word) {
    return tokenizeText(sentence).map((t, i) =>
        t.isWord && normalizeWord(t.text) === word
            ? <strong key={i} className="sp-context-word">{t.text}</strong>
            : <span key={i}>{t.text}</span>
    );
}

export default function SidePanel({
    pageWords,
    selectedWord,
    selectedContext,
    selectedSentence,
    sentenceTranslation,
    sentenceLoading,
    language,
    onWordClick,
    onStatusChange,
    onDeselect,
}) {
    const [activeTab, setActiveTab] = useState('new'); // 'new' | 'all'
    const audioRef = useRef(null);
    const [audioLoading, setAudioLoading] = useState(false);
    const [ctxTranslation, setCtxTranslation] = useState('');
    const [ctxLoading, setCtxLoading] = useState(false);
    // Session-local override for the "this is a name / don't study" toggle. The
    // flashcard deck is the source of truth; this just reflects the click.
    const [studyOverride, setStudyOverride] = useState({});
    const selected = pageWords.find(w => w.word === selectedWord);
    const isStudyable = selected
        ? (studyOverride[selected.word] ?? selected.isStudyable !== false)
        : true;

    const setStudyable = async (next) => {
        if (!selected) return;
        setStudyOverride(o => ({ ...o, [selected.word]: next }));
        try {
            await fetch(`/api/vocabulary/${encodeURIComponent(selected.word)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language, isStudyable: next }),
            });
        } catch {
            // Best-effort; the deck query still reflects the last successful write.
        }
    };

    // Reset the context translation whenever the selected word/sentence changes.
    useEffect(() => {
        setCtxTranslation(selected?.contextTranslation || '');
        setCtxLoading(false);
    }, [selectedContext?.sentence, selected?.contextTranslation]);

    const translateContext = async () => {
        if (!selectedContext?.sentence || ctxLoading) return;
        setCtxLoading(true);
        try {
            const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: selectedContext.sentence, language }),
            });
            const data = await res.json();
            setCtxTranslation(res.ok ? (data.translation || '—') : 'Translation unavailable');
        } catch {
            setCtxTranslation('Translation unavailable');
        } finally {
            setCtxLoading(false);
        }
    };

    const filteredWords = activeTab === 'new'
        ? pageWords.filter(w => w.status > 0 && w.status < 4)
        : pageWords;

    const playAudio = async (word) => {
        setAudioLoading(true);
        try {
            const res = await fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ word, language }),
            });
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                if (audioRef.current) {
                    audioRef.current.src = url;
                    audioRef.current.play();
                }
            } else {
                fallbackSpeak(word, language);
            }
        } catch {
            fallbackSpeak(word, language);
        } finally {
            setAudioLoading(false);
        }
    };

    const fallbackSpeak = (text, lang) => {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            const langMap = {
                fr: 'fr-FR', es: 'es-ES', de: 'de-DE', it: 'it-IT',
                pt: 'pt-BR', pl: 'pl-PL', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN',
                ru: 'ru-RU', ko: 'ko-KR', nl: 'nl-NL',
            };
            utterance.lang = langMap[lang] || lang;
            utterance.rate = 0.8;
            speechSynthesis.speak(utterance);
        }
    };

    return (
        <aside className="side-panel">
            <audio ref={audioRef} hidden />

            {/* Selected text — sentence translation */}
            {selectedSentence ? (
                <div className="sp-sentence-card">
                    <div className="sp-section-label">Selected Text</div>
                    <div className="sp-sentence-text">{selectedSentence}</div>
                    <div className="sp-section-label" style={{ marginTop: '16px' }}>Translation</div>
                    {sentenceLoading ? (
                        <div className="sp-meaning-card muted">
                            <span className="sp-meaning-text">Translating…</span>
                        </div>
                    ) : sentenceTranslation ? (
                        <div className="sp-meaning-card">
                            <span className="sp-meaning-text">{sentenceTranslation}</span>
                        </div>
                    ) : null}
                </div>
            ) : selected ? (
                /* Word detail */
                <div className="sp-detail">
                    <div className="sp-detail-top">
                        <button className="sp-back" onClick={onDeselect} title="Back to word list">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M19 12H5M12 19l-7-7 7-7" />
                            </svg>
                            All words
                        </button>
                        <button
                            className="sp-audio-btn"
                            onClick={() => playAudio(selected.word)}
                            disabled={audioLoading}
                            title="Play pronunciation"
                        >
                            {audioLoading ? (
                                <span className="spinner" style={{ width: '13px', height: '13px' }} />
                            ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none" />
                                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
                                </svg>
                            )}
                        </button>
                    </div>

                    <div className="sp-word-hero">
                        <div className="sp-word-title">{selected.word}</div>
                        {selected.ipa && <div className="sp-word-ipa">{selected.ipa}</div>}
                        {(selected.lemma || selected.partOfSpeech) && (
                            <div className="sp-word-meta">
                                {selected.lemma && selected.lemma !== selected.word && (
                                    <span>Base form <strong>{selected.lemma}</strong></span>
                                )}
                                {grammarSummary(selected.partOfSpeech, selected.morphology) && (
                                    <span>{grammarSummary(selected.partOfSpeech, selected.morphology)}</span>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="sp-level-control">
                        <div className="sp-level-row">
                            {[1, 2, 3, 4].map(n => (
                                <button
                                    key={n}
                                    className={`sp-level-btn level-${n} ${selected.status === n ? 'active' : ''}`}
                                    onClick={() => onStatusChange(selected.word, n)}
                                    title={LEVEL_LABELS[n]}
                                >
                                    {n === 4 ? '✓' : n}
                                </button>
                            ))}
                        </div>
                        <div className="sp-level-caption">{LEVEL_LABELS[selected.status] || 'Unseen'}</div>
                    </div>

                    <div className="sp-scroll">
                        <div className="sp-section">
                            <div className="sp-section-label">Translation</div>
                            {selected.translation ? (
                                <div className="sp-meaning-card">
                                    <span className="sp-meaning-text">{selected.translation}</span>
                                </div>
                            ) : (
                                <div className="sp-meaning-card muted">
                                    <span className="sp-meaning-text">Looking up…</span>
                                </div>
                            )}
                        </div>

                        {selected.meanings && selected.meanings.length > 0 && (
                            <div className="sp-section">
                                <div className="sp-section-label">Meanings</div>
                                {selected.meanings.map((m, i) => (
                                    <div key={i} className="sp-meaning-card">
                                        {m.partOfSpeech && <span className="sp-meaning-pos">{m.partOfSpeech}</span>}
                                        <span className="sp-meaning-text">{m.meaning}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {selectedContext?.sentence && (
                            <div className="sp-section">
                                <div className="sp-section-label">In context</div>
                                <div className="sp-context-sentence">
                                    {highlightWord(selectedContext.sentence, selected.word)}
                                </div>
                                {selected.lookupLoading ? (
                                    <div className="sp-meaning-card muted" style={{ marginTop: '10px' }}>
                                        <span className="sp-meaning-text">Analyzing context…</span>
                                    </div>
                                ) : ctxTranslation ? (
                                    <div className="sp-meaning-card" style={{ marginTop: '10px' }}>
                                        <span className="sp-meaning-text">{ctxTranslation}</span>
                                    </div>
                                ) : (
                                    <button className="sp-translate-btn" onClick={translateContext} disabled={ctxLoading}>
                                        {ctxLoading ? 'Translating…' : 'Translate sentence'}
                                    </button>
                                )}
                            </div>
                        )}

                        {selected.caseExplanation && (
                            <div className="sp-section">
                                <div className="sp-section-label">Por que este caso?</div>
                                <div className="sp-case-card">
                                    <div className="sp-case-head">
                                        <span className="sp-case-name">{selected.caseExplanation.caseLabel}</span>
                                        <span
                                            className={`sp-case-conf ${selected.caseExplanation.confidence || 'medium'}`}
                                            title={selected.caseExplanation.source ? `Fonte: ${selected.caseExplanation.source}` : undefined}
                                        >
                                            {selected.caseExplanation.confidence === 'high'
                                                ? 'Confirmado'
                                                : selected.caseExplanation.confidence === 'low'
                                                    ? 'Possível'
                                                    : 'Provável'}
                                        </span>
                                    </div>
                                    <p className="sp-case-reason">{selected.caseExplanation.reason}</p>
                                    {selected.caseExplanation.pattern && (
                                        <div className="sp-case-pattern">{selected.caseExplanation.pattern}</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="sp-detail-actions">
                        <button
                            className="sp-ignore"
                            onClick={() => onStatusChange(selected.word, 0)}
                            title="Exclude this word from your vocabulary"
                        >
                            Ignore this word
                        </button>
                        <button
                            className="sp-ignore"
                            onClick={() => setStudyable(!isStudyable)}
                            title={isStudyable
                                ? 'Mark as a name so it never becomes a flashcard'
                                : 'Include this word in flashcards again'}
                        >
                            {isStudyable ? 'É um nome — não estudar' : 'Voltar a estudar'}
                        </button>
                    </div>
                </div>
            ) : (
                /* Word list */
                <>
                    <div className="side-panel-tabs">
                        <button
                            className={`side-panel-tab ${activeTab === 'new' ? 'active' : ''}`}
                            onClick={() => setActiveTab('new')}
                        >
                            New Words
                        </button>
                        <button
                            className={`side-panel-tab ${activeTab === 'all' ? 'active' : ''}`}
                            onClick={() => setActiveTab('all')}
                        >
                            All Words
                        </button>
                    </div>

                    <div className="side-panel-wordlist">
                        {filteredWords.map((w) => (
                            <div
                                key={w.word}
                                className={`wordlist-item ${selectedWord === w.word ? 'active' : ''}`}
                                onClick={() => onWordClick(w.word)}
                            >
                                <span className={`wordlist-dot level-${w.status}`} />
                                <div className="wordlist-content">
                                    <div className="wordlist-word">{w.word}</div>
                                    {w.translation && <div className="wordlist-meaning">{w.translation}</div>}
                                </div>
                                <span className="wordlist-level">{LEVEL_LABELS[w.status] || ''}</span>
                            </div>
                        ))}
                        {filteredWords.length === 0 && (
                            <div className="wordlist-empty">
                                {activeTab === 'new'
                                    ? 'Nothing new on this page — keep reading.'
                                    : 'No words found.'}
                            </div>
                        )}
                    </div>
                </>
            )}
        </aside>
    );
}
