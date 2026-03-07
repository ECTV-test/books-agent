// Book Agent — Cloudflare Worker
// Routes: /api/auth, /api/config, /api/provider, /api/admin/auth,
//         /api/detect-level, /api/adapt, /api/translate, /api/describe

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Editor-Token',
};

const ALLOWED_PROVIDERS = ['openai', 'google', 'claude'];

const LANG_NAMES = {
  uk: 'Ukrainian', ru: 'Russian', pl: 'Polish',
  de: 'German',   es: 'Spanish', fr: 'French',
  it: 'Italian',  pt: 'Portuguese', cz: 'Czech',
};

const LEVEL_PROMPTS = {
  A1: 'A1 (absolute beginner): max 500 most common words, sentences max 8 words, present tense only, no idioms',
  A2: 'A2 (elementary): max 1500 common words, sentences max 12 words, simple past/present, no complex grammar',
  B1: 'B1 (intermediate): everyday vocabulary, sentences max 18 words, standard tenses, minimal idioms',
  B2: 'B2 (upper-intermediate): natural vocabulary, varied sentence structure, all common tenses, some idioms',
};

// ─── Router ─────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const { pathname } = new URL(request.url);

    try {
      // Public endpoints (no editor token required)
      if (pathname === '/api/auth'          && request.method === 'POST') return editorAuth(request, env);
      if (pathname === '/api/admin/auth'    && request.method === 'POST') return adminAuth(request, env);

      // All other endpoints require editor token
      const authErr = checkEditorAuth(request, env);
      if (authErr) return authErr;

      if (pathname === '/api/config'        && request.method === 'GET')  return getConfig(env);
      if (pathname === '/api/provider'      && request.method === 'POST') return setProvider(request, env);
      if (pathname === '/api/detect-level'  && request.method === 'POST') return detectLevel(request, env);
      if (pathname === '/api/adapt'         && request.method === 'POST') return adapt(request, env);
      if (pathname === '/api/translate'     && request.method === 'POST') return translate(request, env);
      if (pathname === '/api/describe'      && request.method === 'POST') return describe(request, env);

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500);
    }
  },
};

// ─── Config ─────────────────────────────────────────────────────────────────

async function getConfig(env) {
  const provider = await env.KV.get('active_provider') || 'openai';
  return json({
    provider,
    keys: {
      openai: !!env.OPENAI_API_KEY,
      google: !!env.GOOGLE_API_KEY,
      claude: !!env.ANTHROPIC_API_KEY,
    },
  });
}

// ─── Editor auth ─────────────────────────────────────────────────────────────

async function editorAuth(request, env) {
  const { password } = await request.json();
  if (!env.EDITOR_PASSWORD || password !== env.EDITOR_PASSWORD) {
    return json({ ok: false, error: 'Wrong password' }, 401);
  }
  return json({ ok: true });
}

function checkEditorAuth(request, env) {
  // If EDITOR_PASSWORD is not set, auth is disabled (dev mode)
  if (!env.EDITOR_PASSWORD) return null;
  const token = request.headers.get('X-Editor-Token');
  if (!token || token !== env.EDITOR_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

// ─── Admin auth ──────────────────────────────────────────────────────────────

async function adminAuth(request, env) {
  const { password } = await request.json();
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    return json({ ok: false, error: 'Invalid password' }, 401);
  }
  return json({ ok: true });
}

async function setProvider(request, env) {
  const { provider } = await request.json();
  if (!ALLOWED_PROVIDERS.includes(provider)) return json({ error: 'Invalid provider' }, 400);
  await env.KV.put('active_provider', provider);
  return json({ ok: true, provider });
}

// ─── Detect level ────────────────────────────────────────────────────────────

async function detectLevel(request, env) {
  const { text } = await request.json();

  const result = await openai(env.OPENAI_API_KEY, {
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: 'You are a CEFR language assessor. Analyze the text and return ONLY the level code: A1, A2, B1, B2, C1, or C2. Nothing else.',
      },
      { role: 'user', content: `Assess CEFR level:\n\n${text.slice(0, 2000)}` },
    ],
    max_tokens: 5,
    temperature: 0,
  });

  const level = result.choices[0].message.content.trim().toUpperCase();
  return json({ level });
}

// ─── Adapt ───────────────────────────────────────────────────────────────────

async function adapt(request, env) {
  const { text, fromLevel, toLevel } = await request.json();

  const result = await openai(env.OPENAI_API_KEY, {
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert English language teacher adapting literary texts for learners.
Adapt the text from ${fromLevel} to ${LEVEL_PROMPTS[toLevel]}.

Content rules:
- Keep ALL story events, characters, and plot intact — nothing removed
- Replace complex words with simpler synonyms appropriate for the target level
- Shorten sentences as needed for the target level
- Keep proper names unchanged

Formatting rules (strict):
- Each sentence must be on its own line
- Each speaker's dialogue must start on a new line
- Leave one blank line between paragraphs
- A paragraph should contain 1–3 sentences maximum
- Never merge sentences into long lines — break by meaning, not character count
- Keep [[CHAPTER: ...]] markers exactly as they appear, on their own line

Output ONLY the adapted text, no comments or explanations.`,
      },
      { role: 'user', content: text },
    ],
    temperature: 0.3,
  });

  return json({ text: result.choices[0].message.content.trim() });
}

// ─── Translate ───────────────────────────────────────────────────────────────

async function translate(request, env) {
  const { text, targetLang } = await request.json();
  const provider = await env.KV.get('active_provider') || 'openai';

  if (provider === 'openai')  return translateOpenAI(text, targetLang, env);
  // if (provider === 'google') return translateGoogle(text, targetLang, env);
  // if (provider === 'claude') return translateClaude(text, targetLang, env);

  return json({ error: `Provider "${provider}" not yet implemented` }, 400);
}

async function translateOpenAI(text, targetLang, env) {
  const langName = LANG_NAMES[targetLang] || targetLang;

  const result = await openai(env.OPENAI_API_KEY, {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a professional literary translator. Translate the English text to ${langName}.

Content rules:
- Preserve style, tone, and meaning exactly
- Keep [[CHAPTER: ...]] markers — translate only the chapter name inside them

Formatting rules (strict — preserve exactly):
- Each sentence must remain on its own line — do not merge lines
- Keep blank lines between paragraphs exactly as in the source
- Each speaker's dialogue must start on a new line
- Do not add or remove line breaks — mirror the source structure

Output ONLY the translation, no explanations.`,
      },
      { role: 'user', content: text },
    ],
    temperature: 0.2,
  });

  return json({ text: result.choices[0].message.content.trim() });
}

// ─── Describe ────────────────────────────────────────────────────────────────

async function describe(request, env) {
  const { title, author, excerpt, targetLang } = await request.json();
  const langName = LANG_NAMES[targetLang] || 'English';

  const result = await openai(env.OPENAI_API_KEY, {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Write a short book description (2–3 sentences, max 60 words) in ${langName} for the book "${title}" by ${author}. Output ONLY the description text.`,
      },
      { role: 'user', content: `Book excerpt:\n${excerpt.slice(0, 3000)}` },
    ],
    max_tokens: 150,
    temperature: 0.5,
  });

  return json({ description: result.choices[0].message.content.trim() });
}

// ─── OpenAI helper ───────────────────────────────────────────────────────────

async function openai(apiKey, body) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI ${response.status}: ${err}`);
  }

  return response.json();
}

// ─── Response helper ─────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
