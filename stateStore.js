/**
 * General state storage for the Moltbook agent.
 * Used by agent loop, dashboard, and all LLM clients (Gemini, GLM, Kimi).
 * State is persisted in state.json next to this file.
 */
const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, 'state.json');

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
	return next;
}

module.exports = {
	STATE_PATH,
	getInitialState,
	loadState,
	saveState,
};
