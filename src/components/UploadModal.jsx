'use client';

import { useState, useRef } from 'react';

const LANGUAGES = [
    { code: 'fr', name: 'Français' },
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'de', name: 'Deutsch' },
    { code: 'it', name: 'Italiano' },
    { code: 'pt', name: 'Português' },
    { code: 'ja', name: '日本語' },
    { code: 'zh', name: '中文' },
    { code: 'ru', name: 'Русский' },
    { code: 'ko', name: '한국어' },
    { code: 'nl', name: 'Nederlands' },
];

export default function UploadModal({ open, onClose, onUpload }) {
    const [file, setFile] = useState(null);
    const [language, setLanguage] = useState('fr');
    const [title, setTitle] = useState('');
    const [extracting, setExtracting] = useState(false);
    const [progress, setProgress] = useState(0);
    const fileRef = useRef(null);

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
            const { processPages } = await import('@/lib/pageBreaker');
            const rawPages = [];

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
                const book = ePub();
                await book.open(arrayBuffer, 'binary');

                const spine = await book.loaded.spine;
                const spineItems = spine.spineItems || [];
                const totalChapters = spineItems.length;

                for (let i = 0; i < totalChapters; i++) {
                    const item = spineItems[i];
                    await item.load(book.load.bind(book));
                    const text = item.document?.body?.textContent || '';
                    item.unload();

                    const cleanText = text.replace(/\s+/g, ' ').trim();
                    if (cleanText) {
                        // Mark chapters forcibly so pageBreaker splits them
                        rawPages.push({ pageNumber: i + 1, content: `CHAPTER ${i + 1}\n\n` + cleanText });
                    }
                    setProgress(Math.round((i / totalChapters) * 80));
                }
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
                const book = await res.json();
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
                <div className="modal-title">📄 Upload Book</div>
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
                                <div className="upload-card-icon">📄</div>
                                <div className="upload-card-text">{file.name}</div>
                                <div className="upload-card-hint">
                                    {(file.size / 1024 / 1024).toFixed(1)} MB
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="upload-card-icon">⬆️</div>
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
                        {extracting ? `Extracting... ${progress}%` : '📚 Import Book'}
                    </button>
                </div>
            </div>
        </div>
    );
}
