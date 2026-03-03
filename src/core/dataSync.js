const fs = require('fs');
const path = require('path');
const { getCollection } = require('../integrations/mongoClient');

// File JSON sekarang disimpan di folder data/ pada root project.
const STATE_PATH = path.join(__dirname, '../../data/state.json');
const LOG_PATH = path.join(__dirname, '../../data/activityLog.json');
const PERSONALIZE_PATH = path.join(__dirname, '../../data/personalize.json');

function readLocalJson(filePath) {
	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function writeLocalJson(filePath, data) {
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getFileMtime(filePath) {
	try {
		const stat = fs.statSync(filePath);
		return stat.mtime.toISOString();
	} catch {
		return null;
	}
}

function pickLatestTimestamp(candidates) {
	const valid = candidates
		.map((v) => (v ? Date.parse(v) : NaN))
		.filter((n) => Number.isFinite(n));
	if (!valid.length) return null;
	const latest = Math.max(...valid);
	return new Date(latest).toISOString();
}

function countArrayLike(data, paths) {
	if (!data || typeof data !== 'object') return 0;
	let max = 0;
	for (const p of paths) {
		const parts = p.split('.');
		let cur = data;
		for (const part of parts) {
			if (!cur || typeof cur !== 'object') {
				cur = null;
				break;
			}
			cur = cur[part];
		}
		if (Array.isArray(cur)) {
			max = Math.max(max, cur.length);
		}
	}
	return max;
}

function resolveSource({ mongoDoc, localData, meta }) {
	const hasMongo = !!mongoDoc && !!mongoDoc.data;
	const hasLocal = localData != null;

	if (hasMongo && !hasLocal) return { winner: 'mongo', data: mongoDoc.data };
	if (!hasMongo && hasLocal) return { winner: 'local', data: localData };
	if (!hasMongo && !hasLocal) return { winner: 'none', data: null };

	const mongoUpdatedAt = mongoDoc.updatedAt || null;
	const localUpdatedAt =
		meta?.localUpdatedAt ||
		pickLatestTimestamp([
			meta?.timestamps?.lastMoltbookCheck,
			meta?.timestamps?.lastPostAt,
			meta?.timestamps?.lastCommentAt,
			meta?.fileMtime,
		]);

	if (mongoUpdatedAt && localUpdatedAt) {
		const diffMs =
			Math.abs(Date.parse(mongoUpdatedAt) - Date.parse(localUpdatedAt)) || 0;
		if (diffMs > 30_000) {
			return Date.parse(mongoUpdatedAt) > Date.parse(localUpdatedAt)
				? { winner: 'mongo', data: mongoDoc.data }
				: { winner: 'local', data: localData };
		}
	}

	const mongoCount = countArrayLike(mongoDoc.data, meta?.arrayPaths || []);
	const localCount = countArrayLike(localData, meta?.arrayPaths || []);

	if (mongoCount !== localCount) {
		return mongoCount > localCount
			? { winner: 'mongo', data: mongoDoc.data }
			: { winner: 'local', data: localData };
	}

	return mongoUpdatedAt
		? { winner: 'mongo', data: mongoDoc.data }
		: { winner: 'local', data: localData };
}

async function loadFromMongo(collectionName, filter) {
	try {
		const col = await getCollection(collectionName);
		return await col.findOne(filter);
	} catch (err) {
		console.error(`Gagal load dari Mongo (${collectionName}):`, err.message);
		return null;
	}
}

async function saveToMongo(collectionName, filter, data, accountName) {
	try {
		const col = await getCollection(collectionName);
		const now = new Date().toISOString();
		await col.updateOne(
			filter,
			{
				$set: {
					accountName,
					data,
					updatedAt: now,
				},
			},
			{ upsert: true },
		);
	} catch (err) {
		console.error(`Gagal save ke Mongo (${collectionName}):`, err.message);
	}
}

function getAccountNameFromState(state) {
	if (state && typeof state.agentName === 'string' && state.agentName.trim()) {
		return state.agentName.trim();
	}
	if (
		state &&
		typeof state.moltbookApiKey === 'string' &&
		state.moltbookApiKey.trim()
	) {
		return `api_${state.moltbookApiKey.slice(0, 8)}`;
	}
	return 'default';
}

async function syncStateJson() {
	let localState = readLocalJson(STATE_PATH);
	const localFileMtime = getFileMtime(STATE_PATH);
	const accountName = getAccountNameFromState(localState || {});

	const mongoDoc = await loadFromMongo('states', { accountName });

	const meta = {
		fileMtime: localFileMtime,
		timestamps: {
			lastMoltbookCheck: localState?.lastMoltbookCheck || null,
			lastPostAt: localState?.lastPostAt || null,
			lastCommentAt: localState?.lastCommentAt || null,
		},
		arrayPaths: ['recentActions', 'topicHistory'],
	};

	const { winner, data } = resolveSource({
		mongoDoc,
		localData: localState,
		meta,
	});

	if (winner === 'mongo') {
		writeLocalJson(STATE_PATH, data);
		return data;
	}

	if (winner === 'local') {
		await saveToMongo('states', { accountName }, localState || {}, accountName);
		return localState || {};
	}

	return localState || {};
}

async function syncStateToMongoFromLocal() {
	const localState = readLocalJson(STATE_PATH);
	if (!localState) return;
	const accountName = getAccountNameFromState(localState);
	await saveToMongo('states', { accountName }, localState, accountName);
}

async function syncActivityLog() {
	const localLog = readLocalJson(LOG_PATH);
	const localFileMtime = getFileMtime(LOG_PATH);

	const state = readLocalJson(STATE_PATH);
	const accountName = getAccountNameFromState(state || {});

	const mongoDoc = await loadFromMongo('activityLogs', { accountName });

	const meta = {
		fileMtime: localFileMtime,
		arrayPaths: ['entries'],
	};

	const { winner, data } = resolveSource({
		mongoDoc,
		localData: localLog,
		meta,
	});

	if (winner === 'mongo') {
		writeLocalJson(LOG_PATH, data);
		return data;
	}

	if (winner === 'local') {
		await saveToMongo(
			'activityLogs',
			{ accountName },
			localLog || { entries: [] },
			accountName,
		);
		return localLog || { entries: [] };
	}

	return localLog || { entries: [] };
}

async function syncActivityLogToMongoFromLocal() {
	const localLog = readLocalJson(LOG_PATH);
	const state = readLocalJson(STATE_PATH);
	if (!localLog || !state) return;
	const accountName = getAccountNameFromState(state);
	await saveToMongo('activityLogs', { accountName }, localLog, accountName);
}

async function syncPersonalize() {
	const localData = readLocalJson(PERSONALIZE_PATH);
	const localFileMtime = getFileMtime(PERSONALIZE_PATH);
	const state = readLocalJson(STATE_PATH);
	const accountName = getAccountNameFromState(state || {});

	const mongoDoc = await loadFromMongo('personalizeConfigs', { accountName });

	const meta = {
		fileMtime: localFileMtime,
		arrayPaths: ['keywords.music'],
	};

	const { winner, data } = resolveSource({
		mongoDoc,
		localData,
		meta,
	});

	if (winner === 'mongo') {
		writeLocalJson(PERSONALIZE_PATH, data);
		return data;
	}

	if (winner === 'local') {
		await saveToMongo(
			'personalizeConfigs',
			{ accountName },
			localData || {},
			accountName,
		);
		return localData || {};
	}

	return localData || {};
}

async function syncPersonalizeToMongoFromLocal() {
	const localData = readLocalJson(PERSONALIZE_PATH);
	const state = readLocalJson(STATE_PATH);
	if (!localData || !state) return;
	const accountName = getAccountNameFromState(state);
	await saveToMongo(
		'personalizeConfigs',
		{ accountName },
		localData,
		accountName,
	);
}

module.exports = {
	syncStateJson,
	syncStateToMongoFromLocal,
	syncActivityLog,
	syncActivityLogToMongoFromLocal,
	syncPersonalize,
	syncPersonalizeToMongoFromLocal,
};
