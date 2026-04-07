/**
 * TradingViewCapturer — Phase 1 (fully automated multi-TF)
 *
 * Opens Chrome (with a dedicated bot profile so it never conflicts with your
 * running Chrome), restores saved cookies so TradingView stays logged in,
 * navigates to each timeframe via URL, waits for YOUR layout + indicators
 * to fully render, then screenshots only the chart area.
 *
 * Config (.env):
 *   CHROME_PATH      path to chrome.exe   (auto-detected if omitted)
 *   TV_COOKIE_FILE   cookie persistence   (default: data/tv-cookies.json)
 *
 * Usage:
 *   npm run stateful:capture -- --symbol EURUSD --stack intraday
 *   npm run stateful:capture -- --symbol XAUUSD --tfs 4h,1h,15m,5m
 */
import puppeteer, { Browser, Page } from 'puppeteer-core';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { Logger } from '../utils/logger.js';

dotenv.config();

// ── TF string → TradingView URL interval ─────────────────────────────────────
const TV_INTERVAL: Record<string, string> = {
    '1m':  '1',   '1':    '1',
    '3m':  '3',   '3':    '3',
    '5m':  '5',   '5':    '5',
    '10m': '10',
    '15m': '15',  '15':   '15',
    '30m': '30',  '30':   '30',
    '45m': '45',  '45':   '45',
    '1h':  '60',  '60m':  '60',  '60':  '60',
    '2h':  '120', '120m': '120',
    '3h':  '180',
    '4h':  '240', '240m': '240',
    '6h':  '360',
    '8h':  '480',
    '12h': '720',
    '1d':  'D',   '1D':   'D',   'D':   'D',
    '1w':  'W',   '1wk':  'W',   'W':   'W',
    '1mo': 'M',   '1M':   'M',   'M':   'M',
};

// IPDA lookback windows — target visible bars per timeframe
// IPDA lookback windows — TradingView native &range= URL param
// Supported: 1D 5D 1M 3M 6M YTD 1Y 3Y 5Y ALL
const IPDA_RANGE: Record<string, string> = {
    '1m':  '1D',  '3m':  '1D',  '5m':  '5D',  '10m': '5D',
    '15m': '5D',  '30m': '1M',  '45m': '1M',
    '1h':  '1M',  '2h':  '3M',  '3h':  '3M',
    '4h':  '3M',  '6h':  '6M',  '8h':  '6M',  '12h': '6M',
    '1d':  '6M',  '1w':  '3Y',  '1mo': '5Y',
};
const CHART_SELECTORS = [
    '[data-name="chart-area"]',
    '.chart-container',
    '#chart_container',
    '.layout__area--center',
    '.chart-markup-table',
];

// Popup / toast close-button selectors
const POPUP_SELECTORS = [
    '[data-name="close-button"]',
    '.js-dialog__close',
    'button[aria-label="Close"]',
    '.tv-dialog__close',
    '[data-role="toast-close-button"]',
    '.toast-close-button',
];

export type CapturedChart = {
    tf: string;
    imagePath: string;
};

/** @deprecated kept for backward-compatibility with old CLI */
export interface CaptureOptions {
    symbol?:      string;
    timeframe?:   string;
    outputDir?:   string;
    waitSeconds?: number;
}

/** @deprecated kept for backward-compatibility with old CLI */
export interface CaptureLoopOptions extends CaptureOptions {
    intervalMinutes?: number;
    totalCaptures?:   number;
}

export class TradingViewCapturer {

    // ── Config ────────────────────────────────────────────────────────────────

    private readonly chromeCandidates: string[] = [
        process.env.CHROME_PATH ?? '',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    ];

    private readonly cookieFile: string;
    private readonly outputDir: string;

