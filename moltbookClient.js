const BASE_URL = 'https://www.moltbook.com/api/v1';

async function handleJsonResponse(response) {
	const text = await response.text();
	let data;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		throw new Error(`Failed to parse JSON from Moltbook: ${text}`);
	}

	if (!response.ok) {
		const msg =
			(data && (data.error || data.message || data.hint)) ||
			`HTTP ${response.status}`;
		throw new Error(`Moltbook error: ${msg}`);
	}

	return data;
}

async function registerAgent(name, description) {
	const response = await fetch(`${BASE_URL}/agents/register`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ name, description }),
	});

	return handleJsonResponse(response);
}

async function getStatus(apiKey) {
	const response = await fetch(`${BASE_URL}/agents/status`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});

	return handleJsonResponse(response);
}

async function getHome(apiKey) {
	const response = await fetch(`${BASE_URL}/home`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});

	return handleJsonResponse(response);
}

async function createPost(apiKey, { submoltName, title, content }) {
	const response = await fetch(`${BASE_URL}/posts`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			submolt_name: submoltName,
			title,
			content,
		}),
	});

	return handleJsonResponse(response);
}

async function addComment(apiKey, { postId, content, parentId }) {
	const response = await fetch(`${BASE_URL}/posts/${postId}/comments`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			content,
			...(parentId ? { parent_id: parentId } : {}),
		}),
	});

	return handleJsonResponse(response);
}

async function getFeed(apiKey, { sort = 'hot', limit = 10, filter } = {}) {
	const params = new URLSearchParams();
	if (sort) params.set('sort', sort);
	if (limit) params.set('limit', String(limit));
	if (filter) params.set('filter', filter);

	const response = await fetch(`${BASE_URL}/feed?${params.toString()}`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});

	return handleJsonResponse(response);
}

async function getPostComments(apiKey, { postId, sort = 'new' }) {
	const params = new URLSearchParams();
	if (sort) params.set('sort', sort);

	const response = await fetch(
		`${BASE_URL}/posts/${postId}/comments?${params.toString()}`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		},
	);

	return handleJsonResponse(response);
}

async function markNotificationsReadByPost(apiKey, { postId }) {
	const response = await fetch(
		`${BASE_URL}/notifications/read-by-post/${postId}`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
		},
	);

	return handleJsonResponse(response);
}

async function verifyContent(apiKey, { verificationCode, answer }) {
	const response = await fetch(`${BASE_URL}/verify`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			verification_code: verificationCode,
			answer,
		}),
	});

	return handleJsonResponse(response);
}

/** Upvote a post. See https://www.moltbook.com/heartbeat.md */
async function upvotePost(apiKey, postId) {
	const response = await fetch(`${BASE_URL}/posts/${postId}/upvote`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});
	return handleJsonResponse(response);
}

/** Upvote a comment. See https://www.moltbook.com/heartbeat.md */
async function upvoteComment(apiKey, commentId) {
	const response = await fetch(`${BASE_URL}/comments/${commentId}/upvote`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	});
	return handleJsonResponse(response);
}

/** Follow another agent by name. Moltbook: follow only when you consistently enjoy their content (rare). */
async function followAgent(apiKey, agentName) {
	const response = await fetch(`${BASE_URL}/agents/follow`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ name: agentName }),
	});
	return handleJsonResponse(response);
}

module.exports = {
	registerAgent,
	getStatus,
	getHome,
	createPost,
	addComment,
	getFeed,
	getPostComments,
	markNotificationsReadByPost,
	verifyContent,
	upvotePost,
	upvoteComment,
	followAgent,
};
