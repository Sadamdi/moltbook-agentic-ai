const path = require('path');
const fs = require('fs');
const { loadState, saveState } = require('./stateStore');
const { callLLM, getPrimaryProvider } = require('./llmClient');
const {
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
} = require('./moltbookClient');

const PERSONALIZE_PATH = path.join(__dirname, 'personalize.json');

function loadPersonalize() {
  try {
    const raw = fs.readFileSync(PERSONALIZE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('personalize.json not found or invalid, using defaults:', err.message);
    return {
      agent: { name: 'MoltbookAgent', description: 'An agentic AI on Moltbook. Edit personalize.json to set your agent name and prompts.' },
      keywords: { music: [] },
      prompts: {},
    };
  }
}

function fillTemplate(str, data) {
  if (!str || typeof str !== 'string') return '';
  let s = str;
  for (const [k, v] of Object.entries(data)) {
    s = s.replace(new RegExp('{{' + k + '}}', 'g'), v != null ? String(v) : '');
  }
  return s;
}

const personalizeConfig = loadPersonalize();
const PREFERRED_KEYWORDS = Array.isArray(personalizeConfig.keywords?.music) ? personalizeConfig.keywords.music : [];

async function ensureState() {
  const state = loadState();
  return state;
}

function safeStringify(value) {
  return JSON.stringify(value, null, 2);
}

function recordAction(kind, summary, extra) {
  try {
    const state = loadState();
    const prev = Array.isArray(state.recentActions) ? state.recentActions : [];
    const entry = {
      kind,
      summary,
      at: new Date().toISOString(),
      ...(extra || {}),
    };
    const next = [entry, ...prev].slice(0, 30);
    saveState({ recentActions: next });
  } catch (err) {
    console.error('Gagal menyimpan recentActions:', err.message);
  }
}

/**
 * Try to solve Moltbook verification math challenge locally.
 * Parses two numbers and one operator (+, -, *, /) from challenge text.
 * @returns {string|null} The numeric result as string (e.g. "15.00") or null if unparseable.
 */
function solveVerificationChallenge(challengeText) {
  if (!challengeText || typeof challengeText !== 'string') return null;
  const s = challengeText.trim();
  // Match two numbers (integer or decimal) and one of + - * /
  const match = s.match(/(-?\d+(?:\.\d+)?)\s*([+\-*\/])\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const [, aStr, op, bStr] = match;
  const a = parseFloat(aStr);
  const b = parseFloat(bStr);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  let result;
  switch (op) {
    case '+': result = a + b; break;
    case '-': result = a - b; break;
    case '*': result = a * b; break;
    case '/': result = b === 0 ? null : a / b; break;
    default: return null;
  }
  if (result === null || !Number.isFinite(result)) return null;
  // Format similarly to expected (e.g. 15.00 or -3.5)
  if (Number.isInteger(result)) return String(result);
  return String(Number(Math.round(result * 1e6) / 1e6));
}

function recordVerificationAttempt(entry) {
  try {
    const state = loadState();
    const history = Array.isArray(state.verificationHistory) ? state.verificationHistory : [];
    const next = [{ ...entry, at: new Date().toISOString() }, ...history].slice(0, 20);
    saveState({ verificationHistory: next });
  } catch (err) {
    console.error('Gagal menyimpan verificationHistory:', err.message);
  }
}

/**
 * Solve verification challenge (local parse first, then LLM with history) and call verifyContent.
 * On failure: records attempt, logs, does NOT throw so the agent loop continues.
 */
async function solveAndVerifyVerification(state, verification, logLabel) {
  const { verification_code: verificationCode, challenge_text: challengeText } = verification;
  if (!verificationCode || !challengeText) return;

  let answer = solveVerificationChallenge(challengeText);
  if (answer === null) {
    const history = Array.isArray(state.verificationHistory) ? state.verificationHistory : [];
    const failed = history.filter((e) => e.success === false).slice(0, 5);
    const historyBlock =
      failed.length > 0
        ? `\nYou previously got these wrong — do not repeat the same answer:\n${failed
            .map((e) => `- Challenge: "${(e.challengeText || '').slice(0, 120)}" → you answered "${e.ourAnswer}" (incorrect).`)
            .join('\n')}\n`
        : '';

    const solvePrompt = fillTemplate(personalizeConfig.prompts.verification || 'Challenge: {{challengeText}}\n{{historyBlock}}\nRespond with ONLY the final number.', {
      challengeText,
      historyBlock,
    }).trim();

    try {
      const { text: answerText } = await callLLM({ prompt: solvePrompt });
      const cleaned = String(answerText).match(/-?\d+(\.\d+)?/);
      answer = cleaned ? cleaned[0] : String(answerText).trim();
    } catch (err) {
      console.error(`${logLabel}: LLM solve failed:`, err.message);
      return;
    }
  }

  try {
    const verifyResult = await verifyContent(state.moltbookApiKey, {
      verificationCode,
      answer,
    });
    console.log(`${logLabel}:`, verifyResult?.message || safeStringify(verifyResult));
    recordVerificationAttempt({
      challengeText: challengeText.slice(0, 200),
      ourAnswer: answer,
      success: true,
    });
  } catch (err) {
    console.error(`${logLabel}:`, err.message);
    recordVerificationAttempt({
      challengeText: challengeText.slice(0, 200),
      ourAnswer: answer,
      success: false,
    });
    // Do not rethrow — agent loop continues
  }
}

function recordTopicEntry(entry) {
  try {
    const state = loadState();
    const history = Array.isArray(state.topicHistory) ? state.topicHistory : [];
    const stats =
      state.topicStats && typeof state.topicStats === 'object' ? state.topicStats : {};

    const topic = entry.topic || 'unknown';
    const at = new Date().toISOString();
    const normalized = {
      topic,
      subtopics: Array.isArray(entry.subtopics) ? entry.subtopics : [],
      sentiment: entry.sentiment || 'neutral',
      source: entry.source || null,
      postTitle: entry.postTitle || null,
      snippet: entry.snippet || null,
      at,
    };

    const nextHistory = [normalized, ...history].slice(0, 50);

    const prevStats = stats[topic] || { count: 0, lastAt: null };
    stats[topic] = {
      count: (prevStats.count || 0) + 1,
      lastAt: at,
    };

    saveState({ topicHistory: nextHistory, topicStats: stats });
  } catch (err) {
    console.error('Gagal menyimpan topicHistory:', err.message);
  }
}

/**
 * Generate a comment that is RELEVANT to the specific post.
 * Ensures we never reply with off-topic content (e.g. wrong topic when post is about something else).
 */
async function generateCommentForPost(state, targetPost, fallbackContent) {
  const title = targetPost.title || targetPost.post_title || '';
  const body = targetPost.content_preview || targetPost.content || '';
  const persona = state.personaSummary || state.agentDescription || '';
  const combined = `${title} ${body}`.toLowerCase();
  const isMusicPost = PREFERRED_KEYWORDS.some((kw) => combined.includes(kw));

  const agentName = personalizeConfig.agent?.name || state.agentName || 'MoltbookAgent';
  const noMusicRule = isMusicPost ? '' : '\n' + (personalizeConfig.prompts.commentNoMusicRule || 'CRITICAL: Respond only about the topic of this post. Do not bring up unrelated topics.').trim() + '\n';
  const prompt = fillTemplate(personalizeConfig.prompts.comment || 'You are {{agentName}}. Post: {{title}} {{body}}. {{noMusicRule}} Persona: {{persona}}. Respond with ONLY the comment text.', {
    agentName,
    title,
    body: body || '(no body)',
    noMusicRule,
    persona: persona || 'Music-focused AI agent.',
  }).trim();

  try {
    const { text } = await callLLM({ prompt });
    const comment = String(text || '').trim();
    if (comment.length > 10 && comment.length <= 400) {
      return comment;
    }
  } catch (err) {
    console.error('generateCommentForPost failed:', err.message);
  }
  return fallbackContent || 'Interesting post! Thanks for sharing.';
}

async function classifyInteraction({ postTitle, postContent, commentText }) {
  const agentName = personalizeConfig.agent?.name || 'MoltbookAgent';
  const instruction = fillTemplate(personalizeConfig.prompts.classify || 'Classify topic for {{agentName}}. Post: {{postTitle}} {{postContent}} Comment: {{commentText}}. Respond JSON: {"topic":"...","subtopics":[],"sentiment":"..."}', {
    agentName,
    postTitle: postTitle || '-',
    postContent: postContent || '-',
    commentText: commentText || '-',
  }).trim();

  const { text } = await callLLM({ prompt: instruction });

  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const json = start >= 0 && end >= 0 ? text.slice(start, end + 1) : text;
    const parsed = JSON.parse(json);
    const topic = typeof parsed.topic === 'string' ? parsed.topic.toLowerCase().trim() : 'unknown';
    const sentiment =
      typeof parsed.sentiment === 'string'
        ? parsed.sentiment.toLowerCase().trim()
        : 'neutral';
    const subtopics = Array.isArray(parsed.subtopics)
      ? parsed.subtopics.map((s) => String(s)).slice(0, 6)
      : [];

    return { topic, sentiment, subtopics };
    } catch (err) {
      console.error('Failed to classify interaction topic:', err.message);
    return {
      topic: 'unknown',
      sentiment: 'neutral',
      subtopics: [],
    };
  }
}

async function maybeUpdatePersonaSummary() {
  try {
    const state = loadState();
    const topics = Array.isArray(state.topicHistory)
      ? state.topicHistory.slice(0, 20)
      : [];
    const actions = Array.isArray(state.recentActions)
      ? state.recentActions.slice(0, 20)
      : [];

    if (topics.length === 0) {
      return state;
    }

    const now = Date.now();
    const lastUpdate = state.lastPersonaUpdateAt
      ? Date.parse(state.lastPersonaUpdateAt)
      : 0;
    const lastCount = state.lastPersonaTopicCount ?? 0;

    if (lastUpdate && now - lastUpdate < 60 * 60 * 1000 && topics.length <= lastCount + 3) {
      return state;
    }

    const agentName = personalizeConfig.agent?.name || 'MoltbookAgent';
    const prompt = fillTemplate(personalizeConfig.prompts.personaSummary || 'Summarize personality of {{agentName}}. Topics: {{topics}} Actions: {{actions}}. Respond JSON: {"summary":"...","bullets":[]}', {
      agentName,
      topics: safeStringify(topics),
      actions: safeStringify(actions),
    }).trim();

    const { text } = await callLLM({ prompt });

    let personaSummary = null;
    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      const json = start >= 0 && end >= 0 ? text.slice(start, end + 1) : text;
      const parsed = JSON.parse(json);
      const summary = parsed.summary || parsed.persona || '';
      const bullets = Array.isArray(parsed.bullets)
        ? parsed.bullets.map((b) => String(b)).slice(0, 5)
        : [];
      const bulletsText =
        bullets.length > 0 ? '\n- ' + bullets.join('\n- ') : '';
      personaSummary = String(summary || '').trim() + bulletsText;
    } catch (err) {
      console.error('Failed to parse personaSummary from Gemini:', err.message);
      return state;
    }

    if (!personaSummary || !personaSummary.trim()) {
      return state;
    }

    const next = saveState({
      personaSummary,
      lastPersonaUpdateAt: new Date(now).toISOString(),
      lastPersonaTopicCount: topics.length,
    });
    return next;
    } catch (err) {
      console.error('Failed to update personaSummary:', err.message);
    return loadState();
  }
}

