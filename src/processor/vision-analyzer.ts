import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

export class VisionAnalyzer {
    private genAI: GoogleGenerativeAI;
    private model: any;

    constructor() {
        const apiKey = process.env.GEMINI_API_KEY || "";
        this.genAI = new GoogleGenerativeAI(apiKey);
        // Dùng bản Flash cho rẻ và nhanh
        this.model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    }

    /**
     * Chuyển ảnh sang định dạng Google AI hiểu được
     */
    private fileToGenerativePart(path: string, mimeType: string) {
        return {
            inlineData: {
                data: Buffer.from(fs.readFileSync(path)).toString("base64"),
                mimeType,
            },
        };
    }

    /**
     * Phân tích biểu đồ và lời giảng
     */
    async analyzeChart(imagePath: string, transcriptText: string) {
        const prompt = `
            Bạn là một chuyên gia về phương pháp ICT (Inner Circle Trader).
            Dưới đây là hình ảnh biểu đồ từ video bài giảng và lời giảng tương ứng:
            
            Lời giảng: "${transcriptText}"
            
            Dựa trên hình ảnh và lời giảng, hãy:
            1. Xác định các khái niệm ICT xuất hiện (FVG, Order Block, Liquidity, Market Structure Shift...).
            2. Giải thích ngắn gọn tại sao đây là một setup quan trọng.
            3. Trình bày dưới dạng JSON để lưu vào cơ sở dữ liệu.
        `;

        const imagePart = this.fileToGenerativePart(imagePath, "image/jpeg");

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