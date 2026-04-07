/**
 * PDF Reporter — multi-TF chart + narrator layout.
 * Each narrator section (### N.) gets its own page with the matching TF chart at top.
 *
 * PDFKit cursor rules (CRITICAL):
 *  doc.image()       does NOT advance doc.y  -> must manually: doc.y += h + gap
 *  doc.rect().fill() does NOT advance doc.y  -> must manually: doc.y  = y + h + gap
 *  doc.text()        DOES advance doc.y automatically
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import type { ChartDecisionResult } from '../services/chart-analysis-service';

// ── Palette ──────────────────────────────────────────────────────────────────
const M        = 40;          // page margin
const DARK_BG  = '#0d1117';
const PANEL_BG = '#1a1f2e';
const ROW_A    = '#1e2535';
const ROW_B    = '#141824';
const GOLD     = '#f0c040';
const DIM      = '#a0aab8';
const TX       = '#e6eaf0';   // brighter white for readability
const RED      = '#ff6b6b';
const GREEN    = '#4ddb6e';
const CYAN     = '#26a69a';   // teal — matches chart bullish candle
const FOOTER_T = 'ICT Scholar Agent  ·  Grounded in 244 ICT PDF documents  ·  Not financial advice';

// ── All supported TF keys in HTF→LTF order ──────────────────────────────────
const TF_ALL_ORDER = ['1mo', '1wk', '1w', '1d', '6h', '4h', '3h', '2h', '1h', '45m', '30m', '15m', '5m', '3m', '1m'];

/**
 * Map section index (0-based, 0=HTF Context … 5=Trade Setup, 6=Evidence)
 * to the best chart for that section, using the actual available TFs.
 *
 * Logic: spread sections 0-5 proportionally across availTFs (HTF→LTF),
 *        section 6 (Evidence Summary) always gets the annotated chart.
 */
function tfForSectionIndex(sectionIdx: number, availTFs: string[]): string {
    if (sectionIdx >= 6 || availTFs.length === 0) return 'annotated';
    const i = Math.round((sectionIdx / Math.max(availTFs.length - 1, 5)) * (availTFs.length - 1));
    return availTFs[Math.min(i, availTFs.length - 1)];
}

// ── PDFKit helpers ────────────────────────────────────────────────────────────
function cw(doc: PDFKit.PDFDocument): number {
    return doc.page.width - M * 2;
}

function drawFooter(doc: PDFKit.PDFDocument): void {
    const savedY = doc.y;   // save cursor — PDFKit save()/restore() does NOT restore doc.y
    doc.save()
       .fillColor(DIM).font('Helvetica').fontSize(6.5)
       .text(FOOTER_T, M, doc.page.height - 20, { width: cw(doc), align: 'center', lineBreak: false })
       .restore();
    doc.y = savedY;         // restore cursor to where it was before footer
}

/** Fill the current page with a dark background — must be called right after addPage / at doc start */
function fillPageBg(doc: PDFKit.PDFDocument): void {
    doc.save();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill(DARK_BG);
    doc.restore();
}

/** Stamp footer on current page and open a fresh one */
function addPage(doc: PDFKit.PDFDocument): void {
    drawFooter(doc);
    doc.addPage();
    fillPageBg(doc);
    doc.y = M;
}

/** Coloured pill header bar — does NOT advance doc.y, caller sets it */
function sectionBar(doc: PDFKit.PDFDocument, title: string, barColor = PANEL_BG, textColor = GOLD): void {
    const y = doc.y;
    doc.rect(M, y, cw(doc), 26).fill(barColor);
    doc.fillColor(textColor).font('Helvetica-Bold').fontSize(11)
       .text(title, M + 10, y + 7, { width: cw(doc) - 20 });
    doc.y = y + 34;     // advance past bar
}

/** Render text, auto page-break if near bottom.
 *  Splits very long lines into chunks to avoid PDFKit internal stack overflow
 *  when a single doc.text() call spans multiple pages. */
