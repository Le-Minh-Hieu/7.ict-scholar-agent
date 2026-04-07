import path from 'path';
import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { VisionAnalyzer, ICTChartAnalysis, DrawingInstruction } from '../processor/vision-analyzer';
import { RawDataParser } from '../ingestion/raw-data-parser';
import { MarketDataFetcher, MTF_STACKS, MultiTFResult } from '../ingestion/market-data-fetcher';
import { ScholarAgent } from './scholar-agent';
import { StorageService } from './storage-service';
import { OutcomeService } from './outcome-service';
import { ChartAnnotator } from '../utils/chart-annotator';
import { Logger } from '../utils/logger';
import { sortByCurriculum, getCurriculumOrder, getCurriculumLabel } from '../core/curriculum-index';

export type ChartDecisionResult = {
    timestamp: string;
    imagePath: string;
    annotatedImagePath?: string;
    rawDataPath?: string;
    symbol?: string;
    timeframe?: string;
    /** Keyed by TF string (e.g. "1d", "4h", "1h", "15m") → absolute PNG path */
    timeframeCharts?: Record<string, string>;
    analysis: ICTChartAnalysis;
    drawingGuide: string;
    decision: string;
    sessionId: string;
};

export class ChartAnalysisService {
    private readonly vision    = new VisionAnalyzer();
    private readonly rawParser = new RawDataParser();
    private readonly fetcher   = new MarketDataFetcher();
    private readonly scholar   = new ScholarAgent();
    private readonly annotator = new ChartAnnotator();
    private readonly outcome   = new OutcomeService();
    private readonly storage: StorageService;
    private readonly gemini: any;

    constructor() {
        const statefulDir = path.join(process.cwd(), 'data', 'stateful');
        this.storage = new StorageService(statefulDir);
        const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
        this.gemini  = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    }

    /**
     * Ask Gemini to extract specific ICT concepts from a market summary.
     * Returns a list of search queries for dynamic RAG.
     */
    private async extractDynamicQueries(marketSummary: string): Promise<string[]> {
        const prompt = [
            'You are an ICT (Inner Circle Trader) expert.',
            'Read this market data summary and identify which specific ICT concepts are ACTIVELY present right now.',
            'Return ONLY a JSON array of 4-6 short search query strings (English), each describing one concept.',
            'Focus on what is ACTUALLY happening — do not list generic concepts.',
            'Examples: "bearish order block retest daily", "price in premium above 0.5 fib", "equal highs liquidity target", "london killzone MSS entry"',
            '',
            'MARKET SUMMARY:',
            marketSummary.slice(0, 1200),
            '',
            'Return JSON array only. No explanation.',
        ].join('\n');

        try {
            const res  = await this.gemini.generateContent(prompt);
            const text = (await res.response.text()).trim();
            const json = text.replace(/```json|```/g, '').trim();
            const arr  = JSON.parse(json) as string[];
            if (Array.isArray(arr) && arr.length > 0) return arr;
        } catch { /* fallback to static */ }
        return [];
    }

