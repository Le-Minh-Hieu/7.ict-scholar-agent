/**
 * Generates a simple OHLCV candlestick chart PNG for testing/visualization.
 * Usage: npx tsx src/utils/chart-generator.ts --symbol EURUSD --tf 1h --bars 80 --out data/screenshots/test.png
 *
 * Also exports `generateChart()` for programmatic use.
 */
import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { MarketDataFetcher } from '../ingestion/market-data-fetcher.js';

function getArg(flag: string): string | undefined {
    const idx = process.argv.indexOf(flag);
    return idx !== -1 ? process.argv[idx + 1] : undefined;
}

/** Exported: generate a candlestick chart PNG and return the absolute output path. */
export async function generateChart(
    symbol: string,
    timeframe: string = '1h',
    bars: number = 80,
    outPath?: string,
): Promise<string> {
    const resolvedOut = outPath ?? `data/screenshots/${symbol}_${timeframe}.png`;
    await _renderChart(symbol, timeframe, bars, resolvedOut);
    return path.isAbsolute(resolvedOut) ? resolvedOut : path.join(process.cwd(), resolvedOut);
}

async function _renderChart(symbol: string, timeframe: string, bars: number, outPath: string) {

    console.log(`📊 Generating chart: ${symbol} ${timeframe} | ${bars} bars → ${outPath}`);

    const fetcher = new MarketDataFetcher();
    const data    = await fetcher.fetch(symbol, timeframe, bars);
    const candles  = data.candles.slice(-bars);

    if (candles.length === 0) throw new Error('No candle data returned.');

    // ---- canvas setup ----
    const W = 1200, H = 700, PAD = 60;
    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext('2d');

    // ── TradingView-style gray background ──────────────────────────────────
    ctx.fillStyle = '#b2b5be';
    ctx.fillRect(0, 0, W, H);

    // Price range
    const highs  = candles.map(c => c.high);
    const lows   = candles.map(c => c.low);
    const maxP   = Math.max(...highs);
    const minP   = Math.min(...lows);
    const pRange = maxP - minP || 0.0001;

    const chartW  = W - PAD * 2;
    const chartH  = H - PAD * 2;
    const candleW = Math.max(2, Math.floor(chartW / candles.length) - 1);

    function toY(price: number) {
        return PAD + chartH - ((price - minP) / pRange) * chartH;
    }

    // ── Grid lines (subtle lighter gray) ───────────────────────────────────
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth   = 1;
    for (let i = 0; i <= 6; i++) {
        const y = PAD + (chartH / 6) * i;
        ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
        const price = maxP - (pRange / 6) * i;
        ctx.fillStyle = '#434651';
        ctx.font      = '11px monospace';
        ctx.fillText(price.toFixed(5), 4, y + 4);
    }
    // Vertical grid lines
    const vLines = 8;
    for (let i = 0; i <= vLines; i++) {
        const x = PAD + (chartW / vLines) * i;
        ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, H - PAD); ctx.stroke();
    }
    ctx.restore();

    // ── Session separator lines (red dashed vertical, simulate daily close) ──
    // Rough heuristic: mark every N bars depending on timeframe
    const sessionBars: Record<string, number> = {
        '1m': 390, '5m': 78, '15m': 26, '30m': 13, '1h': 24, '4h': 6, '1d': 5,
    };
    const sepEvery = sessionBars[timeframe] ?? 24;
    ctx.save();
    ctx.strokeStyle = 'rgba(220,50,50,0.7)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 4]);
    for (let i = 0; i < candles.length; i++) {
        if (i % sepEvery === 0 && i > 0) {
            const x = PAD + (i / candles.length) * chartW + candleW / 2;
            ctx.beginPath(); ctx.moveTo(x, PAD); ctx.lineTo(x, H - PAD); ctx.stroke();
        }
    }
    ctx.setLineDash([]);
    ctx.restore();

    // ── Candles ─────────────────────────────────────────────────────────────
    candles.forEach((c, i) => {
        const x       = PAD + (i / candles.length) * chartW;
        const isGreen = c.close >= c.open;

        // Bearish = solid black; Bullish = teal #26a69a
        const bodyColor = isGreen ? '#26a69a' : '#000000';
        const wickColor = isGreen ? '#26a69a' : '#000000';

        // Wick
        ctx.strokeStyle = wickColor;
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(x + candleW / 2, toY(c.high));
        ctx.lineTo(x + candleW / 2, toY(c.low));
        ctx.stroke();

        // Body
        const bodyTop = toY(Math.max(c.open, c.close));
        const bodyH   = Math.max(1, Math.abs(toY(c.open) - toY(c.close)));
        ctx.fillStyle = bodyColor;
        ctx.fillRect(x, bodyTop, candleW, bodyH);

        // Bullish hollow outline (border around teal body)
        if (isGreen) {
            ctx.strokeStyle = '#26a69a';
            ctx.lineWidth   = 1;
            ctx.strokeRect(x, bodyTop, candleW, bodyH);
        }
    });

    // ── Title ───────────────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(180,182,188,0.55)';
    ctx.font      = 'bold 26px sans-serif';
    ctx.fillText(`${symbol}`, W / 2 - 60, H / 2 - 10);
    ctx.font      = '16px sans-serif';
    ctx.fillText(`${symbol.includes('USD') ? 'Euro / U.S. Dol...' : symbol}`, W / 2 - 70, H / 2 + 16);

    ctx.fillStyle = '#434651';
    ctx.font      = 'bold 13px monospace';
    ctx.fillText(`${symbol}  ${timeframe.toUpperCase()}`, PAD + 4, PAD - 10);

    // Current price line
    const last   = candles[candles.length - 1];
    const priceY = toY(last.close);
    ctx.save();
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.beginPath(); ctx.moveTo(PAD, priceY); ctx.lineTo(W - PAD, priceY); ctx.stroke();
    ctx.setLineDash([]);
    // Price label box
    ctx.fillStyle = '#2196f3';
    ctx.fillRect(W - PAD + 1, priceY - 9, 58, 16);
    ctx.fillStyle = '#ffffff';
    ctx.font      = 'bold 10px monospace';
    ctx.fillText(last.close.toFixed(5), W - PAD + 3, priceY + 3);
    ctx.restore();

    // Save
    const absOut = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(absOut, buf);

    console.log(`✅ Chart saved → ${absOut}`);
    console.log(`   Candles: ${candles.length} | High: ${Math.max(...highs).toFixed(5)} | Low: ${Math.min(...lows).toFixed(5)}`);
}

async function main() {
    const symbol    = getArg('--symbol') ?? 'EURUSD';
    const timeframe = getArg('--tf') ?? '1h';
    const bars      = parseInt(getArg('--bars') ?? '80', 10);
    const outPath   = getArg('--out') ?? `data/screenshots/${symbol}_${timeframe}.png`;
    console.log(`📊 Generating chart: ${symbol} ${timeframe} | ${bars} bars → ${outPath}`);
    await _renderChart(symbol, timeframe, bars, outPath);
}

// Only run as CLI when this file is the entry point
const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('chart-generator.ts') ||
               process.argv[1]?.replace(/\\/g, '/').endsWith('chart-generator.js');
if (isMain) {
    main().catch(e => { console.error('❌', e.message); process.exit(1); });
}
