import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export class YoutubeScraper {
    private readonly outputDir = path.join(process.cwd(), 'data', 'raw_videos');

    constructor() {
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    // Hàm lấy danh sách tất cả URL trong playlist
    async getPlaylistUrls(playlistUrl: string): Promise<string[]> {
        console.log("🔍 Đang quét danh sách video trong playlist...");
        const ytDlpPath = path.resolve(process.cwd(), 'node_modules/youtube-dl-exec/bin/yt-dlp.exe');
        const command = `"${ytDlpPath}" --get-id --flat-playlist "${playlistUrl}"`;
        const output = execSync(command).toString().trim();
        return output.split('\n').map(id => `https://www.youtube.com/watch?v=${id}`);
    }

    async downloadVideoAndSub(url: string): Promise<{ videoId: string; title: string } | null> {
        try {
            const videoId = this.extractVideoId(url);
            const ytDlpPath = path.resolve(process.cwd(), 'node_modules/youtube-dl-exec/bin/yt-dlp.exe');
            
            console.log(`⏳ Đang tải video: ${videoId}...`);
            
            const format = "bestvideo[ext=mp4][height<=1080]/bestvideo[height<=720]/best";

            const command = `"${ytDlpPath}" "${url}" -f "${format}" --no-playlist --write-auto-sub --sub-format srt --no-check-certificates --output "${this.outputDir}\\%(title)s.%(ext)s"`;

            execSync(command, { stdio: 'inherit' });

            const files = fs.readdirSync(this.outputDir);
            const downloadedFile = files.find(f => f.endsWith('.mp4'));

            if (downloadedFile) {
                const cleanTitle = downloadedFile.replace('.mp4', '');
                return { videoId, title: cleanTitle };
            }
            return null;
        } catch (error: any) {
            console.error("❌ Lỗi tải video:", error.message);
            return null;
        }
    }

    private extractVideoId(url: string): string {
        const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : "video_" + Date.now();
    }
}