    async analyzeAndDecide(params: {
        imagePath: string;
        rawDataPath?: string;
        symbol?: string;    // e.g. "EURUSD", "BTC", "AAPL"
        timeframe?: string; // e.g. "15m", "1h", "4h", "1d"
        bars?: number;
        sessionId?: string;
        topK?: number;
    }): Promise<ChartDecisionResult> {
        const { imagePath, rawDataPath, symbol, timeframe = '1h', bars = 200, sessionId = 'default', topK = 6 } = params;

        if (!fs.existsSync(imagePath)) {
            throw new Error(`Chart image not found: ${imagePath}`);
        }

        // 1. Get raw data — live fetch takes priority over file
        let rawDataSummary = '';

        if (symbol) {
            Logger.info(`Đang lấy dữ liệu thị trường live: ${symbol} ${timeframe}...`);
            const liveData = await this.fetcher.fetch(symbol, timeframe, bars);
            rawDataSummary = liveData.summary;
        } else if (rawDataPath && fs.existsSync(rawDataPath)) {
            Logger.info('Đang parse raw data từ file...');
            const rawData = this.rawParser.parse(rawDataPath);
            rawDataSummary = rawData.summary;
        }

        // 2. Retrieve internal knowledge — dynamic queries from market summary
        Logger.info('Truy xuất nội bộ knowledge base...');
        let internalContext = '';
        try {
            let queries: string[] = [];
            if (rawDataSummary) {
                Logger.info('Đang extract ICT concepts từ market data...');
                queries = await this.extractDynamicQueries(rawDataSummary);
                if (queries.length > 0) Logger.info(`Dynamic queries: ${queries.join(' | ')}`);
            }
            if (queries.length === 0) {
                queries = ['ICT chart analysis market structure shift FVG order block liquidity entry'];
            }
            // Run all dynamic queries, deduplicate chunks
            const seen = new Set<string>();
            const allChunks: { text: string; source: string; chunkIndex: number; score: number }[] = [];
            for (const q of queries) {
                const chunks = await this.scholar.retrieveRawChunks(q, 3);
                for (const c of chunks) {
                    const key = `${c.source}::${c.chunkIndex}`;
                    if (!seen.has(key)) { seen.add(key); allChunks.push(c); }
                }
            }
            internalContext = allChunks
                .slice(0, topK * 2)
                .map(c => `[SOURCE: ${c.source} | chunk ${c.chunkIndex}]\n${c.text}`)
                .join('\n\n');
        } catch {
            Logger.warn('Knowledge index chưa có hoặc lỗi retrieval. Tiếp tục với vision only.');
        }

        // 3. Vision analysis
        Logger.info('Đang phân tích chart image qua Gemini Vision...');
        const analysis = await this.vision.analyzeChartForDecision(
            imagePath,
            rawDataSummary,
            internalContext,
        );

        // 4. Format drawing guide
        const drawingGuide = this.formatDrawingGuide(analysis.drawings);

        // 5. Format decision text
        const decision = this.formatDecision(analysis);

        // 6. Persist result
        const result: ChartDecisionResult = {
            timestamp: new Date().toISOString(),
            imagePath,
            rawDataPath,
            symbol,
            timeframe,
            analysis,
            drawingGuide,
            decision,
            sessionId,
        };

        const filename = `chart-analysis/${Date.now()}.json`;
        this.storage.saveJson(filename, result);
        Logger.info(`Đã lưu kết quả phân tích: data/stateful/${filename}`);

        // Auto-record as pending case in episodic memory
        const tc = this.outcome.recordCase(result, filename);
        Logger.info(`📋 Case recorded: ID ${tc.id} | ${tc.symbol} ${tc.bias.toUpperCase()} | PENDING`);

        return result;
    }

