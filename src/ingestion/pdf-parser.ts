import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';
import { Logger } from '../utils/logger';

export type ParsedPdfDocument = {
	source: string;
	text: string;
};

export class PdfParser {
	async parsePdf(pdfPath: string): Promise<ParsedPdfDocument> {
		const buffer = fs.readFileSync(pdfPath);
		const parsed = await pdf(buffer);

		return {
			source: path.basename(pdfPath),
			text: (parsed.text || '').replace(/\s+/g, ' ').trim(),
		};
	}

	async parseDirectory(pdfDir: string): Promise<ParsedPdfDocument[]> {
		if (!fs.existsSync(pdfDir)) {
			return [];
		}

		const files = fs
			.readdirSync(pdfDir)
			.filter(file => file.toLowerCase().endsWith('.pdf'));

		const docs: ParsedPdfDocument[] = [];
		for (const file of files) {
			const fullPath = path.join(pdfDir, file);
			try {
				const doc = await this.parsePdf(fullPath);
				if (doc.text.length > 0) {
					docs.push(doc);
				}
			} catch (error) {
				Logger.warn(`Bỏ qua PDF lỗi: ${file}`, error);
			}
		}

		return docs;
	}
}
