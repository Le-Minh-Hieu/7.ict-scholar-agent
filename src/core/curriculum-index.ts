/**
 * ICT Curriculum Index
 * Maps every PDF filename to a numeric curriculum order so retrieval
 * results are presented in the correct teaching sequence rather than
 * arbitrary similarity rank.
 *
 * Order (ascending = earlier in curriculum):
 *   100s  — ICT Mentorship Core Content Month 01
 *   200s  — ICT Mentorship Core Content Month 02
 *   ...
 *   1000s — ICT Mentorship Core Content Month 10
 *   1100s — ICT - Trading Plan Development 1-7
 *   1200s — 2022 ICT Mentorship Episode 1-41
 *   1300s — ICT Forex Market Maker Series Vol. 1-5
 *   1400s — ICT Forex Scout Sniper Vol. 1-8
 *   1500s — ICT Forex series (alphabetical)
 *   1600s — 2023 ICT Mentorship
 *   1700s — Other ICT content
 *   9000s — Unclassified
 */

export type CurriculumEntry = {
    filename: string;
    order: number;
    series: string;
    number: number | null;
    label: string;
};

// ── helpers ──────────────────────────────────────────────────────────────────

function extractNumber(str: string): number | null {
    const m = str.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
}

/** Returns a numeric curriculum order for a given PDF filename. */
export function getCurriculumOrder(filename: string): number {
    const f = filename.toLowerCase();

    // ── Core Content Month 01~10 ──────────────────────────────────────────
    // "ICT Mentorship Core Content - Month 01 ..."
    // "ICT Mentorship - Core Content - Month 02 ..."
    {
        const m = f.match(/month\s*0*(\d+)/);
        if (m && f.includes('mentorship') && (f.includes('core content') || f.includes('core-content'))) {
            const month = parseInt(m[1], 10);
            return month * 100;
        }
    }

    // ── Trading Plan Development 1~7 ─────────────────────────────────────
    // "ICT - Trading Plan Development N_Handbook.pdf"
    if (f.includes('trading plan development')) {
        const n = extractNumber(f.replace(/trading plan development/i, '')) ?? 0;
        return 1100 + n * 10;
    }

    // ── 2022 ICT Mentorship Episodes 1~41 ────────────────────────────────
    // "2022 ICT Mentorship Episode N_Handbook.pdf"
    if (f.startsWith('2022') && f.includes('episode')) {
        const n = extractNumber(f.replace(/.*episode\s*/i, '')) ?? 0;
        return 1200 + n * 5;
    }

    // ── ICT Mentorship 2022 Introduction / Episode misc ──────────────────
    if (f.includes('2022') && f.includes('mentorship')) {
        return 1195;
    }

    // ── Market Maker Series Vol. 1~5 ─────────────────────────────────────
    // "ICT Forex - Market Maker Series Vol. N of 5"
    if (f.includes('market maker series')) {
        const n = extractNumber(f.replace(/.*vol\.?\s+/i, '')) ?? 0;
        return 1300 + n * 10;
    }

    // ── Scout Sniper Basic Field Guide Vol. 1~8 ──────────────────────────
    if (f.includes('scout sniper')) {
        const n = extractNumber(f.replace(/.*vol\.?\s+/i, '')) ?? 0;
        return 1400 + n * 10;
    }

    // ── ICT Forex — named topics (alphabetical within 1500s) ─────────────
    if (f.includes('ict forex')) {
        // Assign a stable slot based on alphabetical position within this group
        const topic = f.replace(/ict forex[^a-z]*/i, '').replace(/_handbook\.pdf$/i, '').trim();
        const code  = topic.split('').slice(0, 4).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        return 1500 + (code % 100);
    }

    // ── 2023 ICT Mentorship ───────────────────────────────────────────────
    if (f.startsWith('2023') || (f.includes('2023') && f.includes('mentorship'))) {
        const n = extractNumber(f.replace(/.*ep\s*/i, '')) ?? 0;
        return 1600 + n * 5;
    }

    // ── ICT Mentorship 2023 Ep 01 etc ────────────────────────────────────
    if (f.includes('ict mentorship 2023')) {
        const n = extractNumber(f.replace(/.*ep\s*/i, '')) ?? 0;
        return 1620 + n * 5;
    }

    // ── ICT Institutional Price Action ───────────────────────────────────
    if (f.includes('institutional price action')) {
        const n = extractNumber(f.replace(/.*part\s*/i, '')) ?? 1;
        return 1700 + n * 5;
    }

    // ── Deep Learning / Reviews / Other known ICT content ────────────────
    if (f.includes('deep learning') || f.includes('review') || f.includes('jan')) {
        return 1800;
    }

    if (f.includes('mentorship introduction') || f.includes('mentorship 2022')) {
        return 1195;
    }

    // ── Essentials / standalone topics ───────────────────────────────────
    if (f.includes('essentials')) return 1750;
    if (f.includes('silver bullet')) return 1760;

    return 9000; // unclassified
}

/** Human-readable series label for a filename. */
export function getCurriculumLabel(filename: string): string {
    const f = filename.toLowerCase();

    const monthMatch = f.match(/month\s*0*(\d+)/);
    if (monthMatch && f.includes('mentorship')) return `Core Month ${monthMatch[1].padStart(2, '0')}`;

    if (f.includes('trading plan development')) return `Trading Plan Dev ${extractNumber(f) ?? ''}`;
    if (f.startsWith('2022') && f.includes('episode')) return `2022 Mentorship Ep ${extractNumber(f.replace(/.*episode\s*/i, '')) ?? ''}`;
    if (f.includes('market maker series')) return `Market Maker Vol ${extractNumber(f.replace(/.*vol\.?\s+/i, '')) ?? ''}`;
    if (f.includes('scout sniper')) return `Scout Sniper Vol ${extractNumber(f.replace(/.*vol\.?\s+/i, '')) ?? ''}`;
    if (f.includes('ict forex')) return 'ICT Forex Series';
    if (f.includes('2023')) return '2023 Mentorship';
    return 'Other ICT Content';
}

/**
 * Sort an array of chunks by curriculum order (ascending = foundational first),
 * then by chunkIndex ascending within the same file.
 */
export function sortByCurriculum<T extends { source: string; chunkIndex: number }>(
    chunks: T[],
): T[] {
    return [...chunks].sort((a, b) => {
        const oa = getCurriculumOrder(a.source);
        const ob = getCurriculumOrder(b.source);
        if (oa !== ob) return oa - ob;
        return a.chunkIndex - b.chunkIndex;
    });
}
