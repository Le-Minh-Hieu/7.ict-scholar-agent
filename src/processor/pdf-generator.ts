import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import SrtParser from 'srt-parser-2';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY || '';
if (!apiKey) {
    console.error('❌ GEMINI_API_KEY is not set. Please add it to your .env file or environment variables.');
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const srtParser = new SrtParser();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure ffmpeg path is correct for your environment
ffmpeg.setFfmpegPath('C:/Users/Administrator/scoop/shims/ffmpeg.exe');

export class ICTPdfGenerator {
    private readonly rawVideosDir = path.join(__dirname, '../../data/raw_videos');
    private readonly pdfOutputDir = path.join(__dirname, '../../data/pdfs');
    private readonly screenshotsDir = path.join(__dirname, '../../data/screenshots');

    constructor() {
        if (!fs.existsSync(this.pdfOutputDir)) fs.mkdirSync(this.pdfOutputDir, { recursive: true });
        if (!fs.existsSync(this.screenshotsDir)) fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }

    async planHandbookStructure(fullText: string, videoTitle: string, targetSections: number): Promise<any[]> {
        console.log(`🤖 Analyzing ICT Teachings for: ${videoTitle}`);
        
        const safeText = fullText.substring(0, 100000); // Token limit safety

        const prompt = `
        ROLE: Expert ICT (Inner Circle Trader) Technical Writer.
        TASK: Organize the following transcript into a professional Technical Handbook for: "${videoTitle}".

        REQUIREMENTS:
        1. FREQUENCY: For every ~${targetSections}-${targetSections+1} blocks of dialogue in the transcript, you MUST create a new section with its own timestamp.
        2. DO NOT use the "%" symbol or any special characters like "■" for bullet points.
        3. USE ONLY a simple hyphen "-" for list items.
        4. ORGANIZE the text for being readable.
        5. ORGANIZE the text for being readable.
        5. NO HEAVY SUMMARIZATION: Keep the original technical explanations and ICT's specific wording.
        6. STRUCTURE: Break the content into logical sections.
        7. OUTPUT ONLY A RAW JSON ARRAY. NO MARKDOWN, NO EXPLANATION.
        
        JSON SCHEMA:
        [
          { 
            "time": "HH:MM:SS", 
            "title": "SECTION TITLE", 
            "content": "Detailed explanation using original ICT terminology...\\n■ Rule A\\n■ Rule B" 
          }
        ]
        
        TRANSCRIPT: "${safeText}"`;

        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const responseText = await response.text();

            const start = responseText.indexOf('[');
            const end = responseText.lastIndexOf(']') + 1;
            if (start < 0 || end <= start) {
                throw new Error(`AI response did not contain a valid JSON array. Response: ${responseText.slice(0, 1000)}`);
            }

            const rawJson = responseText.substring(start, end);
            const parsed = JSON.parse(rawJson);
            if (!Array.isArray(parsed)) {
                throw new Error(`Parsed AI response is not an array. Parsed: ${JSON.stringify(parsed).slice(0, 1000)}`);
            }

            return parsed;
        } catch (error) {
            console.error("⚠️ AI Parsing Error:", error);
            console.error("🚨 Vui lòng kiểm tra lại GEMINI_API_KEY và quyền truy cập API.");

            return [{
                time: "00:00:00",
                title: `Fallback section for ${videoTitle}`,
                content: fullText.substring(0, 1500).trim() || "No transcript available."
            }];
        }
    }

    async generateCustom(videoName: string, srtName: string) {
        
        const videoPath = path.join(this.rawVideosDir, `${videoName}.mp4`);
        const srtPath = path.join(this.rawVideosDir, `${srtName}.srt`);
        const pdfPath = path.join(this.pdfOutputDir, `${videoName}_Handbook.pdf`);
        const subtitles = srtParser.fromSrt(fs.readFileSync(srtPath, 'utf8'));
        const totalBlocks = subtitles.length; 

        // Áp dụng logic tỉ lệ bạn vừa đưa ra
        let targetSections = 2; // Mặc định cho mức > 500

        // if (totalBlocks < 1000) {
        //     targetSections = 2; // Bạn có thể chỉnh thành 2 hoặc 3 tùy ý
        // } else if (totalBlocks > 1000 && totalBlocks <= 2000) {
        //     targetSections = 3;
        // } else if (totalBlocks > 2000) {
        //     targetSections = 4;
        // }

        if (!fs.existsSync(videoPath) || !fs.existsSync(srtPath)) {
            console.error("❌ Source files missing.");
            return;
        }
        console.log(`📊 Tổng số block: ${totalBlocks} => Chia làm ${targetSections} mục Handbook.`);
        const fullTranscript = subtitles.map(s => `[${s.startTime}] ${s.text}`).join(' ');

        const lessonPlans = await this.planHandbookStructure(fullTranscript, videoName, targetSections);

        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        const stream = fs.createWriteStream(pdfPath);
        doc.pipe(stream);

        // --- Cover Page ---
        doc.rect(0, 0, 612, 792).fill('#0f172a');
        doc.fillColor('#38bdf8').font('Helvetica-Bold').fontSize(24).text("ICT MENTORSHIP CORE CONTENT", 50, 280, { align: 'center' });
        doc.fillColor('#ffffff').fontSize(14).text(videoName.toUpperCase(), { align: 'center' });
        
        const tempScreenshots: string[] = [];

        for (const lesson of lessonPlans) {
            const targetSec = this.timeToSeconds(lesson.time);
            const screenshotName = `sync_${Date.now()}_${targetSec}.jpg`;
            const screenshotPath = path.join(this.screenshotsDir, screenshotName);

            // Capture Frame
            await new Promise((res) => {
                ffmpeg(videoPath)
                    .screenshots({ timestamps: [targetSec], filename: screenshotName, folder: this.screenshotsDir })
                    .on('end', res)
                    .on('error', res);
            });
            tempScreenshots.push(screenshotPath);

            doc.addPage();
            
            // 1. Header Section (Thanh tiêu đề tối màu)
            doc.rect(0, 0, 612, 50).fill('#1e293b');
            doc.fillColor('#38bdf8').font('Helvetica-Bold').fontSize(12).text(lesson.title.toUpperCase(), 50, 20);
            doc.fillColor('#94a3b8').font('Helvetica').fontSize(9).text(`TIMESTAMP: ${lesson.time}`, 480, 22);

            // 2. Image Section (Vẽ ảnh và khung viền riêng biệt)
            let currentY = 75;
            if (fs.existsSync(screenshotPath)) {
                // Vẽ ảnh
                doc.image(screenshotPath, 50, currentY, { width: 512 });
                
                // Vẽ khung viền (Stroke) bao quanh ảnh sau khi vẽ ảnh
                doc.rect(50, currentY, 512, 288) // 288 là chiều cao tỉ lệ 16:9 của width 512
                   .lineWidth(1)
                   .stroke('#334155');
                
                currentY += 310; // Đẩy nội dung chữ xuống dưới ảnh (288 + khoảng cách)
            }

            // 3. Content Section (Nội dung bám sát nguyên văn ICT)
            // Tách nội dung thành các dòng để xử lý bullet point đẹp hơn
            const cleanContent = lesson.content
                .replace(/\\n/g, "\n")
                .replace(/[*#_]/g, "");

            doc.fillColor('#1e293b')
               .font('Helvetica')
               .fontSize(10.5)
               .text(cleanContent, 55, currentY, {
                   width: 500,
                   align: 'justify',
                   lineGap: 6,      // Tăng khoảng cách dòng để dễ đọc
                   paragraphGap: 12 // Tăng khoảng cách giữa các đoạn
               });
        }

        doc.end();

        stream.on('finish', () => {
            // Cleanup all temporary assets
            tempScreenshots.forEach(f => { if(fs.existsSync(f)) fs.unlinkSync(f); });
            
            // Sync: Delete source video and srt
            if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
            if (fs.existsSync(srtPath)) fs.unlinkSync(srtPath);

            console.log(`✅ Handbook Generated & Synced: ${pdfPath}`);
        });
    }

    private timeToSeconds(t: string): number {
        const parts = t.split(':');
        if (parts.length < 3) return 0;
        return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2].split(/[.,]/)[0]);
    }
}