function safeText(
    doc: PDFKit.PDFDocument,
    text: string,
    opts: { color?: string; font?: string; size?: number; lineGap?: number; indent?: number } = {},
): void {
    const { color = TX, font = 'Helvetica', size = 10, lineGap = 2.0, indent = 0 } = opts;
    const MAX_CHARS = 600;   // max chars per doc.text() call to avoid PDFKit recursion

    // Split by existing newlines first, then chunk long lines
    const rawLines = text.split('\n');
    const chunks: string[] = [];
    for (const line of rawLines) {
        if (line.length <= MAX_CHARS) {
            chunks.push(line);
        } else {
            // Break long line at word boundaries every MAX_CHARS chars
            let remaining = line;
            while (remaining.length > MAX_CHARS) {
                let cut = remaining.lastIndexOf(' ', MAX_CHARS);
                if (cut <= 0) cut = MAX_CHARS;
                chunks.push(remaining.slice(0, cut));
                remaining = remaining.slice(cut).trimStart();
            }
            if (remaining) chunks.push(remaining);
        }
    }

    for (const chunk of chunks) {
        if (doc.y > doc.page.height - M - 28) addPage(doc);
        doc.fillColor(color).font(font).fontSize(size)
           .text(chunk || ' ', M + indent, doc.y, { width: cw(doc) - indent, lineGap, lineBreak: true });
    }
}

/** Embed chart PNG at full column width; advances doc.y */
function embedChart(doc: PDFKit.PDFDocument, imgPath: string | undefined): void {
    if (!imgPath || !fs.existsSync(imgPath)) return;
    const imgW = cw(doc);
    const imgH = Math.round(imgW * (700 / 1200));   // keep 1200×700 source ratio
    if (doc.y + imgH > doc.page.height - M - 30) addPage(doc);
    doc.image(imgPath, M, doc.y, { width: imgW, height: imgH });
    doc.y += imgH + 10;   // MUST advance manually — doc.image() does not
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Render one body line: strip [CATEGORY:...] → blue footnotes,
 * split long paragraph at sentence boundaries for readability.
 */
function renderBodyLine(doc: PDFKit.PDFDocument, raw: string, indent = 0): void {
    // Strip inline bold markers **...**
    const stripped = raw.replace(/\*\*/g, '');

    // Extract all [CATEGORY:...] citations
    const cites = [...stripped.matchAll(/\[CATEGORY:([^\]]+)\]/gi)].map(m => m[1].trim());
    const clean  = stripped.replace(/\[CATEGORY:[^\]]+\]/gi, '').trim();

    if (!clean) return;

    // Split long paragraphs at sentence boundaries (". " or "! " or "? ")
    // so each sentence is at most ~180 chars and we get natural line breaks
    const MAX_SENTENCE = 220;
    const sentences: string[] = [];
    let remaining = clean;
    while (remaining.length > MAX_SENTENCE) {
        // find last sentence-end within window
        const window = remaining.slice(0, MAX_SENTENCE + 40);
        let cut = -1;
        for (const re of [/\.\s+(?=[A-Z])/g, /[!?]\s+/g]) {
            let m: RegExpExecArray | null;
            re.lastIndex = 0;
            while ((m = re.exec(window)) !== null) {
                if (m.index > 30) cut = m.index + m[0].length - 1;
            }
        }
        if (cut <= 0) cut = remaining.lastIndexOf(' ', MAX_SENTENCE) || MAX_SENTENCE;
        sentences.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
    }
    if (remaining) sentences.push(remaining);

    // Render each sentence as its own line
    for (const sentence of sentences) {
        safeText(doc, sentence, { size: 10, lineGap: 2.2, indent });
    }

    // Citations as indented blue footnotes
    for (const cite of cites) {
        safeText(doc, '  ↳ ' + cite, {
            color: '#5b9bd5', font: 'Helvetica', size: 7.5, lineGap: 1.4, indent: indent + 8,
        });
    }
}

