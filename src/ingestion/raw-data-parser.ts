import fs from 'fs';
import path from 'path';

export type OhlcvCandle = {
    time: string;   // ISO string or readable timestamp
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
};

export type RawDataResult = {
    symbol: string;
    timeframe: string;
    candles: OhlcvCandle[];
    latestCandle: OhlcvCandle;
    recentHigh: number;
    recentLow: number;
    swingHighs: OhlcvCandle[];
    swingLows: OhlcvCandle[];
    summary: string;
};

export class RawDataParser {
    /**
     * Parse OHLCV data from a JSON file.
     * Supports two shapes:
     *   - Array of candles: [{ time, open, high, low, close, volume? }, ...]
     *   - TradingView export: { symbol, timeframe, data: [...] }
     */
    parseJson(filePath: string): RawDataResult {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);

        let symbol = 'UNKNOWN';
        let timeframe = 'UNKNOWN';
        let candles: OhlcvCandle[] = [];

        if (Array.isArray(parsed)) {
            candles = this.normalizeCandles(parsed);
        } else if (parsed.data && Array.isArray(parsed.data)) {
            symbol = parsed.symbol || symbol;
            timeframe = parsed.timeframe || timeframe;
            candles = this.normalizeCandles(parsed.data);
        } else {
            throw new Error(`Unrecognised raw data format in: ${filePath}`);
        }

        if (candles.length === 0) {
            throw new Error(`No candles found in: ${filePath}`);
        }

        return this.buildResult(symbol, timeframe, candles);
    }

    /**
     * Parse OHLCV data from a CSV file.
     * Expects header row: time,open,high,low,close[,volume]
     */
    parseCsv(filePath: string): RawDataResult {
        const raw = fs.readFileSync(filePath, 'utf8');
        const lines = raw.trim().split('\n').filter(Boolean);
        const headers = lines[0].toLowerCase().split(',');

        const idx = {
            time:   headers.indexOf('time'),
            open:   headers.indexOf('open'),
            high:   headers.indexOf('high'),
            low:    headers.indexOf('low'),
            close:  headers.indexOf('close'),
            volume: headers.indexOf('volume'),
        };

        const candles: OhlcvCandle[] = lines.slice(1).map(line => {
            const cols = line.split(',');
            return {
                time:   cols[idx.time]?.trim() ?? '',
                open:   parseFloat(cols[idx.open]),
                high:   parseFloat(cols[idx.high]),
                low:    parseFloat(cols[idx.low]),
                close:  parseFloat(cols[idx.close]),
                volume: idx.volume >= 0 ? parseFloat(cols[idx.volume]) : undefined,
            };
        });

        const symbol = path.basename(filePath, path.extname(filePath)).toUpperCase();
        return this.buildResult(symbol, 'CSV', candles);
    }

    /**
     * Auto-detect format and parse.
     */
    parse(filePath: string): RawDataResult {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.csv') return this.parseCsv(filePath);
        return this.parseJson(filePath);
    }

    private normalizeCandles(raw: any[]): OhlcvCandle[] {
        return raw
            .filter(row => row !== null && typeof row === 'object')
            .map(row => ({
                time:   String(row.time ?? row.t ?? row.timestamp ?? row.date ?? ''),
                open:   Number(row.open  ?? row.o ?? 0),
                high:   Number(row.high  ?? row.h ?? 0),
                low:    Number(row.low   ?? row.l ?? 0),
                close:  Number(row.close ?? row.c ?? 0),
                volume: row.volume !== undefined ? Number(row.volume ?? row.v) : undefined,
            }));
    }

    private detectSwings(candles: OhlcvCandle[], lookback: number = 3): {
        swingHighs: OhlcvCandle[];
        swingLows: OhlcvCandle[];
    } {
        const swingHighs: OhlcvCandle[] = [];
        const swingLows: OhlcvCandle[] = [];

        for (let i = lookback; i < candles.length - lookback; i++) {
            const center = candles[i];
            const leftHighs  = candles.slice(i - lookback, i).every(c => c.high  <= center.high);
            const rightHighs = candles.slice(i + 1, i + lookback + 1).every(c => c.high  <= center.high);
            const leftLows   = candles.slice(i - lookback, i).every(c => c.low   >= center.low);
            const rightLows  = candles.slice(i + 1, i + lookback + 1).every(c => c.low   >= center.low);

            if (leftHighs && rightHighs) swingHighs.push(center);
            if (leftLows  && rightLows)  swingLows.push(center);
        }

        return { swingHighs, swingLows };
    }

    private buildResult(symbol: string, timeframe: string, candles: OhlcvCandle[]): RawDataResult {
        const recent = candles.slice(-50);
        const recentHigh = Math.max(...recent.map(c => c.high));
        const recentLow  = Math.min(...recent.map(c => c.low));
        const { swingHighs, swingLows } = this.detectSwings(candles);

        const latestCandle = candles[candles.length - 1];
        const prevClose    = candles.length > 1 ? candles[candles.length - 2].close : latestCandle.open;
        const direction    = latestCandle.close > prevClose ? 'bullish' : 'bearish';

        const summary = [
            `Symbol: ${symbol} | Timeframe: ${timeframe}`,
            `Total candles: ${candles.length}`,
            `Latest: O=${latestCandle.open} H=${latestCandle.high} L=${latestCandle.low} C=${latestCandle.close} (${direction})`,
            `Recent 50-bar High: ${recentHigh} | Low: ${recentLow}`,
            `Swing Highs detected: ${swingHighs.length} | Swing Lows detected: ${swingLows.length}`,
            swingHighs.length > 0
                ? `Last Swing High: ${swingHighs.at(-1)!.high} @ ${swingHighs.at(-1)!.time}`
                : '',
            swingLows.length > 0
                ? `Last Swing Low: ${swingLows.at(-1)!.low} @ ${swingLows.at(-1)!.time}`
                : '',
        ].filter(Boolean).join('\n');

        return { symbol, timeframe, candles, latestCandle, recentHigh, recentLow, swingHighs, swingLows, summary };
    }
}
