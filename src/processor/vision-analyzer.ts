import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

export type DrawingInstruction = {
    tool: 'horizontal_line' | 'rectangle' | 'trendline' | 'arrow' | 'label';
    label: string;
    color: string;
    description: string;
    priceLevel?: number;
    priceZone?: { high: number; low: number };
    fromBar?: string;
    toBar?: string;
};

export type ICTChartAnalysis = {
    htfBias: 'bullish' | 'bearish' | 'ranging' | 'unknown';
    marketStructure: {
        status: string;
        lastMSS?: string;
        internalStructure?: string;
    };
    keyLevels: {
        type: 'FVG' | 'OrderBlock' | 'Liquidity' | 'IFVG' | 'Breaker' | 'Mitigation' | 'EQH' | 'EQL' | 'PDHL';
        zone: string;
        significance: 'high' | 'medium' | 'low';
        note: string;
    }[];
    drawOnLiquidity: string;
    killzoneAlignment: string;
    setup: {
        bias: 'long' | 'short' | 'no_trade';
        confidence: 'high' | 'medium' | 'low';
        entryZone?: string;
        stopLoss?: string;
        target?: string;
        rrRatio?: string;
        reason: string;
    };
    drawings: DrawingInstruction[];
    warnings: string[];
    rawSummary: string;
    narratorScript: string;  // Full ICT teaching narrative — verbose multi-paragraph explanation
};

