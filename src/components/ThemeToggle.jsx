'use client';

import { useState, useEffect } from 'react';

export default function ThemeToggle() {
    const [dark, setDark] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem('bookt-theme');
        if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            setDark(true);
            document.documentElement.setAttribute('data-theme', 'dark');
        }
    }, []);

    const toggle = () => {
        const next = !dark;
        setDark(next);
        document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
        localStorage.setItem('bookt-theme', next ? 'dark' : 'light');
    };

    return (
        <button className="theme-toggle" onClick={toggle} title="Toggle theme">
            {dark ? '☀️' : '🌙'}
        </button>
    );
}