    constructor(outputDir?: string) {
        this.outputDir  = outputDir ?? path.join(process.cwd(), 'data', 'screenshots');
        this.cookieFile = process.env.TV_COOKIE_FILE
            ?? path.join(process.cwd(), 'data', 'tv-cookies.json');
        fs.mkdirSync(this.outputDir,              { recursive: true });
        fs.mkdirSync(path.dirname(this.cookieFile), { recursive: true });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PUBLIC — multi-TF automated capture (new main entry point)
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Fully automated: open Chrome (bot profile), restore cookies, navigate
     * TradingView to each TF, wait for YOUR layout + indicators, screenshot.
     *
     * First run: Chrome opens → if not logged in, bot pauses → you log in once
     * → bot saves cookies → next runs are fully silent.
     */
    async captureMultiTF(symbol: string, timeframes: string[]): Promise<CapturedChart[]> {
        Logger.info(`[TV] Symbol: ${symbol} | TFs: ${timeframes.join(' → ')}`);

        const browser = await this.launchBrowser();
        const results: CapturedChart[] = [];

        try {
            const page = await browser.newPage();
            await page.setViewport({ width: 1920, height: 1080 });

            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                // @ts-ignore
                delete navigator.__proto__.webdriver;
            });

            await this.loadCookies(page);

            // ── Loop: navigate per TF with IPDA range ────────────────────────
            for (const tf of timeframes) {
                const interval = TV_INTERVAL[tf];
                if (!interval) {
                    Logger.warn(`[TV] Unknown TF "${tf}" — bỏ qua`);
                    continue;
                }

                try {
                    const range = IPDA_RANGE[tf] ?? '3M';
                    Logger.info(`[TV] ${tf} → &range=${range}`);
                    await this.navigate(page, symbol, interval, range);
                    await this.waitForChart(page);
                    await this.dismissPopups(page);

                    await this.sleep(1_500); // let indicators render
                    const clip    = await this.getChartClip(page);
                    const outPath = path.join(this.outputDir, `${symbol}_${tf}.png`);
                    await page.screenshot({ path: outPath, clip, type: 'png' });

                    const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
                    Logger.info(`[TV] ✅ ${tf} → ${path.basename(outPath)}  (${sizeKB} KB)`);
                    results.push({ tf, imagePath: outPath });
                } catch (tfErr: any) {
                    Logger.warn(`[TV] ❌ Lỗi TF ${tf}: ${tfErr.message?.slice(0, 120)}`);
                }
            }
        } finally {
            await browser.close();
        }

        return results;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PRIVATE — browser helpers
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Switch TradingView chart to a different interval without a full page reload.
     * Clicks the interval button in the top toolbar.
     * Returns true if click succeeded, false if button not found (caller falls back to navigate).
     */
    private async switchTimeframe(page: Page, interval: string): Promise<boolean> {
        try {
            // Map interval string → display label TradingView uses on the button
            const labelMap: Record<string, string[]> = {
                '1':   ['1m', '1'],   '3':  ['3m', '3'],   '5':  ['5m', '5'],
                '10':  ['10m', '10'], '15': ['15m', '15'],  '30': ['30m', '30'],
                '45':  ['45m', '45'], '60': ['1h', '60m', '1H'],
                '120': ['2h', '2H'],  '180':['3h', '3H'],   '240':['4h', '4H'],
                '360': ['6h', '6H'],  '480':['8h', '8H'],   '720':['12h', '12H'],
                'D':   ['D', '1D', '1d'],  'W': ['W', '1W'],  'M': ['M', '1M'],
            };
            const labels = labelMap[interval] ?? [interval];

            // Try clicking button by data-value attribute
            const clicked = await page.evaluate((iv: string, lbls: string[]) => {
                // 1) data-value match
                const byValue = document.querySelector<HTMLElement>(`[data-name="header-toolbar-time-intervals"] button[data-value="${iv}"]`);
                if (byValue) { byValue.click(); return true; }
                // 2) text content match
                const allBtns = Array.from(document.querySelectorAll<HTMLElement>('[data-name="header-toolbar-time-intervals"] button'));
                for (const btn of allBtns) {
                    if (lbls.some(l => btn.textContent?.trim() === l)) {
                        btn.click(); return true;
                    }
                }
                return false;
            }, interval, labels);

            if (clicked) {
                await this.sleep(2_500); // wait for chart to update
                Logger.info(`[TV] Switched TF → ${interval}`);
                return true;
            }
            return false;
        } catch {
            return false;
        }
    }