export class VisionAnalyzer {
    private genAI: GoogleGenerativeAI;
    private model: any;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY || "";
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    }

    private fileToGenerativePart(filePath: string, mimeType: string) {
        return {
            inlineData: {
                data: Buffer.from(fs.readFileSync(filePath)).toString("base64"),
                mimeType,
            },
        };
    }

    /**
     * Multi-timeframe ICT analysis (top-down or bottom-up).
     * Accepts multiple TF summaries to build layered context for the chart image.
     */
    async analyzeMultiTFForDecision(
        imagePath: string,
        multiTFSummary: string,
        mode: 'topdown' | 'bottomup' = 'topdown',
        internalKnowledgeContext: string = '',
    ): Promise<ICTChartAnalysis> {
        const mimeType  = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        const imagePart = this.fileToGenerativePart(imagePath, mimeType);

        const modeDesc = mode === 'topdown'
            ? 'TOP-DOWN: Start from HTF bias → refine on MTF → find precise entry on LTF.'
            : 'BOTTOM-UP: Spot signal on LTF → confirm with MTF → validate with HTF before committing.';

        const prompt = `You are a price action analyst. You MUST reason like a structured academic: every hypothesis requires evidence cited from the provided PDF references. You have NO independent ICT knowledge — you only know what is in the PDF sections below.

ANALYSIS MODE: ${modeDesc}

━━━━━━━━━━━━━━━━━━ RAW MARKET DATA ━━━━━━━━━━━━━━━━━━
${multiTFSummary}

━━━━━━━━━━━━━━━━━━ ICT REFERENCE LIBRARY (PDF CHUNKS BY CATEGORY) ━━━━━━━━━━━━━━━━━━
${internalKnowledgeContext
    ? internalKnowledgeContext
    : '(unavailable — do not use any ICT terminology, describe price action in plain terms only)'
}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CITATION RULES (strictly enforced):
1. Every ICT term or concept you use MUST be followed immediately by a citation: [CATEGORY: X | REF: filename | chunk N]
2. If a concept has no matching chunk in the library above, do NOT use that term. Use plain price-action language instead.
3. You may ONLY combine two concepts if BOTH have citations from the library.
4. Price levels and directional bias must come from RAW MARKET DATA above, not invented.

TASK — Output exactly TWO tagged sections:

<ANALYSIS_JSON>
{
  "htfBias": "bullish" | "bearish" | "ranging" | "unknown",
  "marketStructure": {
    "status": "overall structure — cite [CATEGORY: HTF_BIAS_MARKET_STRUCTURE | REF: ... | chunk N]",
    "lastMSS": "timeframe + price level + type + cite [CATEGORY: EQUAL_HIGHS_LOWS_STRUCTURE_SHIFT | REF: ... | chunk N]",
    "internalStructure": "internal range character with citation"
  },
  "keyLevels": [
    {
      "type": "FVG|OrderBlock|Liquidity|IFVG|Breaker|Mitigation|EQH|EQL|PDHL",
      "zone": "exact price zone from raw data",
      "significance": "high|medium|low",
      "note": "why price reacts here + cite [CATEGORY: PD_ARRAYS | REF: ... | chunk N]"
    }
  ],
  "drawOnLiquidity": "target + why + cite [CATEGORY: DRAW_ON_LIQUIDITY | REF: ... | chunk N]",
  "killzoneAlignment": "session name + time window + cite [CATEGORY: KILLZONES_TIME | REF: ... | chunk N]",
  "setup": {
    "bias": "long|short|no_trade",
    "confidence": "high|medium|low",
    "entryZone": "price levels from raw data",
    "stopLoss": "price level + ICT rule + cite [CATEGORY: RISK_MANAGEMENT | REF: ... | chunk N]",
    "target": "price level + cite [CATEGORY: DRAW_ON_LIQUIDITY | REF: ... | chunk N]",
    "rrRatio": "calculated number",
    "reason": "confluence list — each point cited to its category"
  },
  "drawings": [
    {
      "tool": "horizontal_line|rectangle|trendline|arrow|label",
      "label": "name",
      "color": "#hex",
      "description": "placement",
      "priceLevel": null,
      "priceZone": null,
      "fromBar": null,
      "toBar": null
    }
  ],
  "warnings": ["warning with citation if applicable"],
  "rawSummary": "3-5 sentence summary with inline citations for every ICT term used"
}
</ANALYSIS_JSON>

<NARRATOR>
Write a structured analysis using ONLY concepts found in the ICT REFERENCE LIBRARY above.

SYSTEMATIC CITATION FORMAT: After every ICT concept or hypothesis write:
  → [CATEGORY: <category_name> | REF: <pdf_filename> | chunk <N>]

If a concept has no citation available, describe the price movement in plain language (e.g. "price moved above the previous high" instead of "BOS").

Structure with these headers:

### 1. HTF Context [CATEGORY: HTF_BIAS_MARKET_STRUCTURE]
State the bias on each timeframe using ONLY definitions from the HTF_BIAS_MARKET_STRUCTURE category. Quote directly from the PDF if relevant. Every directional claim must cite a chunk.

### 2. Draw on Liquidity [CATEGORY: DRAW_ON_LIQUIDITY]
Identify where price is drawn to using ONLY the DRAW_ON_LIQUIDITY category. Name exact price levels from raw data. Every liquidity concept must cite its chunk.

### 3. Structure Shifts [CATEGORY: EQUAL_HIGHS_LOWS_STRUCTURE_SHIFT]
Describe structure events (BOS, CHoCH, MSS, equal highs/lows) using ONLY chunks from EQUAL_HIGHS_LOWS_STRUCTURE_SHIFT. If no chunk covers a term, remove the term.

### 4. PD Arrays Identified [CATEGORY: PD_ARRAYS]
List every PD array visible, using ONLY PD_ARRAYS category chunks. For each array include: price level from raw data + direct quote or paraphrase from chunk + citation.

### 5. Killzone & Time [CATEGORY: KILLZONES_TIME]
Assess current session alignment using ONLY KILLZONES_TIME chunks. Quote the session time window from the PDF.

### 6. Trade Setup [CATEGORY: ENTRY_MODELS + RISK_MANAGEMENT]
Entry model name (only if found in ENTRY_MODELS chunks), entry zone from raw data, stop loss rule from RISK_MANAGEMENT chunk, target from DRAW_ON_LIQUIDITY chunk. Each line cited.

### 7. Evidence Summary
A table:
| Hypothesis | Category | PDF Source | Chunk | Quote |
|---|---|---|---|---|
List every material claim in the analysis with its evidence. If a claim has no citation row, remove the claim.
</NARRATOR>`;

        try {
            const result   = await this.model.generateContent([prompt, imagePart]);
            const response = await result.response;
            const raw      = (await response.text()).trim();

            // Parse structured JSON from <ANALYSIS_JSON> block
            const jsonMatch = raw.match(/<ANALYSIS_JSON>([\s\S]*?)<\/ANALYSIS_JSON>/);
            if (!jsonMatch) throw new Error(`No <ANALYSIS_JSON> block found. Preview: ${raw.slice(0, 400)}`);

            const jsonText = jsonMatch[1].trim();
            const analysis = JSON.parse(jsonText) as ICTChartAnalysis;

            // ── Call 2: Narrator — text-only, no image, no token competition ──
            analysis.narratorScript = await this.generateNarrator(
                analysis,
                multiTFSummary,
                internalKnowledgeContext,
            );

            return analysis;
        } catch (error) {
            console.error('[Vision] Multi-TF analysis error:', error);
            throw error;
        }
    }

    /**
     * Second call: generate the structured ICT narrator from the JSON result.
     * Text-only (no image) so Gemini has full output budget for the narrative.
     */
    private async generateNarrator(
        analysis: ICTChartAnalysis,
        multiTFSummary: string,
        internalKnowledgeContext: string,
    ): Promise<string> {
        const jsonSummary = JSON.stringify({
            htfBias:         analysis.htfBias,
            marketStructure: analysis.marketStructure,
            keyLevels:       analysis.keyLevels,
            drawOnLiquidity: analysis.drawOnLiquidity,
            killzoneAlignment: analysis.killzoneAlignment,
            setup:           analysis.setup,
            warnings:        analysis.warnings,
        }, null, 2);

        const narratorPrompt = `You are an ICT (Inner Circle Trader) educator writing a structured analysis report.
Below is the structured analysis already computed from the chart plus supporting PDF references.
Your task is to write the NARRATOR section — a thorough, academic-style breakdown citing ONLY the PDF chunks provided.

=== COMPUTED ANALYSIS ===
${jsonSummary}

=== RAW MARKET DATA ===
${multiTFSummary}

=== ICT REFERENCE LIBRARY (PDF CHUNKS BY CATEGORY) ===
${internalKnowledgeContext || '(unavailable — describe price action in plain terms only)'}

CITATION FORMAT: After every ICT concept write → [CATEGORY: X | REF: filename | chunk N]
If no chunk covers a term, use plain price-action language instead. Do NOT invent citations.

Write the narrator with these exact headers (minimum 600 words total):

### 1. HTF Context [CATEGORY: HTF_BIAS_MARKET_STRUCTURE]
### 2. Draw on Liquidity [CATEGORY: DRAW_ON_LIQUIDITY]
### 3. Structure Shifts [CATEGORY: EQUAL_HIGHS_LOWS_STRUCTURE_SHIFT]
### 4. PD Arrays Identified [CATEGORY: PD_ARRAYS]
### 5. Killzone & Time [CATEGORY: KILLZONES_TIME]
### 6. Trade Setup [CATEGORY: ENTRY_MODELS + RISK_MANAGEMENT]
### 7. Evidence Summary
| Hypothesis | Category | PDF Source | Chunk | Quote |
|---|---|---|---|---|
(one row per material claim)

Output ONLY the narrator text starting from "### 1." — no preamble, no tags.`;

        try {
            const result   = await this.model.generateContent(narratorPrompt);
            const response = await result.response;
            return (await response.text()).trim();
        } catch (err) {
            console.error('[Vision] Narrator generation error:', err);
            return '(narrator generation failed)';
        }
    }

    /**
     * Full ICT chart analysis from a screenshot.
     * Returns structured analysis with drawing instructions and a trading decision.
     */
    async analyzeChartForDecision(
        imagePath: string,
        rawDataSummary: string = '',
        internalKnowledgeContext: string = '',
    ): Promise<ICTChartAnalysis> {
        const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        const imagePart = this.fileToGenerativePart(imagePath, mimeType);

        const prompt = `You are a senior ICT (Inner Circle Trader) market analyst.
You MUST base your analysis ONLY on:
1. The chart image provided.
2. The raw price data summary below (if provided).
3. The ICT internal knowledge context below (from private PDF notes).

Do NOT use any external information, news, or general market opinion.

${rawDataSummary ? `RAW PRICE DATA SUMMARY:\n${rawDataSummary}\n` : ''}
${internalKnowledgeContext ? `ICT INTERNAL KNOWLEDGE CONTEXT:\n${internalKnowledgeContext}\n` : ''}

TASK — Analyse the chart image and produce a JSON object matching this exact schema:
{
  "htfBias": "bullish" | "bearish" | "ranging" | "unknown",
  "marketStructure": {
    "status": "string describing current structure",
    "lastMSS": "optional — describe the last Market Structure Shift seen",
    "internalStructure": "optional — internal range structure"
  },
  "keyLevels": [
    {
      "type": "FVG" | "OrderBlock" | "Liquidity" | "IFVG" | "Breaker" | "Mitigation" | "EQH" | "EQL" | "PDHL",
      "zone": "price zone or label visible on chart",
      "significance": "high" | "medium" | "low",
      "note": "brief ICT explanation"
    }
  ],
  "drawOnLiquidity": "describe where price is most likely drawn towards and why",
  "killzoneAlignment": "does the setup align with a killzone (London Open, NY Open, Silver Bullet, etc.)?",
  "setup": {
    "bias": "long" | "short" | "no_trade",
    "confidence": "high" | "medium" | "low",
    "entryZone": "price level or zone to enter",
    "stopLoss": "price level for stop loss (below FVG / OB low for longs)",
    "target": "price target — next liquidity or FVG",
    "rrRatio": "estimated R:R e.g. 1:3",
    "reason": "concise ICT reason for this setup"
  },
  "drawings": [
    {
      "tool": "horizontal_line" | "rectangle" | "trendline" | "arrow" | "label",
      "label": "name to show on chart",
      "color": "hex color code",
      "description": "exactly where to draw this on the chart and why",
      "priceLevel": optional number,
      "priceZone": optional { "high": number, "low": number },
      "fromBar": optional "description of left anchor bar",
      "toBar": optional "description of right anchor bar"
    }
  ],
  "warnings": ["list any risk warnings or reasons to be cautious"],
  "rawSummary": "2-3 sentence plain-language summary for the trader"
}

OUTPUT ONLY RAW JSON. No markdown, no explanation outside the JSON.`;

        try {
            const result = await this.model.generateContent([prompt, imagePart]);
            const response = await result.response;
            const text = (await response.text()).trim();

            const start = text.indexOf('{');
            const end   = text.lastIndexOf('}') + 1;
            if (start < 0 || end <= start) {
                throw new Error(`Gemini did not return valid JSON. Preview: ${text.slice(0, 400)}`);
            }

            return JSON.parse(text.substring(start, end)) as ICTChartAnalysis;
        } catch (error) {
            console.error("[Vision] Error calling Gemini:", error);
            throw error;
        }
    }

    /**
     * Legacy method — kept for backward compatibility with pdf-generator pipeline.
     */
    async analyzeChart(imagePath: string, transcriptText: string): Promise<string | null> {
        const prompt = `
            Bạn là một chuyên gia về phương pháp ICT (Inner Circle Trader).
            Dưới đây là hình ảnh biểu đồ từ video bài giảng và lời giảng tương ứng:
            
            Lời giảng: "${transcriptText}"
            
            Dựa trên hình ảnh và lời giảng, hãy:
            1. Xác định các khái niệm ICT xuất hiện (FVG, Order Block, Liquidity, Market Structure Shift...).
            2. Giải thích ngắn gọn tại sao đây là một setup quan trọng.
            3. Trình bày dưới dạng JSON để lưu vào cơ sở dữ liệu.
        `;
        const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        const imagePart = this.fileToGenerativePart(imagePath, mimeType);
        try {
            const result = await this.model.generateContent([prompt, imagePart]);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error("[Vision] Lỗi khi gọi Gemini:", error);
            return null;
        }
    }
}