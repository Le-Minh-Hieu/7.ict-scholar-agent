import YahooFinanceModule from 'yahoo-finance2';
import { OhlcvCandle, RawDataResult } from './raw-data-parser';
import { Logger } from '../utils/logger';
import dotenv from 'dotenv';
dotenv.config();

// ───────────────────────────── Twelve Data ───────────────────────────────
const TWELVE_API_KEY = process.env.TWELVE_DATA_API_KEY ?? '';
const TWELVE_BASE    = 'https://api.twelvedata.com';

/** Twelve Data interval codes */
const TWELVE_INTERVAL: Record<string, string> = {
    '1m':  '1min',
    '2m':  '2min',
    '3m':  '5min',   // no 3min → 5min
    '5m':  '5min',
    '10m': '15min',
    '15m': '15min',
    '30m': '30min',
    '45m': '45min',  // ✔ native
    '1h':  '1h',
    '60m': '1h',
    '90m': '1h',     // no 90min → 1h
    '2h':  '2h',
    '3h':  '4h',     // no 3h → 4h
    '4h':  '4h',     // ✔ native
    '6h':  '8h',     // no 6h → 8h
    '8h':  '8h',
    '12h': '1day',
    '1d':  '1day',
    '1w':  '1week',  '1wk': '1week',
    '1mo': '1month',
};

/**
 * Convert common symbol format → Twelve Data symbol.
 * Forex: EURUSD → EUR/USD | Crypto: BTC → BTC/USD | DXY: DX
 */
function toTwelveSymbol(symbol: string): string {
    const up = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    // Already formatted
    if (symbol.includes('/')) return symbol.toUpperCase();
    // Crypto shortcuts
    const cryptoMap: Record<string, string> = {
        'BTC': 'BTC/USD', 'BTCUSD': 'BTC/USD',
        'ETH': 'ETH/USD', 'ETHUSD': 'ETH/USD',
        'SOL': 'SOL/USD', 'SOLUSD': 'SOL/USD',
        'XRP': 'XRP/USD', 'XRPUSD': 'XRP/USD',
    };
    if (cryptoMap[up]) return cryptoMap[up];
    // 6-char forex pairs → EUR/USD format
    if (/^[A-Z]{6}$/.test(up)) return `${up.slice(0, 3)}/${up.slice(3)}`;
    // Gold/Silver
    if (up === 'XAUUSD' || up === 'GOLD') return 'XAU/USD';
    if (up === 'XAGUSD' || up === 'SILVER') return 'XAG/USD';
    // Indices
    const idxMap: Record<string, string> = {
        'US30': 'DJ30', 'DOW': 'DJ30',
        'NAS100': 'NDX', 'NASDAQ': 'NDX',
        'SPX500': 'SPX', 'SP500': 'SPX',
        'DXY': 'DX',   // Twelve Data uses DX for US Dollar Index
    };
    return idxMap[up] ?? up;
}

