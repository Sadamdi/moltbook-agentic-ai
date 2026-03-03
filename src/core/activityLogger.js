/**
 * Activity logger for Moltbook agent.
 * Logs every fetch (feed, home, comments) and every action (post, comment, reply)
 * to activityLog.json for owner dashboard.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { syncActivityLogToMongoFromLocal } = require('./dataSync');

// File log sekarang di data/activityLog.json pada root project.
const LOG_PATH = path.join(__dirname, '../../data/activityLog.json');
const MAX_ENTRIES =
	Number.parseInt(process.env.ACTIVITY_LOG_MAX_ENTRIES, 10) > 0
		? Number.parseInt(process.env.ACTIVITY_LOG_MAX_ENTRIES, 10)
		: 2000;

function generateId() {
	return crypto.randomUUID();
}

function loadLog() {
	try {
		const raw = fs.readFileSync(LOG_PATH, 'utf8');
		return JSON.parse(raw);
	} catch {
		return { entries: [] };
	}
}

function saveLog(data) {
	fs.writeFileSync(LOG_PATH, JSON.stringify(data, null, 2), 'utf8');
	if (process.env.MONGODB_URI) {
		// Fire-and-forget; error tidak menghentikan logging lokal.
		syncActivityLogToMongoFromLocal().catch((err) => {
			console.error(
				'[MongoSync] Gagal sync activityLog ke Mongo:',
				err.message,
			);
		});
	}
}

/**
 * Append a log entry. Trims to MAX_ENTRIES (FIFO).
 * @param {Object} entry - { type, at, selfName, data }
 */
function appendLog(entry) {
	const log = loadLog();
	const id = generateId();
	const full = {
		id,
		type: entry.type,
		at: entry.at || new Date().toISOString(),
		selfName: entry.selfName || null,
		data: entry.data || {},
	};
	const entries = [full, ...(log.entries || [])].slice(0, MAX_ENTRIES);
	saveLog({ entries });
}

/**
 * Log feed fetch.
 */
function logFeedFetch(selfName, feed, sort, limit) {
	const posts = feed?.posts || feed?.data?.posts || [];
	appendLog({
		type: 'feed_fetch',
		selfName,
		data: {
			sort: sort || 'hot',
			limit: limit ?? 20,
			postCount: posts.length,
			posts: posts.map((p) => ({
				postId: p.post_id || p.id || p.postId,
				title: p.title || p.post_title,
				author: p.author_name || p.author?.name,
				contentPreview: (p.content_preview || p.content || '').slice(0, 300),
				submolt: p.submolt_name,
				upvotes: p.upvotes,
				commentCount: p.comment_count,
			})),
		},
	});
}

/**
 * Log home fetch.
 */
function logHomeFetch(selfName, homeData) {
	appendLog({
		type: 'home_fetch',
		selfName,
		data: {
			yourAccount: homeData?.your_account || null,
			activityOnYourPosts: homeData?.activity_on_your_posts || [],
			postsFromAccountsYouFollow: (
				homeData?.posts_from_accounts_you_follow?.posts || []
			).map((p) => ({
				postId: p.post_id || p.id || p.postId,
				title: p.title || p.post_title,
				author: p.author_name || p.author?.name,
				contentPreview: (p.content_preview || p.content || '').slice(0, 200),
			})),
		},
	});
}

/**
 * Log comments fetch for a post.
 */
function logCommentsFetch(selfName, postId, postTitle, comments) {
	const list = Array.isArray(comments) ? comments : [];
	appendLog({
		type: 'comments_fetch',
		selfName,
		data: {
			postId,
			postTitle,
			commentCount: list.length,
			comments: list.map((c) => ({
				commentId: c.id || c.comment_id,
				author: c.author?.name || c.author_name,
				content: (c.content || c.body || '').slice(0, 500),
				parentId: c.parent_id || c.parentId,
				createdAt: c.created_at || c.createdAt,
			})),
		},
	});
}

/**
 * Log post created by agent.
 */
function logPostCreated(selfName, post, title, content, submolt) {
	appendLog({
		type: 'post_created',
		selfName,
		data: {
			postId: post?.id || post?.post_id,
			title: post?.title || title,
			content: post?.content || content,
			author: selfName,
			submolt: submolt || 'general',
		},
	});
}

/**
 * Log comment added by agent on someone else's post.
 */
function logCommentAdded(selfName, post, ourComment) {
	appendLog({
		type: 'comment_added',
		selfName,
		data: {
			postId: post?.post_id || post?.id || post?.postId,
			postTitle: post?.title || post?.post_title,
			postAuthor: post?.author_name || post?.author?.name,
			postContentPreview: (post?.content_preview || post?.content || '').slice(
				0,
				500,
			),
			ourComment,
		},
	});
}

/**
 * Log reply added by agent on own post.
 */
function logReplyAdded(selfName, postId, postTitle, targetComment, ourReply) {
	appendLog({
		type: 'reply_added',
		selfName,
		data: {
			postId,
			postTitle,
			targetAuthor: targetComment?.author?.name || targetComment?.author_name,
			targetCommentContent: (
				targetComment?.content ||
				targetComment?.body ||
				''
			).slice(0, 500),
			ourReply,
		},
	});
}

/**
 * Read entries for API (with optional filter and limit).
 */
function getEntries(options = {}) {
	const { type, limit = 100 } = options;
	const log = loadLog();
	let entries = log.entries || [];
	if (type) {
		entries = entries.filter((e) => e.type === type);
	}
	return entries.slice(0, limit);
}

/**
 * Find post metadata by postId from feed_fetch or comments_fetch entries.
 */
function findPostById(postId) {
	const log = loadLog();
	const entries = log.entries || [];
	for (const e of entries) {
		if (e.type === 'feed_fetch' && e.data?.posts) {
			const p = e.data.posts.find(
				(x) => String(x.postId || x.id || '') === String(postId),
			);
			if (p) return { ...p, postId: p.postId || p.id || postId };
		}
		if (
			e.type === 'comments_fetch' &&
			String(e.data?.postId) === String(postId)
		) {
			return {
				postId,
				title: e.data.postTitle,
				postTitle: e.data.postTitle,
				comments: e.data.comments || [],
			};
		}
	}
	return null;
}

module.exports = {
	appendLog,
	logFeedFetch,
	logHomeFetch,
	logCommentsFetch,
	logPostCreated,
	logCommentAdded,
	logReplyAdded,
	getEntries,
	findPostById,
	LOG_PATH,
};
