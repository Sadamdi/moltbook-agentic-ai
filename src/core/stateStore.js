/**
 * General state storage untuk Moltbook agent dengan path baru di src/core.
 * Hanya bertanggung jawab ke file state.json; sinkronisasi Mongo di-handle oleh dataSync.
 */
const fs = require('fs');
const path = require('path');
const { syncStateToMongoFromLocal } = require('./dataSync');

// File state sekarang di data/state.json pada root project.
const STATE_PATH = path.join(__dirname, '../../data/state.json');

function getInitialState() {
	return {
		currentGeminiKeyIndex: 0,
		currentGlmKeyIndex: 0,
		currentKimiKeyIndex: 0,
		moltbookApiKey: null,
		lastMoltbookCheck: null,
		agentName: null,
		agentDescription: null,
		lastStatus: null,
		lastPostAt: null,
		lastCommentAt: null,
		recentActions: [],
		topicHistory: [],
		topicStats: {},
		personaSummary: null,
		lastPersonaUpdateAt: null,
		lastPersonaTopicCount: 0,
		verificationHistory: [],
		followingNames: [],
		lastFollowAt: null,
		lastUpvoteAt: null,
		lastUsedProvider: 'gemini',
		lastUsedGlmModel: null,
		lastUsedKimiModel: null,
	};
}

function loadState() {
	try {
		const raw = fs.readFileSync(STATE_PATH, 'utf8');
		return JSON.parse(raw);
	} catch {
		const initial = getInitialState();
		fs.writeFileSync(STATE_PATH, JSON.stringify(initial, null, 2));
		return initial;
	}
}

function saveState(partial) {
	const current = loadState();
	const next = { ...current, ...partial };
	fs.writeFileSync(STATE_PATH, JSON.stringify(next, null, 2));
	if (process.env.MONGODB_URI) {
		// Fire-and-forget; jika gagal tidak memblokir loop utama.
		syncStateToMongoFromLocal().catch((err) => {
			console.error('[MongoSync] Gagal sync state ke Mongo:', err.message);
		});
	}
	return next;
}

module.exports = {
	STATE_PATH,
	getInitialState,
	loadState,
	saveState,
};