/** Fetch OHLCV from Twelve Data REST API (newest-first → reversed to oldest-first) */
async function fetchTwelveData(
    symbol: string,
    timeframe: string,
    bars: number,
): Promise<OhlcvCandle[]> {
    const interval    = TWELVE_INTERVAL[timeframe] ?? '1h';
    const outputsize  = Math.min(bars + 5, 5000);
    const twSymbol    = toTwelveSymbol(symbol);
    const url = `${TWELVE_BASE}/time_series?symbol=${encodeURIComponent(twSymbol)}`
              + `&interval=${interval}&outputsize=${outputsize}&apikey=${TWELVE_API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);

    const data: any = await res.json();
    if (data.status === 'error') throw new Error(`Twelve Data: ${data.message}`);
    if (!Array.isArray(data.values)) throw new Error('Twelve Data: no values');

    // values are newest-first → reverse
    return (data.values as any[]).reverse().map((v: any) => ({
        time:   v.datetime,
        open:   parseFloat(v.open),
        high:   parseFloat(v.high),
        low:    parseFloat(v.low),
        close:  parseFloat(v.close),
        volume: v.volume != null ? parseFloat(v.volume) : undefined,
    }));
}

// ─────────────────────────────── OANDA v20 ──────────────────────────────────
// Docs: https://developer.oanda.com/rest-live-v20/instrument-ep/
// Env vars: OANDA_API_KEY, OANDA_ENV (practice | live)
// Forex pairs use OANDA when the key is set; crypto/stocks fall back to Yahoo.

const OANDA_API_KEY = process.env.OANDA_API_KEY ?? '';
const OANDA_ENV     = (process.env.OANDA_ENV ?? 'practice') as 'practice' | 'live';
const OANDA_BASE    = OANDA_ENV === 'live'
    ? 'https://api-fxtrade.oanda.com/v3'
    : 'https://api-fxpractice.oanda.com/v3';

/** OANDA granularity codes
 *  Note: OANDA does not have M3, M45, H1.5 — nearest equivalents used.
 */
const OANDA_GRAN: Record<string, string> = {
    '1m':  'M1',
    '2m':  'M2',
    '3m':  'M4',  // nearest: M4 (OANDA has no M3)
    '5m':  'M5',
    '10m': 'M10',
    '15m': 'M15',
    '30m': 'M30',
    '45m': 'M30', // nearest: M30 (OANDA has no M45)
    '1h':  'H1',
    '90m': 'H1',  // nearest: H1 (OANDA has no H1.5)
    '2h':  'H2',
    '3h':  'H3',  // ← native H3 ✅
    '4h':  'H4',  // ← native H4 ✅
    '6h':  'H6',  // ← native H6 ✅
    '8h':  'H8',
    '12h': 'H12',
    '1d':  'D',
    '1w':  'W',  '1wk': 'W',
    '1mo': 'M',
};

/**
 * Convert common symbol format → OANDA instrument (e.g. EURUSD → EUR_USD)
 * Returns null if not a recognised OANDA forex/commodity pair.
 */
function toOandaInstrument(symbol: string): string | null {
    const up = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');

    const OANDA_MAP: Record<string, string> = {
        // Major forex pairs
        'EURUSD': 'EUR_USD', 'GBPUSD': 'GBP_USD', 'USDJPY': 'USD_JPY',
        'AUDUSD': 'AUD_USD', 'NZDUSD': 'NZD_USD', 'USDCAD': 'USD_CAD',
        'USDCHF': 'USD_CHF', 'EURGBP': 'EUR_GBP', 'EURJPY': 'EUR_JPY',
        'GBPJPY': 'GBP_JPY', 'AUDJPY': 'AUD_JPY', 'EURCHF': 'EUR_CHF',
        'AUDCAD': 'AUD_CAD', 'AUDCHF': 'AUD_CHF', 'CADJPY': 'CAD_JPY',
        'NZDJPY': 'NZD_JPY', 'EURAUD': 'EUR_AUD', 'EURCAD': 'EUR_CAD',
        'GBPAUD': 'GBP_AUD', 'GBPCAD': 'GBP_CAD', 'GBPCHF': 'GBP_CHF',
        'GBPNZD': 'GBP_NZD', 'EURNZD': 'EUR_NZD', 'CADCHF': 'CAD_CHF',
        // Commodities/indices available on OANDA
        'XAUUSD': 'XAU_USD', 'GOLD': 'XAU_USD',
        'XAGUSD': 'XAG_USD', 'SILVER': 'XAG_USD',
        'US30':   'US30_USD', 'DOW': 'US30_USD',
        'NAS100': 'NAS100_USD', 'NASDAQ': 'NAS100_USD',
        'SPX500': 'SPX500_USD', 'SP500': 'SPX500_USD',
        'GER40':  'DE40_EUR',
        'UK100':  'UK100_GBP',
        'WTI':    'WTICO_USD', 'OIL': 'WTICO_USD',
        'BRENT':  'BCO_USD',
    };

    return OANDA_MAP[up] ?? null;
}

/** Fetch candles from OANDA v20 REST API */
async function fetchOanda(
    instrument: string,
    timeframe: string,
    bars: number,
): Promise<OhlcvCandle[]> {
    const gran  = OANDA_GRAN[timeframe] ?? 'H1';
    const count = Math.min(bars + 5, 5000); // +5 buffer for swing detection, max 5000
    const url   = `${OANDA_BASE}/instruments/${instrument}/candles`
                + `?count=${count}&granularity=${gran}&price=M`;

    const res = await fetch(url, {
        headers: {
            'Authorization':           `Bearer ${OANDA_API_KEY}`,
            'Accept-Datetime-Format':  'RFC3339',
        },
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`OANDA API error ${res.status}: ${body}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.candles as any[])
        .filter((c: any) => c.complete !== false) // skip currently-forming candle
        .map((c: any) => ({
            time:   c.time,
            open:   parseFloat(c.mid.o),
            high:   parseFloat(c.mid.h),
            low:    parseFloat(c.mid.l),
            close:  parseFloat(c.mid.c),
            volume: c.volume ?? undefined,
        }));
}
// ────────────────────────────────────────────────────────────────────────────

