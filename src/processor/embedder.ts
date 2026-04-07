import dotenv from 'dotenv';
dotenv.config();

/**
 * Embedder using Google Gemini gemini-embedding-001 (3072-dim, semantic).
 *
 * Model available on v1beta: models/gemini-embedding-001
 * Fallback: gemini-embedding-2-preview (if needed)
 *
 * Rate-limit strategy (free tier: 1500 RPM):
 *   PARALLEL_SIZE = 10 concurrent calls
 *   BATCH_DELAY_MS = 500ms between batches  → ~1200 RPM
 *   4000 chunks ≈ 400 batches × 500ms ≈ 3.5 min rebuild
 */

const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_URL   = (key: string) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${key}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EmbedResponse = { embedding: { values: number[] } };

export class Embedder {
	private readonly apiKey: string;
	private static readonly PARALLEL_SIZE  = 1;    // sequential – eliminates concurrent 503 bursts
	private static readonly BATCH_DELAY_MS = 800;  // 800 ms between calls → ~75 RPM

	constructor() {
		this.apiKey = process.env.GEMINI_API_KEY ?? '';
		if (!this.apiKey) throw new Error('GEMINI_API_KEY is required for Gemini embeddings.');
	}

	/** Embed a single text → semantic vector via v1beta REST */
	async embedText(text: string): Promise<number[]> {
		const res = await fetch(EMBED_URL(this.apiKey), {
			method:  'POST',
			headers: { 'Content-Type': 'application/json' },
			body:    JSON.stringify({
				content: { parts: [{ text: text.slice(0, 2048) }] },
			}),
		});
		if (!res.ok) {
			const body = await res.text();
			throw new Error(`Embed API error ${res.status}: ${body}`);
		}
		const data = await res.json() as EmbedResponse;
		return data.embedding.values;
	}

	/**
	 * Embed with exponential-backoff retry for transient 503/429/500 errors.
	 * 503 (service overload) → starts at 10 s.
	 * 429 (rate limit)       → starts at 15 s.
	 * Others                 → starts at 2 s.
	 * Max 7 attempts, cap at 60 s.
	 */
	async embedTextWithRetry(text: string, maxRetries = 7): Promise<number[]> {
		let attempt = 0;
		while (true) {
			try {
				return await this.embedText(text);
			} catch (err: unknown) {
				const msg = String(err);
				const is503  = /503|UNAVAILABLE/.test(msg);
				const is429  = /429|RESOURCE_EXHAUSTED|quota/i.test(msg);
				const is5xx  = /500/.test(msg);
				const isRetryable = is503 || is429 || is5xx;

				if (!isRetryable || attempt >= maxRetries) throw err;

				const baseMs = is429 ? 15_000 : is503 ? 3_000 : 2_000;
				const delayMs = Math.min(baseMs * Math.pow(2, attempt), 60_000);
				attempt++;
				process.stdout.write(
					`\n  ⚠️ ${msg.slice(0, 60)} — retry ${attempt}/${maxRetries} in ${delayMs / 1000}s...`
				);
				await new Promise(r => setTimeout(r, delayMs));
			}
		}
	}

	/**
	 * Embed many texts with parallel micro-batches + rate-limit guard.
	 * Uses retry-aware embedTextWithRetry for each call.
	 * Shows live progress counter during long index builds.
	 */
	async embedBatch(texts: string[], startOffset = 0, total?: number): Promise<number[][]> {
		const { PARALLEL_SIZE, BATCH_DELAY_MS } = Embedder;
		const grandTotal = total ?? (startOffset + texts.length);
		const results: number[][] = new Array(texts.length);

		for (let i = 0; i < texts.length; i += PARALLEL_SIZE) {
			const slice = texts.slice(i, i + PARALLEL_SIZE);

			const batchResults = await Promise.all(slice.map(t => this.embedTextWithRetry(t)));
			for (let j = 0; j < batchResults.length; j++) {
				results[i + j] = batchResults[j];
			}

			const done = startOffset + Math.min(i + PARALLEL_SIZE, texts.length);
			process.stdout.write(`\r  ↳ Embedded ${done}/${grandTotal} chunks...`);

			if (i + PARALLEL_SIZE < texts.length) {
				await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
			}
		}

		process.stdout.write('\n');
		return results;
	}
}
