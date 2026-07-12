/**
 * Single point of contact for the local Python AI service (Whisper alignment,
 * Argos translation, TTS). Centralizes the base URL, timeouts and error
 * handling so routes degrade gracefully when the service is down.
 */

const BASE_URL = (process.env.BOOKT_AI_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

export class AIServiceError extends Error {
    constructor(message, { status, cause } = {}) {
        super(message);
        this.name = 'AIServiceError';
        this.status = status;
        this.cause = cause;
    }
}

/**
 * POST JSON to the AI service with a hard timeout. Throws AIServiceError on
 * network failure, timeout, or non-2xx response.
 * @returns {Promise<Response>} the raw response (caller reads json/blob)
 */
export async function aiFetch(path, { method = 'POST', body, timeoutMs = 15000, headers } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: method === 'GET' || body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
            signal: controller.signal,
        });
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new AIServiceError(`AI service ${path} returned ${res.status}`, {
                status: res.status,
                cause: detail,
            });
        }
        return res;
    } catch (err) {
        if (err instanceof AIServiceError) throw err;
        const reason = err.name === 'AbortError' ? 'timed out' : 'is unreachable';
        throw new AIServiceError(`AI service ${reason} (${BASE_URL}${path})`, { cause: err });
    } finally {
        clearTimeout(timer);
    }
}

/** True if the service answers /health within the timeout. */
export async function aiHealthy(timeoutMs = 3000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${BASE_URL}/health`, { signal: controller.signal });
        return res.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

export const AI_BASE_URL = BASE_URL;