// yahoo-finance2 v3 requires instantiation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YahooFinance = YahooFinanceModule as any;
const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

// Yahoo Finance interval map (Yahoo only supports these fixed intervals)
const INTERVAL_MAP: Record<string, '1m'|'2m'|'5m'|'15m'|'30m'|'60m'|'90m'|'1h'|'1d'|'5d'|'1wk'|'1mo'|'3mo'> = {
    '1m':  '1m',
    '2m':  '2m',
    '3m':  '2m',  // Yahoo has no 3m → use 2m
    '5m':  '5m',
    '10m': '5m',  // Yahoo has no 10m → use 5m
    '15m': '15m',
    '30m': '30m',
    '45m': '30m', // Yahoo has no 45m → use 30m
    '1h':  '60m',
    '60m': '60m',
    '90m': '90m', // Yahoo has native 90m ✅
    '2h':  '60m',
    '3h':  '60m', // Yahoo has no 3h → use 1h
    '4h':  '60m', // Yahoo has no 4h → use 1h
    '6h':  '60m', // Yahoo has no 6h → use 1h
    '12h': '1d',  // Yahoo has no 12h → use 1d
    '1d':  '1d',
    '1w':  '1wk', '1wk': '1wk',
    '1mo': '1mo',
};

// How many calendar days back to fetch per timeframe
const RANGE_DAYS: Record<string, number> = {
    '1m':  1,
    '2m':  2,
    '3m':  3,
    '5m':  5,
    '10m': 7,
    '15m': 10,
    '30m': 20,
    '45m': 20,
    '1h':  30,
    '60m': 30,
    '90m': 45,
    '2h':  45,
    '3h':  60,
    '4h':  60,
    '6h':  90,
    '12h': 180,
    '1d':  365,
    '1w':  730,  '1wk': 730,
    '1mo': 1825,
};

/**
 * Forex symbols on Yahoo Finance use the format XXXYYY=X
 * Crypto uses XXX-USD
 * Stocks use normal ticker: AAPL
 *
 * Helper: convert common shorthand to Yahoo symbol
 *   EURUSD  → EURUSD=X
 *   BTC     → BTC-USD
 *   BTCUSD  → BTC-USD
 *   AAPL    → AAPL  (unchanged)
 */
