# ICT Scholar Agent

> Hệ thống phân tích thị trường theo phương pháp ICT (Inner Circle Trader).  
> Grounded in 125+ ICT PDF documents. Not financial advice.

---

## Yêu cầu

```env
# .env
GEMINI_API_KEY=...
CHROME_PATH=...           # Path đến Chrome/Chromium cho TradingView capturer
TELEGRAM_BOT_TOKEN=...    # Optional — Telegram bot
```

---

## Các lệnh CLI

### Build knowledge base
```bash
npm run stateful:build
```
Parse toàn bộ PDF trong `data/pdfs/`, tạo embeddings và lưu vào `data/stateful/knowledge-index.json`.  
Hỗ trợ **resume**: nếu bị ngắt giữa chừng, chạy lại sẽ tiếp tục từ checkpoint `knowledge-index-tmp.json`.

---

### Hỏi knowledge base
```bash
npm run stateful:ask -- "<câu hỏi>"
```
Query trực tiếp vào knowledge index, trả lời dựa trên PDF ICT.

---

### Chụp ảnh TradingView + phân tích ICT
```bash
npm run stateful:capture -- --symbol EURUSD [--stack intraday] [--tfs 4h,1h,15m] [--mode topdown]
```
- Mở trình duyệt, chụp screenshot từng timeframe trên TradingView
- Gửi ảnh vào Gemini Vision kèm context từ knowledge index
- Xuất `report.txt` + `report.pdf` vào `data/reports/YYYY-MM-DD/<session>_HH-MM/`
- Sau khi PDF tạo xong, tự xóa file PNG

**Chụp ảnh thôi, không phân tích:**
```bash
npm run stateful:screenshot -- --symbol EURUSD [--stack macro|full|deep|swing|intraday|scalp|precision|micro] [--tfs 4h,1h,15m]
```

**Stacks có sẵn (HTF → LTF):**
| Stack | Timeframes |
|---|---|
| `macro` | 1mo → 1w → 1d → 4h |
| `full` | 1mo → 1w → 1d → 4h → 1h → 15m |
| `deep` | 1mo → 1w → 1d → 6h → 3h → 1h → 45m → 15m → 5m |
| `swing` | 1wk → 1d → 4h → 1h |
| `intraday` (default) | 1d → 4h → 1h → 15m |
| `scalp` | 4h → 1h → 15m → 5m |
| `precision` | 4h → 1h → 45m → 15m → 5m → 3m |
| `micro` | 1h → 15m → 5m → 1m |

---

### Phân tích từ raw data (Yahoo Finance)
```bash
npm run stateful:chart -- --symbol EURUSD [--stack intraday] [--mode topdown]
```
- Fetch OHLCV data qua Yahoo Finance
- Tự vẽ chart PNG bằng lightweight-charts
- Phân tích qua Gemini Vision + knowledge index
- Xuất `report.txt` + `report.pdf`

---

### Quản lý trade outcomes
```bash
# Xem danh sách cases
npm run stateful:outcome -- --list [--symbol EURUSD]

# Xem thống kê win rate
npm run stateful:outcome -- --stats [--symbol EURUSD]

# Cập nhật kết quả
npm run stateful:outcome -- --id <id> --result WIN|LOSS|BREAKEVEN [--pips 70] [--notes "..."]
```

---

## Cấu trúc thư mục

```
data/
├── pdfs/                          ← PDF ICT (125+ files, không track trong git)
├── stateful/
│   ├── knowledge-index.json       ← Vector index (toàn bộ PDF)
│   ├── knowledge-index-tmp.json   ← Checkpoint khi build
│   ├── trade-cases.json           ← Lịch sử trade cases
│   ├── chart-analysis/            ← JSON kết quả từng lần phân tích
│   └── sessions/                  ← Chat session memory
└── reports/
    └── YYYY-MM-DD/
        └── <session>_HH-MM/       ← asia|london|nyam|nypm
            ├── report.txt
            └── report.pdf

src/
├── stateful.ts                    ← CLI entry point
├── index.ts                       ← Download pipeline entry
├── agents/                        ← (Planned) Multi-agent system
├── bot/
│   └── telegram.ts                ← Telegram bot interface
├── core/
│   ├── curriculum-index.ts        ← PDF curriculum ordering
│   └── gemini.ts
├── ingestion/
│   ├── market-data-fetcher.ts     ← Yahoo Finance / Binance OHLCV
│   ├── pdf-parser.ts              ← Parse PDF thành text
│   ├── raw-data-parser.ts         ← Parse raw OHLCV JSON
│   ├── tradingview-capturer.ts    ← Puppeteer → TradingView screenshots
│   ├── video-downloader.ts        ← Download YouTube videos
│   └── youtube-scraper.ts         ← Scrape YouTube playlists
├── processor/
│   ├── embedder.ts                ← Gemini text-embedding-004
│   ├── pdf-generator.ts           ← ICT Handbook PDF từ video + SRT
│   ├── text-splitter.ts           ← Chunk PDF text
│   └── vision-analyzer.ts         ← Gemini Vision → ICTChartAnalysis
├── services/
│   ├── chart-analysis-service.ts  ← Điều phối toàn bộ analysis pipeline
│   ├── outcome-service.ts         ← Trade case CRUD + stats
│   ├── scholar-agent.ts           ← RAG: embed + retrieve + answer
│   └── storage-service.ts         ← JSON file I/O
└── utils/
    ├── chart-annotator.ts         ← Vẽ annotations lên chart PNG
    ├── chart-generator.ts         ← Vẽ OHLCV chart bằng canvas
    ├── logger.ts
    └── pdf-reporter.ts            ← Xuất report.pdf từ ChartDecisionResult
```

