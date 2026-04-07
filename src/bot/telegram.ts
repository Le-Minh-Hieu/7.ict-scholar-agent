/**
 * ICT Scholar Telegram Bot
 *
 * Usage:
 *   Set TELEGRAM_BOT_TOKEN in .env
 *   npm run bot:start
 *
 * Send a chart screenshot with caption:
 *   EURUSD                      → EURUSD, intraday stack, top-down
 *   EURUSD intraday             → explicit stack
 *   XAUUSD scalp bottomup       → stack + mode
 *   GBPJPY swing                → swing stack
 *
 * Or send a text message to ask the ICT knowledge base a question.
 */
import { Telegraf, Context } from 'telegraf';
import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { ChartAnalysisService } from '../services/chart-analysis-service.js';
import { ScholarAgent } from '../services/scholar-agent.js';
import { Logger } from '../utils/logger.js';

dotenv.config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
    console.warn('\u26a0️  TELEGRAM_BOT_TOKEN not set in .env — bot will not start.');
    console.warn('   Set TELEGRAM_BOT_TOKEN=<your_token> in .env, then run: npm run bot:start');
    process.exit(0);  // exit 0 = not an error, just skipped
}

const bot     = new Telegraf(TOKEN);
const service = new ChartAnalysisService();
const scholar = new ScholarAgent();

// ── helpers ──────────────────────────────────────────────────────────────────

function parseCaption(caption: string): {
    symbol: string;
    stack: 'swing' | 'intraday' | 'scalp' | 'micro';
    mode: 'topdown' | 'bottomup';
} {
    const parts = caption.trim().toUpperCase().split(/\s+/);
    const symbol = parts[0] ?? 'EURUSD';

    const stackMap: Record<string, 'swing' | 'intraday' | 'scalp' | 'micro'> = {
        SWING: 'swing', INTRADAY: 'intraday', SCALP: 'scalp', MICRO: 'micro',
    };
    const modeMap: Record<string, 'topdown' | 'bottomup'> = {
        TOPDOWN: 'topdown', 'TOP-DOWN': 'topdown', BOTTOMUP: 'bottomup', 'BOTTOM-UP': 'bottomup',
    };

    let stack: 'swing' | 'intraday' | 'scalp' | 'micro' = 'intraday';
    let mode: 'topdown' | 'bottomup' = 'topdown';

    for (const part of parts.slice(1)) {
        if (stackMap[part]) stack = stackMap[part];
        if (modeMap[part])  mode  = modeMap[part];
    }
    return { symbol, stack, mode };
}

async function downloadFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, res => {
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
    });
}

function chunkText(text: string, max = 4000): string[] {
    const chunks: string[] = [];
    while (text.length > 0) {
        chunks.push(text.slice(0, max));
        text = text.slice(max);
    }
    return chunks;
}

function summarizeDecision(decision: string): string {
    // Extract the structured block only (trim narrator to first 800 chars for Telegram)
    const narratorEnd = decision.indexOf('━━');
    const structured  = narratorEnd > 0 ? decision.slice(narratorEnd) : decision;

    const narratorStart = decision.indexOf('╔══');
    const narratorText  = narratorEnd > 0 && narratorStart > 0
        ? decision.slice(narratorStart, narratorEnd).slice(0, 1200) + '\n...(see full analysis in file)'
        : '';

    return [narratorText, structured].filter(Boolean).join('\n');
}

// ── commands ─────────────────────────────────────────────────────────────────

bot.start((ctx) => ctx.reply(
    '🤖 *ICT Scholar Agent*\n\n' +
    'Gửi ảnh chart (screenshot từ TradingView hoặc bất kỳ chart nào) với caption:\n\n' +
    '`EURUSD` — mặc định intraday top-down\n' +
    '`XAUUSD scalp` — scalp stack\n' +
    '`GBPJPY swing bottomup` — swing + bottom-up\n\n' +
    'Hoặc gửi câu hỏi về ICT (text) để tra cứu PDF knowledge base.\n\n' +
    '_Symbols: EURUSD · GBPJPY · XAUUSD · BTC · ETH · AAPL ..._',
    { parse_mode: 'Markdown' }
));

