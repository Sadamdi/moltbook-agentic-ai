const { loadState, saveState } = require('./stateStore');

function loadGeminiKeys() {
	const entries = Object.entries(process.env).filter(([key, value]) => {
		return (
			key.startsWith('GOOGLE_API_KEY') &&
			typeof value === 'string' &&
			value.trim().length > 0
		);
	});

	if (entries.length === 0) {
		throw new Error(
			'No GOOGLE_API_KEY* variables found in .env. Please add at least one Gemini API key.',
		);
	}

	const sorted = entries.sort(([a], [b]) => {
		if (a === 'GOOGLE_API_KEY') return -1;
		if (b === 'GOOGLE_API_KEY') return 1;
		const numA = parseInt(a.replace('GOOGLE_API_KEY', ''), 10);
		const numB = parseInt(b.replace('GOOGLE_API_KEY', ''), 10);
		if (Number.isNaN(numA) && Number.isNaN(numB)) return a.localeCompare(b);
		if (Number.isNaN(numA)) return 1;
		if (Number.isNaN(numB)) return -1;
		return numA - numB;
	});

	return sorted.map(([, value]) => value.trim());
}

async function callGemini({ prompt, model = 'gemini-2.5-flash', maxAttempts }) {
	const apiKeys = loadGeminiKeys();
	const state = loadState();

	let index = state.currentGeminiKeyIndex || 0;
	if (index < 0 || index >= apiKeys.length) {
		index = 0;
	}

	const attempts = Math.min(maxAttempts || apiKeys.length, apiKeys.length);

	let lastError;

	for (let i = 0; i < attempts; i += 1) {
		const apiKey = apiKeys[index];
		try {
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
				apiKey,
			)}`;

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					contents: [
						{
							role: 'user',
							parts: [{ text: prompt }],
						},
					],
				}),
			});

			if (!response.ok) {
				if ([401, 403, 429].includes(response.status)) {
					lastError = new Error(
						`Gemini key index ${index} error HTTP ${response.status}`,
					);
					index = (index + 1) % apiKeys.length;
					saveState({ currentGeminiKeyIndex: index });
					continue;
				}
				const errorText = await response.text();
				throw new Error(`Gemini HTTP ${response.status}: ${errorText}`);
			}

			const data = await response.json();
			const text =
				data?.candidates?.[0]?.content?.parts?.[0]?.text ??
				data?.candidates?.[0]?.output_text ??
				null;
			if (typeof text !== 'string') {
				throw new Error('Respons Gemini tidak berisi teks.');
			}

			saveState({
				currentGeminiKeyIndex: index,
				lastUsedProvider: 'gemini',
			});
			return { text, usedKeyIndex: index };
		} catch (err) {
			lastError = err;
			index = (index + 1) % apiKeys.length;
			saveState({ currentGeminiKeyIndex: index });
		}
	}

	throw lastError || new Error('Gagal memanggil Gemini dengan semua API key.');
}

module.exports = {
	loadGeminiKeys,
	callGemini,
};
