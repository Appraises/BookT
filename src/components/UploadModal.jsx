'use client';

import { useEffect, useState, useRef } from 'react';

const LANGUAGES = [
    { code: 'fr', name: 'Français' },
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'de', name: 'Deutsch' },
    { code: 'it', name: 'Italiano' },
    { code: 'pt', name: 'Português' },
    { code: 'pl', name: 'Polski' },
    { code: 'ja', name: '日本語' },
    { code: 'zh', name: '中文' },
    { code: 'ru', name: 'Русский' },
    { code: 'ko', name: '한국어' },
    { code: 'nl', name: 'Nederlands' },
];

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'mp4', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac']);

const AUDIO_MIME_TYPES = {
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    flac: 'audio/flac',
};

function normalizeZipPath(value) {
    return (value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function dirname(path) {
    const normalized = normalizeZipPath(path);
    const index = normalized.lastIndexOf('/');
    return index >= 0 ? normalized.slice(0, index) : '';
}

function resolveHref(basePath, href) {
    const cleanHref = normalizeZipPath((href || '').split('#')[0].split('?')[0]);
    if (!cleanHref) return '';
    if (!basePath) return cleanHref;

    const parts = `${normalizeZipPath(basePath)}/${cleanHref}`.split('/');
    const resolved = [];
    for (const part of parts) {
        if (!part || part === '.') continue;
        if (part === '..') resolved.pop();
        else resolved.push(part);
    }
    return resolved.join('/');
}

function extname(path) {
    const cleanPath = normalizeZipPath(path).split('/').pop() || '';
    const index = cleanPath.lastIndexOf('.');
    return index >= 0 ? cleanPath.slice(index + 1).toLowerCase() : '';
}

function isAudioAsset(path, mediaType = '') {
    return mediaType.toLowerCase().startsWith('audio/') || AUDIO_EXTENSIONS.has(extname(path));
}

function fileNameFromPath(path, fallbackIndex) {
    const base = normalizeZipPath(path).split('/').pop() || `epub-audio-${fallbackIndex}.mp3`;
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, '-');
    return safe || `epub-audio-${fallbackIndex}.mp3`;
}

function findZipFile(zip, path) {
    const normalized = normalizeZipPath(path);
    const decoded = (() => {
        try { return decodeURIComponent(normalized); } catch { return normalized; }
    })();

    if (zip.file(normalized)) return zip.file(normalized);
    if (decoded !== normalized && zip.file(decoded)) return zip.file(decoded);

    const lower = normalized.toLowerCase();
    const match = Object.keys(zip.files).find((entry) => normalizeZipPath(entry).toLowerCase() === lower);
    return match ? zip.file(match) : null;
}

function parseXml(text, type = 'application/xml') {
    return new DOMParser().parseFromString(text, type);
}

function extractMediaReferences(markup) {
    const references = new Set();
    const attrPattern = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    let match;

    while ((match = attrPattern.exec(markup))) {
        const ref = match[1];
        if (isAudioAsset(ref)) references.add(ref);
    }

    return [...references];
}

async function parseEpubPackage(zip) {
    const containerFile = findZipFile(zip, 'META-INF/container.xml');
    if (!containerFile) return null;

    const containerXml = parseXml(await containerFile.async('text'));
    const rootfile = containerXml.getElementsByTagName('rootfile')[0];
    const packagePath = normalizeZipPath(rootfile?.getAttribute('full-path'));
    const packageFile = packagePath ? findZipFile(zip, packagePath) : null;
    if (!packageFile) return null;

    const packageBase = dirname(packagePath);
    const packageXml = parseXml(await packageFile.async('text'));
    const manifest = new Map();

    for (const item of Array.from(packageXml.getElementsByTagName('item'))) {
        const id = item.getAttribute('id');
        const href = item.getAttribute('href') || '';
        if (!id || !href) continue;

        manifest.set(id, {
            id,
            href,
            path: resolveHref(packageBase, href),
            mediaType: item.getAttribute('media-type') || '',
            mediaOverlay: item.getAttribute('media-overlay') || '',
        });
    }

    const spine = Array.from(packageXml.getElementsByTagName('itemref'))
        .map((itemref) => manifest.get(itemref.getAttribute('idref')))
        .filter(Boolean);

    return { manifest, spine };
}

async function extractEmbeddedEpubAudio(arrayBuffer) {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(arrayBuffer);
    const parsed = await parseEpubPackage(zip);
    if (!parsed) return [];

    const allAudio = Array.from(parsed.manifest.values())
        .filter((item) => isAudioAsset(item.path, item.mediaType))
        .sort((a, b) => a.path.localeCompare(b.path));

    if (allAudio.length === 0) return [];

    const usedPaths = new Set();
    const chapterAudio = [];

    const addChapterAudio = (spineIndex, audioPath, source) => {
        const normalized = normalizeZipPath(audioPath);
        if (!normalized || usedPaths.has(`${spineIndex}:${normalized}`)) return;
        const item = allAudio.find((audio) => normalizeZipPath(audio.path) === normalized);
        if (!item || !findZipFile(zip, item.path)) return;

        usedPaths.add(`${spineIndex}:${normalized}`);
        chapterAudio.push({
            spineIndex,
            path: item.path,
            mediaType: item.mediaType || AUDIO_MIME_TYPES[extname(item.path)] || 'audio/mpeg',
            fileName: fileNameFromPath(item.path, chapterAudio.length + 1),
            source,
        });
    };

    for (let spineIndex = 0; spineIndex < parsed.spine.length; spineIndex++) {
        const spineItem = parsed.spine[spineIndex];
        const chapterBase = dirname(spineItem.path);
        const chapterFile = findZipFile(zip, spineItem.path);

        if (chapterFile) {
            const markup = await chapterFile.async('text');
            for (const ref of extractMediaReferences(markup)) {
                addChapterAudio(spineIndex, resolveHref(chapterBase, ref), 'chapter');
            }
        }

        const overlayItem = spineItem.mediaOverlay ? parsed.manifest.get(spineItem.mediaOverlay) : null;
        const overlayFile = overlayItem ? findZipFile(zip, overlayItem.path) : null;
        if (overlayFile) {
            const markup = await overlayFile.async('text');
            const overlayBase = dirname(overlayItem.path);
            for (const ref of extractMediaReferences(markup)) {
                addChapterAudio(spineIndex, resolveHref(overlayBase, ref), 'media-overlay');
            }
        }
    }

    if (chapterAudio.length === 0 && allAudio.length === parsed.spine.length) {
        allAudio.forEach((audio, index) => addChapterAudio(index, audio.path, 'ordered'));
    } else if (chapterAudio.length === 0 && allAudio.length === 1 && parsed.spine.length === 1) {
        addChapterAudio(0, allAudio[0].path, 'single');
    }

    const firstAudioByChapter = new Map();
    for (const audio of chapterAudio) {
        if (!firstAudioByChapter.has(audio.spineIndex)) {
            const file = findZipFile(zip, audio.path);
            firstAudioByChapter.set(audio.spineIndex, {
                ...audio,
                blob: await file.async('blob'),
            });
        }
    }

    return [...firstAudioByChapter.values()];
}

async function uploadEmbeddedAudio(book, embeddedAudio, setProgress) {
    if (!embeddedAudio.length || !Array.isArray(book.chapters)) return book;

    const chaptersByNumber = new Map(book.chapters.map((chapter) => [chapter.number, chapter]));
    const updatedChapters = new Map(book.chapters.map((chapter) => [chapter.id, chapter]));

    for (let index = 0; index < embeddedAudio.length; index++) {
        const audio = embeddedAudio[index];
        const chapter = chaptersByNumber.get(audio.chapterNumber);
        if (!chapter) continue;

        setProgress(92 + Math.round(((index + 1) / embeddedAudio.length) * 7));

        const formData = new FormData();
        formData.append('chapterId', chapter.id);
        formData.append('audio', new File([audio.blob], audio.fileName, { type: audio.mediaType }));

        const res = await fetch(`/api/books/${book.id}/chapters`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            console.warn(`Embedded EPUB audio upload failed for chapter ${chapter.number}`);
            continue;
        }

        const data = await res.json();
        if (data.audioUrl) {
            updatedChapters.set(chapter.id, { ...chapter, audioUrl: data.audioUrl });
        }
    }

    return {
        ...book,
        chapters: book.chapters.map((chapter) => updatedChapters.get(chapter.id) || chapter),
    };
}

export default function UploadModal({ open, initialLanguage, onClose, onUpload }) {
    const [file, setFile] = useState(null);
    const [language, setLanguage] = useState('fr');
    const [title, setTitle] = useState('');
    const [extracting, setExtracting] = useState(false);
    const [progress, setProgress] = useState(0);
    const fileRef = useRef(null);

    useEffect(() => {
        if (open && initialLanguage) setLanguage(initialLanguage);
    }, [open, initialLanguage]);

    if (!open) return null;

    const handleFileChange = (e) => {
        const f = e.target.files?.[0];
        if (f && (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.epub'))) {
            setFile(f);
            // Auto-set title from filename
            setTitle(f.name.replace(/\.(pdf|epub)$/i, ''));
        }
    };

    const handleSubmit = async () => {
        if (!file) return;
        setExtracting(true);
        setProgress(0);

        try {
            const { processPages, classifyEpubSection } = await import('@/lib/pageBreaker');
            const rawPages = [];
            let embeddedAudio = [];

            if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                // PDF Extraction
                const pdfjsLib = await import('pdfjs-dist');
                pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

                const arrayBuffer = await file.arrayBuffer();
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                const totalPdfPages = pdf.numPages;

                for (let i = 1; i <= totalPdfPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const text = textContent.items
                        .map((item) => item.str)
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim();

                    rawPages.push({ pageNumber: i, content: text });
                    setProgress(Math.round((i / totalPdfPages) * 80));
                }
            } else if (file.name.toLowerCase().endsWith('.epub')) {
                // EPUB Extraction
                const ePub = (await import('epubjs')).default;
                const arrayBuffer = await file.arrayBuffer();
                const epubAudio = await extractEmbeddedEpubAudio(arrayBuffer);
                const spineToChapterNumber = new Map();
                const book = ePub();
                await book.open(arrayBuffer, 'binary');

                const spine = await book.loaded.spine;
                const spineItems = spine.spineItems || [];
                const totalSections = spineItems.length;

                // Load every section's text first so classification can weigh
                // each against the whole spine (edge position, length).
                const sections = [];
                for (let i = 0; i < totalSections; i++) {
                    const item = spineItems[i];
                    await item.load(book.load.bind(book));
                    const text = item.document?.body?.textContent || '';
                    item.unload();
                    const cleanText = text.replace(/\s+/g, ' ').trim();
                    if (cleanText) sections.push({ spineIndex: i, cleanText });
                    setProgress(Math.round((i / totalSections) * 80));
                }

                // Only real chapters get a number — front/back matter (cover,
                // dedication, copyright, TOC, author bio) would otherwise offset
                // every chapter and misalign per-chapter audio.
                let classes = sections.map((s) => classifyEpubSection(s.cleanText, s.spineIndex, totalSections));
                // Never leave a book chapter-less: if nothing read as a chapter,
                // fall back to treating every section as one.
                if (!classes.includes('chapter')) classes = classes.map(() => 'chapter');

                let chapterNumber = 0;
                sections.forEach((s, idx) => {
                    if (classes[idx] === 'chapter') {
                        chapterNumber += 1;
                        spineToChapterNumber.set(s.spineIndex, chapterNumber);
                        // Forced marker so pageBreaker splits and numbers it.
                        rawPages.push({ pageNumber: rawPages.length + 1, content: `CHAPTER ${chapterNumber}\n\n` + s.cleanText });
                    } else {
                        // Still readable, but not a numbered chapter (no audio slot).
                        rawPages.push({ pageNumber: rawPages.length + 1, content: s.cleanText });
                    }
                });

                embeddedAudio = epubAudio
                    .map((audio) => ({
                        ...audio,
                        chapterNumber: spineToChapterNumber.get(audio.spineIndex),
                    }))
                    .filter((audio) => audio.chapterNumber);
            }

            // Split into readable pages with chapter detection
            setProgress(85);
            const { pages, chapters } = processPages(rawPages, 700);
            setProgress(90);

            // Send to API
            const res = await fetch('/api/books', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: title || file.name,
                    language,
                    totalPages: pages.length,
                    pages,
                    chapters,
                }),
            });

            if (res.ok) {
                let book = await res.json();
                if (embeddedAudio.length > 0) {
                    book = await uploadEmbeddedAudio(book, embeddedAudio, setProgress);
                }
                setProgress(100);
                onUpload(book);
                onClose();
                setFile(null);
                setTitle('');
                setProgress(0);
            }
        } catch (err) {
            console.error('File extraction failed:', err);
            alert('Failed to extract file text. Please try another file.');
        } finally {
            setExtracting(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-title">Upload a book</div>
                <div className="modal-subtitle">
                    Select a PDF or EPUB in a foreign language to start reading
                </div>

                <div className="modal-field">
                    <label className="modal-label">Book File</label>
                    <div
                        className="upload-card"
                        onClick={() => fileRef.current?.click()}
                        style={{ minHeight: '100px', padding: '20px' }}
                    >
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".pdf,.epub"
                            onChange={handleFileChange}
                            hidden
                        />
                        {file ? (
                            <>
                                <div className="upload-card-icon">✓</div>
                                <div className="upload-card-text">{file.name}</div>
                                <div className="upload-card-hint">
                                    {(file.size / 1024 / 1024).toFixed(1)} MB
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="upload-card-icon">+</div>
                                <div className="upload-card-text">Click to select a PDF or EPUB</div>
                                <div className="upload-card-hint">or drag and drop</div>
                            </>
                        )}
                    </div>
                </div>

                <div className="modal-field">
                    <label className="modal-label">Book Title</label>
                    <input
                        className="modal-input"
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="My French Book"
                    />
                </div>

                <div className="modal-field">
                    <label className="modal-label">Document Language</label>
                    <select
                        className="modal-select"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                    >
                        {LANGUAGES.map((l) => (
                            <option key={l.code} value={l.code}>
                                {l.name}
                            </option>
                        ))}
                    </select>
                </div>

                {extracting && (
                    <div className="progress-bar-container">
                        <div
                            className="progress-bar-fill"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                )}

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose} disabled={extracting}>
                        Cancel
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={handleSubmit}
                        disabled={!file || extracting}
                    >
                        {extracting ? `Extracting… ${progress}%` : 'Import book'}
                    </button>
                </div>
            </div>
        </div>
    );
}