function normalizeSymbol(input: string): string {
    const upper = input.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Already in Yahoo format
    if (input.endsWith('=X') || input.includes('-')) return input.toUpperCase();

    // Common crypto shortcuts
    const cryptoMap: Record<string, string> = {
        'BTC':    'BTC-USD',
        'BTCUSD': 'BTC-USD',
        'ETH':    'ETH-USD',
        'ETHUSD': 'ETH-USD',
        'SOL':    'SOL-USD',
        'SOLUSD': 'SOL-USD',
        'XRP':    'XRP-USD',
        'XRPUSD': 'XRP-USD',
        'DOGE':   'DOGE-USD',
    };
    if (cryptoMap[upper]) return cryptoMap[upper];

    // 6-char forex pairs (e.g. EURUSD, GBPJPY)
    if (/^[A-Z]{6}$/.test(upper)) return `${upper}=X`;

    // Dollar Index
    if (upper === 'DXY' || upper === 'DX') return 'DX-Y.NYB';

    return upper;
}

function detectSwings(candles: OhlcvCandle[], lookback = 3): {
    swingHighs: OhlcvCandle[];
    swingLows:  OhlcvCandle[];
} {
    const swingHighs: OhlcvCandle[] = [];
    const swingLows:  OhlcvCandle[] = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
        const c = candles[i];
        const lh = candles.slice(i - lookback, i).every(x => x.high <= c.high);
        const rh = candles.slice(i + 1, i + lookback + 1).every(x => x.high <= c.high);
        const ll = candles.slice(i - lookback, i).every(x => x.low >= c.low);
        const rl = candles.slice(i + 1, i + lookback + 1).every(x => x.low >= c.low);

        if (lh && rh) swingHighs.push(c);
        if (ll && rl) swingLows.push(c);
    }
    return { swingHighs, swingLows };
}

/**
 * ICT top-down analysis stacks.
 * Each stack is ordered HTF → LTF for topdown analysis.
 *
 * New stacks:
 *   full      — Monthly → Weekly → Daily → 4H → 1H → 15M (comprehensive)
 *   deep      — Monthly → Weekly → Daily → 6H → 3H → 1H → 45M → 15M → 5M (maximum depth)
 *   macro     — Monthly → Weekly → Daily → 4H (orientation only, fast)
 *   precision — 4H → 1H → 45M → 15M → 5M → 3M (tight entry model)
 */
export const MTF_STACKS: Record<string, string[]> = {
    // ── existing ──────────────────────────────────────────────────────────
    swing:     ['1wk', '1d',  '4h',  '1h'],
    intraday:  ['1d',  '4h',  '1h',  '15m'],
    scalp:     ['4h',  '1h',  '15m', '5m'],
    micro:     ['1h',  '15m', '5m',  '1m'],
    // ── new ───────────────────────────────────────────────────────────────
    macro:     ['1mo', '1w',  '1d',  '4h'],
    full:      ['1mo', '1w',  '1d',  '4h',  '1h',  '15m'],
    deep:      ['1mo', '1w',  '1d',  '6h',  '3h',  '1h',  '45m', '15m', '5m'],
    precision: ['4h',  '1h',  '45m', '15m', '5m',  '3m'],
};

export type MultiTFResult = {
    symbol: string;
    mode: 'topdown' | 'bottomup';
    timeframes: string[];
    layers: Record<string, RawDataResult>;   // TF → data
    combinedSummary: string;
    /** DXY + SMT context injected as extra block (optional) */
    correlatedContext?: string;
};

// ──────────────────────── SMT Divergence ────────────────────────────────────
export type SMTSignal = {
    type: 'bullish' | 'bearish' | 'none';
    description: string;
    /** Symbol that FAILED to confirm */
    failingSymbol: string;
    /** Symbol that made the new extreme */
    leadingSymbol: string;
};

/**
 * SMT Divergence: compare the last swing highs/lows of two correlated pairs.
 * Bearish SMT: primary makes NEW swing high, smt pair DOES NOT → bearish divergence.
 * Bullish SMT: primary makes NEW swing low,  smt pair DOES NOT → bullish divergence.
 */
