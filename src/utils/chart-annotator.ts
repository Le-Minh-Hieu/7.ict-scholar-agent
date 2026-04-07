/**
 * ChartAnnotator — Draws ICT analysis zones onto a chart PNG.
 * Uses the same coordinate mapping as chart-generator.ts (W=1200, H=700, PAD=60).
 */
import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import path from 'path';
import { DrawingInstruction } from '../processor/vision-analyzer.js';
import { OhlcvCandle } from '../ingestion/raw-data-parser.js';

const W   = 1200;
const H   = 700;
const PAD = 60;
const chartH = H - PAD * 2;
const chartW = W - PAD * 2;

export class ChartAnnotator {
    /**
     * Load the original chart PNG, draw ICT zones/levels on top, save to outputPath.
     * @param imagePath   original chart PNG
     * @param drawings    drawing instructions from VisionAnalyzer
     * @param candles     candle data (to derive price range for Y-mapping)
     * @param outputPath  where to save the annotated PNG
     */
    async annotate(
        imagePath: string,
        drawings: DrawingInstruction[],
        candles: OhlcvCandle[],
        outputPath: string,
    ): Promise<string> {
        if (!fs.existsSync(imagePath)) throw new Error(`Image not found: ${imagePath}`);
        if (candles.length === 0)      throw new Error('No candle data for coordinate mapping.');

        // ── derive price range (same logic as chart-generator) ──────────────
        const highs  = candles.map(c => c.high);
        const lows   = candles.map(c => c.low);
        const maxP   = Math.max(...highs);
        const minP   = Math.min(...lows);
        const pRange = maxP - minP || 0.0001;

        function toY(price: number): number {
            return PAD + chartH - ((price - minP) / pRange) * chartH;
        }

        // ── load original image onto canvas ──────────────────────────────────
        const canvas = createCanvas(W, H);
        const ctx    = canvas.getContext('2d');
        const img    = await loadImage(imagePath);
        ctx.drawImage(img, 0, 0, W, H);

        // ── draw each instruction ─────────────────────────────────────────────
        let labelOffset = 0;   // stagger overlapping right-side labels
        for (const d of drawings) {
            ctx.save();
            // Map standard colors to ones visible on gray background
            let color = d.color ?? '#1565c0';
            // Remap pure white/near-white → dark so it shows on gray bg
            if (/^#(fff|ffffff|f{6}|fefefe|fdfdfd)/i.test(color)) color = '#1a237e';

            /** Draw a pill-shaped label badge at (lx, ly) */
            const drawBadge = (text: string, lx: number, ly: number, bg: string, fg = '#ffffff') => {
                const pad = 4;
                ctx.font = 'bold 11px sans-serif';
                const tw  = ctx.measureText(text).width;
                ctx.fillStyle   = bg;
                ctx.globalAlpha = 0.88;
                ctx.beginPath();
                const rx = lx - pad, ry = ly - 13, rw = tw + pad * 2, rh = 16;
                ctx.roundRect(rx, ry, rw, rh, 3);
                ctx.fill();
                ctx.globalAlpha = 1;
                ctx.fillStyle   = fg;
                ctx.fillText(text, lx, ly);
            };

            if (d.tool === 'horizontal_line') {
                const price = d.priceLevel;
                if (price == null) { ctx.restore(); continue; }
                const y = toY(price);
                ctx.strokeStyle = color;
                ctx.lineWidth   = 2;
                ctx.setLineDash([8, 4]);
                ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
                ctx.setLineDash([]);
                // Right-side badge with price
                const ly = Math.max(14, Math.min(y + labelOffset, H - PAD - 4));
                drawBadge(`${d.label}  ${price.toFixed(5)}`, W - PAD + 2, ly, color);
                labelOffset = (labelOffset + 18) % 120;
            }

            else if (d.tool === 'rectangle') {
                const zone = d.priceZone;
                if (!zone || zone.high == null || zone.low == null) { ctx.restore(); continue; }
                const yTop  = toY(zone.high);
                const yBot  = toY(zone.low);
                const rectH = Math.abs(yBot - yTop);
                const rTop  = Math.min(yTop, yBot);
                // Semi-transparent fill
                ctx.globalAlpha = 0.22;
                ctx.fillStyle   = color;
                ctx.fillRect(PAD, rTop, chartW, rectH);
                // Border
                ctx.globalAlpha = 0.9;
                ctx.strokeStyle = color;
                ctx.lineWidth   = 2;
                ctx.strokeRect(PAD, rTop, chartW, rectH);
                ctx.globalAlpha = 1;
                // Label inside zone (top-left)
                drawBadge(d.label, PAD + 6, rTop + 13, color);
            }

            else if (d.tool === 'arrow') {
                const from = d.priceZone?.high ?? d.priceLevel;
                const to   = d.priceZone?.low  ?? d.priceLevel;
                if (from == null || to == null) { ctx.restore(); continue; }
                const yFrom = toY(from);
                const yTo   = toY(to);
                const x     = W - PAD - 40;
                ctx.strokeStyle = color;
                ctx.fillStyle   = color;
                ctx.lineWidth   = 2.5;
                ctx.beginPath(); ctx.moveTo(x, yFrom); ctx.lineTo(x, yTo); ctx.stroke();
                const dir = yTo > yFrom ? 1 : -1;
                ctx.beginPath();
                ctx.moveTo(x, yTo);
                ctx.lineTo(x - 7, yTo - dir * 12);
                ctx.lineTo(x + 7, yTo - dir * 12);
                ctx.closePath(); ctx.fill();
                drawBadge(d.label, x - 40, yFrom - 6, color);
            }

            else if (d.tool === 'label') {
                const price = d.priceLevel ?? (d.priceZone ? (d.priceZone.high + d.priceZone.low) / 2 : null);
                if (price == null) { ctx.restore(); continue; }
                drawBadge('◀ ' + d.label, PAD + 8, toY(price) - 4, color);
            }

            ctx.restore();
        }

        // ── Legend strip at bottom ─────────────────────────────────────────────
        ctx.fillStyle   = 'rgba(20,20,30,0.72)';
        ctx.fillRect(PAD, H - PAD - 22, 380, 20);
        ctx.fillStyle = '#e0e0e0';
        ctx.font      = '10.5px sans-serif';
        ctx.fillText('ICT Scholar Agent  ·  annotations from PDF knowledge base', PAD + 6, H - PAD - 7);

        // ── save ──────────────────────────────────────────────────────────────
        const absOut = path.isAbsolute(outputPath) ? outputPath : path.join(process.cwd(), outputPath);
        fs.mkdirSync(path.dirname(absOut), { recursive: true });
        fs.writeFileSync(absOut, canvas.toBuffer('image/png'));
        return absOut;
    }
}
