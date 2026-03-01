require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const { getHome } = require('./moltbookClient');
const { loadState } = require('./stateStore');

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3000;

function loadLocalState() {
  try {
    return loadState();
  } catch (err) {
    return { error: err.message };
  }
}

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
  const recentActions = Array.isArray(state.recentActions) ? state.recentActions : [];

  const topicStats =
    state.topicStats && typeof state.topicStats === 'object' ? state.topicStats : {};
  const topTopics = Object.entries(topicStats)
    .map(([topic, info]) => ({
      topic,
      count: info.count || 0,
      lastAt: info.lastAt || null,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="refresh" content="10" />
  <title>Agentic Gemini AI for Sosmed Moltbook – Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
  <style>
    body { background-color: #020617; }
  </style>
</head>
<body class="text-gray-100">
  <div class="max-w-6xl mx-auto px-4 py-6">
    <header class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold">Agentic Gemini AI for Sosmed Moltbook</h1>
        <p class="text-sm text-gray-400">A friendly live dashboard for your Moltbook agentic Gemini bot.</p>
      </div>
      <button onclick="location.reload()" class="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm">
        Refresh
      </button>
    </header>

    <section class="grid gap-4 md:grid-cols-2 mb-6">
      <div class="bg-slate-900 rounded-lg p-4 shadow">
        <h2 class="text-sm font-semibold text-gray-300 mb-2">Account</h2>
        <p class="text-lg font-semibold">${yourAccount.name || 'Unknown'}</p>
        <p class="text-xs text-gray-400 mt-1">${state.agentDescription || ''}</p>
        <dl class="mt-3 space-y-1 text-sm">
          <div class="flex justify-between"><dt>Karma</dt><dd>${yourAccount.karma ?? 0}</dd></div>
          <div class="flex justify-between"><dt>Unread Notifications</dt><dd>${yourAccount.unread_notification_count ?? 0}</dd></div>
          <div class="flex justify-between"><dt>Last Moltbook Check</dt><dd class="text-gray-400 text-xs">${state.lastMoltbookCheck || '-'}</dd></div>
          <div class="flex justify-between"><dt>Last Status</dt><dd>${state.lastStatus || '-'}</dd></div>
        </dl>
      </div>

      <div class="bg-slate-900 rounded-lg p-4 shadow">
        <h2 class="text-sm font-semibold text-gray-300 mb-2">Posting Activity</h2>
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

    <section class="mb-6 grid gap-4 md:grid-cols-2">
      <div class="bg-slate-900 rounded-lg p-4 shadow">
        <h2 class="text-sm font-semibold text-gray-300 mb-2">Persona Summary</h2>
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

    <section class="mb-6">
      <h2 class="text-sm font-semibold text-gray-300 mb-2">Activity On Your Posts</h2>
      <div class="space-y-3">
        ${
          activities.length === 0
            ? '<p class="text-sm text-gray-400">No new activity yet.</p>'
            : activities
                .map(
                  (a) => `
          <article class="bg-slate-900 rounded-lg p-3 shadow">
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

    <section class="mb-6">
      <h2 class="text-sm font-semibold text-gray-300 mb-2">Posts From Accounts You Follow</h2>
      <div class="space-y-3">
        ${
          followingPosts.length === 0
            ? '<p class="text-sm text-gray-400">No posts yet from accounts you follow.</p>'
            : followingPosts
                .map(
                  (p) => `
          <article class="bg-slate-900 rounded-lg p-3 shadow">
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

    <section class="mb-6">
      <h2 class="text-sm font-semibold text-gray-300 mb-2">Recent Bot Actions</h2>
      <div class="space-y-3">
        ${
          recentActions.length === 0
            ? '<p class="text-sm text-gray-400">No actions recorded yet.</p>'
            : recentActions
                .map(
                  (a) => `
          <article class="bg-slate-900 rounded-lg p-3 shadow flex items-start justify-between">
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

    <footer class="mt-8 text-center text-xs text-gray-500">
      Agentic Gemini AI for Sosmed Moltbook · owner dashboard · Local only
    </footer>
  </div>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});

