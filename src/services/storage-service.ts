import fs from 'fs';
import path from 'path';

export class StorageService {
	constructor(private readonly rootDir: string) {
		if (!fs.existsSync(this.rootDir)) {
			fs.mkdirSync(this.rootDir, { recursive: true });
		}
	}

	private resolvePath(relativePath: string): string {
		const absolutePath = path.join(this.rootDir, relativePath);
		const parentDir = path.dirname(absolutePath);
		if (!fs.existsSync(parentDir)) {
			fs.mkdirSync(parentDir, { recursive: true });
		}
		return absolutePath;
	}

	saveJson<T>(relativePath: string, data: T): void {
		const filePath = this.resolvePath(relativePath);
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
	}

	readJson<T>(relativePath: string): T | null {
		const filePath = this.resolvePath(relativePath);
		if (!fs.existsSync(filePath)) {
			return null;
		}

		const raw = fs.readFileSync(filePath, 'utf8').trim();
		if (!raw) {
			return null;
		}

		return JSON.parse(raw) as T;
	}
}
