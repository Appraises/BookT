'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import BookCard from '@/components/BookCard';
import UploadModal from '@/components/UploadModal';
import LangSwitcher from '@/components/LangSwitcher';
import LanguageManager from '@/components/LanguageManager';

const SELECTED_LANGUAGE_KEY = 'bookt-selected-language';

const LANGUAGE_NAMES = {
  fr: 'French',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  pl: 'Polish',
  ja: 'Japanese',
  zh: 'Chinese',
  ru: 'Russian',
  ko: 'Korean',
  nl: 'Dutch',
};

function languageName(code) {
  return LANGUAGE_NAMES[code] || code?.toUpperCase() || 'Language';
}

export default function LibraryPage() {
  const [books, setBooks] = useState([]);
  const [languageStats, setLanguageStats] = useState([]);
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const [dueCount, setDueCount] = useState(0);
  const router = useRouter();

  const fetchBooks = async () => {
    const res = await fetch('/api/books');
    const data = await res.json();
    setBooks(Array.isArray(data) ? data : []);
    return Array.isArray(data) ? data : [];
  };

  const fetchLanguageStats = async () => {
    const res = await fetch('/api/stats');
    const data = await res.json();
    const languages = Array.isArray(data.languages) ? data.languages : [];
    setLanguageStats(languages);
    return languages;
  };

  useEffect(() => {
    let cancelled = false;

    const loadLibrary = async () => {
      try {
        const [loadedBooks, loadedLanguages] = await Promise.all([
          fetchBooks(),
          fetchLanguageStats(),
        ]);

        if (cancelled) return;

        const availableLanguages = loadedLanguages.length > 0
          ? loadedLanguages.map((item) => item.language)
          : [...new Set(loadedBooks.map((book) => book.language))];
        const savedLanguage = localStorage.getItem(SELECTED_LANGUAGE_KEY);
        const nextLanguage = availableLanguages.includes(savedLanguage)
          ? savedLanguage
          : availableLanguages[0] || '';

        setSelectedLanguage(nextLanguage);
        if (nextLanguage) localStorage.setItem(SELECTED_LANGUAGE_KEY, nextLanguage);
      } catch (err) {
        console.error('Failed to fetch library:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadLibrary();
    return () => { cancelled = true; };
  }, []);

  const availableLanguages = useMemo(() => {
    const fromStats = languageStats.map((item) => item.language);
    const fromBooks = books.map((book) => book.language);
    return [...new Set([...fromStats, ...fromBooks])].filter(Boolean);
  }, [books, languageStats]);

  useEffect(() => {
    if (availableLanguages.length === 0) {
      setSelectedLanguage('');
      return;
    }

    if (selectedLanguage && availableLanguages.includes(selectedLanguage)) return;

    const nextLanguage = availableLanguages[0];
    setSelectedLanguage(nextLanguage);
    localStorage.setItem(SELECTED_LANGUAGE_KEY, nextLanguage);
  }, [availableLanguages, selectedLanguage]);

  // Due flashcards for the selected language (badge on the flashcards chip)
  useEffect(() => {
    if (!selectedLanguage) {
      setDueCount(0);
      return;
    }
    let cancelled = false;
    fetch(`/api/flashcards?language=${encodeURIComponent(selectedLanguage)}&limit=1`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setDueCount(data?.stats?.due || 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedLanguage]);

  const selectedStats = languageStats.find((item) => item.language === selectedLanguage) || {
    language: selectedLanguage,
    total: 0,
    learning: 0,
    known: 0,
    bookCount: books.filter((book) => book.language === selectedLanguage).length,
  };

  const filteredBooks = selectedLanguage
    ? books.filter((book) => book.language === selectedLanguage)
    : books;

  const handleLanguageChange = (language) => {
    setSelectedLanguage(language);
    if (language) localStorage.setItem(SELECTED_LANGUAGE_KEY, language);
  };

  const handleBookClick = (id) => {
    router.push(`/read/${id}`);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this book?')) return;
    try {
      await fetch(`/api/books/${id}`, { method: 'DELETE' });
      await Promise.all([fetchBooks(), fetchLanguageStats()]);
    } catch (err) {
      console.error('Failed to delete book:', err);
    }
  };

  const handleUpload = async (book) => {
    setBooks((prev) => [book, ...prev]);
    handleLanguageChange(book.language);
    await fetchLanguageStats();
  };

  const selectedLanguageName = selectedLanguage ? languageName(selectedLanguage) : 'Library';
  const hasBooks = books.length > 0;
  const hasLanguageBooks = filteredBooks.length > 0;

  return (
    <>
      <nav className="navbar">
        <Link href="/" className="navbar-brand">
          <span className="navbar-brand-text">BookT</span>
        </Link>
        <div className="navbar-actions">
          <LangSwitcher
            languages={availableLanguages}
            value={selectedLanguage}
            onChange={handleLanguageChange}
            count={selectedLanguage ? selectedStats.total : undefined}
            counts={Object.fromEntries(languageStats.map((item) => [item.language, item.total]))}
            onAdd={() => setLanguagesOpen(true)}
          />
          <button className="nav-chip" title="Languages" onClick={() => setLanguagesOpen(true)}>
            <svg className="nav-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
            </svg>
          </button>
          <Link href="/flashcards" className="nav-chip" title="Flashcards">
            <svg className="nav-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="6" width="13" height="15" rx="2" />
              <path d="M8 6V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-1" />
            </svg>
            {dueCount > 0 && <span className="nav-chip-badge">{dueCount > 99 ? '99+' : dueCount}</span>}
          </Link>
          <Link href="/stats" className="nav-chip" title="Stats">
            <svg className="nav-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
            </svg>
          </Link>
          <ThemeToggle />
        </div>
      </nav>

      <div className="app-container">
        <div className="library-header">
          <div>
            <h1 className="library-title">{selectedLanguage ? `${selectedLanguageName} Library` : 'My Library'}</h1>
            <p className="library-subtitle">
              {selectedLanguage ? (
                <>
                  {filteredBooks.length} {filteredBooks.length === 1 ? 'book' : 'books'}
                  {' · '}
                  {selectedStats.known} known / {selectedStats.total} seen lemmas
                </>
              ) : (
                <>
                  {books.length} {books.length === 1 ? 'book' : 'books'}
                </>
              )}
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setUploadOpen(true)}
          >
            Upload Book
          </button>
        </div>

        {loading ? (
          <div className="loading-overlay">
            <div className="spinner" />
          </div>
        ) : !hasBooks ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H12v17H4.5A2.5 2.5 0 0 0 2 21.5v-17z" />
                <path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H12v17h7.5a2.5 2.5 0 0 1 2.5 2.5v-17z" />
              </svg>
            </div>
            <div className="empty-state-title">No books yet</div>
            <div className="empty-state-text">
              Upload a PDF or EPUB in a foreign language to start your reading journey.
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: '20px' }}
              onClick={() => setUploadOpen(true)}
            >
              Upload your first book
            </button>
          </div>
        ) : !hasLanguageBooks ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H12v17H4.5A2.5 2.5 0 0 0 2 21.5v-17z" />
                <path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H12v17h7.5a2.5 2.5 0 0 1 2.5 2.5v-17z" />
              </svg>
            </div>
            <div className="empty-state-title">No {selectedLanguageName} books yet</div>
            <div className="empty-state-text">
              Upload a book while {selectedLanguageName} is selected to add it to this library.
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: '20px' }}
              onClick={() => setUploadOpen(true)}
            >
              Upload {selectedLanguageName} book
            </button>
          </div>
        ) : (
          <div className="library-grid">
            <div
              className="upload-card"
              onClick={() => setUploadOpen(true)}
            >
              <div className="upload-card-icon">+</div>
              <div className="upload-card-text">Add new book</div>
              <div className="upload-card-hint">{selectedLanguageName}</div>
            </div>
            {filteredBooks.map((book) => (
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
        initialLanguage={selectedLanguage || undefined}
        onClose={() => setUploadOpen(false)}
        onUpload={handleUpload}
      />

      <LanguageManager
        open={languagesOpen}
        onClose={() => setLanguagesOpen(false)}
      />
    </>
  );
}