---

## Luồng dữ liệu

### Luồng 1 — `stateful:capture` (TradingView screenshots)

```
npm run stateful:capture
        │
        ▼
TradingViewCapturer.captureMultiTF()
  └── Puppeteer mở TradingView, chụp từng TF → PNG files
        │
        ▼
ScholarAgent.retrieveDiverseChunks()
  └── Embed query → cosine similarity → top chunks từ knowledge-index.json
  └── 10 TAXONOMY queries cố định + dynamic queries
        │
        ▼
VisionAnalyzer.analyzeMultiTFScreenshots()
  └── Gửi tất cả PNG + PDF context → Gemini Vision
  └── → ICTChartAnalysis (htfBias, setup, drawingInstructions, narratorScript)
        │
        ▼
ChartAnnotator.annotate()
  └── Vẽ OB/FVG/SL/TP lên chart PNG
        │
        ▼
OutcomeService.recordCase()     StorageService.saveJson()
  └── Lưu trade case PENDING    └── Lưu chart-analysis/*.json
        │
        ▼
generatePdfReport()
  └── PDFKit: cover + multi-TF grid + narrator pages + drawing guide
  └── → data/reports/YYYY-MM-DD/<session>/report.pdf
        │
        ▼
Xóa PNG files (đã embed vào PDF)
```

### Luồng 2 — `stateful:chart` (Raw data)

```
npm run stateful:chart
        │
        ▼
MarketDataFetcher.fetchMultiTF()
  └── Yahoo Finance API → OHLCV data từng TF
        │
        ▼
generateChart()
  └── Canvas/lightweight-charts → PNG
        │
        ▼
[giống Luồng 1 từ VisionAnalyzer trở đi]
```

---

## RAG hiện tại — Vấn đề đã biết

Mỗi lần phân tích, hệ thống chỉ đưa vào Gemini **~60-80 chunks** (~1-4% tổng index):

| Phần | Queries | topK | Chunks tối đa |
|---|---|---|---|
| Dynamic queries | ~6 | 5 | ~30 |
| TAXONOMY (10 category cố định) | 10 | 5 | ~50 |
| **Sau dedup** | | | **~60-80** |

**Vấn đề:** Dynamic query đầu vào chỉ là tên TF (`"4h chart screenshot"`) — không có price action thật → queries không thực sự dynamic.

→ Kế hoạch cải thiện: xem [ARCHITECTURE-PLAN.md](./ARCHITECTURE-PLAN.md)

---

## PDF Report layout

Mỗi report.pdf gồm:
1. **Cover page** — header + annotated chart + decision table (HTF Bias, Entry, SL, TP, R:R)
2. **Multi-TF Overview** — grid 2 cột tất cả TF charts
3. **Narrator pages** — mỗi `### N.` section một trang, có chart TF tương ứng + body text
4. **Drawing Instructions** — danh sách OB/FVG/level cần vẽ
5. **Risk Warnings** (nếu có)

---

## Tech stack

| Thành phần | Library |
|---|---|
| Runtime | Node.js + TypeScript (ESM) |
| AI | `@google/generative-ai` (Gemini 2.5 Flash) |
| Embedding | Gemini `text-embedding-004` (dim 3072) |
| Vector search | Cosine similarity thuần (in-memory JSON) |
| Browser automation | `puppeteer-core` |
| PDF generation | `pdfkit` |
| Chart rendering | `canvas` |
| Market data | `yahoo-finance2` |
| Telegram | `telegraf` |

