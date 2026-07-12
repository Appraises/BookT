'use client';

// Deterministic hue from the title so each book keeps its own cover color
function coverHue(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 360;
}

export default function BookCard({ book, onClick, onDelete }) {
    const progress = book.totalPages > 0
        ? Math.round(((book.currentPage - 1) / book.totalPages) * 100)
        : 0;

    const langNames = {
        fr: 'Français', en: 'English', es: 'Español', de: 'Deutsch',
        it: 'Italiano', pt: 'Português', pl: 'Polski', ja: '日本語', zh: '中文',
        ru: 'Русский', ko: '한국어', nl: 'Nederlands',
    };

    return (
        <div className="book-card" onClick={() => onClick(book.id)}>
            <div className="book-cover" style={{ '--cover-hue': coverHue(book.title || '') }}>
                <button
                    className="book-card-delete"
                    onClick={(e) => { e.stopPropagation(); onDelete(book.id); }}
                    title="Delete book"
                >
                    ×
                </button>
                <span className="book-cover-title">{book.title}</span>
                <span className="book-cover-ornament">{book.language}</span>
            </div>
            <div className="book-card-body">
                <div className="book-card-title">{book.title}</div>
                <div className="book-card-meta">
                    <span className="book-card-lang">
                        {langNames[book.language] || book.language}
                    </span>
                    <span className="book-card-pages">{book.totalPages} pages</span>
                </div>
                <div className="book-card-progress">
                    <div
                        className="book-card-progress-bar"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>
        </div>
    );
}
