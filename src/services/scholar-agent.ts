import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PdfParser } from '../ingestion/pdf-parser';
import { TextChunk, TextSplitter } from '../processor/text-splitter';
import { Embedder } from '../processor/embedder';
import { StorageService } from './storage-service';
import { Logger } from '../utils/logger';

dotenv.config();

type IndexedChunk = TextChunk & {
	embedding: number[];
};

type KnowledgeIndex = {
	version: string;
	updatedAt: string;
	chunks: IndexedChunk[];
};

type SessionTurn = {
	role: 'user' | 'assistant';
	content: string;
	createdAt: string;
};

type SessionMemory = {
	sessionId: string;
	turns: SessionTurn[];
};

export class ScholarAgent {
	private readonly pdfParser = new PdfParser();
	private readonly splitter = new TextSplitter();
	private readonly embedder = new Embedder();
	private readonly storage: StorageService;
	private readonly model: any;

	private readonly pdfDir: string;
	private readonly indexPath = 'knowledge-index.json';

	/** In-memory cache — loaded once per process, never re-read from disk */
	private cachedIndex: KnowledgeIndex | null = null;

	constructor() {
		const apiKey = process.env.GEMINI_API_KEY || '';
		if (!apiKey) {
			throw new Error('GEMINI_API_KEY is required.');
		}

		const genAI = new GoogleGenerativeAI(apiKey);
		this.model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

		const rootDataDir = path.join(process.cwd(), 'data');
		this.pdfDir = path.join(rootDataDir, 'pdfs');
		const statefulDir = path.join(rootDataDir, 'stateful');
		this.storage = new StorageService(statefulDir);
	}

	async buildKnowledgeBase(): Promise<void> {
		// ── 1. Parse PDFs ──────────────────────────────────────────────────────
		Logger.info('Bắt đầu parse PDF nội bộ...');
		const docs = await this.pdfParser.parseDirectory(this.pdfDir);
		if (docs.length === 0) throw new Error(`Không tìm thấy PDF trong: ${this.pdfDir}`);

		Logger.info(`Đã đọc ${docs.length} file PDF, bắt đầu tách chunk...`);
		const chunks = this.splitter.splitDocuments(docs);
		if (chunks.length === 0) throw new Error('Không tạo được chunk nào từ PDF.');

		// ── 2. Settings ────────────────────────────────────────────────────────
		const GEMINI_DIM       = 3072;
		const CHECKPOINT_EVERY = 50;
		const DELAY_MS         = 800;
		const TMP_PATH         = 'knowledge-index-tmp.json'; // new chunks only (small)

		// ── 3. Resume: load completed keys only (no float arrays in RAM) ───────
		const completedKeys = this.loadCompletedKeys(GEMINI_DIM);

		// Also load any previously-saved new chunks from tmp file
		const tmpExisting = this.storage.readJson<{ chunks: IndexedChunk[] }>(TMP_PATH);
		const newChunks: IndexedChunk[] = tmpExisting?.chunks ?? [];
		for (const c of newChunks) {
			completedKeys.add(`${c.source}::${c.chunkIndex}`);
		}

		const pending = chunks.filter(c => !completedKeys.has(`${c.source}::${c.chunkIndex}`));
		const alreadyDone = chunks.length - pending.length;

		if (pending.length === 0) {
			Logger.info('Tất cả chunks đã được embed. Chạy merge cuối...');
		} else {
			if (alreadyDone > 0) Logger.info(`Resume: found ${alreadyDone}/${chunks.length} chunks already embedded.`);
			Logger.info(`Đang tạo embeddings cho ${pending.length} chunks... (${alreadyDone} resumed)`);
		}

		// ── 4. Embed pending chunks, save new ones to tmp file ─────────────────
		for (let i = 0; i < pending.length; i++) {
			const c = pending[i];

			let vector: number[];
			try {
				vector = await this.embedder.embedTextWithRetry(c.text);
			} catch (err: unknown) {
				// Save progress and exit cleanly – next run will resume from tmp
				process.stdout.write(`\n  ❌ ${String(err).slice(0, 80)}\n`);
				process.stdout.write(`  💾 Saved ${newChunks.length} new chunks to tmp. Re-run to continue.\n`);
				this.storage.saveJson(TMP_PATH, { chunks: newChunks });
				throw err;
			}

			newChunks.push({ ...c, embedding: vector });
			completedKeys.add(`${c.source}::${c.chunkIndex}`);

			const totalDone = alreadyDone + i + 1;
			process.stdout.write(`\r  ↳ Embedded ${totalDone}/${chunks.length} chunks...`);

			// Checkpoint: persist new chunks so far
			if ((i + 1) % CHECKPOINT_EVERY === 0) {
				this.storage.saveJson(TMP_PATH, { chunks: newChunks });
			}

			if (i < pending.length - 1) {
				await new Promise(r => setTimeout(r, DELAY_MS));
			}
		}

		process.stdout.write('\n');

		// ── 5. Final merge: old index + new chunks → knowledge-index.json ──────
		Logger.info(`Đang merge ${newChunks.length} chunks mới vào index...`);
		const existing = this.storage.readJson<KnowledgeIndex>(this.indexPath);
		const merged: IndexedChunk[] = [];

		// Keep old valid chunks that are still in current chunk list
		const currentKeys = new Set(chunks.map(c => `${c.source}::${c.chunkIndex}`));
		if (existing?.chunks?.length) {
			for (const c of existing.chunks) {
				const key = `${c.source}::${c.chunkIndex}`;
				if (c.embedding?.length === GEMINI_DIM && currentKeys.has(key)) {
					const newDuplicate = newChunks.find(n => `${n.source}::${n.chunkIndex}` === key);
					if (!newDuplicate) merged.push(c);
				}
			}
		}
		merged.push(...newChunks);

		this.storage.saveJson(this.indexPath, {
			version:   '1.0.0',
			updatedAt: new Date().toISOString(),
			chunks:    merged,
		} as KnowledgeIndex);

		// Clean up tmp file
		try {
			const fs = await import('fs');
			const tmpFull = path.join(process.cwd(), 'data', 'stateful', TMP_PATH);
			if (fs.existsSync(tmpFull)) fs.unlinkSync(tmpFull);
		} catch { /* ignore */ }

		this.cachedIndex = null; // invalidate cache so next query re-reads fresh index
		Logger.info('✅ Đã build knowledge index xong.', {
			output: path.join(process.cwd(), 'data', 'stateful', this.indexPath),
			chunks: merged.length,
		});
	}

