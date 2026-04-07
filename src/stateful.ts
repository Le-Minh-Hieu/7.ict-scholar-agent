import dotenv from 'dotenv';
import fs   from 'fs';
import path from 'path';
import { ScholarAgent } from './services/scholar-agent';
import { ChartAnalysisService, ChartDecisionResult } from './services/chart-analysis-service';
import { OutcomeService, TradeOutcome } from './services/outcome-service';
import { MTF_STACKS } from './ingestion/market-data-fetcher';
import { generateChart } from './utils/chart-generator';
import { generatePdfReport } from './utils/pdf-reporter';

dotenv.config();

function getArg(flag: string): string | undefined {
    const idx = process.argv.indexOf(flag);
    return idx !== -1 ? process.argv[idx + 1] : undefined;
}

/**
 * Determine trading session name based on UTC hour.
 * ICT sessions (approximate UTC boundaries):
 *   Asia    00:00–07:00 UTC  (7 AM–2 PM HCM / 8 PM–3 AM NY)
 *   London  07:00–12:00 UTC  (2 PM–7 PM HCM / 3 AM–8 AM NY)
 *   NYAM    12:00–17:00 UTC  (7 PM–midnight HCM / 8 AM–1 PM NY)
 *   NYPM    17:00–22:00 UTC  (midnight–5 AM HCM / 1 PM–6 PM NY)
 *   Asia    22:00–24:00 UTC  (5 AM–7 AM HCM — pre-Asia/late overnight)
 */
/** Session boundaries in New York time (UTC-4). */
function tradingSession(nyHour: number): string {
    if (nyHour >= 20 || nyHour < 3)  return 'asia';
    if (nyHour < 8)                  return 'london';
    if (nyHour < 13)                 return 'nyam';
    return 'nypm';                                   // 13:00–20:00 NY
}

/**
 * Returns a new session output directory using New York time (UTC-4):
 *   data/reports/YYYY-MM-DD/<session>_HH-MM/
 * e.g. data/reports/2026-04-07/nyam_09-45/
 */
