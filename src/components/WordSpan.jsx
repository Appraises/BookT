'use client';

export default function WordSpan({ text, status, isActive, isAudioHighlighted, onClick }) {
    // status: 1=NEW, 2=RECOGNIZED, 3=FAMILIAR, 4=KNOWN, 0=unseen
    const levelClass = `word-level-${status || 0}`;
    const classes = [
        'word-span',
        levelClass,
        isActive && 'active',
        isAudioHighlighted && 'audio-highlight',
    ].filter(Boolean).join(' ');

    return (
        <span className={classes} onClick={onClick}>
            {text}
        </span>
    );
}