    private findChrome(): string {
        for (const p of this.chromeCandidates) {
            if (p && fs.existsSync(p)) return p;
        }
        throw new Error(
            'Không tìm thấy Chrome.\n' +
            '→ Set CHROME_PATH=<đường dẫn chrome.exe> trong file .env',
        );
    }

    private async launchBrowser(): Promise<Browser> {
        const botProfileDir = path.join(process.cwd(), 'data', '.chrome-bot-profile');
        fs.mkdirSync(botProfileDir, { recursive: true });

        // Try user's real Chrome profile first (must have Chrome closed)
        const realProfile = process.env.CHROME_USER_DATA;
        const profilesToTry = realProfile
            ? [realProfile, botProfileDir]
            : [botProfileDir];

        for (const userDataDir of profilesToTry) {
            // Remove Chrome's SingletonLock file if left behind by a previous kill
            // (Chrome not closed gracefully leaves this file and blocks next launch)
            for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
                const lp = path.join(userDataDir, lockFile);
                try { if (fs.existsSync(lp)) { fs.unlinkSync(lp); Logger.info(`[TV] Removed stale lock: ${lockFile}`); } } catch {}
            }

            try {
                const browser = await puppeteer.launch({
                    executablePath: this.findChrome(),
                    headless:       false,
                    defaultViewport: null,
                    protocolTimeout: 90_000,   // prevent Page.captureScreenshot timeout
                    ignoreDefaultArgs: ['--enable-automation'],
                    args: [
                        '--start-maximized',
                        '--no-default-browser-check',
                        '--no-first-run',
                        '--disable-blink-features=AutomationControlled',
                        '--disable-infobars',
                        `--user-data-dir=${userDataDir}`,
                    ],
                });
                if (userDataDir === realProfile) {
                    Logger.info(`[TV] ✅ Dùng Chrome profile của bạn: ${userDataDir}`);
                } else {
                    Logger.info(`[TV] Dùng bot profile: ${userDataDir}`);
                    if (realProfile) {
                        Logger.info('[TV] ℹ️  (Chrome đang mở → dùng bot profile thay thế. Lần đầu cần login.)');
                    }
                }
                return browser;
            } catch (err: any) {
                if (userDataDir === realProfile) {
                    // Any error with real profile → fall back to bot profile
                    Logger.warn(`[TV] Real profile error: ${err.message?.slice(0, 80)}`);
                    Logger.warn('[TV] → Tự động chuyển sang bot profile...');
                    continue;
                }
                throw err;
            }
        }

