import path from 'path';
import { StorageService } from './storage-service';
import { ChartDecisionResult } from './chart-analysis-service';

// ── Types ────────────────────────────────────────────────────────────────────

export type TradeOutcome = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'PENDING';

export type TradeCase = {
    id:               string;
    timestamp:        string;
    symbol:           string;
    timeframe:        string;
    stack?:           string;
    /** ICT concepts detected — used for similarity search */
    setupConditions:  string[];
    bias:             string;
    entry?:           string;
    sl?:              string;
    tp?:              string;
    rr?:              string;
    outcome:          TradeOutcome;
    pips?:            number;
    notes?:           string;
    /** Links to the full chart-analysis JSON file */
    analysisFile:     string;
};

export type CaseStats = {
    total:      number;
    wins:       number;
    losses:     number;
    breakeven:  number;
    pending:    number;
    winRate:    number;   // 0-100 %
    avgPips:    number;
    totalPips:  number;
};

// ── Service ──────────────────────────────────────────────────────────────────

export class OutcomeService {
    private readonly storage: StorageService;
    private static readonly CASE_LOG = 'trade-cases.json';

    constructor() {
        const statefulDir = path.join(process.cwd(), 'data', 'stateful');
        this.storage = new StorageService(statefulDir);
    }

    // ── Read / write helpers ────────────────────────────────────────────────

    private loadAll(): TradeCase[] {
        return this.storage.readJson<TradeCase[]>(OutcomeService.CASE_LOG) ?? [];
    }

    private saveAll(cases: TradeCase[]): void {
        this.storage.saveJson(OutcomeService.CASE_LOG, cases);
    }

    // ── Record a new analysis as a pending case ─────────────────────────────

    recordCase(result: ChartDecisionResult, analysisFile: string): TradeCase {
        const setup = result.analysis.setup;

        // Extract ICT setup conditions from the analysis
        const conditions: string[] = [];

        if (result.analysis.htfBias)            conditions.push(`htf_bias:${result.analysis.htfBias}`);
        if (setup.bias && setup.bias !== 'no_trade') conditions.push(`bias:${setup.bias}`);
        if (result.analysis.marketStructure?.status) conditions.push(`structure:${result.analysis.marketStructure.status}`);
        if (result.analysis.drawOnLiquidity)    conditions.push(`draw_on_liq:${result.analysis.drawOnLiquidity.slice(0, 60)}`);
        if (result.analysis.killzoneAlignment)  conditions.push(`killzone:${result.analysis.killzoneAlignment.slice(0, 40)}`);
        if (setup.reason)                        conditions.push(`reason:${setup.reason.slice(0, 80)}`);

        const tc: TradeCase = {
            id:              String(Date.now()),
            timestamp:       result.timestamp,
            symbol:          result.symbol ?? 'UNKNOWN',
            timeframe:       result.timeframe ?? 'UNKNOWN',
            setupConditions: conditions,
            bias:            setup.bias ?? 'no_trade',
            entry:           setup.entryZone,
            sl:              setup.stopLoss,
            tp:              setup.target,
            rr:              setup.rrRatio,
            outcome:         'PENDING',
            analysisFile,
        };

        const cases = this.loadAll();
        cases.push(tc);
        this.saveAll(cases);

        return tc;
    }

    // ── Update outcome for an existing case ────────────────────────────────

    updateOutcome(id: string, outcome: TradeOutcome, pips?: number, notes?: string): TradeCase {
        const cases = this.loadAll();
        const idx = cases.findIndex(c => c.id === id);
        if (idx === -1) throw new Error(`Case ID not found: ${id}`);

        cases[idx] = { ...cases[idx], outcome, pips, notes };
        this.saveAll(cases);
        return cases[idx];
    }

    // ── Find similar past cases based on setup conditions ──────────────────

    findSimilarCases(symbol: string, setupConditions: string[], limit = 5): TradeCase[] {
        const cases = this.loadAll().filter(c => c.outcome !== 'PENDING');

        return cases
            .map(c => {
                // Count matching condition prefixes (htf_bias, bias, structure...)
                const overlap = setupConditions.filter(cond => {
                    const prefix = cond.split(':')[0];
                    return c.setupConditions.some(s => s.startsWith(prefix + ':') && s === cond);
                }).length;
                return { case: c, score: overlap };
            })
            .filter(x => x.score > 0)
            .sort((a, b) => {
                // Same symbol bonus
                const aBonus = a.case.symbol === symbol ? 1 : 0;
                const bBonus = b.case.symbol === symbol ? 1 : 0;
                return (b.score + bBonus) - (a.score + aBonus);
            })
            .slice(0, limit)
            .map(x => x.case);
    }

    // ── Build summary string for injection into chart analysis context ──────

    buildHistoryContext(symbol: string, setupConditions: string[]): string {
        const similar = this.findSimilarCases(symbol, setupConditions, 5);
        if (similar.length === 0) return '';

        const lines = [
            '### EPISODIC MEMORY — Similar Past Trades',
            `(${similar.length} case(s) found with matching setup conditions)\n`,
        ];

        for (const c of similar) {
            const pip = c.pips !== undefined ? `${c.pips > 0 ? '+' : ''}${c.pips} pips` : 'pips N/A';
            const icon = c.outcome === 'WIN' ? '✅' : c.outcome === 'LOSS' ? '❌' : '➖';
            lines.push(`${icon} [${c.symbol} | ${c.timeframe} | ${c.timestamp.slice(0, 10)}]`);
            lines.push(`   Bias: ${c.bias} | Outcome: ${c.outcome} ${pip}`);
            lines.push(`   Setup: ${c.setupConditions.slice(0, 4).join(', ')}`);
            if (c.notes) lines.push(`   Notes: ${c.notes}`);
            lines.push('');
        }

        const stats = this.getStats(symbol);
        if (stats.total >= 3) {
            lines.push(`📊 ${symbol} stats (${stats.total} completed): Win rate ${stats.winRate.toFixed(0)}% | Avg pips ${stats.avgPips.toFixed(1)}`);
        }

        return lines.join('\n');
    }

    // ── Stats ───────────────────────────────────────────────────────────────

    getStats(symbol?: string): CaseStats {
        const cases = this.loadAll().filter(c =>
            c.outcome !== 'PENDING' && (!symbol || c.symbol === symbol)
        );

        const wins      = cases.filter(c => c.outcome === 'WIN').length;
        const losses    = cases.filter(c => c.outcome === 'LOSS').length;
        const breakeven = cases.filter(c => c.outcome === 'BREAKEVEN').length;
        const pipsArr   = cases.filter(c => c.pips !== undefined).map(c => c.pips as number);
        const totalPips = pipsArr.reduce((s, p) => s + p, 0);

        return {
            total:     cases.length,
            wins,
            losses,
            breakeven,
            pending:   this.loadAll().filter(c => c.outcome === 'PENDING').length,
            winRate:   cases.length > 0 ? (wins / cases.length) * 100 : 0,
            avgPips:   pipsArr.length > 0 ? totalPips / pipsArr.length : 0,
            totalPips,
        };
    }

    // ── List cases ───────────────────────────────────────────────────────────

    listCases(symbol?: string, limit = 20): TradeCase[] {
        return this.loadAll()
            .filter(c => !symbol || c.symbol === symbol)
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
            .slice(0, limit);
    }
}
