import { execSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// ─── Paths ───────────────────────────────────────────────────────────────────
const YT_DLP   = `C:/Users/Administrator/scoop/shims/yt-dlp.exe`;
const COOKIES  = path.resolve(process.cwd(), 'www.youtube.com_cookies.txt');

// ─── Progress file ────────────────────────────────────────────────────────────
export type DownloadProgress = {
    playlistUrl : string;
    playlistId  : string;           // extracted from URL for keying
    totalVideos : number;
    allVideoIds : string[];         // full ordered list from playlist
    completedIds: string[];         // successfully downloaded
    failedIds   : string[];         // tried but errored
    lastUpdated : string;
};

/** Result of a scan for bad / missing video files */
export type BadVideoReport = {
    partFiles   : { file: string; url: string | null }[];   // .mp4.part (incomplete)
    smallFiles  : { file: string; sizeMB: number; url: string | null }[];  // <1 MB = corrupt
    missingInDir: { videoId: string; url: string }[];        // in progress but no .mp4 in dir
};

// ─── Main class ───────────────────────────────────────────────────────────────
export class YoutubeScraper {
    private readonly outputDir    = path.join(process.cwd(), 'data', 'raw_videos');
    private readonly progressDir  = path.join(process.cwd(), 'data', 'stateful');
    private readonly progressFile = path.join(process.cwd(), 'data', 'stateful', 'download-progress.json');

    constructor() {
        fs.mkdirSync(this.outputDir,   { recursive: true });
        fs.mkdirSync(this.progressDir, { recursive: true });
    }

    // ─── Playlist URL → list of video IDs ─────────────────────────────────────
    async getPlaylistUrls(playlistUrl: string): Promise<string[]> {
        console.log('🔍 Đang quét danh sách video trong playlist...');
        const command = `"${YT_DLP}" --get-id --flat-playlist "${playlistUrl}"`;
        const output  = execSync(command).toString().trim();
        return output.split('\n')
            .map(id => id.trim())
            .filter(Boolean)
            .map(id => `https://www.youtube.com/watch?v=${id}`);
    }

    // ─── Get all video IDs (without downloading) ──────────────────────────────
    private getPlaylistIds(playlistUrl: string): string[] {
        console.log('🔍 Đang lấy danh sách video IDs từ playlist...');
        const result = spawnSync(
            YT_DLP,
            ['--get-id', '--flat-playlist', playlistUrl],
            { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
        );
        if (result.error) throw result.error;
        return (result.stdout || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
    }

    // ─── Download playlist with resume ────────────────────────────────────────
    async downloadPlaylist(playlistUrl: string): Promise<void> {
        const playlistId = this.extractPlaylistId(playlistUrl);

        // Load or init progress
        let progress = this.loadProgress(playlistId);
        let needsRefetch = !progress || !progress.allVideoIds.length;

        if (needsRefetch) {
            const ids = this.getPlaylistIds(playlistUrl);
            progress = {
                playlistUrl,
                playlistId,
                totalVideos  : ids.length,
                allVideoIds  : ids,
                completedIds : progress?.completedIds ?? [],
                failedIds    : progress?.failedIds    ?? [],
                lastUpdated  : new Date().toISOString(),
            };
            this.saveProgress(playlistId, progress);
            console.log(`📋 Playlist: ${ids.length} videos tổng cộng`);
        } else {
            console.log(`📋 Resume — ${progress.totalVideos} videos, đã xong: ${progress.completedIds.length}`);
        }

        // Filter pending
        const done    = new Set(progress.completedIds);
        const pending = progress.allVideoIds.filter(id => !done.has(id));

        if (pending.length === 0) {
            console.log('✅ Tất cả video đã được tải!');
            return;
        }

        const startIdx = progress.allVideoIds.indexOf(pending[0]) + 1;
        console.log(`\n▶️  Bắt đầu từ video #${startIdx}/${progress.totalVideos} — còn ${pending.length} video chưa tải\n`);

        for (let i = 0; i < pending.length; i++) {
            const videoId  = pending[i];
            const globalNo = progress.allVideoIds.indexOf(videoId) + 1;
            const url      = `https://www.youtube.com/watch?v=${videoId}`;

            console.log(`\n[${globalNo}/${progress.totalVideos}] Đang tải: ${videoId}`);
            console.log(`   URL: ${url}`);

            const ok = this.downloadSingleVideo(url, videoId);

            if (ok) {
                progress.completedIds.push(videoId);
                // Remove from failed if it was previously failed
                progress.failedIds = progress.failedIds.filter(id => id !== videoId);
            } else {
                if (!progress.failedIds.includes(videoId)) {
                    progress.failedIds.push(videoId);
                }
                console.warn(`   ⚠️  Video ${videoId} thất bại — bỏ qua, tiếp tục...`);
            }

            progress.lastUpdated = new Date().toISOString();
            this.saveProgress(playlistId, progress);
        }

        const stats = this.getProgressStats(progress);
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`✅ Hoàn thành đợt tải này`);
        console.log(`   Tổng: ${stats.total} | Đã xong: ${stats.completed} | Lỗi: ${stats.failed} | Còn lại: ${stats.remaining}`);
        if (stats.failed > 0) {
            console.log(`   ⚠️  ${stats.failed} video thất bại. Chạy lại lệnh để retry.`);
        }
    }

    // ─── Download one video + subtitles ───────────────────────────────────────
    private downloadSingleVideo(url: string, videoId: string): boolean {
        const format  = 'bestvideo[ext=mp4][height<=1080]/bestvideo[height<=720]/best[ext=mp4]/best';
        const outTmpl = path.join(this.outputDir, '%(id)s.%(ext)s');

        // Check if mp4 already exists on disk (earlier partial progress)
        const existingMp4 = path.join(this.outputDir, `${videoId}.mp4`);
        if (fs.existsSync(existingMp4)) {
            const sizeMB = fs.statSync(existingMp4).size / (1024 * 1024);
            if (sizeMB >= 1) {
                console.log(`   ✅ Đã tồn tại trên disk (${sizeMB.toFixed(1)} MB)`);
                return true;
            }
            // Too small — re-download
            fs.unlinkSync(existingMp4);
        }

        const args = [
            '--cookies',          COOKIES,
            '--no-check-certificates',
            '-f',                 format,
            '--no-playlist',
            '--write-auto-sub',
            '--sub-lang',         'en',
            '--sub-format',       'srt',
            '--convert-subs',     'srt',
            '-o',                 outTmpl,
            url,
        ];

        const result = spawnSync(YT_DLP, args, { stdio: 'inherit', encoding: 'utf8' });
        return result.status === 0;
    }

    // ─── Scan bad / incomplete files in outputDir ─────────────────────────────
    scanBadFiles(): BadVideoReport {
        const allFiles    = fs.existsSync(this.outputDir)
            ? fs.readdirSync(this.outputDir)
            : [];
        const allProgress = this.loadAllProgress();

        // Build id→url map from all progress files
        const idToUrl = new Map<string, string>();
        for (const prog of allProgress) {
            for (const id of prog.allVideoIds) {
                idToUrl.set(id, `https://www.youtube.com/watch?v=${id}`);
            }
        }

        const partFiles: BadVideoReport['partFiles']  = [];
        const smallFiles: BadVideoReport['smallFiles'] = [];

        for (const file of allFiles) {
            const full = path.join(this.outputDir, file);
            const stat = fs.statSync(full);

            if (file.endsWith('.part')) {
                const baseId = this.extractVideoIdFromFilename(file.replace('.part', ''));
                partFiles.push({ file, url: baseId ? idToUrl.get(baseId) ?? null : null });
            } else if (file.endsWith('.mp4')) {
                const sizeMB = stat.size / (1024 * 1024);
                if (sizeMB < 1) {
                    const baseId = this.extractVideoIdFromFilename(file);
                    smallFiles.push({ file, sizeMB: Math.round(sizeMB * 100) / 100, url: baseId ? idToUrl.get(baseId) ?? null : null });
                }
            }
        }

        // Missing in dir (in progress.completedIds but no .mp4 on disk)
        const missingInDir: BadVideoReport['missingInDir'] = [];
        for (const prog of allProgress) {
            for (const id of prog.completedIds) {
                const mp4 = path.join(this.outputDir, `${id}.mp4`);
                if (!fs.existsSync(mp4)) {
                    missingInDir.push({ videoId: id, url: `https://www.youtube.com/watch?v=${id}` });
                }
            }
        }

        return { partFiles, smallFiles, missingInDir };
    }

    // ─── Show progress status for a playlist ─────────────────────────────────
    showStatus(playlistUrl?: string): void {
        const allProgress = playlistUrl
            ? [this.loadProgress(this.extractPlaylistId(playlistUrl))].filter(Boolean) as DownloadProgress[]
            : this.loadAllProgress();

        if (allProgress.length === 0) {
            console.log('Chưa có playlist nào được tải. Dùng --playlist <url>.');
            return;
        }

        for (const prog of allProgress) {
            const stats = this.getProgressStats(prog);
            console.log(`\n${'─'.repeat(60)}`);
            console.log(`📺  ${prog.playlistUrl}`);
            console.log(`    Tổng     : ${stats.total} videos`);
            console.log(`    Đã xong  : ${stats.completed} (${stats.pct}%)`);
            console.log(`    Lỗi      : ${stats.failed}`);
            console.log(`    Còn lại  : ${stats.remaining}`);
            console.log(`    Cập nhật : ${prog.lastUpdated.slice(0,16)}`);
        }
    }

    // ─── Retry failed videos ──────────────────────────────────────────────────
    async retryFailed(playlistUrl: string): Promise<void> {
        const playlistId = this.extractPlaylistId(playlistUrl);
        const progress   = this.loadProgress(playlistId);
        if (!progress || progress.failedIds.length === 0) {
            console.log('Không có video nào bị lỗi cần retry.');
            return;
        }
        console.log(`🔄 Retry ${progress.failedIds.length} video thất bại...`);
        // Mark all failed as pending again then run
        progress.failedIds = [];
        this.saveProgress(playlistId, progress);
        await this.downloadPlaylist(playlistUrl);
    }

    // ─── OLD METHOD — kept for backward compat ────────────────────────────────
    async downloadVideoAndSub(url: string): Promise<{ videoId: string; title: string } | null> {
        try {
            const videoId = this.extractVideoId(url);
            console.log(`⏳ Đang tải video: ${videoId}...`);
            const ok = this.downloadSingleVideo(url, videoId);
            if (!ok) return null;
            // Find the mp4
            const mp4 = path.join(this.outputDir, `${videoId}.mp4`);
            if (fs.existsSync(mp4)) {
                return { videoId, title: videoId };
            }
            // Fallback — scan dir for any new mp4
            const files = fs.readdirSync(this.outputDir);
            const f     = files.find(fi => fi.endsWith('.mp4'));
            return f ? { videoId, title: f.replace('.mp4', '') } : null;
        } catch (error: any) {
            console.error('❌ Lỗi tải video:', error.message);
            return null;
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────
    private extractPlaylistId(url: string): string {
        const m = url.match(/[?&]list=([^&]+)/);
        return m ? m[1] : url.replace(/[^a-zA-Z0-9]/g, '_').slice(-40);
    }

    private extractVideoId(url: string): string {
        const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match  = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : 'video_' + Date.now();
    }

    /** Try to extract a YouTube video ID (11 chars) from a filename */
    private extractVideoIdFromFilename(filename: string): string | null {
        // yt-dlp with -o '%(id)s.%(ext)s' names the file directly as the ID
        const base = path.basename(filename).split('.')[0];
        if (/^[a-zA-Z0-9_-]{11}$/.test(base)) return base;
        return null;
    }

    private getProgressStats(p: DownloadProgress) {
        const total     = p.totalVideos;
        const completed = p.completedIds.length;
        const failed    = p.failedIds.length;
        const remaining = Math.max(0, total - completed - failed);   // approximate
        const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { total, completed, failed, remaining, pct };
    }

    private progressKey(playlistId: string): string {
        return path.join(this.progressDir, `dl-progress-${playlistId}.json`);
    }

    private loadProgress(playlistId: string): DownloadProgress | null {
        const file = this.progressKey(playlistId);
        if (!fs.existsSync(file)) return null;
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch { return null; }
    }

    private saveProgress(playlistId: string, progress: DownloadProgress): void {
        fs.writeFileSync(this.progressKey(playlistId), JSON.stringify(progress, null, 2), 'utf8');
    }

    /** Load all dl-progress-*.json files */
    private loadAllProgress(): DownloadProgress[] {
        if (!fs.existsSync(this.progressDir)) return [];
        return fs.readdirSync(this.progressDir)
            .filter(f => f.startsWith('dl-progress-') && f.endsWith('.json'))
            .map(f => {
                try { return JSON.parse(fs.readFileSync(path.join(this.progressDir, f), 'utf8')); }
                catch { return null; }
            })
            .filter(Boolean) as DownloadProgress[];
    }

    private formatTime(seconds: number): string {
        const hours   = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs    = Math.floor(seconds % 60);
        const ms      = Math.floor((seconds % 1) * 1000);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
    }
}