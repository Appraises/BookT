"""
Forced alignment between book text and an audiobook narration.

Whisper transcribes the audio into words with accurate timestamps, but those
words are the *narration's* text — not necessarily identical to the book's text
(mishearings, punctuation, numbers spelled out, OCR quirks). We line the two up
with a sequence match, carry the audio timestamps onto the book words, then
group book words into sentences and emit one sync entry per sentence.

Kept dependency-free (stdlib only) so it can be unit-tested without loading
Whisper. `local_ai_service.py` imports `build_alignment` from here.
"""

import difflib
import re
import unicodedata

# Words: letter runs (with internal ' or -) or digit runs. Unicode-aware.
_WORD_RE = re.compile(r"[^\W\d_]+(?:['\-’][^\W\d_]+)*|\d+", re.UNICODE)

# Split after sentence-ending punctuation (., !, ?, …, », ”, ") followed by space.
_SENT_SPLIT_RE = re.compile(r'(?<=[.!?…»”"])\s+')

_MIN_ENTRY_SECONDS = 0.05


def norm_word(word):
    """Lowercase and strip diacritics so book and narration words compare equal."""
    decomposed = unicodedata.normalize("NFD", word.lower())
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")


def split_sentences(text):
    text = (text or "").strip()
    if not text:
        return []
    parts = [p.strip() for p in _SENT_SPLIT_RE.split(text) if p.strip()]
    return parts or [text]


def flatten_hyp_words(segments):
    """
    Flatten Whisper segments into (normalized_word, start_time) pairs.
    Prefers per-word timestamps; falls back to segment-level timing when a
    segment has no word timestamps.
    """
    words = []
    starts = []
    for seg in segments or []:
        seg_words = getattr(seg, "words", None)
        if seg_words:
            for w in seg_words:
                norm = norm_word((getattr(w, "word", "") or "").strip())
                if not norm:
                    continue
                words.append(norm)
                starts.append(float(getattr(w, "start", 0.0) or 0.0))
        else:
            seg_start = float(getattr(seg, "start", 0.0) or 0.0)
            for token in _WORD_RE.findall(getattr(seg, "text", "") or ""):
                norm = norm_word(token)
                if not norm:
                    continue
                words.append(norm)
                starts.append(seg_start)
    return words, starts


def interpolate(times, duration):
    """
    Replace None entries in a non-decreasing timeline by linear interpolation
    between known anchors, then clamp to a monotonic range within [0, duration].
    Mutates and returns `times`.
    """
    n = len(times)
    if n == 0:
        return times

    known = [i for i in range(n) if times[i] is not None]
    if not known:
        for i in range(n):
            times[i] = duration * i / n if duration else 0.0
        return times

    first = known[0]
    for i in range(first):
        times[i] = times[first] * (i / first) if first else 0.0

    for a, b in zip(known, known[1:]):
        if b > a + 1:
            t0, t1 = times[a], times[b]
            gap = b - a
            for k in range(1, gap):
                times[a + k] = t0 + (t1 - t0) * (k / gap)

    last = known[-1]
    tail = times[last]
    span = max(n - 1 - last, 1)
    for i in range(last + 1, n):
        times[i] = tail + (duration - tail) * ((i - last) / span)

    prev = 0.0
    for i in range(n):
        v = times[i]
        if v is None or v < prev:
            v = prev
        if duration:
            v = min(v, duration)
        times[i] = v
        prev = v
    return times


def proportional_page_alignment(pages, duration):
    """Fallback: one entry per page, time split by page length. Used only when
    the audio yields no usable word stream."""
    clean_pages = [(page or "").strip() for page in pages]
    if not clean_pages:
        return []

    weights = [max(len(page), 1) for page in clean_pages]
    total_weight = sum(weights) or len(clean_pages)
    cursor = 0.0
    alignment = []
    for index, page_text in enumerate(clean_pages, start=1):
        share = weights[index - 1] / total_weight
        end = duration if index == len(clean_pages) else cursor + duration * share
        alignment.append(
            {
                "pageNumber": index,
                "startTime": round(cursor, 2),
                "endTime": round(max(end, cursor + _MIN_ENTRY_SECONDS), 2),
                "text": page_text[:1200],
            }
        )
        cursor = end
    return alignment


def build_alignment(pages, segments, duration):
    """
    Build sentence-level sync entries.

    @param pages: list of page texts (chapter's reading pages, in order)
    @param segments: Whisper segments (each with .text/.start/.end and optional
                     .words[] of objects with .word/.start/.end)
    @param duration: audio duration in seconds
    @return list of {pageNumber, startTime, endTime, text}, pageNumber 1-based
            relative to `pages`, entries contiguous and ordered by time.
    """
    clean_pages = [(page or "").strip() for page in pages]
    if not clean_pages:
        return []

    # Reference stream: book sentences (tagged with page) + flat book words.
    sentences = []   # {pageNumber, text, w0, w1}
    ref_words = []
    for page_index, page_text in enumerate(clean_pages, start=1):
        for sentence_text in split_sentences(page_text):
            w0 = len(ref_words)
            for token in _WORD_RE.findall(sentence_text):
                norm = norm_word(token)
                if norm:
                    ref_words.append(norm)
            sentences.append(
                {
                    "pageNumber": page_index,
                    "text": sentence_text[:600],
                    "w0": w0,
                    "w1": len(ref_words),
                }
            )

    hyp_words, hyp_starts = flatten_hyp_words(segments)

    # Nothing to align against -> degrade to the old proportional split.
    if not ref_words or not hyp_words:
        return proportional_page_alignment(clean_pages, duration)

    # Align book words to narration words; carry timestamps onto book words.
    matcher = difflib.SequenceMatcher(a=ref_words, b=hyp_words, autojunk=False)
    ref_time = [None] * len(ref_words)
    for a0, b0, size in matcher.get_matching_blocks():
        for k in range(size):
            ref_time[a0 + k] = hyp_starts[b0 + k]
    interpolate(ref_time, duration)

    # Sentence start = its first word's time (None if the sentence has no words).
    starts = [
        ref_time[s["w0"]] if s["w1"] > s["w0"] else None
        for s in sentences
    ]
    interpolate(starts, duration)

    # End each sentence where the next one starts, so coverage is gap-free and
    # the reader's `t >= start && t < end` lookup always resolves.
    alignment = []
    n = len(sentences)
    for i, sent in enumerate(sentences):
        start = starts[i]
        end = starts[i + 1] if i + 1 < n else (duration or start + _MIN_ENTRY_SECONDS)
        end = max(end, start + _MIN_ENTRY_SECONDS)
        alignment.append(
            {
                "pageNumber": sent["pageNumber"],
                "startTime": round(start, 2),
                "endTime": round(end, 2),
                "text": sent["text"],
            }
        )
    return alignment
