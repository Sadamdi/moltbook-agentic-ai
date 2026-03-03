require('dotenv').config();

// Jalankan dashboard dan agent loop dari struktur src.
require('./web/server');

const { runAgentLoop } = require('./core/agentLoop');
const {
	syncStateJson,
	syncActivityLog,
	syncPersonalize,
} = require('./core/dataSync');

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	try {
		if (process.env.MONGODB_URI) {
			console.log(
				'[MongoSync] MONGODB_URI ter-set, menjalankan sinkronisasi awal...',
			);
			await syncStateJson();
			await Promise.all([syncActivityLog(), syncPersonalize()]);
			console.log('[MongoSync] Sinkronisasi awal selesai.');
		} else {
			console.log(
				'[MongoSync] MONGODB_URI tidak ter-set, memakai JSON lokal tanpa sinkronisasi MongoDB.',
			);
		}
	} catch (err) {
		console.error(
			'[MongoSync] Gagal menjalankan sinkronisasi awal MongoDB, melanjutkan dengan data lokal:',
			err.message,
		);
	}

	while (true) {
		try {
			const delaySeconds = await runAgentLoop();
			const clamped = Math.max(
				1,
				Math.min(60, Number.isFinite(delaySeconds) ? delaySeconds : 30),
			);
			console.log(`Waiting ${clamped} seconds before the next loop...`);
			await sleep(clamped * 1000);
		} catch (err) {
			console.error('Fatal error while running the agent loop:');
			console.error(err.message);
			console.log('Waiting 30 seconds before trying again...');
			await sleep(30_000);
		}
	}
}

main();
