require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { getHome, getPostComments } = require('../integrations/moltbookClient');
const { loadState } = require('../core/stateStore');
const { getEntries, findPostById } = require('../core/activityLogger');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
	session({
		secret:
			process.env.SESSION_SECRET || 'moltbook-agent-secret-change-in-prod',
		resave: false,
		saveUninitialized: false,
		cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
	}),
);

function requireAuth(req, res, next) {
	if (req.session?.owner) return next();
	if (req.path === '/login' || req.path.startsWith('/login')) return next();
	res.redirect('/login');
}

app.use(requireAuth);

function loadLocalState() {
	try {
		return loadState();
	} catch (err) {
		return { error: err.message };
	}
}

function esc(s) {
	if (s == null || s === undefined) return '';
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function renderLoginPage(error) {
	const errHtml = error
		? `<p class="text-red-400 text-sm mt-2">${esc(error)}</p>`
		: '';
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Login – Moltbook Agent</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <style>
    body { font-family: 'DM Sans', sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); min-height: 100vh; }
    .card { background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(71, 85, 105, 0.5); }
    .input:focus { outline: none; ring: 2px; ring-color: #f97316; }
  </style>
</head>
<body class="text-gray-100 flex items-center justify-center min-h-screen">
  <div class="w-full max-w-md mx-4">
    <div class="card rounded-xl shadow-2xl p-8">
      <h1 class="text-2xl font-bold text-center mb-8 text-orange-400">Moltbook Agent</h1>
      <p class="text-center text-gray-400 text-sm mb-6">Owner dashboard</p>
      <form method="POST" action="/login" class="space-y-5">
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">Username</label>
          <input type="text" name="username" required autofocus
            class="w-full px-4 py-3 rounded-lg bg-slate-900 border border-slate-600 text-gray-100 placeholder-gray-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 transition-all"
            placeholder="Owner username" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">Password</label>
          <input type="password" name="password" required
            class="w-full px-4 py-3 rounded-lg bg-slate-900 border border-slate-600 text-gray-100 placeholder-gray-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 transition-all"
            placeholder="••••••••" />
        </div>
        ${errHtml}
        <button type="submit" class="w-full py-3 rounded-lg bg-orange-500 hover:bg-orange-400 text-white font-semibold transition-colors">
          Masuk
        </button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

app.get('/login', (req, res) => {
	if (req.session?.owner) return res.redirect('/');
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.send(renderLoginPage());
});

app.post('/login', (req, res) => {
	if (req.session?.owner) return res.redirect('/');
	const username = (req.body?.username || '').trim();
	const password = req.body?.password || '';
	const ownerUser = process.env.OWNER_USERNAME || '';
	const ownerPass = process.env.OWNER_PASSWORD || '';
	if (!ownerUser || !ownerPass) {
		return res
			.setHeader('Content-Type', 'text/html; charset=utf-8')
			.send(
				renderLoginPage(
					'Login disabled: OWNER_USERNAME or OWNER_PASSWORD not set in .env',
				),
			);
	}
	if (username === ownerUser && password === ownerPass) {
		req.session.owner = username;
		return res.redirect('/');
	}
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.send(renderLoginPage('Invalid username or password'));
});

app.post('/logout', (req, res) => {
	req.session.destroy(() => res.redirect('/login'));
});

app.get('/', async (req, res) => {
	const state = loadLocalState();

	const lastUsedProvider = state.lastUsedProvider || 'gemini';
	let primaryProviderLabel = 'Gemini';
	let currentKeyIndex = state.currentGeminiKeyIndex ?? '-';
	let lastModel = state.lastUsedGlmModel || state.lastUsedKimiModel || '-';

	if (lastUsedProvider === 'glm') {
		primaryProviderLabel = 'GLM';
		currentKeyIndex = state.currentGlmKeyIndex ?? '-';
		lastModel = state.lastUsedGlmModel || '-';
	} else if (lastUsedProvider === 'kimi') {
		primaryProviderLabel = 'Kimi';
		currentKeyIndex = state.currentKimiKeyIndex ?? '-';
		lastModel = state.lastUsedKimiModel || '-';
	}

	let homeData = null;
	let homeError = null;

	if (state && state.moltbookApiKey) {
		try {
			homeData = await getHome(state.moltbookApiKey);
		} catch (err) {
			homeError = err.message;
		}
	} else {
		homeError = 'No Moltbook API key found in state.json';
	}

	const yourAccount = homeData?.your_account || {};
	const activities = homeData?.activity_on_your_posts || [];
	const followingPosts = homeData?.posts_from_accounts_you_follow?.posts || [];
	const recentActions = Array.isArray(state.recentActions)
		? state.recentActions
		: [];

	const topicStats =
		state.topicStats && typeof state.topicStats === 'object'
			? state.topicStats
			: {};
	const topTopics = Object.entries(topicStats)
		.map(([topic, info]) => ({
			topic,
			count: info.count || 0,
			lastAt: info.lastAt || null,
		}))
		.sort((a, b) => b.count - a.count)
		.slice(0, 3);

	const headerHtml = `<header class="flex items-center justify-between mb-8 pb-6 border-b border-slate-700/60">
      <div>
        <h1 class="text-2xl font-bold text-gray-100">Agentic Gemini AI for Sosmed Moltbook</h1>
        <p class="text-sm text-gray-400 mt-1">A friendly live dashboard for your Moltbook agentic Gemini bot.</p>
      </div>
      <div class="flex items-center gap-3">
        <a href="/bot-dashboard" class="px-4 py-2 rounded-lg bg-slate-700/80 hover:bg-slate-600 text-sm font-medium transition-colors">Bot Dashboard</a>
        <button onclick="location.reload()" class="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-sm font-medium transition-colors">Refresh</button>
        <form method="POST" action="/logout" class="inline"><button type="submit" class="px-4 py-2 rounded-lg bg-slate-700/80 hover:bg-red-600/80 text-sm font-medium transition-colors">Logout</button></form>
      </div>
    </header>`;

	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="refresh" content="10" />
  <title>Agentic Gemini AI for Sosmed Moltbook – Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <style>
    body { font-family: 'DM Sans', sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); min-height: 100vh; }
    .card { background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(71, 85, 105, 0.5); }
  </style>
</head>
<body class="text-gray-100">
  <div class="max-w-6xl mx-auto px-4 py-8">
    ${headerHtml}

    <section class="grid gap-6 md:grid-cols-2 mb-8">
      <div class="card rounded-xl p-6 shadow-xl">
        <h2 class="text-sm font-semibold text-orange-400/90 uppercase tracking-wide mb-3">Account</h2>
        <p class="text-lg font-semibold">${yourAccount.name || 'Unknown'}</p>
        <p class="text-xs text-gray-400 mt-1">${state.agentDescription || ''}</p>
        <dl class="mt-3 space-y-1 text-sm">
          <div class="flex justify-between"><dt>Karma</dt><dd>${yourAccount.karma ?? 0}</dd></div>
          <div class="flex justify-between"><dt>Unread Notifications</dt><dd>${yourAccount.unread_notification_count ?? 0}</dd></div>
          <div class="flex justify-between"><dt>Last Moltbook Check</dt><dd class="text-gray-400 text-xs">${state.lastMoltbookCheck || '-'}</dd></div>
          <div class="flex justify-between"><dt>Last Status</dt><dd>${state.lastStatus || '-'}</dd></div>
        </dl>
      </div>

      <div class="card rounded-xl p-6 shadow-xl">
        <h2 class="text-sm font-semibold text-orange-400/90 uppercase tracking-wide mb-3">Posting Activity</h2>
        <dl class="space-y-1 text-sm">
          <div class="flex justify-between"><dt>Last Post At</dt><dd class="text-gray-400 text-xs">${state.lastPostAt || '-'}</dd></div>
          <div class="flex justify-between"><dt>Last Comment At</dt><dd class="text-gray-400 text-xs">${state.lastCommentAt || '-'}</dd></div>
          <div class="flex justify-between"><dt>Last Used Provider</dt><dd>${primaryProviderLabel}</dd></div>
          <div class="flex justify-between"><dt>Current Key Index</dt><dd>${currentKeyIndex}</dd></div>
          <div class="flex justify-between"><dt>Last LLM Model</dt><dd>${lastModel}</dd></div>
        </dl>
        ${
					homeError
						? `<p class="mt-3 text-xs text-red-400">Home error: ${homeError}</p>`
						: ''
				}
      </div>
    </section>

    <section class="mb-8 grid gap-6 md:grid-cols-2">
      <div class="card rounded-xl p-6 shadow-xl">
        <h2 class="text-sm font-semibold text-orange-400/90 uppercase tracking-wide mb-3">Persona Summary</h2>
        <p class="text-sm text-gray-100 whitespace-pre-line">
          ${state.personaSummary || 'No persona summary yet. The bot will build this up as it interacts on Moltbook.'}
        </p>
      </div>

      <div class="bg-slate-900 rounded-lg p-4 shadow">
        <h2 class="text-sm font-semibold text-gray-300 mb-2">Top Topics</h2>
        ${
					topTopics.length === 0
						? '<p class="text-sm text-gray-400">No topic data yet.</p>'
						: `<ul class="text-sm text-gray-100 space-y-1">` +
							topTopics
								.map(
									(t) =>
										`<li class="flex justify-between"><span>${t.topic}</span><span class="text-gray-400 text-xs">count: ${t.count}</span></li>`,
								)
								.join('') +
							'</ul>'
				}
      </div>
    </section>

    <section class="mb-8">
      <h2 class="text-sm font-semibold text-orange-400/90 uppercase tracking-wide mb-4">Activity On Your Posts</h2>
      <div class="space-y-4">
        ${
					activities.length === 0
						? '<p class="text-sm text-gray-400">No new activity yet.</p>'
						: activities
								.map(
									(a) => `
          <article class="card rounded-xl p-4 shadow-lg">
            <h3 class="font-semibold text-sm">${a.post_title || 'Untitled post'}</h3>
            <p class="text-xs text-gray-400 mb-1">Submolt: ${a.submolt_name || '-'}</p>
            <p class="text-xs text-gray-300">
              New notifications: <span class="font-semibold">${a.new_notification_count ?? 0}</span>
            </p>
            <p class="text-xs text-gray-400 mt-1">Latest commenters: ${(a.latest_commenters || []).join(', ')}</p>
            <p class="text-xs text-gray-500 mt-1">Preview: ${a.preview || '-'}</p>
          </article>
        `,
								)
								.join('')
				}
      </div>
    </section>

    <section class="mb-8">
      <h2 class="text-sm font-semibold text-orange-400/90 uppercase tracking-wide mb-4">Posts From Accounts You Follow</h2>
      <div class="space-y-4">
        ${
					followingPosts.length === 0
						? '<p class="text-sm text-gray-400">No posts yet from accounts you follow.</p>'
						: followingPosts
								.map(
									(p) => `
          <article class="card rounded-xl p-4 shadow-lg">
            <h3 class="font-semibold text-sm">${p.title || 'Untitled post'}</h3>
            <p class="text-xs text-gray-400 mb-1">
              By <span class="font-semibold">${p.author_name || '-'}</span>
              · Submolt: ${p.submolt_name || '-'}
            </p>
            <p class="text-xs text-gray-300 mb-1">${(p.content_preview || '').slice(0, 220)}${
							(p.content_preview || '').length > 220 ? '…' : ''
						}</p>
            <p class="text-xs text-gray-500">Upvotes: ${p.upvotes ?? 0} · Comments: ${
							p.comment_count ?? 0
						}</p>
          </article>
        `,
								)
								.join('')
				}
      </div>
    </section>

    <section class="mb-8">
      <h2 class="text-sm font-semibold text-orange-400/90 uppercase tracking-wide mb-4">Recent Bot Actions</h2>
      <div class="space-y-4">
        ${
					recentActions.length === 0
						? '<p class="text-sm text-gray-400">No actions recorded yet.</p>'
						: recentActions
								.map(
									(a) => `
          <article class="card rounded-xl p-4 shadow-lg flex items-start justify-between">
            <div>
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-600/30 text-blue-300 uppercase tracking-wide">
                ${a.kind}
              </span>
              <p class="mt-2 text-sm text-gray-100">${a.summary || ''}</p>
              ${
								a.postTitle
									? `<p class="text-xs text-gray-400 mt-1">Post: ${a.postTitle}</p>`
									: ''
							}
              ${
								a.postAuthor
									? `<p class="text-xs text-gray-400">By: ${a.postAuthor}</p>`
									: ''
							}
              ${
								a.targetAuthor
									? `<p class="text-xs text-gray-400">To: ${a.targetAuthor}</p>`
									: ''
							}
              ${
								a.commentPreview
									? `<p class="text-xs text-gray-300 mt-1">Comment: ${a.commentPreview}</p>`
									: a.replyPreview
										? `<p class="text-xs text-gray-300 mt-1">Reply: ${a.replyPreview}</p>`
										: ''
							}
              ${
								a.topic
									? `<p class="text-xs text-indigo-300 mt-1">Topic: ${a.topic}</p>`
									: ''
							}
            </div>
            <div class="ml-4 text-right">
              <p class="text-xs text-gray-400">${a.at}</p>
            </div>
          </article>
        `,
								)
								.join('')
				}
      </div>
    </section>

    <footer class="mt-12 pt-6 border-t border-slate-700/60 text-center text-xs text-gray-500">
      Agentic Gemini AI for Sosmed Moltbook · owner dashboard · Local only
    </footer>
  </div>
</body>
</html>`);
});

app.get('/api/logs', (req, res) => {
	try {
		const type = req.query.type || null;
		const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
		const entries = getEntries({ type: type || undefined, limit });
		const state = loadLocalState();
		const selfName = state?.agentName || 'MoltbookAgent';
		res.json({ entries, selfName });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

app.get('/api/bot-dashboard', async (req, res) => {
	try {
		const entries = getEntries({ limit: 2000 });
		const state = loadLocalState();
		const selfName = state?.agentName || 'MoltbookAgent';

		let feed = [];
		const seenFeed = new Set();
		for (const e of entries) {
			if (e.type === 'feed_fetch' && e.data?.posts) {
				for (const p of e.data.posts) {
					const id = p.postId || p.id;
					if (id && !seenFeed.has(id)) {
						seenFeed.add(id);
						feed.push({ ...p, postId: id, at: e.at });
					}
				}
			}
		}

		let posts = entries
			.filter((e) => e.type === 'post_created')
			.map((e) => ({
				...e.data,
				at: e.at,
				author: e.data?.author || selfName,
			}));

		const seenPosts = new Set(
			posts.map((p) => p.postId || p.id).filter(Boolean),
		);
		for (const e of entries) {
			if (e.type === 'home_fetch' && e.data?.activityOnYourPosts) {
				for (const a of e.data.activityOnYourPosts) {
					const pid = a.post_id || a.id;
					if (pid && !seenPosts.has(pid)) {
						seenPosts.add(pid);
						posts.push({
							postId: pid,
							title: a.post_title || a.title,
							postTitle: a.post_title || a.title,
							contentPreview: a.preview || '',
							author: selfName,
							submolt: a.submolt_name || 'general',
							upvotes: null,
							commentCount: a.new_notification_count ?? 0,
							at: e.at,
						});
					}
				}
			}
		}
		if (state?.moltbookApiKey) {
			try {
				const home = await getHome(state.moltbookApiKey);
				const activities = home?.activity_on_your_posts || [];
				for (const a of activities) {
					const pid = a.post_id || a.id;
					if (pid && !seenPosts.has(pid)) {
						seenPosts.add(pid);
						posts.push({
							postId: pid,
							title: a.post_title || a.title,
							postTitle: a.post_title || a.title,
							contentPreview: a.preview || '',
							author: selfName,
							submolt: a.submolt_name || 'general',
							upvotes: null,
							commentCount: a.new_notification_count ?? 0,
							at: null,
						});
					}
				}
			} catch (err) {
				console.error('Failed to fetch home/feed for posts:', err.message);
			}
		}

		const comments = entries
			.filter((e) => e.type === 'comment_added' || e.type === 'reply_added')
			.map((e) => ({
				...e.data,
				type: e.type,
				at: e.at,
				selfName: e.selfName,
			}));

		res.json({ feed, posts, comments, selfName });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

app.get('/api/bot-dashboard/post/:postId', async (req, res) => {
	try {
		const { postId } = req.params;
		const state = loadLocalState();
		if (!state?.moltbookApiKey) {
			return res.status(401).json({ error: 'No Moltbook API key' });
		}
		const post = findPostById(postId);
		let comments = [];
		try {
			const resp = await getPostComments(state.moltbookApiKey, {
				postId,
				sort: 'new',
			});
			comments = resp?.comments || resp || [];
		} catch (err) {
			if (post?.comments) comments = post.comments;
		}
		res.json({ post: post || { postId, title: 'Unknown post' }, comments });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

app.get('/bot-dashboard', (req, res) => {
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bot Dashboard – Moltbook Agent</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <style>
    body { font-family: 'DM Sans', sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); min-height: 100vh; }
    .card { background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(71, 85, 105, 0.5); }
    .tab-active { border-bottom: 2px solid #f97316; color: #f97316; }
    .post-card:hover { background: rgba(51, 65, 85, 0.9); }
    .comment-nested { border-left: 2px solid #475569; margin-left: 1rem; padding-left: 0.75rem; }
  </style>
</head>
<body class="text-gray-100">
  <div class="max-w-5xl mx-auto px-4 py-8">
    <header class="flex items-center justify-between mb-8 pb-6 border-b border-slate-700/60">
      <div>
        <h1 class="text-2xl font-bold text-gray-100">Bot Dashboard</h1>
        <p class="text-sm text-gray-400 mt-1" id="agentLabel">u/loading...</p>
      </div>
      <div class="flex items-center gap-3">
        <a href="/" class="px-4 py-2 rounded-lg bg-slate-700/80 hover:bg-slate-600 text-sm font-medium transition-colors">Main Dashboard</a>
        <button id="refresh" class="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-sm font-medium transition-colors">Refresh</button>
        <form method="POST" action="/logout" class="inline"><button type="submit" class="px-4 py-2 rounded-lg bg-slate-700/80 hover:bg-red-600/80 text-sm font-medium transition-colors">Logout</button></form>
      </div>
    </header>

    <nav class="flex gap-6 mb-8 border-b border-slate-700/60">
      <button class="tab-btn tab-active py-2 text-sm font-medium text-orange-400" data-tab="feed">Feed</button>
      <button class="tab-btn py-2 text-sm font-medium text-gray-400 hover:text-gray-100" data-tab="posts">Posts</button>
      <button class="tab-btn py-2 text-sm font-medium text-gray-400 hover:text-gray-100" data-tab="comments">Comments</button>
    </nav>

    <div id="feed-panel" class="tab-panel">
      <div id="feed-list" class="space-y-3"></div>
      <div id="feed-empty" class="hidden text-center py-12 text-gray-500">No feed posts yet.</div>
    </div>
    <div id="posts-panel" class="tab-panel hidden">
      <div id="posts-list" class="space-y-3"></div>
      <div id="posts-empty" class="hidden text-center py-12 text-gray-500">No posts yet.</div>
    </div>
    <div id="comments-panel" class="tab-panel hidden">
      <div id="comments-list" class="space-y-3"></div>
      <div id="comments-empty" class="hidden text-center py-12 text-gray-500">No comments yet.</div>
    </div>

    <aside class="mt-8 p-6 card rounded-xl shadow-xl">
      <h3 class="text-sm font-semibold text-orange-400/90 uppercase tracking-wide mb-3">Best of (from feed)</h3>
      <div id="best-of" class="space-y-2 text-sm"></div>
    </aside>
  </div>

  <script>
    function esc(s) {
      if (s == null || s === undefined) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function formatTime(iso) {
      const d = new Date(iso);
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    function postCard(p, clickable) {
      const href = clickable ? ' href="/bot-dashboard/post/' + esc(p.postId || p.id) + '"' : '';
      const tag = clickable ? 'a' : 'div';
      const cls = 'post-card block card rounded-xl p-5 shadow-lg ' + (clickable ? 'cursor-pointer transition-all' : '');
      return '<' + tag + (clickable ? href : '') + ' class="' + cls + '">' +
        '<p class="text-xs text-gray-500 mb-1">m/' + esc(p.submolt || 'general') + ' · ' + esc(p.author || '?') + '</p>' +
        '<h3 class="font-semibold text-gray-100">' + esc(p.title || p.postTitle || 'Untitled') + '</h3>' +
        '<p class="text-sm text-gray-400 mt-1 line-clamp-2">' + esc((p.contentPreview || p.content || '').slice(0, 200)) + '…</p>' +
        '<p class="text-xs text-gray-500 mt-2 flex gap-4">' +
          '<span class="text-orange-400">↑ ' + (p.upvotes ?? 0) + '</span>' +
          '<span>💬 ' + (p.commentCount ?? 0) + ' comments</span>' +
        '</p>' +
      '</' + tag + '>';
    }
    function commentCard(c) {
      const label = c.type === 'reply_added' ? 'Replied to ' + esc(c.targetAuthor || '?') : 'Commented on post by ' + esc(c.postAuthor || '?');
      const content = c.ourComment || c.ourReply || '';
      const postTitle = c.postTitle || c.postId || 'post';
      const postUrl = c.postId ? '/bot-dashboard/post/' + esc(c.postId) : null;
      const linkHtml = postUrl
        ? '<a href="' + postUrl + '" class="text-orange-400 underline hover:text-orange-300 font-medium">' + esc(postTitle) + '</a>'
        : '<span class="text-gray-400">' + esc(postTitle) + '</span>';
      const viewLink = postUrl
        ? ' <a href="' + postUrl + '" class="inline-block mt-2 text-sm text-orange-400 underline hover:text-orange-300">View post & comments →</a>'
        : '';
      return '<article class="card rounded-xl p-5 shadow-lg">' +
        '<p class="text-xs text-gray-500">→ ' + label + ' in ' + linkHtml + '</p>' +
        '<p class="text-sm text-gray-200 mt-2">' + esc(content.slice(0, 300)) + (content.length > 300 ? '…' : '') + '</p>' +
        '<p class="text-xs text-gray-500 mt-2">' + formatTime(c.at) + viewLink + '</p>' +
      '</article>';
    }
    function setTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('tab-active', 'text-orange-400');
        b.classList.add('text-gray-400');
        if (b.dataset.tab === tab) { b.classList.add('tab-active', 'text-orange-400'); b.classList.remove('text-gray-400'); }
      });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      const panel = document.getElementById(tab + '-panel');
      if (panel) panel.classList.remove('hidden');
    }
    function load() {
      fetch('/api/bot-dashboard')
        .then(r => r.json())
        .then(({ feed, posts, comments, selfName }) => {
          document.getElementById('agentLabel').textContent = 'u/' + (selfName || 'agent');
          const feedList = document.getElementById('feed-list');
          const feedEmpty = document.getElementById('feed-empty');
          if (feed.length === 0) {
            feedList.innerHTML = '';
            feedEmpty.classList.remove('hidden');
          } else {
            feedEmpty.classList.add('hidden');
            feedList.innerHTML = feed.slice(0, 100).map(p => postCard(p, true)).join('');
          }
          const postsList = document.getElementById('posts-list');
          const postsEmpty = document.getElementById('posts-empty');
          if (posts.length === 0) {
            postsList.innerHTML = '';
            postsEmpty.classList.remove('hidden');
          } else {
            postsEmpty.classList.add('hidden');
            postsList.innerHTML = posts.map(p => postCard({ ...p, postId: p.postId, title: p.title, content: p.content, author: p.author || selfName, submolt: p.submolt }, true)).join('');
          }
          const commentsList = document.getElementById('comments-list');
          const commentsEmpty = document.getElementById('comments-empty');
          if (comments.length === 0) {
            commentsList.innerHTML = '';
            commentsEmpty.classList.remove('hidden');
          } else {
            commentsEmpty.classList.add('hidden');
            commentsList.innerHTML = comments.map(commentCard).join('');
          }
          const bestOf = document.getElementById('best-of');
          const top = feed.slice().sort((a,b) => (b.upvotes||0) - (a.upvotes||0)).slice(0, 5);
          bestOf.innerHTML = top.length ? top.map(p => '<div class="mb-2"><a href="/bot-dashboard/post/' + esc(p.postId) + '" class="block text-gray-300 hover:text-orange-400">' + esc((p.title||'').slice(0,50)) + (p.title && p.title.length > 50 ? '…' : '') + '</a><span class="text-xs text-gray-500">' + (p.upvotes||0) + ' pts · ' + (p.commentCount||0) + ' comments</span></div>').join('') : '<p class="text-gray-500">No data yet</p>';
        })
        .catch(err => { document.getElementById('feed-list').innerHTML = '<p class="text-red-400">Error: ' + esc(err.message) + '</p>'; });
    }
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.addEventListener('click', () => setTab(b.dataset.tab));
    });
    setTab('feed');
    document.getElementById('refresh').addEventListener('click', load);
    load();
    setInterval(load, 15000);
  </script>
</body>
</html>`);
});

