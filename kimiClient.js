const { loadState, saveState } = require('./stateStore');

function loadKimiKeys() {
	const entries = Object.entries(process.env).filter(([key, value]) => {
		return (
			key.startsWith('KIMI_API_KEY') &&
			typeof value === 'string' &&
			value.trim().length > 0
		);
	});

	if (entries.length === 0) {
		throw new Error(
			'No KIMI_API_KEY* variables found in .env while provider "kimi" is enabled. Please add at least one Kimi API key.',
		);
	}

	const sorted = entries.sort(([a], [b]) => {
		if (a === 'KIMI_API_KEY') return -1;
		if (b === 'KIMI_API_KEY') return 1;
		const numA = parseInt(a.replace('KIMI_API_KEY', ''), 10);
		const numB = parseInt(b.replace('KIMI_API_KEY', ''), 10);
		if (Number.isNaN(numA) && Number.isNaN(numB)) return a.localeCompare(b);
		if (Number.isNaN(numA)) return 1;
		if (Number.isNaN(numB)) return -1;
		return numA - numB;
	});

	return sorted.map(([, value]) => value.trim());
}

function buildKimiModelList(overrideModel) {
	const envDefault = process.env.KIMI_DEFAULT_MODEL
		? String(process.env.KIMI_DEFAULT_MODEL).trim()
		: null;

	const baseList = [
		overrideModel && String(overrideModel).trim(),
		envDefault,
		// Prioritas default model Kimi (berdasarkan dokumentasi Moonshot).
		'kimi-k2-turbo-preview',
		'moonshot-v1-8k',
	].filter(Boolean);

	const seen = new Set();
	const unique = [];
	for (const m of baseList) {
		if (!seen.has(m)) {
			seen.add(m);
			unique.push(m);
		}
	}
	return unique;
}

async function callKimi({ prompt, model, maxAttempts } = {}) {
	if (!prompt || typeof prompt !== 'string') {
		throw new Error('callKimi membutuhkan parameter "prompt" berupa string.');
	}

	const apiKeys = loadKimiKeys();
	const models = buildKimiModelList(model);
	if (models.length === 0) {
		throw new Error('Tidak ada model Kimi yang tersedia untuk dicoba.');
	}

	const state = loadState();

	let baseKeyIndex = state.currentKimiKeyIndex || 0;
	if (baseKeyIndex < 0 || baseKeyIndex >= apiKeys.length) {
		baseKeyIndex = 0;
	}

	const maxTotalAttempts =
		typeof maxAttempts === 'number' && maxAttempts > 0
			? Math.min(maxAttempts, apiKeys.length * models.length)
			: apiKeys.length * models.length;

	const endpoint =
		process.env.KIMI_API_URL || 'https://api.moonshot.ai/v1/chat/completions';

	let attempts = 0;
	let lastError;

	console.log(
		'[KIMI] Starting callKimi:',
		JSON.stringify(
			{
				totalKeys: apiKeys.length,
				models,
				baseKeyIndex,
				maxTotalAttempts,
			},
			null,
			2,
		),
	);

	for (let keyOffset = 0; keyOffset < apiKeys.length; keyOffset += 1) {
		const keyIndex = (baseKeyIndex + keyOffset) % apiKeys.length;
		const apiKey = apiKeys[keyIndex];

		for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
			if (attempts >= maxTotalAttempts) {
				break;
			}
			attempts += 1;

			const kimiModel = models[modelIndex];

			try {
				console.log(
					`[KIMI] Attempt ${attempts}/${maxTotalAttempts} → keyIndex=${keyIndex}, model=${kimiModel}`,
				);

				const response = await fetch(endpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify({
						model: kimiModel,
						messages: [
							{
								role: 'user',
								content: prompt,
							},
						],
						stream: false,
					}),
				});

				if (!response.ok) {
					if ([401, 403, 429].includes(response.status)) {
						const errorText = await response.text().catch(() => '');
						console.warn(
							`[KIMI] Soft error (will try next combination) keyIndex=${keyIndex}, model=${kimiModel}, status=${response.status}, body=${errorText}`,
						);
						lastError = new Error(
							`Kimi key index ${keyIndex} with model "${kimiModel}" error HTTP ${response.status}: ${errorText}`,
						);
						continue;
					}

					const errorText = await response.text().catch(() => '');
					throw new Error(
						`Kimi HTTP ${response.status} (model=${kimiModel}, keyIndex=${keyIndex}): ${errorText}`,
					);
				}

				const data = await response.json();

				const text =
					data?.choices?.[0]?.message?.content ??
					data?.choices?.[0]?.text ??
					data?.data?.[0]?.content ??
					data?.result ??
					null;

				if (typeof text !== 'string') {
					throw new Error('Respons Kimi tidak berisi teks yang bisa dipakai.');
				}

				saveState({
					currentKimiKeyIndex: keyIndex,
					lastUsedProvider: 'kimi',
					lastUsedKimiModel: kimiModel,
				});

				console.log(
					`[KIMI] Success with keyIndex=${keyIndex}, model=${kimiModel}, attempts=${attempts}`,
				);

				return {
					text,
					usedKeyIndex: keyIndex,
					usedModel: kimiModel,
				};
			} catch (err) {
				lastError = err;
			}
		}
	}

	console.error(
		'[KIMI] Exhausted all key/model combinations without success. Last error:',
		lastError ? lastError.message : 'Unknown error',
	);

	throw (
		lastError || new Error('Gagal memanggil Kimi dengan semua key dan model.')
	);
}

module.exports = {
	loadKimiKeys,
	callKimi,
};