	/**
	 * Load (and cache) the knowledge index. Reads from disk only once per process.
	 */
	private ensureIndex(): KnowledgeIndex {
		if (!this.cachedIndex) {
			Logger.info('Đang load knowledge index vào bộ nhớ...');
			const loaded = this.storage.readJson<KnowledgeIndex>(this.indexPath);
			if (!loaded || loaded.chunks.length === 0) {
				throw new Error('Knowledge index chưa có. Hãy chạy build trước.');
			}
			this.cachedIndex = loaded;
			Logger.info(`✅ Knowledge index loaded: ${loaded.chunks.length} chunks`);
		}
		return this.cachedIndex;
	}

	/**
	 * Returns raw PDF text chunks most similar to the query — NO Gemini call.
	 * Use this when you want to strictly source output from internal PDFs only.
	 */
	async retrieveRawChunks(query: string, topK: number = 8): Promise<{ text: string; source: string; chunkIndex: number; score: number }[]> {
		const knowledgeIndex = this.ensureIndex();
		if (!knowledgeIndex || knowledgeIndex.chunks.length === 0) {
			throw new Error('Knowledge index chưa có. Hãy chạy build trước.');
		}

		const queryEmbedding = await this.embedder.embedText(query);
		return knowledgeIndex.chunks
			.map(chunk => ({
				text: chunk.text,
				source: chunk.source,
				chunkIndex: chunk.chunkIndex,
				score: this.cosineSimilarity(queryEmbedding, chunk.embedding),
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);
	}

	/**
	 * Diverse retrieval: fetch `poolSize` candidates by cosine similarity, then
	 * enforce max `maxPerSource` chunks per PDF source before returning `topK`.
	 * This prevents a handful of "generalist" PDFs from dominating every query.
	 *
	 * @param alreadyUsedSources  Optional set of PDF sources used in prior calls
	 *                            — chunks from these sources are deprioritised but
	 *                            not excluded (fallback when no fresh sources left).
	 */
	async retrieveDiverseChunks(
		query:              string,
		topK:               number   = 3,
		maxPerSource:       number   = 1,
		poolSize:           number   = 30,
		alreadyUsedSources: Set<string> = new Set(),
	): Promise<{ text: string; source: string; chunkIndex: number; score: number }[]> {
		const knowledgeIndex = this.ensureIndex();
		if (!knowledgeIndex || knowledgeIndex.chunks.length === 0) {
			throw new Error('Knowledge index chưa có. Hãy chạy build trước.');
		}

		const queryEmbedding = await this.embedder.embedText(query);

		// Step 1: score all chunks, take top pool
		const pool = knowledgeIndex.chunks
			.map(chunk => ({
				text:       chunk.text,
				source:     chunk.source,
				chunkIndex: chunk.chunkIndex,
				score:      this.cosineSimilarity(queryEmbedding, chunk.embedding),
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, poolSize);

		// Step 2: two-pass source-capped selection
		//   Pass A: prefer sources NOT previously used (fresh sources first)
		//   Pass B: fall back to already-used sources to fill remaining slots
		const sourceCount = new Map<string, number>();
		const selected: typeof pool = [];

		const tryAdd = (chunk: typeof pool[0]): boolean => {
			const n = sourceCount.get(chunk.source) ?? 0;
			if (n < maxPerSource) {
				selected.push(chunk);
				sourceCount.set(chunk.source, n + 1);
				return true;
			}
			return false;
		};

		// Pass A — fresh sources only
		for (const chunk of pool) {
			if (selected.length >= topK) break;
			if (!alreadyUsedSources.has(chunk.source)) tryAdd(chunk);
		}

		// Pass B — fill remaining with already-used sources (still source-capped)
		if (selected.length < topK) {
			for (const chunk of pool) {
				if (selected.length >= topK) break;
				if (alreadyUsedSources.has(chunk.source)) tryAdd(chunk);
			}
		}

		return selected;
	}

	async ask(question: string, sessionId: string = 'default', topK: number = 6): Promise<{ answer: string; sources: string[] }> {
		const knowledgeIndex = this.ensureIndex();
		if (!knowledgeIndex || knowledgeIndex.chunks.length === 0) {
			throw new Error('Knowledge index chưa có. Hãy chạy build trước.');
		}

		const queryEmbedding = await this.embedder.embedText(question);
		const ranked = knowledgeIndex.chunks
			.map(chunk => ({
				chunk,
				score: this.cosineSimilarity(queryEmbedding, chunk.embedding),
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);

		const session = this.loadSession(sessionId);
		const memoryContext = session.turns
			.slice(-6)
			.map(turn => `${turn.role.toUpperCase()}: ${turn.content}`)
			.join('\n');

		const context = ranked
			.map(item => `[SOURCE: ${item.chunk.source} | CHUNK: ${item.chunk.chunkIndex}]\n${item.chunk.text}`)
			.join('\n\n');

		const prompt = [
			'Bạn là ICT Scholar Agent.',
			'CHỈ ĐƯỢC phép trả lời dựa trên INTERNAL DATA được cung cấp trong phần CONTEXT.',
			'Nếu context không đủ, hãy nói rõ thiếu dữ liệu nào và không suy diễn từ internet.',
			'Trả lời ngắn gọn, có cấu trúc và theo tư duy ICT trader chuyên nghiệp.',
			'',
			memoryContext ? `SESSION MEMORY:\n${memoryContext}` : 'SESSION MEMORY: (empty)',
			'',
			`QUESTION:\n${question}`,
			'',
			`CONTEXT:\n${context}`,
		].join('\n');

		const result = await this.model.generateContent(prompt);
		const response = await result.response;
		const answer = (await response.text()).trim();

		const now = new Date().toISOString();
		session.turns.push({ role: 'user', content: question, createdAt: now });
		session.turns.push({ role: 'assistant', content: answer, createdAt: now });
		this.saveSession(session);

		const sources = Array.from(new Set(ranked.map(item => item.chunk.source)));
		return { answer, sources };
	}

	private loadSession(sessionId: string): SessionMemory {
		const sessionPath = `sessions/${sessionId}.json`;
		const existing = this.storage.readJson<SessionMemory>(sessionPath);
		if (existing) {
			return existing;
		}
		return {
			sessionId,
			turns: [],
		};
	}

	private saveSession(session: SessionMemory): void {
		const sessionPath = `sessions/${session.sessionId}.json`;
		this.storage.saveJson(sessionPath, session);
	}

	/**
	 * Load only the key strings from the knowledge index (no float arrays held in RAM).
	 * Nulls out embedding after extracting keys so GC can reclaim the memory.
	 */
	private loadCompletedKeys(dim: number): Set<string> {
		const keys = new Set<string>();
		try {
			const existing = this.storage.readJson<KnowledgeIndex>(this.indexPath);
			if (existing?.chunks?.length) {
				for (const c of existing.chunks) {
					if (c.embedding?.length === dim) {
						keys.add(`${c.source}::${c.chunkIndex}`);
					}
					// Discard float array immediately so GC can reclaim RAM
					(c as Record<string, unknown>).embedding = null;
				}
			}
		} catch { /* no existing index → empty set */ }
		return keys;
	}

	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length || a.length === 0) {
			return -1;
		}

		let dot = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		const denominator = Math.sqrt(normA) * Math.sqrt(normB);
		if (denominator === 0) {
			return -1;
		}
		return dot / denominator;
	}
}
