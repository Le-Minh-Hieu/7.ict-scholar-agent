# ICT Scholar Agent — Multi-Agent Architecture

> Grounded in 346+ ICT PDF documents. Not financial advice.

---

## Tổng quan hệ thống

ICT Scholar Agent là một hệ thống phân tích thị trường tài chính theo phương pháp **Inner Circle Trader (ICT)**. Hệ thống gồm:

1. **Ingestion pipeline** — tải PDF, video, chụp ảnh TradingView
2. **Knowledge index** — embed 346+ PDF thành vector index, phân chia theo domain (19 agents)
3. **Multi-agent RAG** — 19 sub-agents, mỗi agent chuyên một domain ICT, query từ index riêng
4. **Analysis pipeline** — TradingView screenshot → Gemini Vision → top-down ICT analysis
5. **Report pipeline** — PDF report có chart + narrator + drawing guide
6. **Outcome tracking** — ghi nhận kết quả mỗi trade case, tính win rate

---

## Kiến trúc Multi-Agent

```
┌─────────────────────────────────────────────────────────────────────┐
│                   TopDownOrchestratorAgent                          │
│   Điều phối toàn bộ luồng phân tích từ HTF → LTF                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 0 — Foundations (always-on context injected vào mọi agent)  │
│  FoundationsAgent                                                   │
│  (premium/discount, fair value, impulse swings, MM logic,          │
│   elements of trade setup, liquidity run basics)                    │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 1 — Macro & HTF Bias                                         │
│  MacroAgent | HtfBiasAgent | SeasonalMacroAgent                     │
│  (COT, bonds, DXY) | (IPDA, quarterly, swing pts) | (seasonal,     │
│   interest rate differentials)                                      │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 2 — Market Structure & PD Arrays                             │
│  MarketStructureAgent | PdArrayAgent                                │
│  (CHoCH/BOS/MSS, MM traps, IFC) | (OB, FVG, Breaker, Mitigation,  │
│   Propulsion, Rejection, Vacuum, Reclaimed OB, Liquidity)          │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 3 — Algorithmic & Gap Theory                                 │
│  AlgoGapAgent | SmtForexAgent                                       │
│  (NWOG, NDOG, Algo Price Delivery, Reaper, Ma Deuce) |             │
│  (SMT divergence, Judas Swing, ATM, Scout Sniper, MM Series)       │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 4 — Time, Session & AMD                                      │
│  SessionKillzoneAgent | AmdPowerOf3Agent                            │
│  (Asia/London/NY/LC, Silver Bullet, CBDR, daily range, bias) |     │
│  (AMD phases, Power of 3, Time & Price Theory, Asian Range)        │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 5 — Entry Models                                             │
│  OteEntryAgent | ChartModelsAgent | SwingTradingAgent               │
│  (OTE Vol 1-20, pattern recog.) | (Charter Models 1-5, Inst. PA) | │
│  (swing setups, million $ setup)                                    │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 6 — Intraday & Short-Term Execution                          │
│  ShortTermIpdaAgent | DayTradeSetupAgent                            │
│  (LRLR, One Shot One Kill, weekly range) | (B&B, 20 pips, scalping)│
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 7 — Risk, Plan & Psychology                                  │
│  RiskExecutionAgent | TradingPlanAgent                              │
│  (position sizing, SL/TP, tâm lý, mitigating losses) |             │
│  (Trading Plan Dev 1-7, W.E.N.T. 1-5, If I Could Go Back 1-4)     │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 8 — Live Context (validate setup vs real executions)        │
│  LiveReviewAgent                                                    │
│  (2022 Episodes 2-41, 2023 live tape readings ES/NQ,               │
│   market reviews, FOMC, NFP, CPI, funded challenge)                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Cấu trúc thư mục (Project mới)

```
ict-scholar-agents/                        ← root project mới
├── .env
├── package.json
├── tsconfig.json
│
├── data/
│   ├── pdfs/                              ← 346–500+ source PDFs (copy từ master)
│   │   ├── ICT Mentorship Core Content - Month 01 ...pdf
│   │   └── ...
│   │
│   ├── stateful/
│   │   ├── agent-indexes/                 ← 19 file vector index (per-agent)
│   │   │   ├── foundations.json
│   │   │   ├── pd_arrays.json
│   │   │   ├── market_structure.json
│   │   │   └── ...  (19 files)
│   │   │
│   │   ├── process-index.json             ← Tier 1 process entries (~800-1200 entries)
│   │   ├── agent-pdf-map.json             ← output của agents:classify (PDF → agentId)
│   │   ├── trade-cases.json               ← episodic memory (reuse từ project cũ)
│   │   ├── sessions/                      ← chat session memory
│   │   └── tmp/                           ← checkpoint files khi đang build
│   │
│   ├── reports/
│   │   └── YYYY-MM-DD/
│   │       └── <session>_HH-MM/
│   │           ├── report.txt
│   │           └── report.pdf
│   │
│   └── screenshots/                       ← TradingView PNG (xóa sau khi embed PDF)
│
└── src/
    ├── agents/
    │   ├── agent-registry.ts              ← AGENT_RULES[], classify(), assign()
    │   ├── base-agent.ts                  ← abstract ICTSubAgent class
    │   ├── top-down-orchestrator.ts       ← orchestrator 8 layers
    │   │
    │   ├── layer0/
    │   │   └── foundations-agent.ts
    │   ├── layer1/
    │   │   ├── macro-agent.ts
    │   │   ├── htf-bias-agent.ts
    │   │   └── seasonal-macro-agent.ts
    │   ├── layer2/
    │   │   ├── market-structure-agent.ts
    │   │   └── pd-array-agent.ts
    │   ├── layer3/
    │   │   ├── algo-gap-agent.ts
    │   │   └── smt-forex-agent.ts
    │   ├── layer4/
    │   │   ├── session-killzone-agent.ts
    │   │   └── amd-power-of-3-agent.ts
    │   ├── layer5/
    │   │   ├── ote-entry-agent.ts
    │   │   ├── chart-models-agent.ts
    │   │   └── swing-trading-agent.ts
    │   ├── layer6/
    │   │   ├── short-term-ipda-agent.ts
    │   │   └── daytrade-setup-agent.ts
    │   ├── layer7/
    │   │   ├── risk-execution-agent.ts
    │   │   └── trading-plan-agent.ts
    │   └── layer8/
    │       └── live-review-agent.ts
    │
    ├── core/
    │   ├── curriculum-index.ts            ← reuse từ project cũ
    │   ├── process-index.ts               ← ProcessEntry type + queryProcessIndex()
    │   └── gemini.ts                      ← getGeminiModel(), getGroqClient()
    │
    ├── ingestion/
    │   ├── pdf-parser.ts                  ← reuse
    │   ├── process-extractor.ts           ← Tier 1 build: PDF chunks → ProcessEntry[]
    │   ├── tradingview-capturer.ts        ← reuse
    │   ├── market-data-fetcher.ts         ← reuse (yahoo-finance2)
    │   └── video-downloader.ts            ← reuse
    │
    ├── processor/
    │   ├── embedder.ts                    ← reuse (retry/backoff giữ nguyên)
    │   ├── text-splitter.ts               ← cải tiến: paragraph-aware
    │   └── vision-analyzer.ts             ← cải tiến: Gemini 2.0 Flash + VisionObservations
    │
    ├── services/
    │   ├── scholar-agent.ts               ← refactor: per-agent index + process-index tier
    │   ├── chart-analysis-service.ts      ← refactor: dùng orchestrator
    │   ├── outcome-service.ts             ← reuse
    │   └── storage-service.ts             ← reuse
    │
    ├── utils/
    │   ├── pdf-reporter.ts                ← reuse (generatePdfReport)
    │   ├── logger.ts                      ← reuse
    │   ├── chart-generator.ts             ← reuse (canvas)
    │   └── chart-annotator.ts             ← reuse
    │
    └── stateful.ts                        ← CLI entry (cải tiến)
