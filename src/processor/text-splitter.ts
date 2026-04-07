import { ParsedPdfDocument } from '../ingestion/pdf-parser';

export type TextChunk = {
	id: string;
	source: string;
	text: string;
	chunkIndex: number;
};

export class TextSplitter {
	constructor(
		private readonly chunkSize: number = 1200,
		private readonly chunkOverlap: number = 200,
	) {}

	splitDocuments(docs: ParsedPdfDocument[]): TextChunk[] {
		const chunks: TextChunk[] = [];

		for (const doc of docs) {
			const text = doc.text;
			if (!text) {
				continue;
			}

			let start = 0;
			let chunkIndex = 0;

			while (start < text.length) {
				const end = Math.min(start + this.chunkSize, text.length);
				const content = text.slice(start, end).trim();

				if (content.length > 0) {
					chunks.push({
						id: `${doc.source}::${chunkIndex}`,
						source: doc.source,
						text: content,
						chunkIndex,
					});
					chunkIndex += 1;
				}

				if (end >= text.length) {
					break;
				}

				start = Math.max(end - this.chunkOverlap, start + 1);
			}
		}

		return chunks;
	}
}
