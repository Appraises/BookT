import { NextResponse } from 'next/server';
import { aiFetch, AIServiceError } from '@/lib/aiService';

// POST /api/translate
// Body: { text: "Je suis", language: "fr" }
export async function POST(request) {
    try {
        const { text, language } = await request.json();

        if (!text || !language) {
            return NextResponse.json({ error: 'text and language are required' }, { status: 400 });
        }

        // The python backend expects the ISO language code (e.g., "fr").
        const res = await aiFetch('/translate', {
            body: { word: text, language },
            timeoutMs: 20000,
        });
        const data = await res.json();
        return NextResponse.json(data);
    } catch (error) {
        if (error instanceof AIServiceError) {
            console.warn('Translation unavailable:', error.message);
            return NextResponse.json(
                { error: 'Translation service unavailable', detail: error.message },
                { status: 503 }
            );
        }
        console.error('Translation failed:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
