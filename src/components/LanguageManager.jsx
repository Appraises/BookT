'use client';

import { useState, useEffect, useCallback } from 'react';
import Flag from './Flag';

const NAMES = {
    fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian',
    pt: 'Portuguese', pl: 'Polish', ja: 'Japanese', zh: 'Chinese', ru: 'Russian',
    ko: 'Korean', nl: 'Dutch',
};

export default function LanguageManager({ open, onClose, onInstalled }) {
    const [data, setData] = useState(null);
    const [installing, setInstalling] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/languages');
            setData(await res.json());
        } catch {
            setData({ supported: [], installed: [], offline: true, target: 'pt' });
        }
    }, []);

    useEffect(() => {
        if (open) { setError(''); load(); }
    }, [open, load]);

    if (!open) return null;

    const install = async (language) => {
        setInstalling(language);
        setError('');
        try {
            const res = await fetch('/api/languages/install', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language }),
            });
            const d = await res.json();
            if (!res.ok) {
                setError(d.error || 'Install failed');
            } else {
                await load();
                onInstalled?.(language);
            }
        } catch {
            setError('Install failed — is the local AI service running?');
        } finally {
            setInstalling(null);
        }
    };

    const installed = new Set(data?.installed || []);
    const target = data?.target || 'pt';
    const supported = data?.supported || [];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal lang-manager" onClick={(e) => e.stopPropagation()}>
                <div className="modal-title">Languages</div>
                <div className="modal-subtitle">
                    Install offline translation models for the languages you want to read.
                    Audio sync works for any language without extra downloads.
                </div>

                {data?.offline && (
                    <div className="lang-manager-note">
                        The local AI service isn&apos;t running. Start it with <code>npm run ai</code>, then reopen this.
                    </div>
                )}
                {error && <div className="lang-manager-note error">{error}</div>}

                <div className="lang-manager-list">
                    {supported.map((code) => {
                        const isTarget = code === target;
                        const isInstalled = installed.has(code);
                        return (
                            <div key={code} className="lang-manager-row">
                                <Flag code={code} />
                                <span className="lang-manager-name">{NAMES[code] || code.toUpperCase()}</span>
                                {isTarget ? (
                                    <span className="lang-manager-badge target">Your language</span>
                                ) : installing === code ? (
                                    <span className="lang-manager-installing">
                                        <span className="spinner" style={{ width: '14px', height: '14px' }} /> Downloading…
                                    </span>
                                ) : isInstalled ? (
                                    <span className="lang-manager-badge installed">Installed</span>
                                ) : (
                                    <button
                                        className="btn btn-sm btn-secondary"
                                        disabled={data?.offline || Boolean(installing)}
                                        onClick={() => install(code)}
                                    >
                                        Install
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