function getRecentStats(state) {
  const recent = Array.isArray(state.recentActions) ? state.recentActions : [];

  const counts = recent.reduce((acc, a) => {
    if (!a || !a.kind) return acc;
    acc[a.kind] = (acc[a.kind] || 0) + 1;
    return acc;
  }, {});

  const lastKind = recent[0]?.kind || null;
  let streak = 0;
  for (let i = 0; i < recent.length; i += 1) {
    if (recent[i]?.kind === lastKind) {
      streak += 1;
    } else {
      break;
    }
  }

  return { recent, counts, lastKind, streak };
}

/** Count engagements per author from recent actions (comment/reply_comment with postAuthor). Moltbook: follow only when we consistently enjoy their content. */
function getEngagementByAuthor(state) {
  const recent = Array.isArray(state.recentActions) ? state.recentActions : [];
  const byAuthor = {};
  for (const a of recent) {
    const author = a.postAuthor || a.targetAuthor;
    if (author && typeof author === 'string' && author.trim()) {
      const name = author.trim();
      if (!byAuthor[name]) byAuthor[name] = 0;
      byAuthor[name] += 1;
    }
  }
  return byAuthor;
}

/** Pick an author we could follow: engaged 2+ times, not already following, not self. Returns agent name or null. */
function pickFollowCandidate(state) {
  const selfName = state.agentName || personalizeConfig.agent?.name || 'MoltbookAgent';
  const following = new Set(Array.isArray(state.followingNames) ? state.followingNames : []);
  const engagement = getEngagementByAuthor(state);
  const candidates = Object.entries(engagement)
    .filter(([name]) => name !== selfName && !following.has(name) && engagement[name] >= 2)
    .sort((a, b) => b[1] - a[1]);
  return candidates.length > 0 ? candidates[0][0] : null;
}

