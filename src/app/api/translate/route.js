import { NextResponse } from 'next/server';

// POST /api/translate
// Body: { text: "Je suis", language: "fr" }
export async function POST(request) {
    try {
        const { text, language } = await request.json();

        if (!text || !language) {
            return NextResponse.json({ error: 'text and language are required' }, { status: 400 });
        }

        // The python backend expects the ISO language code (e.g., "fr")
        // for OPUS-MT translation models lookups.

        const res = await fetch('http://127.0.0.1:8000/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                word: text,
                language: language, // Sending "fr" instead of "French"
            }),
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Python TTS service error (translation block): ${err}`);
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Translation failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
