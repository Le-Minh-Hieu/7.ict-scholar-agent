import PDFDocument from 'pdfkit';

import fs from 'fs';

import path from 'path';

import { fileURLToPath } from 'url';

import ffmpeg from 'fluent-ffmpeg';

import SrtParser from 'srt-parser-2';



const srtParser = new SrtParser();

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);



ffmpeg.setFfmpegPath('C:/Users/Administrator/scoop/shims/ffmpeg.exe');



export class ICTPdfGenerator {

    private readonly rawVideosDir = path.join(__dirname, '../../data/raw_videos');

    private readonly pdfOutputDir = path.join(__dirname, '../../data/pdfs');

    private readonly screenshotsDir = path.join(__dirname, '../../data/screenshots');



    constructor() {

        if (!fs.existsSync(this.pdfOutputDir)) fs.mkdirSync(this.pdfOutputDir, { recursive: true });

        if (!fs.existsSync(this.screenshotsDir)) fs.mkdirSync(this.screenshotsDir, { recursive: true });

    }



    async generateCustom(videoName: string, srtName: string) {

        const videoPath = path.join(this.rawVideosDir, `${videoName}.mp4`);

        const srtPath = path.join(this.rawVideosDir, `${srtName}.srt`);

        const safeFileName = videoName.substring(0, 50).replace(/[\\/:*?"<>|]/g, '_');

        const pdfPath = path.join(this.pdfOutputDir, `${safeFileName}_HandBook.pdf`);



        if (!fs.existsSync(videoPath) || !fs.existsSync(srtPath)) {

            console.error(`❌ Không tìm thấy file tại raw_videos!`);

            return;

        }



        const subtitles = srtParser.fromSrt(fs.readFileSync(srtPath, 'utf8'));

        const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });

        const stream = fs.createWriteStream(pdfPath);

        doc.pipe(stream);



        let lastSize = 0;

        console.log(`🚀 Deep Scan: Đang bắt từng chuyển cảnh cho ${videoName}...`);



        // Quét dày (i += 4) để đảm bảo không trượt Slide văn bản nào

        for (let i = 0; i < subtitles.length; i += 4) {

            const sub = subtitles[i];

            const timestamp = this.timeToSeconds(sub.startTime);

            const screenshotName = `frame_${i}.jpg`;

            const screenshotPath = path.join(this.screenshotsDir, screenshotName);



            // 1. Chụp khung hình

            await new Promise((resolve) => {

                ffmpeg(videoPath)

                    .screenshots({

                        timestamps: [timestamp],

                        filename: screenshotName,

                        folder: this.screenshotsDir,

                        size: '1280x720'

                    })

                    .on('end', resolve)

                    .on('error', resolve);

            });



            const segmentText = subtitles.slice(i, i + 4).map((s: any) => s.text).join(" ").replace(/\s+/g, ' ');

            const currentSize = fs.existsSync(screenshotPath) ? fs.statSync(screenshotPath).size : 0;



            // 2. SO SÁNH NHẠY BÉN (Threshold 1500 byte (~1.5KB))

            // Chỉ cần ICT di chuyển chuột hoặc đổi Slide chữ, size ảnh sẽ lệch ngay

            const isDifferent = Math.abs(currentSize - lastSize) > 1500;



            if (i === 0 || isDifferent) {

                doc.addPage();

               

                // Vẽ Header Timestamp

                doc.fillColor('#f0f0f0').rect(50, 40, 495, 20).fill();

                doc.fillColor('#0047ab').font('Helvetica-Bold').fontSize(10).text(`TIMEMARK: ${sub.startTime}`, 60, 47);



                if (fs.existsSync(screenshotPath)) {

                    doc.image(screenshotPath, 50, 70, { width: 495 });

                }



                doc.y = 360; // Đặt text dưới ảnh (ảnh 16:9 chiếm khoảng 280px chiều cao)

                doc.fillColor('#333333').font('Helvetica').fontSize(10).text(segmentText, {

                    width: 495, align: 'justify', lineGap: 2

                });



                lastSize = currentSize;

            } else {

                // Nếu là slide cũ, nối text vào dưới

                if (doc.y > 750) {

                    doc.addPage();

                    doc.y = 50;

                }

                doc.moveDown(1);

                doc.fillColor('#666666').font('Helvetica-Oblique').fontSize(9).text(`[Cont.]: ${segmentText}`, {

                    width: 495, align: 'justify'

                });

            }



            if (i % 40 === 0) console.log(`Tiến độ: Đã xử lý đến ${sub.startTime}`);

        }



        doc.end();

        return new Promise((res) => {

            stream.on('finish', () => {

                console.log(`✅ Xuất thành công: ${pdfPath}`);

                res(true);

            });

        });

    }



    private timeToSeconds(t: string): number {

        const a = t.split(':');

        const secondsPart = a[2].includes(',') ? a[2].split(',')[0] : a[2].split('.')[0];

        return (+a[0]) * 3600 + (+a[1]) * 60 + (+secondsPart);

    }

}