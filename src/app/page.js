'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import BookCard from '@/components/BookCard';
import UploadModal from '@/components/UploadModal';

export default function LibraryPage() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchBooks();
  }, []);

  const fetchBooks = async () => {
    try {
      const res = await fetch('/api/books');
      const data = await res.json();
      setBooks(data);
    } catch (err) {
      console.error('Failed to fetch books:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBookClick = (id) => {
    router.push(`/read/${id}`);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this book?')) return;
    try {
      await fetch(`/api/books/${id}`, { method: 'DELETE' });
      setBooks((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      console.error('Failed to delete book:', err);
    }
  };

  const handleUpload = (book) => {
    setBooks((prev) => [book, ...prev]);
  };

  return (
    <>
      <nav className="navbar">
        <a href="/" className="navbar-brand">
          <span className="navbar-brand-icon">📚</span>
          <span className="navbar-brand-text">BookT</span>
        </a>
        <div className="navbar-actions">
          <a href="/stats" className="btn btn-ghost">📊 Stats</a>
          <a href="/flashcards" className="btn btn-ghost">🃏 Flashcards</a>
          <ThemeToggle />
        </div>
      </nav>

      <div className="app-container">
        <div className="library-header">
          <div>
            <h1 className="library-title">My Library</h1>
            <p className="library-subtitle">
              {books.length} {books.length === 1 ? 'book' : 'books'}
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setUploadOpen(true)}
          >
            ⬆️ Upload PDF
          </button>
        </div>

        {loading ? (
          <div className="loading-overlay">
            <div className="spinner" />
          </div>
        ) : books.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📖</div>
            <div className="empty-state-title">No books yet</div>
            <div className="empty-state-text">
              Upload a PDF in a foreign language to start your reading journey
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: '20px' }}
              onClick={() => setUploadOpen(true)}
            >
              ⬆️ Upload your first PDF
            </button>
          </div>
        ) : (
          <div className="library-grid">
            <div
              className="upload-card"
              onClick={() => setUploadOpen(true)}
            >
              <div className="upload-card-icon">➕</div>
              <div className="upload-card-text">Add new book</div>
              <div className="upload-card-hint">Upload a PDF</div>
            </div>
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onClick={handleBookClick}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUpload={handleUpload}
      />
    </>
  );
}