    /**
     * Multi-timeframe top-down or bottom-up analysis.
     * Fetches all TF layers from market, then passes combined context to vision.
     */
    async analyzeMultiTFAndDecide(params: {
        imagePath: string;
        symbol: string;
        timeframes?: string[];
        stack?: keyof typeof MTF_STACKS;
        mode?: 'topdown' | 'bottomup';
        bars?: number;
        sessionId?: string;
        topK?: number;
        smtSymbol?: string;   // e.g. "GBPUSD" for SMT divergence comparison
    }): Promise<ChartDecisionResult> {
        // Default SMT pairs by ICT methodology (correlated pairs expected to diverge)
        const DEFAULT_SMT: Record<string, string> = {
            'EURUSD': 'GBPUSD',
            'GBPUSD': 'EURUSD',
            'AUDUSD': 'NZDUSD',
            'NZDUSD': 'AUDUSD',
            'USDCAD': 'USDCHF',
            'USDCHF': 'USDCAD',
            'XAUUSD': 'XAGUSD',
            'XAGUSD': 'XAUUSD',
            'NAS100': 'US30',
            'US30':   'NAS100',
            'SP500':  'NAS100',
        };

        const {
            imagePath,
            symbol,
            timeframes,
            stack = 'intraday',
            mode = 'topdown',
            bars = 100,
            sessionId = 'default',
            topK = 6,
            smtSymbol: smtSymbolParam,
        } = params;

        // Auto-resolve SMT pair from default table if not explicitly provided
        const smtSymbol = smtSymbolParam ?? DEFAULT_SMT[symbol.toUpperCase()];
        if (smtSymbol && !smtSymbolParam) {
            Logger.info(`[SMT] Auto-assigned SMT pair: ${symbol} ↔ ${smtSymbol}`);
        }

        if (!fs.existsSync(imagePath)) {
            throw new Error(`Chart image not found: ${imagePath}`);
        }

        const tfs = timeframes ?? MTF_STACKS[stack];
        Logger.info(`[Multi-TF] ${mode.toUpperCase()} | Stack: ${stack} | ${tfs.join(' → ')}`);

        // 1. Fetch all TF layers from market
        const mtfResult: MultiTFResult = await this.fetcher.fetchMultiTF(symbol, tfs, mode, bars, smtSymbol);

        // 1b. Log correlated context if available
        if (mtfResult.correlatedContext) {
            Logger.info('DXY + SMT context fetched ✅');
        }

        // 1b. Extract dynamic ICT queries from live market summary
        let dynamicQueries: string[] = [];
        try {
            Logger.info('Đang extract ICT concepts từ market data...');
            dynamicQueries = await this.extractDynamicQueries(mtfResult.combinedSummary);
            if (dynamicQueries.length > 0) Logger.info(`Dynamic queries: ${dynamicQueries.join(' | ')}`);
        } catch { /* non-fatal */ }

        // 2. Retrieve RAW PDF chunks — dynamic queries first, then TAXONOMY
        //    Each category is retrieved independently → passed as labelled sections.
        //    Gemini MUST cite [CATEGORY | PDF | chunk] for every hypothesis.
        let internalContext = '';
        try {
            // ── Dynamic query chunks (injected first, highest priority) ────────
            // ── Global source tracker — enforces diversity ACROSS categories ──
            // Each PDF source is allowed at most once across all dynamic + taxonomy
            // retrievals. After each round we add new sources to this set so the
            // next category automatically prefers fresh PDFs from the 301-file KB.
            const globalUsedSources = new Set<string>();

            // ── Dynamic query chunks (injected first, highest priority) ────────
            const dynamicChunkMap = new Map<string, { text: string; source: string; chunkIndex: number; score: number }>();
            for (const q of dynamicQueries) {
                // pool=50, topK=5, maxPerSource=1, prefer sources not yet globally used
                const chunks = await this.scholar.retrieveDiverseChunks(q, 5, 1, 50, globalUsedSources);
                for (const c of chunks) {
                    const key = `${c.source}::${c.chunkIndex}`;
                    if (!dynamicChunkMap.has(key)) {
                        dynamicChunkMap.set(key, c);
                        globalUsedSources.add(c.source);
                    }
                }
            }
            const dynamicBlock = dynamicChunkMap.size > 0
                ? '### DYNAMIC — Concepts active in current market\n' +
                  [...dynamicChunkMap.values()]
                      .slice(0, 12)
                      .map(c => `  [DYNAMIC | ${c.source} | chunk ${c.chunkIndex}]\n  ${c.text.replace(/\n/g, '\n  ')}`)
                      .join('\n\n')
                : '';

            // ── Episodic memory — similar past trades ─────────────────────────
            const episodicBlock = this.outcome.buildHistoryContext(symbol, dynamicQueries);

            const TAXONOMY: Record<string, string> = {
                'HTF_BIAS_MARKET_STRUCTURE':
                    'higher timeframe bias bullish bearish market structure intermediate term high low expansion',
                'DRAW_ON_LIQUIDITY':
                    'draw on liquidity buy side sell side liquidity pool old high old low buy stops sell stops',
                'PD_ARRAYS':
                    'fair value gap FVG order block OB breaker block mitigation block IFVG premium discount array',
                'EQUAL_HIGHS_LOWS_STRUCTURE_SHIFT':
                    'equal highs equal lows EQH EQL change of character CHoCH break of structure BOS market structure shift MSS',
                'KILLZONES_TIME':
                    'killzone kill zone London open New York open silver bullet time of day session',
                'ENTRY_MODELS':
                    'optimal trade entry OTE unicorn breaker entry model 2022 model scalp setup',
                'RISK_MANAGEMENT':
                    'stop loss target profit risk reward position sizing invalidation',
                'SMT_DIVERGENCE':
                    'SMT smart money divergence correlated pair intermarket divergence DXY dollar index hedge currency',
                'POWER_OF_3_AMD':
                    'power of three accumulation manipulation distribution AMD open range expansion daily bias',
                'DISPLACEMENT_IMBALANCE':
                    'displacement propulsive candle price run imbalance SIBI BISI single candle inefficiency void gap fill',
            };

            const categoryChunks: Record<string, { text: string; source: string; chunkIndex: number; score: number }[]> = {};

            for (const [category, query] of Object.entries(TAXONOMY)) {
                // pool=60 for taxonomy (larger ⇒ better chance of finding fresh PDFs)
                // topK=5 ⇒ 5 chunks per category (up from 3)
                // maxPerSource=1 ⇒ no single PDF can contribute 2 chunks to same category
                // globalUsedSources ⇒ deprioritise PDFs already cited in prior categories
                const chunks = await this.scholar.retrieveDiverseChunks(query, 5, 1, 60, globalUsedSources);
                categoryChunks[category] = sortByCurriculum(chunks);
                // Register these sources so next categories prefer different PDFs
                for (const c of chunks) globalUsedSources.add(c.source);
            }

            const uniqueSourcesThisRun = globalUsedSources.size;

            // Build labelled context block — each chunk annotated with curriculum position
            internalContext = Object.entries(categoryChunks)
                .map(([category, chunks]) => {
                    if (chunks.length === 0) return '';
                    const refs = chunks.map(c => {
                        const currPos = getCurriculumOrder(c.source);
                        const label   = getCurriculumLabel(c.source);
                        return `  [REF: ${c.source} | chunk ${c.chunkIndex} | ${label} | pos ${currPos}]\n  ${c.text.replace(/\n/g, '\n  ')}`;
                    }).join('\n\n');
                    return `### CATEGORY: ${category}\n${refs}`;
                })
                .filter(Boolean)
                .join('\n\n' + '─'.repeat(60) + '\n\n');

            const totalChunks = Object.values(categoryChunks).reduce((s, a) => s + a.length, 0);
            Logger.info(`Loaded ${totalChunks} PDF chunks across ${Object.keys(TAXONOMY).length} categories | ${uniqueSourcesThisRun} unique PDF sources cited this run.`);

            // Prepend dynamic + episodic blocks before taxonomy context
            const prefix = [dynamicBlock, episodicBlock, mtfResult.correlatedContext ?? ''].filter(Boolean).join('\n\n' + '\u2550'.repeat(60) + '\n\n');
            if (prefix) internalContext = prefix + '\n\n' + '═'.repeat(60) + '\n\n' + internalContext;
        } catch {
            Logger.warn('Knowledge index unavailable. Continuing with vision + market data only.');
        }

        // 3. Vision analysis with multi-TF context
        Logger.info('Đang phân tích chart image qua Gemini Vision (multi-TF)...');
        const analysis = await this.vision.analyzeMultiTFForDecision(
            imagePath,
            mtfResult.combinedSummary,
            mode,
            internalContext,
        );

        const drawingGuide = this.formatDrawingGuide(analysis.drawings);
        const decision     = this.formatMultiTFDecision(analysis, mtfResult);

        // 4. Draw annotations onto chart image
        // Use the entry TF candles (LTF for topdown = last TF, HTF for bottomup = last TF after reverse)
        const entryTF       = tfs[tfs.length - 1];
        const entryData     = mtfResult.layers[entryTF];
        const annotatedPath = imagePath.replace(/\.png$/i, '_annotated.png');
        let   annotatedImagePath: string | undefined;
        if (entryData && analysis.drawings.length > 0) {
            try {
                annotatedImagePath = await this.annotator.annotate(
                    imagePath,
                    analysis.drawings,
                    entryData.candles,
                    annotatedPath,
                );
                Logger.info(`✅ Annotated chart saved → ${annotatedImagePath}`);
            } catch (e: any) {
                Logger.warn(`Could not annotate chart: ${e.message}`);
            }
        }

        const result: ChartDecisionResult = {
            timestamp: new Date().toISOString(),
            imagePath,
            annotatedImagePath,
            symbol,
            timeframe:  tfs.join('→'),
            analysis,
            drawingGuide,
            decision,
            sessionId,
        };

        const filename = `chart-analysis/mtf_${Date.now()}.json`;
        this.storage.saveJson(filename, result);
        Logger.info(`Đã lưu kết quả MTF: data/stateful/${filename}`);

        // Auto-record as pending case in episodic memory
        const tc = this.outcome.recordCase(result, filename);
        Logger.info(`📋 Case recorded: ID ${tc.id} | ${tc.symbol} ${tc.bias.toUpperCase()} | PENDING`);

        return result;
    }