function makeSessionDir(): string {
    const utc      = new Date();
    const ny       = new Date(utc.getTime() - 4 * 60 * 60 * 1000);        // NY = UTC-4
    const dateStr  = ny.toISOString().slice(0, 10);                        // 2026-04-07
    const timeStr  = ny.toISOString().slice(11, 16).replace(':', '-');     // 09-45
    const session  = tradingSession(ny.getUTCHours());                     // getUTCHours on shifted Date = NY hour
    const dir      = path.join(process.cwd(), 'data', 'reports', dateStr, `${session}_${timeStr}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** Save a human-readable .txt report into the session directory. */
function saveReport(result: ChartDecisionResult): string {
    const base    = result.annotatedImagePath ?? result.imagePath;
    const repPath = path.join(path.dirname(base), 'report.txt');
    const lines  = [
        '='.repeat(70),
        'ICT SCHOLAR AGENT — ANALYSIS REPORT',
        `Generated : ${result.timestamp}`,
        `Symbol    : ${result.symbol ?? 'N/A'}`,
        `Timeframe : ${result.timeframe ?? 'N/A'}`,
        `Image     : ${result.imagePath}`,
        result.annotatedImagePath ? `Annotated : ${result.annotatedImagePath}` : '',
        '='.repeat(70),
        '',
        result.drawingGuide,
        '',
        result.decision,
    ].filter(l => l !== undefined).join('\n');
    fs.writeFileSync(repPath, lines, 'utf8');
    return repPath;
}

async function main() {
    const command = process.argv[2];
    const hasHelpFlag = process.argv.includes('--help') || process.argv.includes('-h');

    if (!command || hasHelpFlag) {
        console.log('Dùng một trong các lệnh sau:');
        console.log('- npm run stateful:build');
        console.log('- npm run stateful:ask   -- "<câu hỏi>"');
        console.log('- npm run stateful:screenshot -- --symbol EURUSD [--stack intraday] [--tfs 4h,1h,15m]  (chụp ảnh thôi, chưa AI)');
        console.log('- npm run stateful:capture   -- --symbol EURUSD [--stack intraday] [--tfs 4h,1h,15m] [--mode topdown]  (chụp + phân tích ICT)');
        console.log('- npm run stateful:chart -- --symbol <sym> [--stack swing|intraday|...] [--mode topdown|bottomup]');
        console.log('- npm run stateful:outcome -- --list [--symbol EURUSD]');
        console.log('- npm run stateful:outcome -- --stats [--symbol EURUSD]');
        console.log('- npm run stateful:outcome -- --id <id> --result WIN|LOSS|BREAKEVEN [--pips 70] [--notes "..."]');
        console.log('- npm run stateful:download -- --playlist <url>');
        console.log('- npm run stateful:download -- --scan');
        console.log('- npm run stateful:download -- --status');
        return;
    }

    if (command === 'build') {
        const agent = new ScholarAgent();
        await agent.buildKnowledgeBase();
        return;
    }

    if (command === 'ask') {
        const agent = new ScholarAgent();
        const question = process.argv.slice(3).filter(a => !a.startsWith('--')).join(' ').trim();
        const sessionId = process.env.SESSION_ID || 'default';

        if (!question) {
            throw new Error('Thiếu câu hỏi. Ví dụ: npm run stateful:ask -- "ICT nói gì về MSS và FVG?"');
        }

        const result = await agent.ask(question, sessionId, 6);
        console.log('\n=== ANSWER ===\n');
        console.log(result.answer);
        console.log('\n=== SOURCES ===\n');
        result.sources.forEach(source => console.log(`- ${source}`));
        return;
    }

    if (command === 'capture') {
        const symbol         = getArg('--symbol') ?? 'EURUSD';
        const stack          = getArg('--stack') as keyof typeof MTF_STACKS | undefined;
        const tfRaw          = getArg('--tfs') ?? getArg('--timeframes');
        const mode           = (getArg('--mode') ?? 'topdown') as 'topdown' | 'bottomup';
        const sessionId      = getArg('--session') ?? process.env.SESSION_ID ?? 'default';
        const screenshotOnly = process.argv.includes('--screenshot-only');

        const timeframes = tfRaw
            ? tfRaw.split(',').map(s => s.trim())
            : MTF_STACKS[stack ?? 'intraday'];

        const sessionDir = makeSessionDir();
        console.log(`📁 Session dir  : ${sessionDir}`);
        console.log(`📸 Symbol       : ${symbol}`);
        console.log(`📊 Timeframes   : ${timeframes.join(' → ')}`);
        if (!screenshotOnly) console.log(`🔄 Mode         : ${mode}`);
        console.log('');

        // ── Screenshot-only mode: capture & stop, no AI ───────────────────
        if (screenshotOnly) {
            const { TradingViewCapturer } = await import('./ingestion/tradingview-capturer.js');
            const capturer  = new TradingViewCapturer(sessionDir);
            const captures  = await capturer.captureMultiTF(symbol, timeframes);
            console.log(`\n✅ ${captures.length} screenshot(s) saved:`);
            for (const c of captures) {
                console.log(`   [${c.tf.padEnd(4)}] ${c.imagePath}`);
            }
            console.log('\nChạy lại không có --screenshot-only để phân tích ICT.');
            return;
        }

        // ── Full analysis mode ─────────────────────────────────────────────
        const service = new ChartAnalysisService();
        const result  = await service.analyzeFromScreenshots({
            symbol,
            timeframes,
            sessionDir,
            mode,
            sessionId,
        });

        console.log('\n' + result.drawingGuide);
        console.log('\n' + result.decision);

        const rp = saveReport(result);
        console.log(`📄 Report (.txt) → ${rp}`);

        try {
            const pdfPath = await generatePdfReport(result);
            console.log(`📑 Report (.pdf) → ${pdfPath}`);

            // Delete PNGs after embedding in PDF
            const pngsToDelete = [
                result.imagePath,
                result.annotatedImagePath,
                ...Object.values(result.timeframeCharts ?? {}),
            ].filter((p): p is string => !!p && fs.existsSync(p));
            for (const png of pngsToDelete) {
                try { fs.unlinkSync(png); } catch { /* ignore */ }
            }
            if (pngsToDelete.length > 0) {
                console.log(`🗑️  Đã xóa ${pngsToDelete.length} PNG (đã embed vào PDF)`);
            }
        } catch (e: any) {
            console.warn(`⚠️  PDF generation failed: ${e.message}`);
        }
        return;
    }

    if (command === 'chart') {
        let imagePath     = getArg('--image');
        const rawDataPath = getArg('--data');
        const symbol      = getArg('--symbol');
        const mode        = (getArg('--mode') ?? 'topdown') as 'topdown' | 'bottomup';
        const stack       = getArg('--stack') as 'swing' | 'intraday' | 'scalp' | 'micro' | 'macro' | 'full' | 'deep' | 'precision' | undefined;
        const tfRaw       = getArg('--timeframes') ?? getArg('--tfs');
        const timeframe   = getArg('--timeframe') ?? getArg('--tf') ?? '1h';
        const barsStr     = getArg('--bars');
        const bars        = barsStr ? parseInt(barsStr, 10) : 100;
        const sessionId   = getArg('--session') ?? process.env.SESSION_ID ?? 'default';
        const smtSymbol   = getArg('--smt');   // e.g. --smt GBPUSD

        // ── Create session output directory ───────────────────────────────
        const sessionDir = makeSessionDir();
        console.log(`📁 Session dir: ${sessionDir}`);

        // ── Auto-generate live chart if --image not supplied ─────────────────
        if (!imagePath && symbol) {
            const tf  = tfRaw  ? tfRaw.split(',').map(s => s.trim())[0]
                       : stack ? MTF_STACKS[stack][0]
                       : timeframe;
            const out = path.join(sessionDir, `${symbol}_${tf}_live.png`);
            console.log(`📸 No --image supplied — generating live chart: ${symbol} ${tf}...`);
            imagePath = await generateChart(symbol, tf, bars, out);
        }

        if (!imagePath) {
            console.log('Dùng: npm run stateful:chart -- --symbol <sym> [options]\n');
            console.log('Options:');
            console.log('  --image    path to existing chart PNG (optional if --symbol provided)');
            console.log('  --symbol   EURUSD | GBPJPY | XAUUSD | BTC | ETH | AAPL ...');
            console.log('  --mode     topdown (default) | bottomup');
            console.log('  --stack    macro | full | deep | swing | intraday (default) | scalp | precision | micro');
            console.log('  --timeframes 1mo,1w,1d,4h,1h,15m   (custom comma-separated)');
            console.log('  --tf       single timeframe for chart gen (default 1h)');
            console.log('  --bars     bars per timeframe (default 100)');
            console.log('  --session  session id (default "default")');
            console.log('\nStacks (HTF → LTF):');
            console.log('  macro     : 1mo → 1w → 1d → 4h                        (orientation)');
            console.log('  full      : 1mo → 1w → 1d → 4h → 1h → 15m             (comprehensive)');
            console.log('  deep      : 1mo → 1w → 1d → 6h → 3h → 1h → 45m → 15m → 5m  (maximum)');
            console.log('  swing     : 1wk → 1d → 4h → 1h');
            console.log('  intraday  : 1d → 4h → 1h → 15m');
            console.log('  scalp     : 4h → 1h → 15m → 5m');
            console.log('  precision : 4h → 1h → 45m → 15m → 5m → 3m');
            console.log('  micro     : 1h → 15m → 5m → 1m');
            throw new Error('Thiếu --image hoặc --symbol.');
        }

        const service = new ChartAnalysisService();

        // Multi-TF branch: needs symbol + (stack/timeframes)
        if (symbol && (stack || tfRaw || !getArg('--tf'))) {
            const customTFs = tfRaw ? tfRaw.split(',').map(s => s.trim()) : undefined;
            const result = await service.analyzeMultiTFAndDecide({
                imagePath,
                symbol,
                timeframes: customTFs,
                stack: stack ?? 'intraday',
                mode,
                bars,
                sessionId,
                smtSymbol,
            });

            // Generate individual TF charts for the PDF narrator pages
            const stackTFs = customTFs ?? MTF_STACKS[stack ?? 'intraday'];
            const tfCharts: Record<string, string> = {};
            for (const tf of stackTFs) {
                try {
                    const out = path.join(sessionDir, `${symbol}_${tf}_live.png`);
                    tfCharts[tf] = await generateChart(symbol, tf, bars, out);
                } catch {
                    // skip if TF chart fails
                }
            }
            result.timeframeCharts = tfCharts;

            console.log('\n' + result.drawingGuide);
            console.log('\n' + result.decision);
            if (result.annotatedImagePath) {
                console.log(`\n✅ Annotated chart → ${result.annotatedImagePath}`);
            }
            const rp = saveReport(result);
            console.log(`📄 Report (.txt)  → ${rp}`);
            try {
                const pdfPath = await generatePdfReport(result);
                console.log(`📑 Report (.pdf)  → ${pdfPath}`);
                // ── Xóa PNG sau khi đã embed vào PDF thành công ──────────────
                const pngsToDelete = [
                    result.imagePath,
                    result.annotatedImagePath,
                    ...Object.values(result.timeframeCharts ?? {}),
                ].filter((p): p is string => !!p && fs.existsSync(p));
                for (const png of pngsToDelete) {
                    try { fs.unlinkSync(png); } catch { /* ignore */ }
                }
                if (pngsToDelete.length > 0) {
                    console.log(`🗑️  Đã xóa ${pngsToDelete.length} file PNG (đã embed vào PDF)`);
                }
            } catch (e: any) {
                console.warn(`⚠️  PDF generation failed: ${e.message}`);
            }
            return;
        }

        // Single-TF fallback
        const result = await service.analyzeAndDecide({ imagePath, rawDataPath, symbol, timeframe, bars, sessionId });
        console.log('\n' + result.drawingGuide);
        console.log('\n' + result.decision);
        if (result.annotatedImagePath) {
            console.log(`\n✅ Annotated chart → ${result.annotatedImagePath}`);
        }
        const rp = saveReport(result);
        console.log(`📄 Report (.txt)  → ${rp}`);
        try {
            const pdfPath = await generatePdfReport(result);
            console.log(`📑 Report (.pdf)  → ${pdfPath}`);
        } catch (e: any) {
            console.warn(`⚠️  PDF generation failed: ${e.message}`);
        }
        return;
    }

    if (command === 'outcome') {
        const svc      = new OutcomeService();
        const doList   = process.argv.includes('--list');
        const doStats  = process.argv.includes('--stats');
        const id       = getArg('--id');
        const symbol   = getArg('--symbol');

        if (doList) {
            const cases = svc.listCases(symbol, 30);
            if (cases.length === 0) { console.log('Chưa có case nào.'); return; }
            console.log(`\n${'─'.repeat(70)}`);
            console.log(`  TRADE CASE LOG${symbol ? ` — ${symbol}` : ''}`);
            console.log(`${'─'.repeat(70)}`);
            for (const c of cases) {
                const pip  = c.pips !== undefined ? `${c.pips > 0 ? '+' : ''}${c.pips}p` : '';
                const icon = c.outcome === 'WIN' ? '✅' : c.outcome === 'LOSS' ? '❌' : c.outcome === 'BREAKEVEN' ? '➖' : '⏳';
                console.log(`${icon} [${c.id}] ${c.symbol} ${c.timeframe} | ${c.bias.toUpperCase()} | ${c.outcome} ${pip}`);
                console.log(`     ${c.timestamp.slice(0, 16)} | ${c.setupConditions.slice(0, 3).join(', ')}`);
            }
            return;
        }

        if (doStats) {
            const s = svc.getStats(symbol);
            console.log(`\n📊 STATS${symbol ? ` — ${symbol}` : ' — ALL SYMBOLS'}`);
            console.log(`   Total completed : ${s.total}`);
            console.log(`   Pending         : ${s.pending}`);
            console.log(`   Win rate        : ${s.winRate.toFixed(1)}%  (W:${s.wins} L:${s.losses} B:${s.breakeven})`);
            console.log(`   Avg pips        : ${s.avgPips.toFixed(1)}`);
            console.log(`   Total pips      : ${s.totalPips > 0 ? '+' : ''}${s.totalPips}`);
            return;
        }

        if (id) {
            const resultArg = getArg('--result')?.toUpperCase() as TradeOutcome | undefined;
            if (!resultArg || !['WIN','LOSS','BREAKEVEN'].includes(resultArg)) {
                throw new Error('--result phải là WIN | LOSS | BREAKEVEN');
            }
            const pipsStr = getArg('--pips');
            const pips    = pipsStr ? parseFloat(pipsStr) : undefined;
            const notes   = getArg('--notes');
            const tc = svc.updateOutcome(id, resultArg, pips, notes);
            console.log(`✅ Updated: [${tc.id}] ${tc.symbol} ${tc.bias} → ${tc.outcome}${pips !== undefined ? ` (${pips > 0 ? '+' : ''}${pips} pips)` : ''}`);
            // Show updated stats
            const s = svc.getStats(tc.symbol);
            if (s.total >= 1) console.log(`📊 ${tc.symbol} win rate: ${s.winRate.toFixed(0)}% (${s.total} completed)`);
            return;
        }

        console.log('Dùng: npm run stateful:outcome -- --list | --stats | --id <id> --result WIN|LOSS|BREAKEVEN [--pips N] [--notes "..."]');
        return;
    }

    throw new Error(`Lệnh không hợp lệ: ${command}. Dùng --help để xem hướng dẫn.`);
}

main().catch((error) => {
    console.error('❌ Stateful runner error:', error);
    process.exit(1);
});