bot.help((ctx) => ctx.reply(
    '📖 *Hướng dẫn*\n\n' +
    '*Chart analysis:*\n' +
    'Gửi ảnh + caption: `SYMBOL [stack] [mode]`\n' +
    '• Stacks: `swing` `intraday` `scalp` `micro`\n' +
    '• Modes: `topdown` `bottomup`\n\n' +
    '*Hỏi ICT knowledge base:*\n' +
    'Gửi text bất kỳ — ví dụ: "FVG là gì?" hay "Giải thích Order Block"\n\n' +
    '*Ví dụ captions:*\n' +
    '`EURUSD intraday`\n' +
    '`XAUUSD scalp bottomup`\n' +
    '`BTC swing`',
    { parse_mode: 'Markdown' }
));

// ── photo handler ─────────────────────────────────────────────────────────────

bot.on('photo', async (ctx) => {
    const caption = ctx.message.caption ?? '';
    if (!caption.trim()) {
        return ctx.reply(
            '⚠️ Thiếu caption. Thêm symbol vào caption, ví dụ:\n`EURUSD` hoặc `XAUUSD scalp bottomup`',
            { parse_mode: 'Markdown' }
        );
    }

    const { symbol, stack, mode } = parseCaption(caption);
    const thinking = await ctx.reply(`🔍 Đang phân tích *${symbol}* (${mode} · ${stack})...`, { parse_mode: 'Markdown' });

    let tempImagePath = '';
    try {
        // Download the best-quality photo
        const photos  = ctx.message.photo;
        const fileId  = photos[photos.length - 1].file_id;
        const file    = await ctx.telegram.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;

        tempImagePath = path.join(os.tmpdir(), `ict_tg_${Date.now()}.jpg`);
        await downloadFile(fileUrl, tempImagePath);

        // Run full analysis
        const result = await service.analyzeMultiTFAndDecide({
            imagePath: tempImagePath,
            symbol,
            stack,
            mode,
            bars: 100,
            sessionId: `tg_${ctx.from?.id ?? 'unknown'}`,
        });

        // Send drawing guide (short)
        if (result.drawingGuide && result.drawingGuide.length > 40) {
            await ctx.reply(result.drawingGuide.slice(0, 4000));
        }

        // Send annotated chart if available
        if (result.annotatedImagePath && fs.existsSync(result.annotatedImagePath)) {
            await ctx.replyWithPhoto(
                { source: fs.createReadStream(result.annotatedImagePath) },
                { caption: `📊 Annotated: ${symbol} · ${stack} · ${mode}` }
            );
        }

        // Send decision in chunks (narrator + structured)
        const summary = summarizeDecision(result.decision);
        for (const chunk of chunkText(summary, 4000)) {
            await ctx.reply(chunk);
        }

        // Delete "thinking" message
        await ctx.telegram.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {});

    } catch (err: any) {
        Logger.error('Telegram bot error (photo):', err);
        await ctx.reply(`❌ Lỗi phân tích: ${err.message}`);
    } finally {
        if (tempImagePath && fs.existsSync(tempImagePath)) {
            fs.unlinkSync(tempImagePath);
        }
    }
});

// ── text handler (knowledge base Q&A) ────────────────────────────────────────

bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // ignore unknown commands

    const thinking = await ctx.reply('📚 Đang tra cứu ICT knowledge base...');
    try {
        const sessionId = `tg_${ctx.from?.id ?? 'unknown'}`;
        const result    = await scholar.ask(text, sessionId, 6);

        const header  = `📖 *ICT Scholar — từ ${result.sources.length} PDF nguồn*\n\n`;
        const sources = result.sources.map(s => `• ${s}`).join('\n');
        const full    = `${header}${result.answer}\n\n*Nguồn:*\n${sources}`;

        for (const chunk of chunkText(full, 4000)) {
            await ctx.reply(chunk, { parse_mode: 'Markdown' });
        }

        await ctx.telegram.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {});
    } catch (err: any) {
        Logger.error('Telegram bot error (text):', err);
        await ctx.reply(`❌ Lỗi: ${err.message}`);
    }
});

// ── launch ────────────────────────────────────────────────────────────────────

bot.launch().then(() => {
    Logger.info('🤖 ICT Scholar Telegram Bot đã khởi động...');
    Logger.info('Đang lắng nghe tin nhắn từ Telegram...');
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
