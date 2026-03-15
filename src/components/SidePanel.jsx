'use client';

import { useState, useRef } from 'react';

export default function SidePanel({
    pageWords,
    selectedWord,
    selectedSentence,
    sentenceTranslation,
    sentenceLoading,
    language,
    onWordClick,
    onStatusChange
}) {
    const [activeTab, setActiveTab] = useState('new'); // 'new' | 'all'
    const audioRef = useRef(null);
    const [audioLoading, setAudioLoading] = useState(false);

    const filteredWords = activeTab === 'new'
        ? pageWords.filter(w => w.status > 0 && w.status < 4)
        : pageWords;

    const selected = pageWords.find(w => w.word === selectedWord);

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
                pt: 'pt-BR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN',
                ru: 'ru-RU', ko: 'ko-KR', nl: 'nl-NL',
            };
            utterance.lang = langMap[lang] || lang;
            utterance.rate = 0.8;
            speechSynthesis.speak(utterance);
        }
    };

    return (
        <div className="side-panel">
            <audio ref={audioRef} hidden />

            {/* When a sentence is selected — show translation block */}
            {selectedSentence ? (
                <div className="sp-sentence-card">
                    <div className="sp-section-label">Selected Text</div>
                    <div className="sp-sentence-text">{selectedSentence}</div>
                    <div className="sp-section-label" style={{ marginTop: '16px' }}>Translation</div>
                    {sentenceLoading ? (
                        <div className="sp-meaning-card muted">
                            <span className="sp-meaning-text">Translating...</span>
                        </div>
                    ) : sentenceTranslation ? (
                        <div className="sp-meaning-card">
                            <span className="sp-meaning-text">{sentenceTranslation}</span>
                        </div>
                    ) : null}
                </div>
            ) : selected ? (
                <>
                    {/* Word header */}
                    <div className="sp-word-header">
                        <button
                            className={`sp-audio-btn ${audioLoading ? 'loading' : ''}`}
                            onClick={() => playAudio(selected.word)}
                            disabled={audioLoading}
                            title="Play pronunciation"
                        >
                            {audioLoading ? '⏳' : '🔊'}
                        </button>
                        <span className="sp-word-title">{selected.word}</span>
                        {selected.ipa && <span className="sp-word-ipa">{selected.ipa}</span>}
                    </div>

                    {/* Status badge row */}
                    <div className="sp-status-row">
                        <div className={`sp-status-dot level-${selected.status}`} />
                        <span className="sp-status-num">{selected.status}</span>
                    </div>

                    {/* Translation / meaning section */}
                    <div className="sp-section">
                        <div className="sp-section-label">Translation</div>
                        {selected.translation ? (
                            <div className="sp-meaning-card">
                                <span className="sp-meaning-text">{selected.translation}</span>
                            </div>
                        ) : (
                            <div className="sp-meaning-card muted">
                                <span className="sp-meaning-text">Click to look up...</span>
                            </div>
                        )}
                    </div>

                    {/* Meanings list */}
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

                    {/* Status buttons (bottom bar) — 1 2 3 4 + check */}
                    <div className="sp-status-bar">
                        <button
                            className={`sp-status-btn trash`}
                            onClick={() => onStatusChange(selected.word, 0)}
                            title="Remove"
                        >🗑</button>
                        {[1, 2, 3, 4].map(n => (
                            <button
                                key={n}
                                className={`sp-status-btn level-${n} ${selected.status === n ? 'active' : ''}`}
                                onClick={() => onStatusChange(selected.word, n)}
                                title={['', 'New', 'Recognized', 'Familiar', 'Known'][n]}
                            >
                                {n}
                            </button>
                        ))}
                        <button
                            className={`sp-status-btn check ${selected.status === 4 ? 'active' : ''}`}
                            onClick={() => onStatusChange(selected.word, 4)}
                            title="Mark as Known"
                        >✓</button>
                    </div>
                </>
            ) : (
                /* No word selected — show word list */
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
                                <div className={`wordlist-badge level-${w.status}`}>
                                    {w.status > 0 ? w.status : ''}
                                </div>
                                <div className="wordlist-content">
                                    <div className="wordlist-word">{w.word}</div>
                                    <div className="wordlist-meaning">{w.translation || ''}</div>
                                </div>
                            </div>
                        ))}
                        {filteredWords.length === 0 && (
                            <div className="wordlist-empty">
                                {activeTab === 'new' ? 'No new words on this page! 🎉' : 'No words found'}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
