'use client';

// Circular SVG flags, slightly desaturated to sit well in the Quiet Paper palette.
// Windows has no emoji flags, so these are drawn by hand.
const FLAGS = {
    fr: (
        <>
            <rect x="0" y="0" width="6.67" height="20" fill="#3a5fa0" />
            <rect x="6.67" y="0" width="6.66" height="20" fill="#f2efe6" />
            <rect x="13.33" y="0" width="6.67" height="20" fill="#c04a42" />
        </>
    ),
    en: (
        <>
            <rect width="20" height="20" fill="#31508f" />
            <path d="M0 0L20 20M20 0L0 20" stroke="#f2efe6" strokeWidth="4.5" />
            <path d="M0 0L20 20M20 0L0 20" stroke="#c04a42" strokeWidth="1.8" />
            <path d="M10 0V20M0 10H20" stroke="#f2efe6" strokeWidth="6" />
            <path d="M10 0V20M0 10H20" stroke="#c04a42" strokeWidth="3.2" />
        </>
    ),
    es: (
        <>
            <rect width="20" height="20" fill="#c04a42" />
            <rect y="5" width="20" height="10" fill="#e0b23f" />
        </>
    ),
    de: (
        <>
            <rect width="20" height="6.67" fill="#33302a" />
            <rect y="6.67" width="20" height="6.66" fill="#c04a42" />
            <rect y="13.33" width="20" height="6.67" fill="#e0b23f" />
        </>
    ),
    it: (
        <>
            <rect x="0" width="6.67" height="20" fill="#55854f" />
            <rect x="6.67" width="6.66" height="20" fill="#f2efe6" />
            <rect x="13.33" width="6.67" height="20" fill="#c04a42" />
        </>
    ),
    pt: (
        <>
            <rect width="20" height="20" fill="#4d8a4f" />
            <polygon points="10,3.2 17,10 10,16.8 3,10" fill="#e6c04a" />
            <circle cx="10" cy="10" r="3.1" fill="#31508f" />
        </>
    ),
    pl: (
        <>
            <rect width="20" height="10" fill="#f2efe6" />
            <rect y="10" width="20" height="10" fill="#c04a42" />
        </>
    ),
    ja: (
        <>
            <rect width="20" height="20" fill="#f2efe6" />
            <circle cx="10" cy="10" r="5" fill="#c04a42" />
        </>
    ),
    zh: (
        <>
            <rect width="20" height="20" fill="#c04a42" />
            <polygon
                points="10,4.2 11.7,7.9 15.8,8.3 12.7,11 13.6,15 10,12.9 6.4,15 7.3,11 4.2,8.3 8.3,7.9"
                fill="#e6c04a"
            />
        </>
    ),
    ru: (
        <>
            <rect width="20" height="6.67" fill="#f2efe6" />
            <rect y="6.67" width="20" height="6.66" fill="#3a5fa0" />
            <rect y="13.33" width="20" height="6.67" fill="#c04a42" />
        </>
    ),
    ko: (
        <>
            <rect width="20" height="20" fill="#f2efe6" />
            <path d="M5 10a5 5 0 0 1 10 0z" fill="#c04a42" />
            <path d="M15 10a5 5 0 0 1-10 0z" fill="#3a5fa0" />
        </>
    ),
    nl: (
        <>
            <rect width="20" height="6.67" fill="#c04a42" />
            <rect y="6.67" width="20" height="6.66" fill="#f2efe6" />
            <rect y="13.33" width="20" height="6.67" fill="#31508f" />
        </>
    ),
};

export default function Flag({ code, size = 20 }) {
    const art = FLAGS[code];
    return (
        <svg
            className="flag"
            width={size}
            height={size}
            viewBox="0 0 20 20"
            aria-hidden="true"
        >
            {art || (
                <>
                    <rect width="20" height="20" fill="#b8ae9c" />
                    <text
                        x="10"
                        y="13.5"
                        textAnchor="middle"
                        fontSize="8"
                        fontWeight="700"
                        fill="#fdfaf4"
                        fontFamily="inherit"
                    >
                        {(code || '?').slice(0, 2).toUpperCase()}
                    </text>
                </>
            )}
            <circle cx="10" cy="10" r="9.5" fill="none" stroke="rgba(30,22,12,0.15)" />
        </svg>
    );
}