function detectSMTDivergence(
    primaryData:  RawDataResult,
    smtData:      RawDataResult,
    primarySymbol: string,
    smtSymbol:     string,
): SMTSignal {
    const pH = primaryData.swingHighs;
    const pL = primaryData.swingLows;
    const sH = smtData.swingHighs;
    const sL = smtData.swingLows;

    // Need at least 2 swing points each to compare
    if (pH.length < 2 || sH.length < 2 || pL.length < 2 || sL.length < 2) {
        return { type: 'none', description: 'Not enough swing data for SMT comparison.', failingSymbol: '', leadingSymbol: '' };
    }

    const primaryLastHigh  = pH[pH.length - 1].high;
    const primaryPrevHigh  = pH[pH.length - 2].high;
    const smtLastHigh      = sH[sH.length - 1].high;
    const smtPrevHigh      = sH[sH.length - 2].high;

    const primaryLastLow   = pL[pL.length - 1].low;
    const primaryPrevLow   = pL[pL.length - 2].low;
    const smtLastLow       = sL[sL.length - 1].low;
    const smtPrevLow       = sL[sL.length - 2].low;

    // Bearish SMT: primary makes higher high, SMT pair makes lower high (fails to confirm)
    const primaryHigherHigh = primaryLastHigh > primaryPrevHigh;
    const smtLowerHigh      = smtLastHigh < smtPrevHigh;
    if (primaryHigherHigh && smtLowerHigh) {
        return {
            type: 'bearish',
            description: `⚠️ BEARISH SMT DIVERGENCE: ${primarySymbol} made a new swing HIGH (${primaryLastHigh.toFixed(5)}) but ${smtSymbol} FAILED to confirm (lower high: ${smtLastHigh.toFixed(5)}). Suggests SELL-SIDE pressure — look for short setups.`,
            failingSymbol: smtSymbol,
            leadingSymbol: primarySymbol,
        };
    }

    // Bullish SMT: primary makes lower low, SMT pair makes higher low (fails to confirm)
    const primaryLowerLow = primaryLastLow < primaryPrevLow;
    const smtHigherLow    = smtLastLow > smtPrevLow;
    if (primaryLowerLow && smtHigherLow) {
        return {
            type: 'bullish',
            description: `✅ BULLISH SMT DIVERGENCE: ${primarySymbol} made a new swing LOW (${primaryLastLow.toFixed(5)}) but ${smtSymbol} FAILED to confirm (higher low: ${smtLastLow.toFixed(5)}). Suggests BUY-SIDE pressure — look for long setups.`,
            failingSymbol: smtSymbol,
            leadingSymbol: primarySymbol,
        };
    }

    return {
        type: 'none',
        description: `No SMT divergence detected between ${primarySymbol} and ${smtSymbol}. Both pairs confirming structure in sync.`,
        failingSymbol: '',
        leadingSymbol: '',
    };
}