        throw new Error('Không thể khởi động Chrome với bất kỳ profile nào.');
    }

    private async navigate(page: Page, symbol: string, interval: string, range?: string): Promise<void> {
        let url = `https://www.tradingview.com/chart/?symbol=${symbol.toUpperCase()}&interval=${interval}`;
        if (range) url += `&range=${range}`;
        Logger.info(`[TV] → ${url}`);
        // Retry up to 3 times — ERR_CONNECTION_CLOSED can happen between TF navigations
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
                await this.sleep(600);
                return;
            } catch (err: any) {
                if (attempt < 3) {
                    Logger.warn(`[TV] navigate attempt ${attempt} failed (${err.message?.slice(0, 60)}), retrying...`);
                    await this.sleep(1_000);
                } else {
                    throw err;
                }
            }
        }
    }

    private async isLoggedIn(page: Page): Promise<boolean> {
        try {
            return await page.evaluate(() => {
                const html = document.documentElement.innerHTML;
                // Logged-in: user menu button present
                const hasUserMenu    = !!document.querySelector('[data-name="header-user-menu-button"]');
                const hasAvatar      = !!document.querySelector('.tv-header__user-menu-button--logged');
                const hasAccountIcon = html.includes('user-menu') && !html.includes('sign-in');
                // Not logged-in: sign-in/sign-up buttons
                const hasSignIn      = !!document.querySelector('[data-name="header-user-menu-sign-in"]');
                const hasSignUp      = !!document.querySelector('[data-name="header-user-menu-sign-up"]');
                if (hasSignIn || hasSignUp) return false;
                return hasUserMenu || hasAvatar || hasAccountIcon;
            });
        } catch {
            return false;
        }
    }

    // ── IPDA zoom ─────────────────────────────────────────────────────────────

    /**
     * Set X-axis zoom to the ICT IPDA lookback window for the given TF.
     *
     * Tier-1 (JS API): inject window code to call chart.setVisibleRange({ from, to })
     *   — TradingView exposes this on some page types; most accurate.
     *
     * Tier-2 (mouse scroll fallback):
     *   1. Press 'A' → TV auto-fits to ALL historical data (could be thousands of bars)
     *   2. Move mouse to X-axis strip at the bottom
     *   3. Scroll UP (negative deltaY) to ZOOM IN to target bar count
     *      Each tick on the X-axis ≈ 5.5% zoom change (multiplicative)
     *      → ticks = ln(allBars / targetBars) / ln(1.055)
     *
     * Note: physical mouse movement does NOT interfere — puppeteer uses CDP synthetic events.
     */
    private async setIPDAZoom(page: Page, tf: string): Promise<void> {
        const targetDays = IPDA_DAYS[tf] ?? 60;
        const targetBars = IPDA_BARS[tf] ?? 150;
        const allBars    = ALL_DATA_BARS[tf] ?? 5000;
        try {
            const clip   = await this.getChartClip(page);
            const cx     = Math.round(clip.x + clip.width  / 2);
            const cy     = Math.round(clip.y + clip.height / 2);
            const vpH    = page.viewport()?.height ?? 1080;
            // X-axis strip: just below clip area
            const xAxisY = Math.min(clip.y + clip.height + 15, vpH - 10);

            // Click chart center to give keyboard focus
            await page.mouse.click(cx, cy);
            await this.sleep(300);

            // ── Tier-1: JS setVisibleRange ──────────────────────────────────
            const toTs   = Math.floor(Date.now() / 1_000);
            const fromTs = toTs - targetDays * 86_400;

            const jsOk = await page.evaluate((from: number, to: number) => {
                // Scan window properties for a TV chart object with setVisibleRange
                try {
                    const win = window as any;
                    // Direct tvWidget reference
                    for (const wk of ['tvWidget', '_tvWidget', 'tvwidget']) {
                        if (win[wk]?.chart?.()?.setVisibleRange) {
                            win[wk].chart().setVisibleRange({ from, to }, { percentRightMargin: 5 });
                            return 'tvWidget:' + wk;
                        }
                    }
                    // Scan first 300 window keys
                    for (const k of Object.keys(win).slice(0, 300)) {
                        const v = win[k];
                        if (!v || typeof v !== 'object') continue;
                        if (typeof v.chart === 'function') {
                            try {
                                const c = v.chart();
                                if (typeof c?.setVisibleRange === 'function') {
                                    c.setVisibleRange({ from, to }, { percentRightMargin: 5 });
                                    return 'scan:' + k;
                                }
                            } catch {}
                        }
                    }
                } catch {}
                return null;
            }, fromTs, toTs);

            if (jsOk) {
                Logger.info(`[TV] ✅ IPDA zoom via JS (${jsOk}): ${tf} → ${targetDays} days`);
                await this.sleep(800);
                return;
            }

            // ── Tier-2: X-axis mouse scroll ─────────────────────────────────
            Logger.info(`[TV] JS API unavailable — falling back to X-axis scroll`);

            // Press 'A' → TV shows ALL data (allBars estimate)
            await page.keyboard.press('KeyA');
            await this.sleep(700);

            // Move mouse to X-axis strip
            await page.mouse.move(cx, xAxisY);
            await this.sleep(100);

            // Scroll UP (negative deltaY) to zoom IN:
            //   each tick ≈ ×(1/1.055) of current visible bars
            //   ticks = ln(allBars / targetBars) / ln(1.055)
            const ticks = Math.ceil(Math.log(allBars / targetBars) / Math.log(1.055));
            Logger.info(`[TV] IPDA zoom scroll-in: ${tf} → ${targetBars} bars, ${ticks} ticks (allBars=${allBars})`);

            for (let i = 0; i < ticks; i++) {
                await page.mouse.wheel({ deltaX: 0, deltaY: -100 }); // negative = zoom IN (fewer bars)
                if (i % 10 === 9) await this.sleep(60);
            }

            await this.sleep(1_000);
            Logger.info(`[TV] ✅ IPDA zoom done (scroll): ${tf}`);
        } catch (e: any) {
            Logger.warn(`[TV] Could not set IPDA zoom for ${tf}: ${e.message}`);
        }
    }

    // ── Chart readiness ───────────────────────────────────────────────────────
    private async waitForChart(page: Page): Promise<void> {
        // Wait for canvas elements (TV chart always renders via canvas)
        try {
            await page.waitForFunction(
                () => document.querySelectorAll('canvas').length >= 2,
                { timeout: 10_000 },
            );
        } catch {
            // Fallback fixed sleep
            await this.sleep(2_500);
        }
    }

    private async getChartClip(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
        try {
            return await page.evaluate((sels: string[]) => {
                for (const sel of sels) {
                    const el = document.querySelector(sel);
                    if (!el) continue;
                    const r = el.getBoundingClientRect();
                    if (r.width > 200 && r.height > 200) {
                        return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: r.width, height: r.height };
                    }
                }
                // Trim top toolbar (~55px) + bottom status bar (~32px)
                return { x: 0, y: 55, width: window.innerWidth, height: window.innerHeight - 87 };
            }, CHART_SELECTORS);
        } catch {
            const vp = page.viewport() ?? { width: 1920, height: 1080 };
            return { x: 0, y: 55, width: vp.width, height: vp.height - 87 };
        }
    }

    private async dismissPopups(page: Page): Promise<void> {
        // Close symbol-search dialog if open (opened when URL contains ?symbol=)
        try {
            const searchOpen = await page.$('[data-name="symbol-search-items-dialog"], .search-ZXzPWcCf, input[data-role="search"]');
            if (searchOpen) {
                await page.keyboard.press('Escape');
                await this.sleep(500);
            }
        } catch { /* ignore */ }

        // Click-based close buttons
        for (const sel of POPUP_SELECTORS) {
            try {
                const el = await page.$(sel);
                if (el) { await el.click(); await this.sleep(300); }
            } catch { /* ignore */ }
        }
    }

    private async saveCookies(page: Page): Promise<void> {
        try {
            const cookies = await page.cookies();
            fs.writeFileSync(this.cookieFile, JSON.stringify(cookies, null, 2), 'utf8');
        } catch { /* non-fatal */ }
    }

    private async loadCookies(page: Page): Promise<void> {
        if (!fs.existsSync(this.cookieFile)) return;
        try {
            const cookies = JSON.parse(fs.readFileSync(this.cookieFile, 'utf8')) as any[];
            if (cookies.length > 0) await page.setCookie(...cookies);
            Logger.info(`[TV] Loaded ${cookies.length} saved cookies`);
        } catch { /* non-fatal */ }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(r => setTimeout(r, ms));
    }

    private promptEnter(): Promise<void> {
        return new Promise(resolve => {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl.question('', () => { rl.close(); resolve(); });
        });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // DEPRECATED — kept for backward-compatibility with old CLI callers
    // ═════════════════════════════════════════════════════════════════════════

    /** @deprecated Use captureMultiTF() instead */
    async capture(options: CaptureOptions = {}): Promise<string> {
        const { symbol, timeframe, outputDir } = options;
        const tf  = timeframe ?? '1h';
        const sym = symbol ?? 'CHART';
        const dir = outputDir ?? this.outputDir;
        const results = await new TradingViewCapturer(dir).captureMultiTF(sym, [tf]);
        return results[0]?.imagePath ?? '';
    }

    /** @deprecated Use captureMultiTF() inside a loop instead */
    async captureLoop(options: CaptureLoopOptions = {}): Promise<string[]> {
        const { symbol = 'CHART', timeframe = '1h', outputDir, totalCaptures = 12, intervalMinutes = 5 } = options;
        const dir     = outputDir ?? this.outputDir;
        const paths: string[] = [];
        for (let i = 0; i < totalCaptures; i++) {
            const res = await new TradingViewCapturer(dir).captureMultiTF(symbol, [timeframe]);
            if (res[0]) paths.push(res[0].imagePath);
            if (i < totalCaptures - 1) await this.sleep(intervalMinutes * 60_000);
        }
        return paths;
    }
}