    private formatMultiTFDecision(analysis: ICTChartAnalysis, mtf: MultiTFResult): string {
        const modeLabel = mtf.mode === 'topdown' ? '📊 TOP-DOWN (HTF→LTF)' : '📊 BOTTOM-UP (LTF→HTF)';
        const tfsLabel  = mtf.timeframes.join(' → ');

        const base = this.formatDecision(analysis);
        return [
            `=== MULTI-TIMEFRAME ${modeLabel} ===`,
            `Timeframes   : ${tfsLabel}`,
            `Symbol       : ${mtf.symbol}`,
            '',
            base,
        ].join('\n');
    }

    private formatDrawingGuide(drawings: DrawingInstruction[]): string {
        if (!drawings || drawings.length === 0) {
            return 'Không có hướng dẫn vẽ cụ thể.';
        }

        const lines: string[] = ['=== HƯỚNG DẪN VẼ TRÊN BIỂU ĐỒ ===', ''];

        drawings.forEach((d, i) => {
            lines.push(`${i + 1}. [${d.label}]`);
            lines.push(`   Công cụ  : ${d.tool.replace('_', ' ').toUpperCase()}`);
            lines.push(`   Màu sắc  : ${d.color}`);
            lines.push(`   Cách vẽ  : ${d.description}`);
            if (d.priceLevel !== undefined) {
                lines.push(`   Mức giá  : ${d.priceLevel}`);
            }
            if (d.priceZone) {
                lines.push(`   Vùng giá : ${d.priceZone.low} — ${d.priceZone.high}`);
            }
            if (d.fromBar || d.toBar) {
                lines.push(`   Span     : ${d.fromBar ?? '?'} → ${d.toBar ?? '?'}`);
            }
            lines.push('');
        });

        return lines.join('\n');
    }