export class MarketDataFetcher {
    /**
     * Fetch multiple timeframes for the same symbol (top-down or bottom-up).
     * @param symbol     e.g. "EURUSD", "BTC"
     * @param timeframes ordered array HTF→LTF for topdown, LTF→HTF for bottomup
     * @param mode       'topdown' | 'bottomup'
     */
    async fetchMultiTF(
        symbol: string,
        timeframes: string[],
        mode: 'topdown' | 'bottomup' = 'topdown',
        bars: number = 100,
        smtSymbol?: string,
    ): Promise<MultiTFResult> {
        const ordered = mode === 'topdown' ? timeframes : [...timeframes].reverse();

        Logger.info(`Fetching ${ordered.length} timeframes [${mode}]: ${ordered.join(' → ')}`);

        const layers: Record<string, RawDataResult> = {};
        for (const tf of ordered) {
            layers[tf] = await this.fetch(symbol, tf, bars);
        }

        const directionLabel = mode === 'topdown' ? 'HTF → LTF (Top-Down)' : 'LTF → HTF (Bottom-Up)';

        // Inject actual current wall-clock time so the model uses the real time for killzone analysis
        // Fixed offset: New York EDT = UTC-4
        const nowUTC    = new Date();
        const NY_OFFSET = -4; // EDT (UTC-4), fixed
        const nowNY     = new Date(nowUTC.getTime() + NY_OFFSET * 60 * 60 * 1000);
        const pad2      = (n: number) => String(n).padStart(2, '0');
        const nyTimeStr = `${nowNY.getUTCFullYear()}-${pad2(nowNY.getUTCMonth() + 1)}-${pad2(nowNY.getUTCDate())} ${pad2(nowNY.getUTCHours())}:${pad2(nowNY.getUTCMinutes())} New York (UTC-4 / EDT)`;

        // TF-aware role labels — works for any number of timeframes
        const TF_ROLES: Record<string, string> = {
            '1mo': 'Monthly Bias',
            '1w':  'Weekly Bias',  '1wk': 'Weekly Bias',
            '1d':  'Daily Bias',
            '6h':  'Macro Structure',
            '4h':  'Macro Structure',
            '3h':  'Intermediate Structure',
            '2h':  'Intermediate Structure',
            '1h':  'Entry TF',
            '90m': 'Entry TF',
            '45m': 'Precision Entry TF',
            '30m': 'Precision Entry TF',
            '15m': 'Trigger TF',
            '10m': 'Trigger TF',
            '5m':  'Precision Trigger',
            '3m':  'Micro Trigger',
            '2m':  'Micro Trigger',
            '1m':  'Micro Trigger',
        };

        const combinedSummary = [
            `=== MULTI-TIMEFRAME ANALYSIS [${directionLabel}] ===`,
            `Symbol: ${normalizeSymbol(symbol)}`,
            `Current Wall-Clock Time (UTC): ${nowUTC.toISOString()}`,
            `Current Wall-Clock Time (New York / EDT): ${nyTimeStr}`,
            '',
            ...ordered.map(tf => {
                const layer = layers[tf];
                const role  = TF_ROLES[tf] ?? tf.toUpperCase();
                return `[${role} — ${tf.toUpperCase()}]\n${layer.summary}`;
            }),
        ].join('\n\n');

        // Fetch DXY + SMT correlated context (non-blocking, on entry TF)
        const entryTF          = ordered[Math.floor(ordered.length / 2)] ?? ordered[ordered.length - 1];
        const correlatedContext = await this.fetchCorrelatedContext(symbol, smtSymbol ?? null, entryTF, bars)
            .catch((e: any) => { Logger.warn(`Correlated context failed: ${e.message}`); return ''; });

        return { symbol: normalizeSymbol(symbol), mode, timeframes: ordered, layers, combinedSummary, correlatedContext };
    }

