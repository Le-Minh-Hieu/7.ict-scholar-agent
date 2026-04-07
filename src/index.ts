import { YoutubeScraper } from './ingestion/youtube-scraper.js';
import { ICTPdfGenerator } from './processor/pdf-generator.js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
dotenv.config();

function getArg(flag: string): string | undefined {
    const idx = process.argv.indexOf(flag);
    return idx !== -1 ? process.argv[idx + 1] : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI MODE: npm run download -- [flags]
//   --playlist <url>          Tải playlist, tự resume nếu đã tải dang dở
//   --playlist <url> --retry  Retry những video bị lỗi
//   --status                  Xem tiến độ tất cả playlist
//   --status --playlist <url> Xem tiến độ playlist cụ thể
//   --scan                    Liệt kê file bị lỗi / tải dở
// ─────────────────────────────────────────────────────────────────────────────
async function runCLI(): Promise<boolean> {
    const playlist = getArg('--playlist');
    const doScan   = process.argv.includes('--scan');
    const doStatus = process.argv.includes('--status');
    const doRetry  = process.argv.includes('--retry');
    const hasFlag  = playlist || doScan || doStatus;

    if (!hasFlag) return false;   // không có flag → chạy pipeline bình thường

    const scraper = new YoutubeScraper();

    // -- scan --
    if (doScan) {
        console.log('\n🔎 Đang quét file bị lỗi / thiếu trong data/raw_videos...\n');
        const report  = scraper.scanBadFiles();
        let hasIssues = false;

        if (report.partFiles.length > 0) {
            hasIssues = true;
            console.log(`⚠️  ${report.partFiles.length} file TẢI DỞ (.part):`);
            for (const f of report.partFiles) {
                console.log(`   📁 ${f.file}`);
                if (f.url) console.log(`      🔗 ${f.url}`);
            }
        }
        if (report.smallFiles.length > 0) {
            hasIssues = true;
            console.log(`\n⚠️  ${report.smallFiles.length} file QUÁ NHỎ (<1 MB, có thể hỏng):`);
            for (const f of report.smallFiles) {
                console.log(`   📁 ${f.file}  (${f.sizeMB} MB)`);
                if (f.url) console.log(`      🔗 ${f.url}`);
            }
        }
        if (report.missingInDir.length > 0) {
            hasIssues = true;
            console.log(`\n⚠️  ${report.missingInDir.length} video ĐÃ ĐÁNH DẤU XONG nhưng KHÔNG CÓ FILE .mp4:`);
            for (const m of report.missingInDir) {
                console.log(`   🆔 ${m.videoId}`);
                console.log(`      🔗 ${m.url}`);
            }
        }
        if (!hasIssues) {
            console.log('✅ Không tìm thấy file nào bị lỗi!');
        } else {
            const total = report.partFiles.length + report.smallFiles.length + report.missingInDir.length;
            console.log(`\n📋 Tổng: ${total} vấn đề tìm thấy.`);
            console.log('   → Chạy lại lệnh --playlist để tải lại các video bị lỗi.');
        }
        return true;
    }

    // -- status --
    if (doStatus) {
        scraper.showStatus(playlist);
        return true;
    }

    // -- retry --
    if (playlist && doRetry) {
        await scraper.retryFailed(playlist);
        return true;
    }

    // -- download playlist (resume) --
    if (playlist) {
        await scraper.downloadPlaylist(playlist);
        return true;
    }

    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE MODE (không có flag): tải + generate PDF như cũ
// ─────────────────────────────────────────────────────────────────────────────
async function runPipeline(): Promise<void> {
    const generator   = new ICTPdfGenerator();
    const scraper     = new YoutubeScraper();
    const rawVideosDir = path.join(__dirname, '../data/raw_videos');

    console.log('--- 🤖 ICT AGENT: BẮT ĐẦU QUY TRÌNH ---');

    try {
        // BƯỚC 1: Xử lý file tồn đọng
        const existingFiles  = fs.readdirSync(rawVideosDir);
        const existingVideos = existingFiles.filter(f => f.endsWith('.mp4'));

        if (existingVideos.length > 0) {
            console.log(`📦 Tìm thấy ${existingVideos.length} video cũ chưa xử lý. Đang giải quyết...`);
            for (const videoFile of existingVideos) {
                const baseName = videoFile.replace('.mp4', '');
                const srtFile  = existingFiles.find(f => f.includes(baseName) && f.endsWith('.srt'));
                if (srtFile) {
                    console.log(`🛠️ Đang xử lý file có sẵn: ${baseName}`);
                    await generator.generateCustom(baseName, srtFile.replace('.srt', ''));
                } else {
                    fs.unlinkSync(path.join(rawVideosDir, videoFile));
                }
            }
            console.log('✅ Đã xử lý xong toàn bộ file tồn đọng.');
        }

        // BƯỚC 2: Tải tiếp playlist
        const playlistUrls = [
            'https://www.youtube.com/watch?v=XN8tuO4QIRw&list=PLVgHx4Z63pabpjlduWBaEsn8VMtALhjGV&pp=0gcJCbkEOCosWNin',
        ];

        for (const playlistUrl of playlistUrls) {
            const videoUrls = await scraper.getPlaylistUrls(playlistUrl);

            for (let i = 0; i < videoUrls.length; i++) {
                // Đợi PDF trước đó hoàn tất trước khi tải tiếp
                let isBusy = true;
                while (isBusy) {
                    const currentFiles = fs.readdirSync(rawVideosDir);
                    if (!currentFiles.some(f => f.endsWith('.mp4'))) {
                        isBusy = false;
                    } else {
                        console.log('⏳ Đang đợi PDF trước đó hoàn tất...');
                        await new Promise(res => setTimeout(res, 5000));
                    }
                }

                console.log(`\n📥 Đang tải video mới: ${i + 1}/${videoUrls.length}`);
                const downloadResult = await scraper.downloadVideoAndSub(videoUrls[i]);

                if (downloadResult) {
                    const { title } = downloadResult;
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    const files         = fs.readdirSync(rawVideosDir);
                    const searchPattern = title.toLowerCase().replace(/[\s-]/g, '');
                    const actualVideoFile = files.find(
                        f => f.toLowerCase().replace(/[\s-]/g, '').includes(searchPattern) && f.endsWith('.mp4')
                    );

                    if (actualVideoFile) {
                        const baseName = actualVideoFile.replace('.mp4', '');
                        const srtFile  = files.find(
                            f => f.toLowerCase().replace(/[\s-]/g, '').includes(searchPattern) && f.endsWith('.srt')
                        );
                        if (srtFile) {
                            await generator.generateCustom(baseName, srtFile.replace('.srt', ''));
                        } else {
                            console.warn(`⚠️ Không tìm thấy SRT cho "${baseName}", bỏ qua và xóa video.`);
                            fs.unlinkSync(path.join(rawVideosDir, actualVideoFile));
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ LỖI:', error);
    }
}

async function main() {
    const handled = await runCLI();
    if (!handled) await runPipeline();
}

main();