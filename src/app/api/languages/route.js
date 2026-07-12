import { NextResponse } from 'next/server';
import { aiFetch, AIServiceError } from '@/lib/aiService';

const SUPPORTED = ['fr', 'en', 'es', 'de', 'it', 'pt', 'pl', 'ja', 'zh', 'ru', 'ko', 'nl'];

// GET /api/languages — which languages have translation models installed.
export async function GET() {
    try {
        const res = await aiFetch('/languages', { method: 'GET', timeoutMs: 5000 });
        return NextResponse.json(await res.json());
    } catch (error) {
        // Service down — report nothing installed so the UI can prompt to start it.
        const offline = error instanceof AIServiceError;
        return NextResponse.json({ target: 'pt', supported: SUPPORTED, installed: [], offline });
    }
}