app.get('/bot-dashboard/post/:postId', (req, res) => {
	const postId = (req.params.postId || '').replace(/[^a-zA-Z0-9-]/g, '');
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Post – Bot Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <style>
    body { font-family: 'DM Sans', sans-serif; background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); min-height: 100vh; }
    .card { background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(71, 85, 105, 0.5); }
    .comment-item { border-left: 2px solid #475569; margin-left: 0; padding-left: 1rem; }
    .comment-nested { margin-left: 1.5rem; }
  </style>
</head>
<body class="text-gray-100">
  <div class="max-w-4xl mx-auto px-4 py-8">
    <header class="flex items-center justify-between mb-8 pb-6 border-b border-slate-700/60">
      <a href="/bot-dashboard" class="text-orange-400 hover:text-orange-300 font-medium text-sm flex items-center gap-1">← Back to Bot Dashboard</a>
      <form method="POST" action="/logout" class="inline"><button type="submit" class="px-4 py-2 rounded-lg bg-slate-700/80 hover:bg-red-600/80 text-sm font-medium transition-colors">Logout</button></form>
    </header>
    <div id="post" class="mb-8"></div>
    <div class="mb-6 flex items-center justify-between">
      <h2 id="comments-header" class="text-lg font-semibold text-gray-100">Comments</h2>
      <div class="flex gap-2">
        <button class="sort-btn px-4 py-2 rounded-lg text-sm font-medium bg-orange-500 hover:bg-orange-400 transition-colors" data-sort="new">New</button>
        <button class="sort-btn px-4 py-2 rounded-lg text-sm font-medium bg-slate-700/80 hover:bg-slate-600 transition-colors" data-sort="old">Old</button>
      </div>
    </div>
    <div id="comments" class="space-y-3"></div>
    <div id="loading" class="text-gray-500">Loading...</div>
    <div id="post-id" data-post-id="${postId}"></div>
  </div>
  <script>
    const postId = document.getElementById('post-id').dataset.postId;
    function esc(s) {
      if (s == null || s === undefined) return '';
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function formatTime(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    let comments = [];
    let sortOrder = 'new';
    function renderComment(c, nested) {
      const author = c.author?.name || c.author_name || c.author || '?';
      const content = c.content || c.body || '';
        return '<div class="comment-item ' + (nested ? 'comment-nested' : '') + ' card rounded-xl p-4 mb-3">' +
        '<p class="text-xs text-gray-500"><span class="text-orange-400 font-medium">' + esc(author) + '</span> · ' + formatTime(c.created_at || c.createdAt) + '</p>' +
        '<p class="text-sm text-gray-200 mt-1 whitespace-pre-wrap">' + esc(content) + '</p>' +
      '</div>';
    }
    function renderComments() {
      const sorted = [...comments].sort((a,b) => {
        const ta = new Date(a.created_at || a.createdAt || 0).getTime();
        const tb = new Date(b.created_at || b.createdAt || 0).getTime();
        return sortOrder === 'new' ? tb - ta : ta - tb;
      });
      const byParent = {};
      sorted.forEach(c => {
        const pid = c.parent_id || c.parentId || 'root';
        if (!byParent[pid]) byParent[pid] = [];
        byParent[pid].push(c);
      });
      function nest(items, depth) {
        return items.map(c => {
          const kids = byParent[c.id || c.comment_id] || [];
          return renderComment(c, depth > 0) + (kids.length ? nest(kids, depth+1) : '');
        }).join('');
      }
      const roots = byParent['root'] || [];
      document.getElementById('comments').innerHTML = nest(roots, 0) || '<p class="text-gray-500">No comments yet.</p>';
    }
    function load() {
      fetch('/api/bot-dashboard/post/' + postId)
        .then(r => r.json())
        .then(({ post, comments: cs }) => {
          comments = cs || [];
          document.getElementById('loading').classList.add('hidden');
          document.getElementById('comments-header').textContent = 'Comments (' + comments.length + ')';
          const title = post.title || post.postTitle || 'Untitled';
          const author = post.author || '?';
          const content = post.contentPreview || post.content || '';
          const submolt = post.submolt || 'general';
          document.getElementById('post').innerHTML =
            '<article class="card rounded-xl p-6 shadow-xl">' +
              '<p class="text-xs text-gray-500 mb-1">m/' + esc(submolt) + ' · ' + esc(author) + '</p>' +
              '<h1 class="text-xl font-bold text-gray-100">' + esc(title) + '</h1>' +
              '<div class="text-sm text-gray-300 mt-4 whitespace-pre-wrap">' + esc(content) + '</div>' +
              '<p class="text-xs text-gray-500 mt-4 flex gap-4">' +
                '<span class="text-orange-400">↑ ' + (post.upvotes ?? 0) + '</span>' +
                '<span>💬 ' + (post.commentCount ?? comments.length) + ' comments</span>' +
              '</p>' +
            '</article>';
          renderComments();
        })
        .catch(err => {
          document.getElementById('loading').innerHTML = '<p class="text-red-400">Error: ' + esc(err.message) + '</p>';
        });
    }
    load();
    setInterval(load, 15000);
    document.querySelectorAll('.sort-btn').forEach(b => {
      b.addEventListener('click', () => {
        sortOrder = b.dataset.sort;
        document.querySelectorAll('.sort-btn').forEach(x => { x.classList.remove('bg-orange-500'); x.classList.add('bg-slate-700/80'); });
        b.classList.add('bg-orange-500'); b.classList.remove('bg-slate-700/80');
        renderComments();
      });
    });
  </script>
</body>
</html>`);
});

app.get('/logs', (req, res) => {
	res.redirect(301, '/bot-dashboard');
});

app.listen(PORT, () => {
	console.log(`Dashboard running at http://localhost:${PORT}`);
});
