import { NextResponse } from 'next/server';
import { aiFetch, AIServiceError } from '@/lib/aiService';

// POST /api/languages/install — download + install the translation model for a
// language. Argos packages are ~100MB each, so allow a generous timeout.
export async function POST(request) {
    try {
        const { language } = await request.json();
        if (!language) {
            return NextResponse.json({ error: 'language is required' }, { status: 400 });
        }
        const res = await aiFetch('/install-language', {
            body: { language },
            timeoutMs: 600000,
        });
        return NextResponse.json(await res.json());
    } catch (error) {
        if (error instanceof AIServiceError) {
            return NextResponse.json(
                { error: 'The local AI service is unavailable. Start it with `npm run ai`.', detail: error.message },
                { status: 503 }
            );
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
