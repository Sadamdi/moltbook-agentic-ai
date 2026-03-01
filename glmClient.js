const { loadState, saveState } = require('./stateStore');

function loadGlmKeys() {
	const entries = Object.entries(process.env).filter(([key, value]) => {
		return (
			key.startsWith('GLM_API_KEY') &&
			typeof value === 'string' &&
			value.trim().length > 0
		);
	});

	if (entries.length === 0) {
		throw new Error(
			'No GLM_API_KEY* variables found in .env while PRIMARY_LLM_PROVIDER=glm. Please add at least one GLM API key.',
		);
	}

	const sorted = entries.sort(([a], [b]) => {
		if (a === 'GLM_API_KEY') return -1;
		if (b === 'GLM_API_KEY') return 1;
		const numA = parseInt(a.replace('GLM_API_KEY', ''), 10);
		const numB = parseInt(b.replace('GLM_API_KEY', ''), 10);
		if (Number.isNaN(numA) && Number.isNaN(numB)) return a.localeCompare(b);
		if (Number.isNaN(numA)) return 1;
		if (Number.isNaN(numB)) return -1;
		return numA - numB;
	});

	return sorted.map(([, value]) => value.trim());
}

function buildGlmModelList(overrideModel) {
	const envDefault = process.env.GLM_DEFAULT_MODEL
		? String(process.env.GLM_DEFAULT_MODEL).trim()
		: null;

	const baseList = [
		overrideModel && String(overrideModel).trim(),
		envDefault,
		'glm-5',
		'glm-4.7',
		'glm-4.6',
		'glm-4.6v-flash', // model gratis, bisa dipakai saat saldo habis
		'glm-4.5',
	].filter(Boolean);

	// Hilangkan duplikasi sambil mempertahankan urutan.
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

async function callGLM({ prompt, model, maxAttempts } = {}) {
	if (!prompt || typeof prompt !== 'string') {
		throw new Error('callGLM membutuhkan parameter "prompt" berupa string.');
	}

	const apiKeys = loadGlmKeys();
	const models = buildGlmModelList(model);
	if (models.length === 0) {
		throw new Error('Tidak ada model GLM yang tersedia untuk dicoba.');
	}

	const state = loadState();

	let baseKeyIndex = state.currentGlmKeyIndex || 0;
	if (baseKeyIndex < 0 || baseKeyIndex >= apiKeys.length) {
		baseKeyIndex = 0;
	}

	const maxTotalAttempts =
		typeof maxAttempts === 'number' && maxAttempts > 0
			? Math.min(maxAttempts, apiKeys.length * models.length)
			: apiKeys.length * models.length;

	const endpoint =
		process.env.GLM_API_URL || 'https://api.z.ai/api/paas/v4/chat/completions';

	let attempts = 0;
	let lastError;

	for (let keyOffset = 0; keyOffset < apiKeys.length; keyOffset += 1) {
		const keyIndex = (baseKeyIndex + keyOffset) % apiKeys.length;
		const apiKey = apiKeys[keyIndex];

		for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
			if (attempts >= maxTotalAttempts) {
				break;
			}
			attempts += 1;

			const glmModel = models[modelIndex];

			try {
				const response = await fetch(endpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify({
						model: glmModel,
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
					// 401/403/429 → error terkait key/rate-limit; coba model lain dulu, lalu key lain.
					if ([401, 403, 429].includes(response.status)) {
						const errorText = await response.text().catch(() => '');
						lastError = new Error(
							`GLM key index ${keyIndex} with model "${glmModel}" error HTTP ${response.status}: ${errorText}`,
						);
						// Lanjut ke kombinasi berikutnya (model lain, lalu key lain).
						continue;
					}

					const errorText = await response.text().catch(() => '');
					throw new Error(
						`GLM HTTP ${response.status} (model=${glmModel}, keyIndex=${keyIndex}): ${errorText}`,
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
					throw new Error('Respons GLM tidak berisi teks yang bisa dipakai.');
				}

				// Simpan key index & provider terakhir di state untuk debugging.
				saveState({
					currentGlmKeyIndex: keyIndex,
					lastUsedProvider: 'glm',
					lastUsedGlmModel: glmModel,
				});

				return {
					text,
					usedKeyIndex: keyIndex,
					usedModel: glmModel,
				};
			} catch (err) {
				lastError = err;
				// Lanjut ke kombinasi berikutnya (model lain, lalu key lain).
			}
		}
	}

	throw (
		lastError || new Error('Gagal memanggil GLM dengan semua key dan model.')
	);
}

module.exports = {
	loadGlmKeys,
	callGLM,
};