```

---

## Luồng Input → Output

### Luồng 1 — `capture` (TradingView screenshot → PDF report)

```
[CLI: npm run capture -- --symbol EURUSD --stack intraday]
        │
        ▼
[1] TradingViewCapturer.captureMultiTF()
    Input:  symbol, timeframes[]
    Output: CapturedChart[] (PNG files, 1 per TF)
        │
        ▼
[2] VisionAnalyzer (Gemini 2.0 Flash + vision)
    Input:  PNG files (all TFs in one call)
    Output: VisionObservations JSON
            { visibleConcepts[], activeSession, htfBias,
              marketPhase, priceLocation, keyLevels[] }
        │
        ├──────────────────────────────────────────────────┐
        ▼                                                  ▼
[3a] TopDownOrchestratorAgent                     [3b] OutcomeService
     Input:  VisionObservations + captures[]            .buildHistoryContext()
     Process: 8 layers agents tuần tự/song song    Input:  symbol + conditions
     Each agent:                                   Output: episodic memory block
       - Tier 1: queryProcessIndex() → top 15 entries
       - Tier 2: retrieveDiverseChunks() nếu cần detail
       - Groq llama-3.3-70b: synthesize agent output
     Output: AgentOutput[] (per agent)
        │
        ▼
[4] TopDownAnalysisAgent.synthesize()
    Input:  AgentOutput[] + VisionObservations + episodic memory
    Model:  Gemini 2.0 Flash
    Output: ChartDecisionResult
            { analysis, drawingGuide, decision, narratorScript }
        │
        ▼
[5] VisionAnalyzer.generateNarrator()
    Input:  ChartDecisionResult JSON (text-only, no image)
    Model:  Groq llama-3.3-70b (free tier)
    Output: narratorScript (markdown với citations)
        │
        ▼