    /**
     * Fetch live OHLCV data.
     * Priority: Twelve Data (if key set) → OANDA (if key set) → Yahoo Finance.
     */
    async fetch(symbol: string, timeframe: string = '1h', bars: number = 200): Promise<RawDataResult> {
        const oandaInstrument = toOandaInstrument(symbol);
        const useTwelve       = !!TWELVE_API_KEY;
        const useOanda        = !!OANDA_API_KEY && !!oandaInstrument && !useTwelve;  // OANDA fallback only if no Twelve

        let candles: OhlcvCandle[];
        let displaySymbol: string;
        let source: string;

        if (useTwelve) {
            const twSymbol = toTwelveSymbol(symbol);
            console.log(`📡 Đang lấy dữ liệu [Twelve Data]: ${twSymbol} | ${timeframe} | ${bars} bars...`);
            try {
                candles       = await fetchTwelveData(symbol, timeframe, bars);
                displaySymbol = twSymbol;
                source        = 'Twelve Data';
            } catch (err: any) {
                Logger.warn(`Twelve Data lỗi (${err.message}), fallback → Yahoo Finance`);
                ({ candles, displaySymbol, source } = await this.fetchYahoo(symbol, timeframe, bars));
            }
        } else if (useOanda) {
            console.log(`📡 Đang lấy dữ liệu [OANDA]: ${oandaInstrument} | ${timeframe} | ${bars} bars...`);
            try {
                candles       = await fetchOanda(oandaInstrument!, timeframe, bars);
                displaySymbol = oandaInstrument!;
                source        = 'OANDA';
            } catch (err: any) {
                Logger.warn(`OANDA lỗi (${err.message}), fallback → Yahoo Finance`);
                ({ candles, displaySymbol, source } = await this.fetchYahoo(symbol, timeframe, bars));
            }
        } else {
            ({ candles, displaySymbol, source } = await this.fetchYahoo(symbol, timeframe, bars));
        }

        if (candles.length === 0) {
            throw new Error(`Không có dữ liệu cho ${symbol}.`);
        }

        const recent       = candles.slice(-bars);
        const recentHigh   = Math.max(...recent.map(c => c.high));
        const recentLow    = Math.min(...recent.map(c => c.low));
        const { swingHighs, swingLows } = detectSwings(candles);
        const latestCandle = candles[candles.length - 1];
        const prevClose    = candles.length > 1 ? candles[candles.length - 2].close : latestCandle.open;
        const direction    = latestCandle.close > prevClose ? 'bullish' : 'bearish';

        const summary = [
            `Symbol: ${displaySymbol} | Timeframe: ${timeframe} | Source: ${source}`,
            `Total candles fetched: ${candles.length} | Showing last ${recent.length}`,
            `Latest candle [${latestCandle.time}]: O=${latestCandle.open} H=${latestCandle.high} L=${latestCandle.low} C=${latestCandle.close} (${direction})`,
            `Recent ${recent.length}-bar High: ${recentHigh} | Low: ${recentLow}`,
            `Swing Highs: ${swingHighs.length} | Swing Lows: ${swingLows.length}`,
            swingHighs.length > 0 ? `Last Swing High: ${swingHighs.at(-1)!.high} @ ${swingHighs.at(-1)!.time}` : '',
            swingLows.length  > 0 ? `Last Swing Low:  ${swingLows.at(-1)!.low}  @ ${swingLows.at(-1)!.time}`  : '',
        ].filter(Boolean).join('\n');

        return {
            symbol:       displaySymbol,
            timeframe,
            candles:      recent,
            latestCandle,
            recentHigh,
            recentLow,
            swingHighs,
            swingLows,
            summary,
        };
    }

    /** Private: fetch via Yahoo Finance */
    private async fetchYahoo(
        symbol: string,
        timeframe: string,
        bars: number,
    ): Promise<{ candles: OhlcvCandle[]; displaySymbol: string; source: string }> {
        const yahooSymbol = normalizeSymbol(symbol);
        const interval    = INTERVAL_MAP[timeframe] ?? '60m';
        const rangeDays   = RANGE_DAYS[timeframe] ?? 30;
        const period2     = new Date();
        const period1     = new Date(period2.getTime() - rangeDays * 24 * 60 * 60 * 1000);

        console.log(`📡 Đang lấy dữ liệu [Yahoo Finance]: ${yahooSymbol} | ${timeframe} | ${rangeDays} ngày...`);

        const rawResult: any = await yahooFinance.chart(yahooSymbol, { period1, period2, interval });
        const quotes: any[]  = Array.isArray(rawResult) ? rawResult : (rawResult?.quotes ?? []);
        if (quotes.length === 0) throw new Error(`Không có dữ liệu Yahoo cho ${yahooSymbol}.`);

        const candles: OhlcvCandle[] = quotes
            .filter((q: any) => q.open != null && q.close != null)
            .map((q: any) => ({
                time:   q.date instanceof Date ? q.date.toISOString() : String(q.date),
                open:   Number(q.open),
                high:   Number(q.high),
                low:    Number(q.low),
                close:  Number(q.close),
                volume: q.volume != null ? Number(q.volume) : undefined,
            }));

        return { candles, displaySymbol: yahooSymbol, source: 'Yahoo Finance' };
    }

