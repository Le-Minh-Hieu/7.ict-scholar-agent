export class Logger {
	static info(message: string, meta?: unknown) {
		if (meta !== undefined) {
			console.log(`ℹ️ ${message}`, meta);
			return;
		}
		console.log(`ℹ️ ${message}`);
	}

	static warn(message: string, meta?: unknown) {
		if (meta !== undefined) {
			console.warn(`⚠️ ${message}`, meta);
			return;
		}
		console.warn(`⚠️ ${message}`);
	}

	static error(message: string, meta?: unknown) {
		if (meta !== undefined) {
			console.error(`❌ ${message}`, meta);
			return;
		}
		console.error(`❌ ${message}`);
	}
}