    private formatDecision(analysis: ICTChartAnalysis): string {
        const { setup, htfBias, marketStructure, drawOnLiquidity, killzoneAlignment, warnings, narratorScript } = analysis;

        const decisionSymbol = {
            long:     '🟢 LONG',
            short:    '🔴 SHORT',
            no_trade: '⚪ NO TRADE',
        }[setup.bias] ?? '⚪ NO TRADE';

        const confidence = {
            high:   '⭐⭐⭐ HIGH',
            medium: '⭐⭐   MEDIUM',
            low:    '⭐     LOW',
        }[setup.confidence] ?? setup.confidence;

        const lines = [
            // ── NARRATOR SCRIPT (printed first, most prominent) ──────────────
            '╔══════════════════════════════════════════════════════════════╗',
            '║           ICT SCHOLAR AGENT — LIVE ANALYSIS NARRATION       ║',
            '╚══════════════════════════════════════════════════════════════╝',
            '',
            narratorScript ?? '(narrator script unavailable)',
            '',
            '━'.repeat(64),
            '',
            // ── STRUCTURED DECISION ──────────────────────────────────────────
            '=== QUYẾT ĐỊNH GIAO DỊCH (ICT SCHOLAR AGENT) ===',
            '',
            `Bias HTF     : ${htfBias.toUpperCase()}`,
            `Cấu trúc TT  : ${marketStructure.status}`,
            `${marketStructure.lastMSS ? `MSS gần nhất : ${marketStructure.lastMSS}` : ''}`,
            `Draw on Liq. : ${drawOnLiquidity}`,
            `Killzone     : ${killzoneAlignment}`,
            '',
            `QUYẾT ĐỊNH   : ${decisionSymbol}`,
            `Độ tin cậy   : ${confidence}`,
            `Vào lệnh     : ${setup.entryZone ?? 'N/A'}`,
            `Stop Loss    : ${setup.stopLoss ?? 'N/A'}`,
            `Target       : ${setup.target ?? 'N/A'}`,
            `R:R          : ${setup.rrRatio ?? 'N/A'}`,
            '',
            `Lý do        : ${setup.reason}`,
            '',
            analysis.rawSummary,
            '',
        ];

        if (warnings && warnings.length > 0) {
            lines.push('=== CẢNH BÁO RỦI RO ===');
            warnings.forEach(w => lines.push(`⚠️  ${w}`));
        }

        return lines.filter(l => l !== undefined).join('\n');
    }
}