/** Post IDs we've already commented on (from recentActions), so we don't comment the same post repeatedly. */
function getCommentedPostIds(state) {
  const recent = Array.isArray(state.recentActions) ? state.recentActions : [];
  const ids = new Set();
  for (const a of recent) {
    if (a.kind === 'comment' && a.postId) ids.add(String(a.postId));
  }
  return ids;
}

function applyActionHeuristics(decision, stats, state) {
  const adjusted = { ...decision };
  const now = Date.now();
  const lastPostAt = state.lastPostAt ? Date.parse(state.lastPostAt) : 0;
  const lastCommentAt = state.lastCommentAt ? Date.parse(state.lastCommentAt) : 0;
  const canComment = !lastCommentAt || now - lastCommentAt > 60_000;
  const canPost = !lastPostAt || now - lastPostAt > 2 * 60 * 60 * 1000; // 2 jam

  if (decision.action === 'home') {
    if (stats.lastKind === 'home' && stats.streak >= 3 && canComment) {
      adjusted.action = 'comment';
    } else if (
      stats.lastKind === 'home' &&
      stats.streak >= 5 &&
      canPost &&
      Math.random() < 0.3
    ) {
      adjusted.action = 'post';
    }
  }

  return adjusted;
}

async function decideNextAction(state) {
  const { recent, counts } = getRecentStats({
    ...state,
    recentActions: Array.isArray(state.recentActions)
      ? state.recentActions.slice(0, 10)
      : [],
  });

  const topicHistory = Array.isArray(state.topicHistory) ? state.topicHistory.slice(0, 15) : [];
  const followCandidate = pickFollowCandidate(state);
  const lastFollowAt = state.lastFollowAt || null;
  const sixHoursMs = 6 * 60 * 60 * 1000;
  const canFollow =
    followCandidate &&
    (!lastFollowAt || Date.now() - new Date(lastFollowAt).getTime() > sixHoursMs);

  const context = {
    hasMoltbookApiKey: Boolean(state.moltbookApiKey),
    lastMoltbookCheck: state.lastMoltbookCheck,
    lastStatus: state.lastStatus,
    agentName: state.agentName,
    agentDescription: state.agentDescription,
    personaSummary: state.personaSummary || null,
    recentTopics: topicHistory.map((t) => ({ topic: t.topic, postTitle: t.postTitle })),
    lastPostAt: state.lastPostAt || null,
    lastCommentAt: state.lastCommentAt || null,
    lastFollowAt,
    followCandidate: canFollow ? followCandidate : null,
    recentActionsSummary: {
      counts,
      lastActions: recent.map((a) => ({
        kind: a.kind,
        at: a.at,
        summary: a.summary,
      })),
    },
  };

  const agentName = state.agentName || personalizeConfig.agent?.name || 'MoltbookAgent';
  const instruction = fillTemplate(personalizeConfig.prompts.decideNextAction || 'You are {{agentName}}. Current state: {{context}}. Decide one action and delaySeconds. Respond with a single JSON object only.', {
    agentName,
    context: safeStringify(context),
  }).trim();

  const { text, usedKeyIndex } = await callLLM({
    prompt: instruction,
    maxAttempts: undefined,
  });

  let parsed;
  try {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    const jsonText =
      jsonStart >= 0 && jsonEnd >= 0 ? text.slice(jsonStart, jsonEnd + 1) : text;
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Failed to parse JSON from Gemini: ${err.message}\nText: ${text}`);
  }

  if (!parsed || typeof parsed.action !== 'string') {
    throw new Error(`Respons Gemini tidak memiliki field "action": ${text}`);
  }

  return { decision: parsed, usedKeyIndex };
}

async function runAction(decision, state) {
  const action = decision.action;

  if (action === 'register') {
    if (state.moltbookApiKey) {
      console.log('Already has a Moltbook API key, skipping register.');
      return state;
    }

    const defaultName = personalizeConfig.agent?.name || 'MoltbookAgent';
    const defaultDesc = personalizeConfig.agent?.description || 'An agentic AI on Moltbook. Edit personalize.json to set your description.';
    const agentName =
      state.agentName ||
      (typeof decision.agentName === 'string' && decision.agentName.trim().length > 0
        ? decision.agentName.trim()
        : defaultName);
    const description =
      state.agentDescription ||
      (typeof decision.description === 'string' && decision.description.trim().length > 0
        ? decision.description.trim()
        : defaultDesc);

    console.log(`Registering a new Moltbook agent with name: ${agentName}`);

    const data = await registerAgent(agentName, description);
    const apiKey = data?.agent?.api_key || null;
    const claimUrl = data?.agent?.claim_url || null;
    const verificationCode = data?.agent?.verification_code || null;

    if (!apiKey) {
      throw new Error('Register succeeded but no api_key was returned in the response.');
    }

    const nextState = saveState({
      moltbookApiKey: apiKey,
      agentName,
      agentDescription: description,
    });

    console.log('Moltbook registration succeeded.');
    if (claimUrl) {
      console.log(`Claim URL (share this with your human): ${claimUrl}`);
    }
    if (verificationCode) {
      console.log(`Verification code (for claiming on X): ${verificationCode}`);
    }
    recordAction('register', `Registered agent ${agentName} (pending claim).`, {
      agentName,
      profileUrl: data?.agent?.profile_url,
      status: data?.status || 'pending_claim',
    });
    return nextState;
  }

  if (action === 'check_status') {
    if (!state.moltbookApiKey) {
      console.log('No Moltbook API key yet, cannot check status.');
      return state;
    }

    console.log('Checking Moltbook claim status...');
    const data = await getStatus(state.moltbookApiKey);
    const status = data?.status || data;
    const nextState = saveState({
      lastStatus: status,
    });
    console.log('Claim status:', status);
    recordAction('check_status', `Claim status: ${status}`, { status });
    return nextState;
  }

  if (action === 'home') {
    if (!state.moltbookApiKey) {
      console.log('No Moltbook API key yet, cannot call /home.');
      return state;
    }

    console.log('Calling Moltbook dashboard (/home)...');
    const data = await getHome(state.moltbookApiKey);

    const yourAccount = data?.your_account || {};
    const unread = yourAccount.unread_notification_count ?? 0;
    const karma = yourAccount.karma ?? 0;

    console.log(
      'Home summary:',
      `name=${yourAccount.name || 'unknown'}, karma=${karma}, unread_notifications=${unread}`,
    );

    const now = new Date().toISOString();
    const followingPosts = data?.posts_from_accounts_you_follow?.posts || [];
    const fromFollowed = new Set(Array.isArray(state.followingNames) ? state.followingNames : []);
    for (const p of followingPosts) {
      const name = p.author_name || p.author?.name;
      if (name && typeof name === 'string') fromFollowed.add(name.trim());
    }
    const nextState = saveState({
      lastMoltbookCheck: now,
      followingNames: Array.from(fromFollowed),
    });
    recordAction(
      'home',
      `Home: karma=${karma}, unread=${unread}`,
      {
        karma,
        unreadNotifications: unread,
      },
    );
    return nextState;
  }

  if (action === 'follow') {
    if (!state.moltbookApiKey) {
      console.log('No Moltbook API key yet, cannot follow.');
      return state;
    }
    const name =
      (typeof decision.agentName === 'string' && decision.agentName.trim())
        ? decision.agentName.trim()
        : pickFollowCandidate(state);
    if (!name) {
      console.log('No follow candidate, skipping follow.');
      return state;
    }
    const following = new Set(Array.isArray(state.followingNames) ? state.followingNames : []);
    if (following.has(name)) {
      console.log(`Already following ${name}, skipping.`);
      return state;
    }
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const lastFollowAt = state.lastFollowAt ? new Date(state.lastFollowAt).getTime() : 0;
    if (lastFollowAt && Date.now() - lastFollowAt < sixHoursMs) {
      console.log('Follow cooldown not reached, skipping.');
      return state;
    }
    try {
      await followAgent(state.moltbookApiKey, name);
      const nextFollowing = [...(state.followingNames || []), name];
      const nextState = saveState({
        lastFollowAt: new Date().toISOString(),
        followingNames: nextFollowing,
      });
      recordAction('follow', `Followed ${name} (consistently enjoyed their content).`, {
        agentName: name,
      });
      console.log(`Followed agent: ${name}`);
      return nextState;
    } catch (err) {
      console.error('Follow failed:', err.message);
      return state;
    }
  }

  if (action === 'post') {
    if (!state.moltbookApiKey) {
      console.log('No Moltbook API key yet, cannot create a post.');
      return state;
    }

    const now = Date.now();
    const lastPostAt = state.lastPostAt ? Date.parse(state.lastPostAt) : 0;
    const fortyMinutes = 40 * 60 * 1000;
    if (lastPostAt && now - lastPostAt < fortyMinutes) {
      console.log('Recently posted, waiting before creating a new post.');
      return state;
    }

    const title =
      typeof decision.title === 'string' && decision.title.trim().length > 0
        ? decision.title.trim()
        : 'Thoughts from an autonomous coding agent';
    const content =
      typeof decision.content === 'string' && decision.content.trim().length > 0
        ? decision.content.trim()
        : 'I help my human with planning, coding, and Moltbook interactions using Gemini-based reasoning.';

    console.log('Creating a new post on Moltbook (submolt general)...');
    const data = await createPost(state.moltbookApiKey, {
      submoltName: 'general',
      title,
      content,
    });

    const post = data?.post || data;
    console.log('Post created. Title:', post?.title || title);

    const verification = post?.verification || data?.verification;
    if (verification && verification.verification_code && verification.challenge_text) {
      console.log('Post requires verification. Solving the challenge...');
      await solveAndVerifyVerification(state, verification, 'Post verification result');
    }

    const updated = saveState({
      lastPostAt: new Date().toISOString(),
    });

    try {
      const topicInfo = await classifyInteraction({
        postTitle: post?.title || title,
        postContent: post?.content || content,
        commentText: null,
      });
      recordTopicEntry({
        ...topicInfo,
        source: 'post',
        postTitle: post?.title || title,
        snippet: content.slice(0, 200),
      });
      recordAction('post', `Posted in general: "${title.slice(0, 80)}"`, {
        title,
        submolt: 'general',
        topic: topicInfo.topic,
      });
    } catch (err) {
      console.error('Failed to record topic for post:', err.message);
      recordAction('post', `Posted in general: "${title.slice(0, 80)}"`, {
        title,
        submolt: 'general',
      });
    }

    return updated;
  }

  if (action === 'comment') {
    if (!state.moltbookApiKey) {
      console.log('No Moltbook API key yet, cannot create a comment.');
      return state;
    }

    const now = Date.now();
    const lastCommentAt = state.lastCommentAt ? Date.parse(state.lastCommentAt) : 0;
    const sixtySeconds = 60 * 1000;
    if (lastCommentAt && now - lastCommentAt < sixtySeconds) {
      console.log('Recently commented, waiting before commenting again.');
      return state;
    }

    console.log('Fetching feed to look for an interesting post...');
    const feed = await getFeed(state.moltbookApiKey, { sort: 'hot', limit: 20 });
    const posts = feed?.posts || feed?.data?.posts || [];
    if (!Array.isArray(posts) || posts.length === 0) {
      console.log('No posts in the feed to comment on.');
      return state;
    }

    const commentedPostIds = getCommentedPostIds(state);
    const eligible = posts.filter((p) => {
      const id = p.post_id || p.id || p.postId;
      return id && !commentedPostIds.has(String(id));
    });
    const pool = eligible.length > 0 ? eligible : posts;

    const pickWithVariety = () => {
      const preferredInPool = pool.filter((p) => {
        const text = `${p.title || ''} ${p.content_preview || ''} ${p.content || ''}`.toLowerCase();
        return PREFERRED_KEYWORDS.some((kw) => text.includes(kw));
      });
      const candidates = preferredInPool.length > 0 ? preferredInPool : pool;
      const shuffled = [...candidates].sort(() => Math.random() - 0.5);
      return shuffled[0];
    };

    const target = pickWithVariety();
    const fallbackContent =
      typeof decision.content === 'string' && decision.content.trim().length > 0
        ? decision.content.trim()
        : 'Interesting post! Thanks for sharing.';
    const content = await generateCommentForPost(state, target, fallbackContent);

    console.log(`Adding comment to post: ${target.title || target.post_title || target.post_id}`);
    const data = await addComment(state.moltbookApiKey, {
      postId: target.post_id || target.id || target.postId,
      content,
    });

    const comment = data?.comment || data;
    const verification = comment?.verification || data?.verification;
    if (verification && verification.verification_code && verification.challenge_text) {
      console.log('Comment requires verification. Solving the challenge...');
      await solveAndVerifyVerification(state, verification, 'Comment verification result');
    }

    const postId = target.post_id || target.id || target.postId;
    if (postId) {
      try {
        await upvotePost(state.moltbookApiKey, postId);
        console.log('Upvoted the post we commented on.');
      } catch (e) {
        console.error('Upvote post failed (non-fatal):', e.message);
      }
    }

    const updated = saveState({
      lastCommentAt: new Date().toISOString(),
    });

    try {
      const topicInfo = await classifyInteraction({
        postTitle: target.title || target.post_title || null,
        postContent: target.content_preview || target.content || null,
        commentText: content,
      });
      recordTopicEntry({
        ...topicInfo,
        source: 'comment',
        postTitle: target.title || target.post_title || null,
        snippet: content.slice(0, 200),
      });
      recordAction('comment', 'Commented on a post from feed.', {
        postId: target.post_id || target.id || target.postId,
        postTitle: target.title || target.post_title || null,
        postAuthor: target.author_name || target.author?.name || null,
        commentPreview: content.slice(0, 160),
        topic: topicInfo.topic,
      });
    } catch (err) {
      console.error('Gagal menyimpan topik untuk comment:', err.message);
      recordAction('comment', 'Commented on a post from feed.', {
        postId: target.post_id || target.id || target.postId,
        postTitle: target.title || target.post_title || null,
        postAuthor: target.author_name || target.author?.name || null,
        commentPreview: content.slice(0, 160),
      });
    }

    return updated;
  }

  if (action === 'idle') {
    console.log('Agent memilih idle (tidak melakukan aksi Moltbook kali ini).');
    return state;
  }

  console.log(`Aksi tidak dikenal dari Gemini: ${action}, tidak melakukan apa-apa.`);
  return state;
}

async function maybeReplyToComments(state) {
  if (!state.moltbookApiKey) {
    return state;
  }

  // Respect the global comment cooldown (20 seconds in the RULES, we use a 60 second buffer).
  const now = Date.now();
  const lastCommentAt = state.lastCommentAt ? Date.parse(state.lastCommentAt) : 0;
  const sixtySeconds = 60 * 1000;
  if (lastCommentAt && now - lastCommentAt < sixtySeconds) {
    return state;
  }

  console.log('Checking if there are new comments that need a reply...');
  const home = await getHome(state.moltbookApiKey);
  const yourAccount = home?.your_account || {};
  const selfName = yourAccount.name;
  const activities = home?.activity_on_your_posts || [];

  const targetActivity = activities.find((a) => a.new_notification_count && a.new_notification_count > 0);
  if (!targetActivity) {
    console.log('No new activity on own posts that needs a reply.');
    return state;
  }

  const postId = targetActivity.post_id;
  console.log(`Fetching comments for post with id: ${postId}`);
  const commentsResp = await getPostComments(state.moltbookApiKey, {
    postId,
    sort: 'new',
  });

  const comments = commentsResp?.comments || commentsResp || [];
  if (!Array.isArray(comments) || comments.length === 0) {
    console.log('No comments on this post.');
    return state;
  }

  // Ambil komentar terbaru yang bukan dari diri sendiri.
  const targetComment = comments.find((c) => c.author?.name !== selfName) || comments[0];

  const agentName = personalizeConfig.agent?.name || 'MoltbookAgent';
  const decisionPrompt = fillTemplate(personalizeConfig.prompts.replyToComment || 'You are {{agentName}}. Your name: {{selfName}}. Post: {{postTitle}}. Target comment: {{targetComment}}. Decide shouldReply and reply. Respond JSON only.', {
    agentName,
    selfName: selfName || 'MoltbookAgent',
    postTitle: targetActivity.post_title,
    targetComment: safeStringify(targetComment),
  }).trim();

  const { text } = await callLLM({ prompt: decisionPrompt });
  let replyDecision;
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const json = start >= 0 && end >= 0 ? text.slice(start, end + 1) : text;
    replyDecision = JSON.parse(json);
  } catch (err) {
    console.error('Failed to parse reply decision from Gemini:', err.message);
    return state;
  }

  if (!replyDecision || replyDecision.shouldReply !== true || !replyDecision.reply) {
    console.log('Gemini decided not to reply to this comment.');
    return state;
  }

  const replyText = String(replyDecision.reply).trim();
  if (!replyText) {
    console.log('Reply text is empty, aborting.');
    return state;
  }

  console.log('Replying to comment with an automatic response...');
  const commentResult = await addComment(state.moltbookApiKey, {
    postId,
    content: replyText,
    parentId: targetComment.id || targetComment.comment_id,
  });

  const verification = commentResult?.verification || commentResult?.comment?.verification;
  if (verification && verification.verification_code && verification.challenge_text) {
    console.log('Reply comment requires verification. Solving the challenge...');
    await solveAndVerifyVerification(state, verification, 'Reply comment verification result');
  }

  try {
    await markNotificationsReadByPost(state.moltbookApiKey, { postId });
  } catch (err) {
    console.error('Failed to mark notifications as read:', err.message);
  }

  const updated = saveState({
    lastCommentAt: new Date().toISOString(),
  });
  try {
    const topicInfo = await classifyInteraction({
      postTitle: targetActivity.post_title,
      postContent: null,
      commentText: `${targetComment.content || ''}\nReply: ${replyText}`,
    });
    recordTopicEntry({
      ...topicInfo,
      source: 'reply_comment',
      postTitle: targetActivity.post_title,
      snippet: replyText.slice(0, 200),
    });
    recordAction('reply_comment', 'Replied to a comment on own post.', {
      postTitle: targetActivity.post_title,
      targetAuthor: targetComment.author?.name || null,
      replyPreview: replyText.slice(0, 160),
      topic: topicInfo.topic,
    });
  } catch (err) {
    console.error('Failed to record topic for reply comment:', err.message);
    recordAction('reply_comment', 'Replied to a comment on own post.', {
      postTitle: targetActivity.post_title,
      targetAuthor: targetComment.author?.name || null,
      replyPreview: replyText.slice(0, 160),
    });
  }
  return updated;
}

async function runAgentLoop() {
  const state = await ensureState();

  const stats = getRecentStats(state);
  const { decision, usedKeyIndex } = await decideNextAction(state);
  const finalDecision = applyActionHeuristics(decision, stats, state);
  console.log(
    'Gemini decision:',
    safeStringify({
      action: finalDecision.action,
      delaySeconds: finalDecision.delaySeconds,
      originalAction: decision.action,
    }),
  );

  let updatedState = await runAction(finalDecision, state);

  // After the main action, try replying to new comments on own posts.
  try {
    updatedState = await maybeReplyToComments(updatedState);
  } catch (err) {
    console.error('Failed to process reply comments:', err.message);
  }

  // Periodically update persona summary based on interaction history.
  try {
    updatedState = await maybeUpdatePersonaSummary(updatedState);
  } catch (err) {
    console.error('Failed to update persona summary:', err.message);
  }

  let delaySeconds = Number(finalDecision.delaySeconds);
  if (!Number.isFinite(delaySeconds)) {
    delaySeconds = 30;
  }
  delaySeconds = Math.max(1, Math.min(60, Math.round(delaySeconds)));

  console.log(
    'Loop finished. Summary:',
    safeStringify({
      action: decision.action,
      provider: getPrimaryProvider(),
      usedKeyIndex,
      hasMoltbookApiKey: Boolean(updatedState.moltbookApiKey),
      lastMoltbookCheck: updatedState.lastMoltbookCheck,
      lastStatus: updatedState.lastStatus,
      nextDelaySeconds: delaySeconds,
    }),
  );

  return delaySeconds;
}

module.exports = {
  runAgentLoop,
};

