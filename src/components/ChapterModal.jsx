'use client';

import { useState, useRef } from 'react';

export default function ChapterModal({ open, onClose, bookId, chapters, onChapterUpdate }) {
    const [uploading, setUploading] = useState(null); // chapter ID being uploaded
    const [uploadProgress, setUploadProgress] = useState('');
    const fileRef = useRef(null);
    const targetChapterRef = useRef(null);

    if (!open) return null;

    const handleAudioUpload = async (chapterId, file) => {
        setUploading(chapterId);
        setUploadProgress('Uploading...');

        try {
            const formData = new FormData();
            formData.append('audio', file);
            formData.append('chapterId', chapterId);

            setUploadProgress('Uploading & syncing with Whisper...');

            const res = await fetch(`/api/books/${bookId}/chapters`, {
                method: 'POST',
                body: formData,
            });

            const data = await res.json();

            if (data.audioUrl) {
                setUploadProgress('Done!');
                onChapterUpdate?.(chapterId, data.audioUrl, data.status);
                setTimeout(() => {
                    setUploading(null);
                    setUploadProgress('');
                }, 1000);
            } else {
                setUploadProgress('Failed');
                setTimeout(() => {
                    setUploading(null);
                    setUploadProgress('');
                }, 2000);
            }
        } catch (err) {
            console.error('Chapter audio upload failed:', err);
            setUploadProgress('Error');
            setTimeout(() => {
                setUploading(null);
                setUploadProgress('');
            }, 2000);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="chapter-modal" onClick={e => e.stopPropagation()}>
                <div className="chapter-modal-header">
                    <h2>📚 Chapters</h2>
                    <span className="chapter-modal-count">{chapters.length} chapters</span>
                    <button className="btn btn-ghost chapter-modal-close" onClick={onClose}>✕</button>
                </div>

                <div className="chapter-list">
                    {chapters.map(ch => (
                        <div key={ch.id} className={`chapter-item ${ch.audioUrl ? 'has-audio' : ''}`}>
                            <div className="chapter-item-info">
                                <div className="chapter-item-number">Ch. {ch.number}</div>
                                <div className="chapter-item-title">{ch.title}</div>
                                <div className="chapter-item-pages">
                                    Pages {ch.startPage}–{ch.endPage}
                                </div>
                            </div>

                            <div className="chapter-item-audio">
                                {uploading === ch.id ? (
                                    <div className="chapter-uploading">
                                        <div className="spinner" style={{ width: '20px', height: '20px' }} />
                                        <span className="chapter-upload-text">{uploadProgress}</span>
                                    </div>
                                ) : ch.audioUrl ? (
                                    <div className="chapter-audio-badge">
                                        <span>🎧</span>
                                        <span>Synced</span>
                                    </div>
                                ) : (
                                    <button
                                        className="btn btn-sm btn-primary"
                                        onClick={() => {
                                            targetChapterRef.current = ch.id;
                                            fileRef.current?.click();
                                        }}
                                    >
                                        + Audio
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <input
                    ref={fileRef}
                    type="file"
                    accept=".mp3,.m4a,.wav,.ogg,.flac"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && targetChapterRef.current) {
                            handleAudioUpload(targetChapterRef.current, file);
                        }
                        e.target.value = '';
                    }}
                />
            </div>
        </div>
    );
}
