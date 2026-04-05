import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execPromise = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class VideoDownloader {
    private outputDir: string;

    constructor() {
        this.outputDir = path.join(__dirname, '../../data/raw_videos');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * Tải video từ Youtube về máy
     */
    async downloadVideo(url: string, videoId: string): Promise<string> {
        const outputPath = path.join(this.outputDir, `${videoId}.mp4`);
        
        if (fs.existsSync(outputPath)) {
            console.log(`[Downloader] Video đã tồn tại: ${outputPath}`);
            return outputPath;
        }

        console.log(`[Downloader] Đang tải video: ${videoId}... (Vui lòng đợi)`);
        // Đường dẫn tới file cookie bạn vừa tải về
        const cookiePath = "D:/7. ict-scholar-agent/www.youtube.com_cookies.txt";
        const ytDlpPath = `C:/Users/Administrator/scoop/shims/yt-dlp.exe`; 
        const command = `"${ytDlpPath}" --cookies "${cookiePath}" --no-check-certificate -f "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4]/best" "${url}" -o "${outputPath}"`;
        try {
            await execPromise(command);
            console.log(`[Downloader] Tải thành công: ${outputPath}`);
            return outputPath;
        } catch (error) {
            console.error('[Downloader] Lỗi khi tải:', error);
            throw error;
        }
    }
}