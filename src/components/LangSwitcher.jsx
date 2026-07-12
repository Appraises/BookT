'use client';

import { useEffect, useRef, useState } from 'react';
import Flag from './Flag';

const LANGUAGE_NAMES = {
    fr: 'French', en: 'English', es: 'Spanish', de: 'German',
    it: 'Italian', pt: 'Portuguese', pl: 'Polish', ja: 'Japanese',
    zh: 'Chinese', ru: 'Russian', ko: 'Korean', nl: 'Dutch',
};

export default function LangSwitcher({ languages, value, onChange, count, counts = {}, onAdd }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDoc);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (!languages || languages.length === 0) return null;

    // LingQ-style: the menu lists the other languages; the chip shows the current one
    const others = languages.filter((code) => code !== value);
    const hasMenu = others.length > 0 || Boolean(onAdd);

    return (
        <div className="lang-switcher" ref={ref}>
            <button
                className={`nav-chip ${open ? 'open' : ''}`}
                onClick={() => hasMenu && setOpen((o) => !o)}
                title="Switch language"
            >
                <Flag code={value} />
                {typeof count === 'number' && <span className="nav-chip-num">{count}</span>}
                {hasMenu && (
                    <svg className="nav-chip-chevron" viewBox="0 0 10 6" fill="none">
                        <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                )}
            </button>

            {open && (
                <div className="lang-menu">
                    {others.map((code) => (
                        <button
                            key={code}
                            className="lang-menu-item"
                            onClick={() => { onChange(code); setOpen(false); }}
                        >
                            <Flag code={code} />
                            <span className="lang-menu-name">{LANGUAGE_NAMES[code] || code.toUpperCase()}</span>
                            {counts[code] != null && (
                                <span className="lang-menu-count">({counts[code]})</span>
                            )}
                        </button>
                    ))}

                    {onAdd && (
                        <>
                            {others.length > 0 && <div className="lang-menu-divider" />}
                            <button
                                className="lang-menu-item lang-menu-add"
                                onClick={() => { setOpen(false); onAdd(); }}
                            >
                                <span className="lang-menu-add-icon">+</span>
                                <span className="lang-menu-name">Add a new language</span>
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