export async function generatePdfReport(result: ChartDecisionResult): Promise<string> {
    const base    = result.annotatedImagePath ?? result.imagePath;
    const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // e.g. 2026-04-07T12-30-00
    // If saved in a named session folder (asia/london/nyam/nypm + time), use simple name
    const parentDir = path.basename(path.dirname(base));
    const IN_SESSION_FOLDER = /^(asia|london|nyam|nypm)_\d{2}-\d{2}/.test(parentDir)
        || parentDir.startsWith('session_');
    const pdfPath = IN_SESSION_FOLDER
        ? path.join(path.dirname(base), 'report.pdf')
        : base.replace(/(_annotated)?\.png$/i, `_report_${ts}.pdf`);
    const an      = result.analysis;
    const tfMap   = result.timeframeCharts ?? {};

    /** Resolve the best chart image for a given TF key */
    const availTFs = TF_ALL_ORDER.filter(tf => tfMap[tf] && fs.existsSync(tfMap[tf]));

    function chartFor(tfKey: string): string | undefined {
        if (tfKey === 'annotated') return result.annotatedImagePath ?? result.imagePath;
        if (tfMap[tfKey] && fs.existsSync(tfMap[tfKey])) return tfMap[tfKey];
        // fallback: nearest available TF by global order
        const idx = TF_ALL_ORDER.indexOf(tfKey);
        if (idx >= 0) {
            for (let d = 1; d < TF_ALL_ORDER.length; d++) {
                for (const dir of [1, -1]) {
                    const t = TF_ALL_ORDER[idx + d * dir];
                    if (t && tfMap[t] && fs.existsSync(tfMap[t])) return tfMap[t];
                }
            }
        }
        return result.annotatedImagePath ?? result.imagePath;
    }

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
            const out = fs.createWriteStream(pdfPath);
            doc.pipe(out);

            const W = doc.page.width;

            // Fill page 1 background dark
            fillPageBg(doc);

            // ═══════════════════════════════════════════════════════════════
            // PAGE 1 — Cover: header  +  annotated chart  +  decision table
            // ═══════════════════════════════════════════════════════════════
            // Header band (darker stripe on top of bg)
            doc.rect(0, 0, W, 52).fill('#060a0f');
            doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(16)
               .text('ICT SCHOLAR AGENT', M, 8, { width: W - M * 2 });
            const sub = [`${result.symbol ?? 'N/A'}`, `${result.timeframe ?? 'N/A'}`,
                         new Date(result.timestamp).toUTCString()].join('  ·  ');
            doc.fillColor(DIM).font('Helvetica').fontSize(7.5)
               .text(sub, M, 30, { width: W - M * 2 });
            doc.y = 58;

            // Primary chart (annotated)
            embedChart(doc, result.annotatedImagePath ?? result.imagePath);

            // ── Decision Summary Table ──────────────────────────────────────
            const biasColor = an.htfBias === 'bullish' ? GREEN
                            : an.htfBias === 'bearish' ? RED : GOLD;

            sectionBar(doc, 'TRADING DECISION');

            const rows: Array<[string, string, string?]> = [
                ['HTF BIAS',    (an.htfBias ?? '-').toUpperCase()],
                ['SETUP BIAS',  (an.setup?.bias ?? '-').toUpperCase()],
                ['CONFIDENCE',  String(an.setup?.confidence ?? '-').toUpperCase()],
                ['ENTRY ZONE',  an.setup?.entryZone ?? '-'],
                ['STOP LOSS',   an.setup?.stopLoss ?? '-'],
                ['TARGET',      an.setup?.target ?? '-'],
                ['R : R',       String(an.setup?.rrRatio ?? '-')],
            ];

            const c1 = 130, c2 = cw(doc) - c1;
            for (let i = 0; i < rows.length; i++) {
                const [lbl, val] = rows[i];
                const ry = doc.y;
                const rh = 22;   // taller rows — easier to read
                doc.rect(M,      ry, c1, rh).fill(i % 2 === 0 ? ROW_A : ROW_B);
                doc.rect(M + c1, ry, c2, rh).fill(i % 2 === 0 ? ROW_B : ROW_A);
                doc.fillColor(DIM).font('Helvetica-Bold').fontSize(9)
                   .text(lbl, M + 8, ry + 6, { width: c1 - 12 });
                let vc = TX;
                if (lbl === 'HTF BIAS' || lbl === 'SETUP BIAS') vc = biasColor;
                if (lbl === 'R : R') vc = CYAN;
                if (lbl === 'STOP LOSS') vc = RED;
                if (lbl === 'TARGET') vc = GREEN;
                doc.fillColor(vc).font('Helvetica-Bold').fontSize(9.5)
                   .text(val, M + c1 + 8, ry + 6, { width: c2 - 12 });
                doc.y = ry + rh;
            }
            doc.y += 12;

            // ── Raw Summary ─────────────────────────────────────────────────
            if (an.rawSummary?.trim()) {
                sectionBar(doc, 'SIGNAL SUMMARY');
                for (const line of an.rawSummary.split('\n')) {
                    const l = line.trimEnd();
                    if (l.trim() === '') { doc.moveDown(0.5); continue; }
                    if (doc.y > doc.page.height - M - 28) addPage(doc);
                    renderBodyLine(doc, l, 0);
                    doc.moveDown(0.2);
                }
                doc.moveDown(0.5);
            }
            drawFooter(doc);

            // ═══════════════════════════════════════════════════════════════
            // PAGE 2 — Multi-TF overview grid (2 columns)
            // ═══════════════════════════════════════════════════════════════
            if (availTFs.length > 1) {
                addPage(doc);
                sectionBar(doc, 'MULTI-TIMEFRAME OVERVIEW  —  ' + availTFs.map(t => t.toUpperCase()).join('  ·  '));

                const gap   = 8;
                const gridW = (cw(doc) - gap) / 2;
                const gridH = Math.round(gridW * (700 / 1200));
                let col     = 0;
                let rowTopY = doc.y;

                for (const tf of availTFs) {
                    const imgP = tfMap[tf];
                    if (!imgP || !fs.existsSync(imgP)) continue;
                    const x = M + col * (gridW + gap);
                    // TF label chip
                    doc.rect(x, rowTopY,       gridW, 14).fill(PANEL_BG);
                    doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(8)
                       .text(tf.toUpperCase(), x + 5, rowTopY + 3, { width: gridW - 10 });
                    // chart image
                    doc.image(imgP, x, rowTopY + 14, { width: gridW, height: gridH });
                    col++;
                    if (col >= 2) {
                        col      = 0;
                        rowTopY += 14 + gridH + gap;
                        if (rowTopY + 14 + gridH > doc.page.height - M - 24) {
                            doc.y = rowTopY;
                            addPage(doc);
                            sectionBar(doc, 'MULTI-TIMEFRAME OVERVIEW (CONT.)');
                            rowTopY = doc.y;
                        }
                    }
                }
                // Advance cursor past grid
                doc.y = rowTopY + 14 + gridH + gap;
                drawFooter(doc);
            }

            // ═══════════════════════════════════════════════════════════════
            // NARRATOR SECTION PAGES
            // Each ### N. section gets its own page:
            //   [section title bar]
            //   [matching TF chart image]
            //   [narrator body text]
            // ═══════════════════════════════════════════════════════════════
            const narrator = (an.narratorScript ?? '').trim();
            if (narrator && !narrator.startsWith('(narrator')) {
                // Parse into blocks
                const blocks: Array<{ title: string; lines: string[] }> = [];
                let cur: { title: string; lines: string[] } | null = null;
                for (const raw of narrator.split('\n')) {
                    if (raw.startsWith('### ')) {
                        if (cur) blocks.push(cur);
                        cur = { title: raw.replace(/^###\s*/, '').trim(), lines: [] };
                    } else {
                        cur?.lines.push(raw);
                    }
                }
                if (cur) blocks.push(cur);

                for (let i = 0; i < blocks.length; i++) {
                    const block = blocks[i];
                    addPage(doc);

                    // Title bar
                    sectionBar(doc, block.title);

                    // Chart image: positional — section 0=HTF chart, section last=LTF chart, section 6=annotated
                    const tfKey = tfForSectionIndex(i, availTFs);
                    embedChart(doc, chartFor(tfKey));

                    // Body text
                    for (const raw of block.lines) {
                        const line = raw.trimEnd();

                        // ── skip markdown separator ──────────────────────────
                        if (/^\s*\|[-| :]+\|\s*$/.test(line)) continue;

                        // ── empty line → paragraph gap ───────────────────────
                        if (line.trim() === '') { doc.moveDown(0.6); continue; }

                        // ── markdown table row → styled table ────────────────
                        if (line.startsWith('|')) {
                            const cells = line.split('|').slice(1, -1).map(c => c.trim());
                            if (cells.length === 0) continue;
                            const colW = (cw(doc)) / cells.length;
                            const rowY = doc.y;
                            const rowH = 18;
                            if (rowY + rowH > doc.page.height - M - 28) addPage(doc);
                            cells.forEach((cell, ci) => {
                                const cx = M + ci * colW;
                                doc.rect(cx, rowY, colW, rowH).fill(ci % 2 === 0 ? ROW_A : ROW_B);
                                const shortened = cell.length > 50 ? cell.slice(0, 49) + '…' : cell;
                                doc.fillColor(TX).font('Helvetica').fontSize(8)
                                   .text(shortened, cx + 5, rowY + 5, { width: colW - 8, lineBreak: false });
                            });
                            doc.y = rowY + rowH;
                            continue;
                        }

                        // ── numbered item "1." / "2." → bullet block ─────────
                        const numberedMatch = line.match(/^(\d+)\.\s+(.+)/);
                        if (numberedMatch) {
                            const num  = numberedMatch[1];
                            const body = numberedMatch[2];
                            doc.moveDown(0.3);
                            // Number badge
                            const ny = doc.y;
                            doc.rect(M, ny, 20, 18).fill(PANEL_BG);
                            doc.fillColor(GOLD).font('Helvetica-Bold').fontSize(9)
                               .text(num, M + 4, ny + 4, { width: 14, lineBreak: false });
                            doc.y = ny;
                            // Body text with indent, citations stripped to footnote
                            renderBodyLine(doc, body, 26);
                            doc.moveDown(0.25);
                            continue;
                        }

                        // ── bullet point ─────────────────────────────────────
                        if (/^[-*•]\s/.test(line)) {
                            doc.moveDown(0.2);
                            renderBodyLine(doc, '•  ' + line.replace(/^[-*•]\s+/, ''), 10);
                            doc.moveDown(0.2);
                            continue;
                        }

                        // ── bold heading **text** standalone ─────────────────
                        if (/^\*\*[^*]+\*\*:?\s*$/.test(line.trim())) {
                            doc.moveDown(0.4);
                            const heading = line.replace(/\*\*/g, '').trim();
                            safeText(doc, heading, { font: 'Helvetica-Bold', size: 10.5, color: GOLD });
                            doc.moveDown(0.15);
                            continue;
                        }

                        // ── normal paragraph line ─────────────────────────────
                        renderBodyLine(doc, line, 0);
                        doc.moveDown(0.35);
                    }
                    drawFooter(doc);
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // DRAWING INSTRUCTIONS
            // ═══════════════════════════════════════════════════════════════
            addPage(doc);
            sectionBar(doc, 'DRAWING INSTRUCTIONS');
            if (result.drawingGuide?.trim()) {
                for (const line of result.drawingGuide.split('\n')) {
                    const l = line.trimEnd();
                    if (doc.y > doc.page.height - M - 28) addPage(doc);
                    if (l.trim() === '') { doc.moveDown(0.5); continue; }
                    // Heading lines (ALL-CAPS or starting with #)
                    if (/^#+\s/.test(l) || /^[A-Z][A-Z\s:]{6,}$/.test(l.trim())) {
                        doc.moveDown(0.3);
                        safeText(doc, l.replace(/^#+\s*/, ''), { font: 'Helvetica-Bold', size: 9.5, color: GOLD });
                        doc.moveDown(0.15);
                    } else {
                        safeText(doc, l, { font: 'Courier', size: 8, lineGap: 1.5 });
                    }
                    doc.moveDown(0.15);
                }
            } else {
                safeText(doc, 'No drawing instructions available.', { color: DIM });
            }

            // ── Warnings ────────────────────────────────────────────────────
            if (an.warnings?.length) {
                doc.moveDown(1);
                sectionBar(doc, 'RISK WARNINGS', '#3b1212', RED);
                for (const w of an.warnings) {
                    safeText(doc, '\u26a0  ' + w, { color: RED, size: 8.5, lineGap: 1.6 });
                    doc.moveDown(0.3);
                }
            }
            drawFooter(doc);

            doc.end();
            out.on('finish', () => resolve(pdfPath));
            out.on('error',  reject);
        } catch (err) {
            reject(err);
        }
    });
}