[6] generatePdfReport()
    Input:  ChartDecisionResult (PNG paths + analysis + narrator)
    Output: report.pdf
            ├── Cover page
            ├── Multi-TF grid (all PNGs)
            ├── Narrator pages (per ### N. section + TF chart)
            ├── Drawing Instructions
            └── Risk Warnings
        │
        ▼
[7] PNG cleanup + OutcomeService.recordCase()
    Output: data/reports/YYYY-MM-DD/<session>_HH-MM/report.pdf
            trade-cases.json (PENDING entry)
```

---

### Luồng 2 — `agents:build` (PDF → Vector indexes)

```
[CLI: npm run agents:build]
        │
        ▼
[1] agent-registry.ts → classify()
    Input:  data/pdfs/*.pdf (346-500+ files)
    Output: agent-pdf-map.json
            { foundations: [...], pd_arrays: [...], ... }  ← 19 keys
        │
        ▼
[2] process-extractor.ts → buildProcessIndex()      ← Tier 1 build
    Input:  knowledge-index.json (raw chunks nhóm theo source)
    Process per PDF:
      - Group raw chunks của 1 PDF
      - Gemini 2.5 Flash: extract 3-8 ProcessEntry { title, summary, rules[], steps[] }
      - Embedder.embedText(title + summary + rules.join())
    Output: process-index.json (~800-1200 ProcessEntry)
    Cost:   ~$2-3 one-time | Time: ~20-30 phút
        │
        ▼
[3] base-agent.ts → buildIndex(agentId)             ← Tier 2 build (per agent)
    Input:  agent-pdf-map.json → PDFs cho agentId
    Process:
      - PdfParser.parse() → TextSplitter.split() (paragraph-aware)
      - Embedder.embedTextWithRetry() với checkpoint mỗi 50 chunks
    Output: agent-indexes/<agentId>.json
    Resume: tự động resume nếu bị ngắt
        │
        ▼
[4] agents:stats
    Output: bảng chunks/agent, coverage statistics
```

---

### Luồng 3 — `outcome` (ghi nhận + tra cứu kết quả trade)

```
[Sau khi trade kết thúc]
        │
        ▼
[CLI: npm run outcome -- --id <id> --result WIN --pips 45]
        │
        ▼
[OutcomeService.updateOutcome()]
    Input:  case ID, outcome, pips, notes
    Output: trade-cases.json (cập nhật entry)
            console: win rate stats

[CLI: npm run outcome -- --stats --symbol EURUSD]
        │
        ▼
[OutcomeService.getStats()]
    Output: total / win rate / avg pips / pass-through pips
```

---

## Tối ưu chi phí API

### Phân tích chi phí mỗi run (~8 stacks — ước tính)

| Call | % chi phí | Model hiện tại | Model mới |
|---|---|---|---|
| Main analysis (MTF + PDF context) | ~75% | gemini-2.5-flash | **gemini-2.0-flash** (~70% rẻ hơn) |
| Vision (chart images) | ~12% | gemini-2.5-flash | **gemini-2.0-flash** |
| Narrator / drawings | ~2% | gemini-2.5-flash | **Groq llama-3.3-70b** (free) |
| extractDynamicQueries | ~3% | gemini-2.5-flash | **Groq llama-3.3-70b** (free) |
| PDF report generator (planHandbook) | ~8% | gemini-2.5-flash | **Groq llama-3.3-70b** (free) |
| Embedding | flat | gemini-embedding-001 | giữ nguyên |

**Kết quả dự kiến:** ~$1.00 → ~$0.40–0.45/run (~55% tiết kiệm)

### Hybrid routing logic

```typescript
// src/core/gemini.ts

// Gemini 2.0 Flash — multimodal (vision + main analysis)
export function getGeminiFlash() {
    return new GoogleGenerativeAI(process.env.GEMINI_API_KEY!).getGenerativeModel({
        model: 'gemini-2.0-flash',
    });
}

// Groq free tier — text-only calls (narrator, dynamic queries, pdf handbook)
// 6000 req/day free, llama-3.3-70b chất lượng tương đương flash cho text
export function getGroqClient() {
    return new Groq({ apiKey: process.env.GROQ_API_KEY! });
}

// Usage routing:
// VisionAnalyzer.analyzeMultiTFScreenshots()   → getGeminiFlash()  (cần vision)
// VisionAnalyzer.generateNarrator()            → getGroqClient()   (text-only)
// ChartAnalysisService.extractDynamicQueries() → getGroqClient()   (text-only)
// ICTPdfGenerator.planHandbookStructure()      → getGroqClient()   (text-only)
// TopDownAnalysisAgent.synthesize()            → getGeminiFlash()  (cần context lớn)
```

### Install

```bash
npm install groq-sdk

# .env
GROQ_API_KEY=gsk_xxxx
```

---

## Two-Tier RAG — Process Index

### Vấn đề với raw chunks (hiện tại)

| Vấn đề | Chi tiết |
|---|---|
| Fragment ~300 chars | Chunk có thể bắt đầu giữa câu, thiếu context |
| Không capture "quy trình" | ICT dạy theo steps/rules, raw text miss structure |
| Cosine trên raw text | Miss nhiều concept liên quan semantically |
| Context noise | 60-80 chunks/call nhưng nhiều chunk không hoàn chỉnh |

### Kiến trúc Tier 1 + Tier 2

```
Tier 1 (Process Index)                  Tier 2 (Raw chunks — hydration on demand)
──────────────────────────────          ─────────────────────────────────────────
process-index.json                      agent-indexes/<agentId>.json
~800-1200 entries                       ~4000-6000 raw chunks total
                                        chỉ dùng khi cần thêm detail
Each ProcessEntry:                      được trỏ tới từ ProcessEntry.refs[]
  id:       "m01-p03"
  title:    "OTE Setup Rules"
  summary:  2-3 sentences
  rules:    string[]
  steps:    string[]
  refs:     [{source, chunkIndex}]
  embedding: float[]                    ← embed: title + summary + rules.join(", ")
  category: "ENTRY_MODELS"
  series:   "Month 01"
  curriculumOrder: number
```

### Runtime flow

```
Query arrives
    │
    ▼
[Tier 1] queryProcessIndex(queryEmbedding, topK=15)
    → top 15 ProcessEntry (clean: title + rules + steps)
    │
    ▼ (nếu cần thêm detail cho 3 entries quan trọng nhất)
[Tier 2] hydrateEntry(entry) → load raw chunks từ entry.refs[]
    → inject thêm vào context

Context gửi Gemini = Tier1 blocks + Tier2 hydrated (nếu có)
```

### Thứ tự implement

```
Bước 1: src/core/process-index.ts        ← ProcessEntry type, ProcessIndex type,
                                             queryProcessIndex()
Bước 2: src/ingestion/process-extractor.ts ← load knowledge-index.json
                                              → group by source → Gemini extract
                                              → embed → save process-index.json
Bước 3: src/services/scholar-agent.ts    ← thêm:
                                             ensureProcessIndex()
                                             retrieveProcessEntries(query, topK, category?)
                                             hydrateEntry(entry)
Bước 4: src/services/chart-analysis-service.ts ← thay TAXONOMY loop bằng:
                                              Tier1 queryProcessIndex()
                                              + Tier2 dynamic hydration
Bước 5: npm run stateful:process-build   ← script chạy process-extractor.ts
Bước 6: test với 5-10 PDFs trước full run
```

```typescript
// src/core/process-index.ts

export type ProcessEntry = {
    id:              string;              // "m01-p03", "ep12-p01"
    title:           string;              // "Higher Timeframe Bias Assessment"
    summary:         string;              // 2-3 câu tóm tắt concept
    rules:           string[];            // danh sách rule rõ ràng
    steps:           string[];            // step-by-step nếu có ([] nếu không)
    category:        string;              // HTF_BIAS_MARKET_STRUCTURE | ENTRY_MODELS | ...
    series:          string;              // "Month 01" | "2022 Episode 12" | ...
    curriculumOrder: number;              // từ getCurriculumOrder()
    refs:            { source: string; chunkIndex: number }[];
    embedding:       number[];            // gemini-embedding-001, 3072-dim
};

export type ProcessIndex = {
    version:      string;
    builtAt:      string;
    totalEntries: number;
    entries:      ProcessEntry[];
};

export function queryProcessIndex(
    index:           ProcessIndex,
    queryEmbedding:  number[],
    topK:            number = 15,
    filterCategory?: string,
): ProcessEntry[] { ... }
```

**Chi phí build one-time:** ~$2-3 (input ~3M tokens, output ~300k tokens) | ~20-30 phút

---

## 19 Sub-Agents — PDF Mapping đầy đủ (346 files)

### Agent 1 — `foundations` (~9 files)
**Role:** Định nghĩa khái niệm nền tảng ICT. Context layer inject vào mọi agent khác.
```
ICT Mentorship Core Content - Month 1 - Elements Of A Trade Setup
ICT Mentorship Core Content - Month 1 - Equilibrium Vs. Discount
ICT Mentorship Core Content - Month 1 - Equilibrium Vs. Premium
ICT Mentorship Core Content - Month 1 - Fair Valuation
ICT Mentorship Core Content - Month 1 - How Market Makers Condition The Market
ICT Mentorship Core Content - Month 1 - Impulse Price Swings & Market Protraction
ICT Mentorship Core Content - Month 1 - Liquidity Runs
ICT Mentorship Core Content - Month 1 - What To Focus On Right Now
Essentials To ICT Market Structure
```

---

### Agent 2 — `risk_execution` (~13 files)
**Role:** Position sizing, SL/TP, quản lý tâm lý, xử lý thua lỗ.
```
ICT Mentorship Core Content - Month 02 - Framing Low Risk Trade Setups
ICT Mentorship Core Content - Month 02 - How Traders Make 10% Per Month
ICT Mentorship Core Content - Month 02 - Growing Small Accounts
ICT Mentorship Core Content - Month 02 - How To Mitigate Losing Trades Effectively
ICT Mentorship Core Content - Month 02 - No Fear Of Losing
ICT Mentorship Core Content - Month 02 - The Secrets To Selecting High Reward Setups
ICT Forex - Considerations In Risk Management
ICT Forex - Money Management That Works
ICT Mentorship Core Content - Month 05 - Money Management
ICT Mentorship Core Content - Month 05 - Position Trade Management
ICT Mentorship Core Content - Month 05 - Limit Order Entry Techniques For Long Term Traders
ICT Mentorship Core Content - Month 05 - Stop Entry Techniques For Long Term Traders
ICT Forex - What New Traders Should Focus On
```

---

### Agent 3 — `market_structure` (~16 files)
**Role:** Đọc CHoCH, BOS, MSS, Market Maker Traps, institutional order flow, timeframe selection.
```
ICT Mentorship Core Content - Month 03 - Institutional Market Structure
ICT Mentorship Core Content - Month 03 - Institutional Order Flow
ICT Mentorship Core Content - Month 03 - Institutional Sponsorship
ICT Mentorship Core Content - Month 03 - Macro Economic To Micro Technical
ICT Mentorship Core Content - Month 03 - Market Maker Trap Head Shoulders Pattern
ICT Mentorship Core Content - Month 03 - Market Maker Trap Trendline Phantoms
ICT Mentorship Core Content - Month 03 - The Next Setup - Anticipatory Skill Development
ICT Mentorship Core Content - Month 03 - Timeframe Selection & Defining Setups
ICT Mentorship Core Content - Month 02 - Market Maker Trap False Breakouts
ICT Mentorship Core Content - Month 02 - Market Maker Trap False Flag
ICT Mentorship Core Content - Month 04 - Divergence Phantoms
ICT Institutional Price Action - Micro-Market Structure & Time & Price Concepts
ICT Institutional Price Action - Micro-Market Structure & Time & Price Concepts Part 02
Institutional Market Structure & Standard Deviations With Buyside Liquidity
ICT Mentorship 2023 - Deep Dive Into Institutional Order Flow
ICT Mentorship 2023 - Immediate Rebalance & Institutional Order Flow
```

---

### Agent 4 — `pd_arrays` (~16 files)
**Role:** Nhận diện và xếp hạng PD Arrays: OB, FVG, Breaker, Propulsion, Mitigation, Vacuum, Reclaimed OB, Liquidity.
```
ICT Mentorship Core Content - Month 04 - Orderblocks
ICT Mentorship Core Content - Month 04 - ICT Breaker Block
ICT Mentorship Core Content - Month 04 - ICT Fair Value Gaps FVG
ICT Mentorship Core Content - Month 04 - ICT Propulsion Block
ICT Mentorship Core Content - Month 04 - ICT Rejection Block
ICT Mentorship Core Content - Month 04 - ICT Vacuum Block
ICT Mentorship Core Content - Month 04 - Mitigation Blocks
ICT Mentorship Core Content - Month 04 - Reclaimed ICT Orderblock
ICT Mentorship Core Content - Month 04 - Liquidity Pools
ICT Mentorship Core Content - Month 04 - Liquidity Voids
ICT Mentorship Core Content - Month 04 - Reinforcing Liquidity Concepts & Price Delivery
ICT Mentorship Core Content - Month 04 - Double Bottom Double Top
ICT Mentorship Core Content - Month 05 - Defining HTF PD Arrays
ICT Mentorship 2023 - Advanced Theory On ICT Breaker
ICT Mentorship 2023 - ICT Reaper PD Array Introduction & Market Review
AM Session - Opening Range Gap + Mitigation Block & FVG Entry
```

---

### Agent 5 — `htf_bias` (~16 files)
**Role:** Xác định HTF bias weekly/monthly/quarterly, IPDA data ranges, institutional swing points, open float.
```
ICT Mentorship Core Content - Month 05 - Defining HTF PD Arrays
ICT Mentorship Core Content - Month 05 - Defining Institutional Swing Points
ICT Mentorship Core Content - Month 05 - Defining Open Float Liquidity Pools
ICT Mentorship Core Content - Month 05 - Using IPDA Data Ranges
ICT Mentorship Core Content - Month 05 - Quarterly Shifts & IPDA Data Ranges
ICT Mentorship Core Content - Month 05 - Open Float
ICT Mentorship Core Content - Month 05 - Trade Conditions & Setup Progressions
ICT Mentorship Core Content - Month 05 - Qualifying Trade Conditions With 10 Year Yields
ICT Mentorship Core Content - Month 05 - Using 10 Year Notes In HTF Analysis
ICT Mentorship Core Content - Month 05 - Interest Rate Differentials
ICT Forex - Higher Time Frame Concepts
ICT Forex - Essentials To Trading The Daily Bias
ICT Forex - The Weekly Bias - Excellence In Short Term Trading
January 2023 NonFarm Payroll Review & HTF Concepts
ICT Mentorship Core Content - Month 07 - Short Term Trading Blending IPDA Data Ranges & PD Arrays
ICT Mentorship Core Content - Month 07 - Short Term Trading Using Monthly & Weekly Ranges
```

---

### Agent 6 — `seasonal_macro` (~12 files)
**Role:** Seasonal tendencies, intermarket analysis, COT, open interest, multi-asset filter.
```
ICT Mentorship Core Content - Month 05 - How To Use Bearish Seasonal Tendencies In HTF Analysis
ICT Mentorship Core Content - Month 05 - How To Use Bullish Seasonal Tendencies In HTF Analysis
ICT Mentorship Core Content - Month 05 - Ideal Seasonal Tendencies
ICT Mentorship Core Content - Month 05 - How To Use Intermarket Analysis
ICT Mentorship Core Content - Month 10 - Commitment Of Traders
ICT Mentorship Core Content - Month 10 - Open Interest Secrets & Smart Money Footprints
ICT Mentorship Core Content - Month 10 - Relative Strength Analysis - Accumulation & Distribution
ICT Mentorship Core Content - Month 10 - Importance Of Multi-Asset Analysis
ICT Mentorship Core Content - Month 10 - Premium Vs. Carrying Charge Market
ICT Mentorship Core Content - Month 10 - Commodity Seasonals Tendencies - My Personal Favorites
ICT Forex - COT Insights For Effective Price Action Analysis
ICT Mentorship Core Content - Month 04 - Interest Rate Effects On Currency Trades
```

---

### Agent 7 — `swing_trading` (~9 files)
**Role:** Swing setups multi-day/week, điều kiện lựa chọn thị trường, Million Dollar Setup.
```
ICT Mentorship Core Content - Month 06 - Classic Swing Trading Approach
ICT Mentorship Core Content - Month 06 - Elements To Successful Swing Trading
ICT Mentorship Core Content - Month 06 - High Probability Swing Trade Setups In Bear Markets
ICT Mentorship Core Content - Month 06 - High Probability Swing Trade Setups In Bull Markets
ICT Mentorship Core Content - Month 06 - Ideal Swings Conditions For Any Market
ICT Mentorship Core Content - Month 06 - Keys To Selecting Markets That Will Move Explosively
ICT Mentorship Core Content - Month 06 - Reducing Risk & Maximizing Potential Reward In Swing Setups
ICT Mentorship Core Content - Month 06 - The Million Dollar Swing Setup
ICT Forex - Secrets To Swing Trading
```

---

### Agent 8 — `short_term_ipda` (~7 files)
**Role:** Weekly range profiles, LRLR, One Shot One Kill, MM Manipulation Templates, intraweek reversals.
```
ICT Mentorship Core Content - Month 07 - One Shot One Kill Model
ICT Mentorship Core Content - Month 07 - Short Term Trading Low Resistance Liquidity Runs Part 1
ICT Mentorship Core Content - Month 07 - Short Term Trading Low Resistance Liquidity Runs Part 2
ICT Mentorship Core Content - Month 07 - Short Term Trading Defining Weekly Range Profiles
ICT Mentorship Core Content - Month 07 - Short Term Trading Market Maker Manipulation Templates
ICT Mentorship Core Content - Month 07 - Intraweek Market Reversals & Overlapping Models
ICT Mentorship Core Content - Month 03 - Market Maker Trap Head Shoulders Pattern
```

---

### Agent 9 — `session_killzone` (~15 files)
**Role:** Xác định session active, killzone timing, Silver Bullet window, CBDR, daily range projection.
```
ICT Mentorship Core Content - Month 08 - Central Bank Dealers Range
ICT Mentorship Core Content - Month 08 - Defining The Daily Range
ICT Mentorship Core Content - Month 08 - Essentials To ICT Daytrading
ICT Mentorship Core Content - Month 08 - High Probability Daytrade Setups
ICT Mentorship Core Content - Month 08 - Intraday Profiles
ICT Mentorship Core Content - Month 08 - Projecting Daily Highs & Lows
ICT Mentorship Core Content - Month 08 - When To Avoid The London Session
ICT Mentorship Core Content - Month 08 - Integrating Daytrades With HTF Trade Entries
ICT Forex - The ICT Asian Killzone
ICT Forex - The ICT London Killzone
ICT Forex - The ICT London Close Killzone
ICT Forex - The ICT New York Killzone
ICT Forex - Implementing The Asian Range
2023 ICT Mentorship - ICT Silver Bullet Time Based Trading Model
2023 ICT Mentorship - ICT Silver Bullet Time Based
```

---

### Agent 10 — `amd_power_of_3` (~5 files)
**Role:** Nhận dạng phase AMD đang diễn ra, Power of 3, xác định manipulation đã xảy ra chưa.
```
ICT Forex - Accumulation - Manipulation - Distribution
ICT Forex - Time & Price Theory
ICT Forex - The Weekly Bias - Excellence In Short Term Trading
ICT Forex - Understanding The ICT Judas Swing
2023 Mentorship Price Action Review & PM Session Reversal Model
```

---

### Agent 11 — `daytrade_setup` (~12 files)
**Role:** Bread & Butter buy/sell setups, 20 pips/day, ICT day trade routine, reversal vs continuation, scalping.
```
ICT Mentorship Core Content - Month 09 - Bread & Butter Buy Setups
ICT Mentorship Core Content - Month 09 - Bread & Butter Sell Setups
ICT Mentorship Core Content - Month 09 - 20 Pips Per Day
ICT Mentorship Core Content - Month 09 - ICT Day Trade Routine
ICT Mentorship Core Content - Month 09 - Trading In Consolidations
ICT Mentorship Core Content - Month 09 - Trading Market Reversals
ICT Mentorship Core Content - Month 09 - Filling The Numbers
ICT Mentorship Core Content - Month 09 - The Sentiment Effect
ICT - Mastering High Probability Scalping Vol. 1 of 3
ICT - Mastering High Probability Scalping Vol. 2 of 3
ICT - Mastering High Probability Scalping Vol. 3 of 3
ICT Mentorship 2023 - One Trading Setup For Life
```

---

### Agent 12 — `macro_intermarket` (~17 files)
**Role:** Bond trading, Index Futures, Stock trading, Mega-Trades, multi-asset correlation.
```
ICT Mentorship Core Content - Month 10 - Bond Trading - Basics & Opening Range Concept
ICT Mentorship Core Content - Month 10 - Bond Trading - Consolidation Days
ICT Mentorship Core Content - Month 10 - Bond Trading - Split Session Rules
ICT Mentorship Core Content - Month 10 - Bond Trading - Trending Days
ICT Mentorship Core Content - Month 10 - Index Futures - AM Trend
ICT Mentorship Core Content - Month 10 - Index Futures - Basics & Opening Range Concept
ICT Mentorship Core Content - Month 10 - Index Futures - Index Trade Setups
ICT Mentorship Core Content - Month 10 - Index Futures - PM Trend
ICT Mentorship Core Content - Month 10 - Index Futures - Projected Range & Objectives
ICT Mentorship Core Content - Month 10 - Stock Trading - Building Buy Watchlists
ICT Mentorship Core Content - Month 10 - Stock Trading - Building Sell Watchlists
ICT Mentorship Core Content - Month 10 - Stock Trading - Seasonals & Monthly Swings
ICT Mentorship Core Content - Month 10 - Stock Trading - Using Options
ICT Mentorship Core Content - Month 11 - Bond Mega-Trades
ICT Mentorship Core Content - Month 11 - Commodity Mega-Trades
ICT Mentorship Core Content - Month 11 - Forex & Currency Mega-Trades
ICT Mentorship Core Content - Month 11 - Stock Mega-Trades
```

---

### Agent 13 — `top_down_analysis` (~6 files)
**Role:** Orchestrator context — long term → intermediate → short term → intraday top-down framework.
```
ICT Mentorship Core Content - Month 12 - Long Term Top Down Analysis
ICT Mentorship Core Content - Month 12 - Intermediate Term Top Down Analysis
ICT Mentorship Core Content - Month 12 - Short Term Top Down Analysis
ICT Mentorship Core Content - Month 12 - Intraday Top Down Analysis
ICT Forex - How To Find Explosive Price Moves Before They Happen
ICT Forex - Target Selection & Profit Objectives
```

---

### Agent 14 — `ote_entry` (~25 files)
**Role:** Optimal Trade Entry patterns, nhận dạng OTE retracement, Fibonacci entry models.
```
OTE Primer - Intro To ICT Optimal Trade Entry
OTE Pattern Recognition Series - Vol. 01 → Vol. 20  (20 files)
Pattern Recognition - Aussie OTE NYO
Pattern Recognition - Fiber OTE NYO and Asian Session
ICT Precision Trading Concepts - 1
ICT Precision Trading Concepts - 3
```

---

### Agent 15 — `algo_gap` (~13 files)
**Role:** New Week/Day Opening Gaps, Algorithmic Price Delivery, Time Macros, Gap reprice targets.
```
NWOG - New Week Opening Gap
NWOG - New Week Opening Gap Part 2
NDOG - New Day Opening Gap - Part 1
2023 ICT Mentorship - Opening Range Gap Repricing Macro
2023 ICT Mentorship - Advanced Gap Theory Introduction
2023 ICT Mentorship - Algorithmic Price Delivery & Time Macros Intro
ICT Mentorship 2023 - September 12, 2023 NQ Algorithmic Price Delivery
ICT Mentorship 2023 - September 22, 2023 - High Frequency Trading Algorithmic Entries
ICT Mentorship 2023 - Market Maker Models
NQ Futures Review & The ICT Sick Sister Consolidation Model
ICT Mentorship 2023 - ICT Reaper PD Array Introduction & Market Review
ICT Mentorship 2023 - September 08, 2023 Review & ICT Ma Deuce Model
January 31, 2023 PM Session Example - New Week Opening Gap
```

---

### Agent 16 — `chart_models` (~12 files)
**Role:** ICT Charter Price Action Models 1–5, position trading, intraday volatility expansions.
```
ICT Charter Price Action Model 1
ICT Charter Price Action Model 1 Amplified Lecture
ICT Charter Price Action Model 1 Trade Plan & Algorithmic Theory
ICT Charter Price Action Model 2 Amplified Lecture
ICT Charter Price Action Model 2 Trade Plan & Algorithmic Theory
ICT Charter Price Action Model 3 Amplified Lecture
ICT Charter Price Action Model 3 Trade Plan & Algorithmic Theory
ICT Charter Price Action Model #4 Position Trading
ICT Charter Price Action Model #4 Supplementary Lesson
ICT Charter Price Action Model 4 Trade Plan & Algorithmic Theory
ICT Charter Price Action Model 5 Day Trading - Intraday Volatility Expansions
ICT Charter Price Action Model 5 Supplementary Lesson
```

---

### Agent 17 — `smt_forex` (~17 files)
**Role:** SMT Divergence, Judas Swing, ATM Method, Scout Sniper series, Market Maker Series, Forex-specific execution.
```
ICT Forex - The ICT Smart Money Technique or SMT
ICT Forex - Understanding The ICT Judas Swing
ICT Forex - The ICT ATM Method
ICT Forex - Market Maker Series Vol. 1 of 5 → Vol. 5 of 5 (5 files)
ICT Forex Scout Sniper Basic Field Guide - Vol. 1 → Vol. 8 (8 files)
ICT Forex - Trading The Key Swing Points
ICT Forex - Trade Psychology & Effective Journaling
```

---

### Agent 18 — `trading_plan` (~19 files)
**Role:** Xây dựng trading plan, W.E.N.T framework, lessons learned, proper learning, journaling methodology.
```
ICT - Trading Plan Development 1 → 7 (7 files)
ICT W.E.N.T. Series - Part 1 of 5 → Part 5 of 5 (5 files)
If I Could Go Back & Tell Myself What I Know Now... Part 1 → 4 (4 files)
ICT Forex - Trade Psychology & Effective Journaling
ICT Mentorship 2023 - Proper Learning & The Importance Of Journaling
ICT Mentorship 2022 Introduction
```

---

### Agent 19 — `live_review` (~80+ files)
**Role:** Học từ live executions thực tế — context "đã từng xảy ra" để validate setup và entry timing.

**Sub-categories:**
- **2022 ICT Mentorship Episodes** (Ep 2–41): ~39 files
- **2023 Live Tape Readings** (Feb–Oct): ~25 files
- **2023 Market Reviews & Commentary** (Jan–Oct): ~20 files
- **Special Sessions** (FOMC, NFP, CPI, Fed Testimony, Funded Challenge): ~10 files

```
# 2022 Series
2022 ICT Mentorship Episode 2 → 41 (39 files)

# 2023 Tape Readings
February 13-16, 25 ES Live Commentary & Session Review
March 06-08 Fed Chair Testimony, March 21 Conquering Fear, March 30-31 AM Session
April 11-13 Live Tape Reading, Drawdown Mitigation Homework
May 23-24, June 06-15, July 07-23, Aug 14-22, Sep 05-29, Oct 04-22

# 2023 Market Reviews
ICT Emini Futures Review - January 18
ICT ES Futures Review - January 09
Market Review Feb 07-12, Price Action Chronicles Feb 07
January NFP Review, ICT FOMC February 2023
ICT Mentorship 2023 Ep 01, T.G.I.F. Setup
December 2023 Non Farm Payroll Live Execution
2023 ICT Mentorship - Review Of Interactive Study 090123 NFP NQ Short
ICT Mentorship 2023 - Market Review & When Wrong Is Still Right
ES Review & ICT Funded Challenge Discussion
5 Handle Twitter Example Live Execution
```

---

## Thống kê phân bổ

| # | AgentId | Files | Trọng tâm |
|---|---|---|---|
| 1 | foundations | ~9 | Khái niệm nền tảng |
| 2 | risk_execution | ~13 | Risk, position sizing, tâm lý |
| 3 | market_structure | ~16 | CHoCH/BOS/MSS, MM traps |
| 4 | pd_arrays | ~16 | OB, FVG, Breaker, Liquidity |
| 5 | htf_bias | ~16 | IPDA, quarterly, swing points |
| 6 | seasonal_macro | ~12 | Seasonal, COT, intermarket |
| 7 | swing_trading | ~9 | Swing setup multi-day |
| 8 | short_term_ipda | ~7 | LRLR, weekly range, One Shot |
| 9 | session_killzone | ~15 | Killzone, CBDR, Silver Bullet |
| 10 | amd_power_of_3 | ~5 | AMD phase, Power of 3 |
| 11 | daytrade_setup | ~12 | B&B, 20 pips, scalping |
| 12 | macro_intermarket | ~17 | Bonds, Index, Stock, Mega |
| 13 | top_down_analysis | ~6 | Top-down orchestrator context |
| 14 | ote_entry | ~25 | OTE Vol 1-20, pattern recog. |
| 15 | algo_gap | ~13 | NWOG, NDOG, Algo delivery |
| 16 | chart_models | ~12 | Charter Models 1-5 |
| 17 | smt_forex | ~17 | SMT, Scout Sniper, MM Series |
| 18 | trading_plan | ~19 | Trading plan, W.E.N.T, lessons |
| 19 | live_review | ~80+ | 2022-2023 live executions |
| | **TOTAL** | **~319 assigned** | ~27 overlap cần verify qua agents:classify |

---

## PDF Assignment Rules — filename pattern matching

```typescript
// src/agents/agent-registry.ts
// Rules theo thứ tự priority — first match wins

export const AGENT_RULES: Array<{ agentId: string; patterns: RegExp[] }> = [
  // 19. live_review — check đầu tiên vì "2022 Episode" / "2023...Review" overlap nhiều
  { agentId: 'live_review', patterns: [
    /2022 ICT Mentorship Episode/i,
    /Live Tape Reading/i,
    /Live Execution/i,
    /Live trade Walkthrough/i,
    /Live Commentary/i,
    /Market Review.*202[23]/i,
    /202[23].*Market Review/i,
    /ES Review|NQ.*Review|Emini.*Review/i,
    /FOMC|NFP.*Review|CPI.*Lecture/i,
    /Price Action Chronicles/i,
    /Drawdown Mitigation.*Homework/i,
    /Funded Challenge Discussion/i,
    /Premarket Commentary/i,
    /ES Live Execution/i,
    /Price Action Workshop/i,
    /Forex.*Spooz|Spooz.*Forex/i,
    /Deep Learning On Nasdaq/i,
    /5 Handle Twitter Example/i,
    /TGIF Setup/i,
    /2023 Mentorship Price Action Review/i,
    /Commentary Livestream/i,
    /Weekend Commentary/i,
    /PM Session Market Review/i,
  ]},

  // 15. algo_gap
  { agentId: 'algo_gap', patterns: [
    /NWOG|New Week Opening Gap/i,
    /NDOG|New Day Opening Gap/i,
    /Opening Range Gap.*Repric/i,
    /Advanced Gap Theory/i,
    /Algorithmic Price Delivery/i,
    /Time Macros/i,
    /Sick Sister Consolidation/i,
    /Ma Deuce Model/i,
    /High Frequency Trading.*Algorithmic/i,
    /Market Maker Models/i,
  ]},

  // 14. ote_entry
  { agentId: 'ote_entry', patterns: [
    /OTE Pattern Recognition/i,
    /OTE Primer/i,
    /Optimal Trade Entry/i,
    /Pattern Recognition - Aussie/i,
    /Pattern Recognition - Fiber/i,
    /Precision Trading Concepts/i,
  ]},

  // 16. chart_models
  { agentId: 'chart_models', patterns: [
    /Charter Price Action Model/i,
    /Micro-Market Structure.*Time.*Price/i,
    /Institutional Price Action.*Micro/i,
  ]},

  // 17. smt_forex
  { agentId: 'smt_forex', patterns: [
    /Smart Money Technique|SMT/i,
    /Judas Swing/i,
    /ICT ATM Method/i,
    /Scout Sniper/i,
    /Market Maker Series/i,
    /Trading The Key Swing Points/i,
  ]},

  // 18. trading_plan
  { agentId: 'trading_plan', patterns: [
    /Trading Plan Development/i,
    /W\.E\.N\.T\. Series/i,
    /If I Could Go Back/i,
    /Trade Psychology.*Journaling/i,
    /Proper Learning.*Journaling/i,
    /2022.*Mentorship.*Introduction/i,
  ]},

  // 10. amd_power_of_3
  { agentId: 'amd_power_of_3', patterns: [
    /Accumulation.*Manipulation.*Distribution/i,
    /Time & Price Theory/i,
    /Implementing The Asian Range/i,
    /PM Session Reversal Model/i,
  ]},

  // 9. session_killzone
  { agentId: 'session_killzone', patterns: [
    /Killzone/i,
    /Silver Bullet.*Time Based/i,
    /Central Bank Dealers Range|CBDR/i,
    /Defining The Daily Range/i,
    /Intraday Profiles/i,
    /Projecting Daily Highs/i,
    /Avoid The London Session/i,
    /Integrating Daytrades With HTF/i,
    /Essentials To ICT Daytrading/i,
    /Daily Bias/i,
    /Weekly Bias.*Excellence/i,
    /Month 08/i,
  ]},

  // 11. daytrade_setup
  { agentId: 'daytrade_setup', patterns: [
    /Bread & Butter/i,
    /20 Pips Per Day/i,
    /Day Trade Routine/i,
    /Trading In Consolidations/i,
    /Trading Market Reversals/i,
    /Filling The Numbers/i,
    /Sentiment Effect/i,
    /High Probability Daytrade/i,
    /Mastering High Probability Scalping/i,
    /One Trading Setup For Life/i,
    /Month 09/i,
  ]},

  // 8. short_term_ipda
  { agentId: 'short_term_ipda', patterns: [
    /Low Resistance Liquidity Runs/i,
    /One Shot One Kill/i,
    /Weekly Range Profile/i,
    /Blending IPDA.*PD Arrays/i,
    /Monthly & Weekly Ranges/i,
    /Intraweek Market Reversal/i,
    /Market Maker Manipulation Template/i,
    /Month 07/i,
  ]},

  // 7. swing_trading
  { agentId: 'swing_trading', patterns: [
    /Month 06/i,
    /Swing Trading/i,
    /Swing Trade Setup/i,
    /Million Dollar Swing/i,
    /Ideal Swing/i,
    /Secrets To Swing Trading/i,
  ]},

  // 12. macro_intermarket
  { agentId: 'macro_intermarket', patterns: [
    /Bond Trading/i,
    /Bond Mega/i,
    /Stock Mega/i,
    /Commodity Mega/i,
    /Forex.*Mega|Mega.*Forex/i,
    /Month 10.*(Bond|Index Futures|Stock|Commodity|Multi|COT|Open Interest|Relative|Premium)/i,
    /Month 11/i,
  ]},

  // 6. seasonal_macro
  { agentId: 'seasonal_macro', patterns: [
    /Seasonal Tendencies/i,
    /Bearish Seasonal|Bullish Seasonal|Ideal Seasonal/i,
    /Intermarket Analysis/i,
    /Commitment Of Traders/i,
    /Open Interest.*Smart Money/i,
    /Relative Strength Analysis/i,
    /Multi-Asset Analysis/i,
    /Premium Vs\. Carrying Charge/i,
    /Commodity Seasonal/i,
    /COT Insights/i,
    /Month 10.*(Importance|Commodity Season|Relative|Open Interest|Premium|COT)/i,
  ]},

  // 5. htf_bias
  { agentId: 'htf_bias', patterns: [
    /Defining HTF PD Arrays/i,
    /Defining Institutional Swing Points/i,
    /Defining Open Float Liquidity Pools/i,
    /Using IPDA Data Ranges/i,
    /Quarterly Shifts.*IPDA/i,
    /Open Float/i,
    /Trade Conditions.*Setup Progression/i,
    /Qualifying Trade.*10 Year/i,
    /Using 10 Year Notes/i,
    /Interest Rate Differential/i,
    /Higher Time Frame Concepts/i,
    /NonFarm Payroll.*HTF/i,
    /Month 05/i,
  ]},

  // 4. pd_arrays
  { agentId: 'pd_arrays', patterns: [
    /Orderblock/i,
    /Fair Value Gap|FVG/i,
    /Breaker Block/i,
    /Propulsion Block/i,
    /Rejection Block/i,
    /Vacuum Block/i,
    /Mitigation Block/i,
    /Reclaimed.*Orderblock/i,
    /Liquidity Pool/i,
    /Liquidity Void/i,
    /Reinforcing Liquidity/i,
    /Double Bottom.*Double Top|Double Top.*Double Bottom/i,
    /Reaper PD Array/i,
    /Advanced Theory.*Breaker/i,
    /Month 04/i,
  ]},

  // 3. market_structure
  { agentId: 'market_structure', patterns: [
    /Institutional Market Structure/i,
    /Institutional Order Flow/i,
    /Institutional Sponsorship/i,
    /Macro Economic.*Micro Technical/i,
    /Market Maker Trap/i,
    /Anticipatory Skill/i,
    /Timeframe Selection.*Defining/i,
    /Divergence Phantom/i,
    /Trendline Phantom/i,
    /Standard Deviations.*Buyside/i,
    /Deep Dive.*Institutional/i,
    /Immediate Rebalance.*Institutional/i,
    /Micro-Market Structure/i,
    /Month 03/i,
  ]},

  // 2. risk_execution
  { agentId: 'risk_execution', patterns: [
    /Framing Low Risk/i,
    /How Traders Make 10%/i,
    /Growing Small Accounts/i,
    /Mitigate Losing Trades/i,
    /No Fear Of Losing/i,
    /Secrets To Selecting High Reward/i,
    /Considerations In Risk Management/i,
    /Money Management/i,
    /Position Trade Management/i,
    /Limit Order Entry.*Long Term/i,
    /Stop Entry.*Long Term/i,
    /What New Traders Should Focus/i,
    /Month 02/i,
  ]},

  // 13. top_down_analysis
  { agentId: 'top_down_analysis', patterns: [
    /Top Down Analysis/i,
    /Find Explosive Price Moves/i,
    /Target Selection.*Profit Objectives/i,
    /Month 12/i,
  ]},

  // 1. foundations — fallback
  { agentId: 'foundations', patterns: [
    /Month 1 - /i,
    /Essentials To ICT Market Structure/i,
  ]},
];
```

---

## Core Types

```typescript
// src/agents/base-agent.ts

export abstract class ICTSubAgent {
  abstract readonly agentId: string;
  abstract readonly displayName: string;
  abstract readonly systemPrompt: string;
  abstract readonly queryTemplates: string[];   // domain-specific search queries

  protected ensureIndex(): KnowledgeIndex { ... }
  async retrieve(query: string, topK = 5): Promise<Chunk[]> { ... }
  async retrieveDiverse(
    query: string, topK = 3, maxPerSource = 1, poolSize = 40
  ): Promise<Chunk[]> { ... }
  abstract analyze(context: AgentContext): Promise<AgentOutput>;
}

export type AgentContext = {
  symbol:          string;
  currentTimeUTC:  string;
  sessionName:     'asia' | 'london' | 'nyam' | 'nypm';
  captures:        CapturedChart[];
  visionAnalysis:  ICTChartAnalysis;
  priorOutputs:    Record<string, AgentOutput>;
};

export type AgentOutput = {
  agentId:    string;
  domain:     string;
  summary:    string;
  keyPoints:  string[];
  signals:    AgentSignal[];
  sources:    string[];
  confidence: 'high' | 'medium' | 'low' | 'no_setup';
};

export type AgentSignal = {
  type:         string;   // "OB_BULLISH" | "FVG_BEARISH" | "CHoCH" | "LRLR" | ...
  timeframe:    string;
  priceLevel?:  string;
  note:         string;
};
```

---

## TopDownOrchestratorAgent — Luồng chạy

```
Bước 1:  Nhận captures[] + symbol + sessionName
Bước 2:  Gemini Vision một lần → ICTChartAnalysis (vision layer dùng chung)
Bước 3:  FoundationsAgent.retrieve() → inject context nền tảng
Bước 4:  Layer 1 — song song: MacroAgent | HtfBiasAgent | SeasonalMacroAgent
Bước 5:  Layer 2 — tuần tự:  MarketStructureAgent → PdArrayAgent
Bước 6:  Layer 3 — song song: AlgoGapAgent | SmtForexAgent
Bước 7:  Layer 4 — song song: SessionKillzoneAgent | AmdPowerOf3Agent
Bước 8:  Layer 5 — entry model theo timeframe chính:
           swing    → SwingTradingAgent + OteEntryAgent + ChartModelsAgent
           intraday → ShortTermIpdaAgent + DayTradeSetupAgent
Bước 9:  Layer 7 — RiskExecutionAgent | TradingPlanAgent
Bước 10: Layer 8 — LiveReviewAgent (validate vs historical)
Bước 11: TopDownAnalysisAgent.synthesize(allOutputs) → final ChartDecisionResult
Bước 12: generatePdfReport(result) → report.pdf
```

---

## Build Process

```bash
# Bước 1: Classify PDFs → xem mỗi agent nhận file nào
npm run agents:classify

# Bước 2: Review data/stateful/agent-pdf-map.json, chỉnh rules nếu cần

# Bước 3: Build indexes (hỗ trợ resume nếu bị ngắt)
npm run agents:build                           # Tất cả 19 agents
npm run agents:build -- --agent pd_arrays      # Rebuild 1 agent
npm run agents:stats                           # Thống kê chunks per agent
```

---

## CLI Commands

```bash
# Hiện tại
npm run stateful:build                         # Build legacy single index
npm run stateful:ask -- "<câu hỏi>"
npm run stateful:capture -- --symbol EURUSD [--stack intraday] [--tfs 4h,1h,15m]
npm run stateful:chart   -- --symbol EURUSD [--stack intraday]
npm run stateful:outcome -- --list | --stats | --id <id> --result WIN

# Mục tiêu
npm run agents:classify                        # PDF → agent-pdf-map.json
npm run agents:build                           # Build 19 Tier 2 raw indexes
npm run agents:build -- --agent <agentId>      # Rebuild 1 agent
npm run agents:stats                           # Chunks/agent statistics
npm run stateful:process-build                 # Build Tier 1 process-index.json (~$2-3 one-time)
npm run stateful:capture -- --symbol EURUSD    # Dùng 19-agent orchestrator
npm run stateful:ask -- "<q>" --agent pd_arrays # Query thẳng 1 agent
```

---

## Trạng thái hiện tại vs Mục tiêu

| Thành phần | Hiện tại | Mục tiêu |
|---|---|---|
| PDF count | 125 (feature branch) / 346 (master local) | 500+ khi download đủ |
| Knowledge index | 1 file `knowledge-index.json` | 19 files `agent-indexes/*.json` + `process-index.json` |
| RAG tier | Single — raw chunks only | **Tier 1** process entries (structured) + **Tier 2** raw chunks hydration |
| RAG coverage | ~60-80 chunks / call (~1-4% index) | ~15 process entries (clean) + on-demand raw hydration |
| Dynamic queries | Yếu — chỉ dựa tên TF | `VisionObservations` JSON → targeted per-agent queries |
| Agent count | 1 `ScholarAgent` generic | 19 agents chuyên biệt |
| Orchestration | Không có | `TopDownOrchestratorAgent` 8 layers |
| API model (vision+main) | gemini-2.5-flash | **gemini-2.0-flash** (~70% rẻ hơn) |
| API model (text-only) | gemini-2.5-flash | **Groq llama-3.3-70b** (free tier) |
| Est. cost/run (8 stacks) | ~$1.00 | ~$0.40–0.45 (~55% tiết kiệm) |
| PDF report | ✅ Hoạt động | Giữ nguyên + citation per section từ đúng agent |

---

## Thứ tự implement

```
 Phase A — Foundation
  1. src/core/gemini.ts                  — getGeminiFlash() + getGroqClient() routing
  2. src/core/process-index.ts           — ProcessEntry type + queryProcessIndex()
  3. src/agents/agent-registry.ts        — AGENT_RULES[], classify()
  4. src/agents/base-agent.ts            — abstract ICTSubAgent + build/resume logic

 Phase B — Build indexes
  5. npm run agents:classify             — verify PDF → agent mapping
  6. npm run agents:build                — build 19 agent raw indexes (Tier 2)
  7. npm run stateful:process-build      — build process-index.json (Tier 1, ~$2-3)
  8. npm run agents:stats                — verify chunks per agent

 Phase C — Orchestration
  9. src/agents/top-down-orchestrator.ts — orchestrator skeleton (8 layers)
 10. Build lần lượt 19 agent classes (bắt đầu từ layer0 → layer8)
 11. src/processor/vision-analyzer.ts   — thêm VisionObservations output
                                           switch model → gemini-2.0-flash
                                           generateNarrator() → groq

 Phase D — Wire up & test
 12. Update ChartAnalysisService         — swap ScholarAgent → TopDownOrchestratorAgent
                                           extractDynamicQueries() → groq
 13. Update ICTPdfGenerator              — planHandbookStructure() → groq
 14. End-to-end test 1 run (EURUSD intraday)
 15. Benchmark: cost + latency trước/sau
```

---

## Prerequisites

```env
GEMINI_API_KEY=...
CHROME_PATH=...         # TradingViewCapturer (Puppeteer)
TELEGRAM_BOT_TOKEN=...  # Optional
```

