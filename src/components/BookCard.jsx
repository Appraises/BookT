'use client';

export default function BookCard({ book, onClick, onDelete }) {
    const progress = book.totalPages > 0
        ? Math.round(((book.currentPage - 1) / book.totalPages) * 100)
        : 0;

    const langNames = {
        fr: 'Français', en: 'English', es: 'Español', de: 'Deutsch',
        it: 'Italiano', pt: 'Português', ja: '日本語', zh: '中文',
        ru: 'Русский', ko: '한국어', nl: 'Nederlands',
    };

    return (
        <div className="book-card" onClick={() => onClick(book.id)}>
            <button
                className="book-card-delete btn btn-ghost btn-sm"
                onClick={(e) => { e.stopPropagation(); onDelete(book.id); }}
                title="Delete book"
            >
                🗑️
            </button>
            <div className="book-card-icon">📖</div>
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
    );
}
