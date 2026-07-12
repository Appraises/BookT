'use client';

import { useState, useRef } from 'react';

const POLL_MS = 2500;
const POLL_LIMIT = 1440; // ~60 min of polling before giving up

// Upload with real progress (fetch can't report request-body progress).
function uploadWithProgress(url, formData, onPct) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch { reject(new Error('Unexpected server response')); }
        };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(formData);
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function ChapterModal({ open, onClose, bookId, chapters, onChapterUpdate }) {
    // chapterId -> { phase, pct, label, fileName } drives each row's progress UI.
    // Kept while the modal is closed too — the component stays mounted, so the
    // queue keeps working in the background.
    const [jobs, setJobs] = useState({});
    const pendingRef = useRef([]);   // [{ chapterId, file | null (re-sync) }]
    const processingRef = useRef(false);
    const fileRef = useRef(null);
    const targetChapterRef = useRef(null);

    const updateJob = (chapterId, patch) => {
        setJobs(prev => ({ ...prev, [chapterId]: { ...prev[chapterId], ...patch } }));
    };
    const clearJob = (chapterId, delay) => {
        setTimeout(() => {
            setJobs(prev => {
                const next = { ...prev };
                delete next[chapterId];
                return next;
            });
        }, delay);
    };

    // Follow one alignment job to the end, relaying progress to the row.
    const followJob = async (chapterId, jobId, audioUrl) => {
        for (let i = 0; i < POLL_LIMIT; i++) {
            await sleep(POLL_MS);
            let data;
            try {
                const res = await fetch(`/api/books/${bookId}/chapters/sync?jobId=${jobId}&chapterId=${chapterId}`);
                data = await res.json();
            } catch {
                continue; // transient network hiccup — keep polling
            }

            if (data.status === 'queued') {
                updateJob(chapterId, { phase: 'waiting', label: 'Waiting for aligner…', pct: null });
            } else if (data.status === 'transcribing') {
                updateJob(chapterId, {
                    phase: 'transcribing',
                    label: 'Transcribing…',
                    pct: Math.round((data.progress || 0) * 100),
                });
            } else if (data.status === 'aligning') {
                updateJob(chapterId, { phase: 'aligning', label: 'Matching sentences…', pct: 100 });
            } else if (data.status === 'synced') {
                updateJob(chapterId, { phase: 'done', label: `Synced — ${data.syncCount} sentences`, pct: 100 });
                onChapterUpdate?.(chapterId, audioUrl, 'synced');
                clearJob(chapterId, 1800);
                return;
            } else {
                updateJob(chapterId, {
                    phase: 'error',
                    label: data.error || 'No sync (is the AI service running?)',
                    pct: null,
                });
                onChapterUpdate?.(chapterId, audioUrl, 'uploaded_no_sync');
                clearJob(chapterId, 6000);
                return;
            }
        }
        updateJob(chapterId, { phase: 'error', label: 'Alignment timed out', pct: null });
        clearJob(chapterId, 6000);
    };

    const processItem = async ({ chapterId, file }) => {
        try {
            let data;
            if (file) {
                updateJob(chapterId, { phase: 'uploading', label: 'Uploading…', pct: 0 });
                const formData = new FormData();
                formData.append('audio', file);
                formData.append('chapterId', chapterId);
                data = await uploadWithProgress(
                    `/api/books/${bookId}/chapters`,
                    formData,
                    (pct) => updateJob(chapterId, { pct })
                );
            } else {
                updateJob(chapterId, { phase: 'waiting', label: 'Starting re-sync…', pct: null });
                const res = await fetch(`/api/books/${bookId}/chapters`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chapterId }),
                });
                data = await res.json();
            }

            if (data.jobId) {
                updateJob(chapterId, { phase: 'waiting', label: 'Waiting for aligner…', pct: null });
                await followJob(chapterId, data.jobId, data.audioUrl);
            } else if (data.audioUrl) {
                // Stored but not aligned (AI service offline) — audio still usable.
                updateJob(chapterId, { phase: 'error', label: data.error || 'No sync (AI service offline?)', pct: null });
                onChapterUpdate?.(chapterId, data.audioUrl, data.status || 'uploaded_no_sync');
                clearJob(chapterId, 6000);
            } else {
                updateJob(chapterId, { phase: 'error', label: data.error || 'Upload failed', pct: null });
                clearJob(chapterId, 6000);
            }
        } catch (err) {
            console.error('Chapter audio processing failed:', err);
            updateJob(chapterId, { phase: 'error', label: 'Error — try again', pct: null });
            clearJob(chapterId, 6000);
        }
    };

    // One item at a time: the aligner is serial anyway, and a single moving
    // progress bar with the rest marked "Queued" reads clearly.
    const pump = async () => {
        if (processingRef.current) return;
        processingRef.current = true;
        while (pendingRef.current.length > 0) {
            await processItem(pendingRef.current.shift());
        }
        processingRef.current = false;
    };

    const enqueue = (items) => {
        for (const item of items) {
            updateJob(item.chapterId, {
                phase: 'queued',
                label: item.file ? `Queued — ${item.file.name}` : 'Queued — re-sync',
                pct: null,
                fileName: item.file?.name || null,
            });
            pendingRef.current.push(item);
        }
        pump();
    };

    // Map picked files onto chapters. A number in the filename that matches an
    // open chapter wins ("04 - chapitre.mp3" -> chapter 4); the rest pair up in
    // name order with the remaining chapters without audio.
    const assignFiles = (files, preferredChapterId) => {
        const busy = new Set(Object.keys(jobs));
        let available = chapters.filter(ch => !ch.audioUrl && !busy.has(ch.id));

        if (files.length === 1 && preferredChapterId) {
            return [{ chapterId: preferredChapterId, file: files[0] }];
        }

        const assignments = [];
        const remainingFiles = [];
        for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
            const numbers = (file.name.match(/\d+/g) || []).map(Number);
            const match = available.find(ch => numbers.includes(ch.number));
            if (match) {
                assignments.push({ chapterId: match.id, file });
                available = available.filter(ch => ch.id !== match.id);
            } else {
                remainingFiles.push(file);
            }
        }
        for (const file of remainingFiles) {
            const chapter = available.shift();
            if (!chapter) break; // more files than open chapters — ignore extras
            assignments.push({ chapterId: chapter.id, file });
        }
        return assignments;
    };

    if (!open) return null;

    const activeCount = Object.values(jobs).filter(j => j.phase !== 'done' && j.phase !== 'error').length;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="chapter-modal" onClick={e => e.stopPropagation()}>
                <div className="chapter-modal-header">
                    <h2>Chapters</h2>
                    <span className="chapter-modal-count">
                        {chapters.length} chapters{activeCount > 0 ? ` · ${activeCount} in queue` : ''}
                    </span>
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                            targetChapterRef.current = null;
                            fileRef.current?.click();
                        }}
                        title="Pick several audio files — they are matched to chapters by the number in the filename"
                    >
                        + Add multiple
                    </button>
                    <button className="btn btn-ghost chapter-modal-close" onClick={onClose}>✕</button>
                </div>

                <div className="chapter-list">
                    {chapters.map(ch => {
                        const job = jobs[ch.id];
                        return (
                            <div key={ch.id} className={`chapter-item ${ch.audioUrl ? 'has-audio' : ''}`}>
                                <div className="chapter-item-info">
                                    <div className="chapter-item-number">Ch. {ch.number}</div>
                                    <div className="chapter-item-title">{ch.title}</div>
                                    <div className="chapter-item-pages">
                                        Pages {ch.startPage}–{ch.endPage}
                                    </div>
                                </div>

                                <div className="chapter-item-audio">
                                    {job ? (
                                        <div className={`chapter-progress ${job.phase}`}>
                                            <div className="chapter-progress-head">
                                                <span className="chapter-progress-label">{job.label}</span>
                                                {job.pct != null && job.phase !== 'error' && (
                                                    <span className="chapter-progress-pct">{job.pct}%</span>
                                                )}
                                            </div>
                                            {job.phase !== 'error' && (
                                                <div className={`chapter-progress-track ${job.pct == null ? 'indeterminate' : ''}`}>
                                                    <div
                                                        className="chapter-progress-fill"
                                                        style={job.pct != null ? { width: `${job.pct}%` } : undefined}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    ) : ch.audioUrl ? (
                                        <div className="chapter-audio-actions">
                                            <div className="chapter-audio-badge">
                                                <span>Audio synced</span>
                                            </div>
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => enqueue([{ chapterId: ch.id, file: null }])}
                                                title="Re-align this chapter's audio (upgrades older sync)"
                                            >
                                                Re-sync
                                            </button>
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
                        );
                    })}
                </div>

                <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept=".mp3,.m4a,.wav,.ogg,.flac"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length > 0) {
                            enqueue(assignFiles(files, targetChapterRef.current));
                        }
                        targetChapterRef.current = null;
                        e.target.value = '';
                    }}
                />
            </div>
        </div>
    );
}
