import { YoutubeScraper } from './ingestion/youtube-scraper';
import { ICTPdfGenerator } from './processor/pdf-generator';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

async function runICTAgentUI() {
    const generator = new ICTPdfGenerator();
    const scraper = new YoutubeScraper();
    const rawVideosDir = path.join(__dirname, '../data/raw_videos');

    console.log("--- 🤖 ICT AGENT: BẮT ĐẦU QUY TRÌNH ---");

    try {
        // --- BƯỚC 1: KIỂM TRA VÀ XỬ LÝ FILE CÓ SẴN (TRƯỚC KHI TẢI) ---
        const existingFiles = fs.readdirSync(rawVideosDir);
        const existingVideos = existingFiles.filter(f => f.endsWith('.mp4'));

        if (existingVideos.length > 0) {
            console.log(`📦 Tìm thấy ${existingVideos.length} video cũ chưa xử lý. Đang giải quyết...`);
            for (const videoFile of existingVideos) {
                const baseName = videoFile.replace('.mp4', '');
                const srtFile = existingFiles.find(f => f.includes(baseName) && f.endsWith('.srt'));
                
                if (srtFile) {
                    console.log(`🛠️ Đang xử lý file có sẵn: ${baseName}`);
                    await generator.generateCustom(baseName, srtFile.replace('.srt', ''));
                } else {
                    // Nếu có video mà không có srt thì mới xóa để tránh kẹt "Cờ"
                    fs.unlinkSync(path.join(rawVideosDir, videoFile));
                }
            }
            console.log("✅ Đã xử lý xong toàn bộ file tồn đọng.");
        }

        // --- BƯỚC 2: TẢI TIẾP PLAYLIST ---
        const playlistUrls = [
            "https://www.youtube.com/watch?v=7WM8qdkanIY&list=PLVgHx4Z63paah1dHyad1OMJQJdm6iP2Yn",
            "https://www.youtube.com/watch?v=E9F_aT9f038&list=PLVgHx4Z63paaRnabpBl38GoMkxF1FiXCF",
            "https://www.youtube.com/watch?v=Vh0NtdPPj1M&list=PLVgHx4Z63paZ0R9gMaq0y2fM_2vyNJadp",
            "https://www.youtube.com/watch?v=aQrd75xwBS4&list=PLVgHx4Z63paY_zqefCOHItTatr3ptUcAB",
        ];

        for (const playlistUrl of playlistUrls) {
            const videoUrls = await scraper.getPlaylistUrls(playlistUrl);

            for (let i = 0; i < videoUrls.length; i++) {
                // Kiểm tra "Cờ": Nếu file trước đó chưa xong thì đợi
                let isBusy = true;
                while (isBusy) {
                    const currentFiles = fs.readdirSync(rawVideosDir);
                    if (!currentFiles.some(f => f.endsWith('.mp4'))) {
                        isBusy = false;
                    } else {
                        console.log("⏳ Đang đợi PDF trước đó hoàn tất...");
                        await new Promise(res => setTimeout(res, 5000));
                    }
                }

                console.log(`\n📥 Đang tải video mới: ${i + 1}/${videoUrls.length}`);
                const downloadResult = await scraper.downloadVideoAndSub(videoUrls[i]);

                if (downloadResult) {
                    const { title } = downloadResult;
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    const files = fs.readdirSync(rawVideosDir);
                    const searchPattern = title.toLowerCase().replace(/[\s-]/g, '');
                    const actualVideoFile = files.find(f => f.toLowerCase().replace(/[\s-]/g, '').includes(searchPattern) && f.endsWith('.mp4'));

                    if (actualVideoFile) {
                        const baseName = actualVideoFile.replace('.mp4', '');
                        const srtFile = files.find(f => f.toLowerCase().replace(/[\s-]/g, '').includes(searchPattern) && f.endsWith('.srt'));
                        if (srtFile) {
                            await generator.generateCustom(baseName, srtFile.replace('.srt', ''));
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error("❌ LỖI:", error);
    }
}

runICTAgentUI();