    /**
     * Fetch DXY + optional SMT pair on a given timeframe and return a formatted
     * correlated-context string ready to inject into the analysis prompt.
     *
     * @param primarySymbol  e.g. "EURUSD"
     * @param smtSymbol      e.g. "GBPUSD" (or null to skip SMT)
     * @param timeframe      reference timeframe for DXY + SMT (usually '1h' or '4h')
     * @param bars           bars to fetch
     */
    async fetchCorrelatedContext(
        primarySymbol: string,
        smtSymbol: string | null,
        timeframe: string = '1h',
        bars: number = 100,
    ): Promise<string> {
        const blocks: string[] = [];

        // ── DXY ─────────────────────────────────────────────────────────────
        try {
            Logger.info(`Fetching DXY ${timeframe}...`);
            const dxy = await this.fetch('DXY', timeframe, bars);
            const dxyDir = dxy.latestCandle.close > dxy.candles[0].close ? 'STRENGTHENING ↑' : 'WEAKENING ↓';
            blocks.push([
                `=== DXY (US Dollar Index) — ${timeframe} ===`,
                `Latest: ${dxy.latestCandle.close.toFixed(3)} | Direction: ${dxyDir}`,
                `Recent High: ${dxy.recentHigh.toFixed(3)} | Recent Low: ${dxy.recentLow.toFixed(3)}`,
                dxy.swingHighs.length > 0 ? `Last Swing High: ${dxy.swingHighs.at(-1)!.high.toFixed(3)} @ ${dxy.swingHighs.at(-1)!.time}` : '',
                dxy.swingLows.length  > 0 ? `Last Swing Low:  ${dxy.swingLows.at(-1)!.low.toFixed(3)}  @ ${dxy.swingLows.at(-1)!.time}` : '',
                `NOTE: EUR/GBP pairs inversely correlated with DXY. DXY ${dxyDir === 'STRENGTHENING ↑' ? 'strength → bearish pressure on EUR/GBP pairs' : 'weakness → bullish pressure on EUR/GBP pairs'}.`,
            ].filter(Boolean).join('\n'));
        } catch (e: any) {
            Logger.warn(`DXY fetch failed: ${e.message}`);
        }

        // ── SMT Divergence ──────────────────────────────────────────────────
        if (smtSymbol) {
            try {
                Logger.info(`Fetching SMT pair ${smtSymbol} ${timeframe}...`);
                const primaryData = await this.fetch(primarySymbol, timeframe, bars);
                const smtData     = await this.fetch(smtSymbol, timeframe, bars);
                const signal      = detectSMTDivergence(primaryData, smtData, primarySymbol, smtSymbol);

                const smtLatestClose = smtData.latestCandle.close;
                const smtDir = smtData.latestCandle.close > smtData.candles[0].close ? 'bullish' : 'bearish';

                blocks.push([
                    `=== SMT PAIR: ${smtSymbol} — ${timeframe} (for SMT Divergence vs ${primarySymbol}) ===`,
                    `Latest Close: ${smtLatestClose} (${smtDir})`,
                    `Recent High: ${smtData.recentHigh} | Recent Low: ${smtData.recentLow}`,
                    smtData.swingHighs.length > 0 ? `Last Swing High: ${smtData.swingHighs.at(-1)!.high} @ ${smtData.swingHighs.at(-1)!.time}` : '',
                    smtData.swingLows.length  > 0 ? `Last Swing Low:  ${smtData.swingLows.at(-1)!.low}  @ ${smtData.swingLows.at(-1)!.time}` : '',
                    '',
                    `=== SMT DIVERGENCE SIGNAL ===`,
                    signal.description,
                ].filter(Boolean).join('\n'));
            } catch (e: any) {
                Logger.warn(`SMT pair fetch failed: ${e.message}`);
            }
        }

        if (blocks.length === 0) return '';
        return [
            '═'.repeat(64),
            '=== CORRELATED MARKET CONTEXT (DXY + SMT) ===',
            '═'.repeat(64),
            ...blocks,
            '═'.repeat(64),
        ].join('\n\n');
    }}