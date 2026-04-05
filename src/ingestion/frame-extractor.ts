import ffmpeg from 'fluent-ffmpeg';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class FrameExtractor {
    private outputDir: string;

    constructor() {
        this.outputDir = path.join(__dirname, '../../data/screenshots');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    /**
     * Chụp ảnh tại một thời điểm cụ thể trong video
     * @param videoPath Đường dẫn file video cục bộ (sau khi tải về bằng yt-dlp)
     * @param timestamp Giây thứ bao nhiêu trong video
     * @param videoId ID của video để đặt tên file
     */
    async takeScreenshot(videoPath: string, timestamp: number, videoId: string): Promise<string> {
        const fileName = `frame_${videoId}_${Math.floor(timestamp)}.jpg`;
        const filePath = path.join(this.outputDir, fileName);

        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .screenshots({
                    timestamps: [timestamp],
                    filename: fileName,
                    folder: this.outputDir,
                    size: '1280x720' // Độ phân giải chuẩn để Gemini nhìn rõ chart
                })
                .on('end', () => {
                    console.log(`[Vision] Đã chụp ảnh tại: ${timestamp}s`);
                    resolve(filePath);
                })
                .on('error', (err) => {
                    console.error('[Vision] Lỗi chụp ảnh:', err);
                    reject(err);
                });
        });
    }
}