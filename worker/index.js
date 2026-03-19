// Book Agent — Cloudflare Worker
// Routes: /api/auth, /api/config, /api/provider, /api/admin/auth,
//         /api/structure, /api/detect-level, /api/adapt, /api/translate, /api/describe,
//         /api/models (POST), /api/generate-cover (POST)

const ADAPT_MODELS     = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'];
const TRANSLATE_MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'];

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
  B2: `B2 (upper intermediate):
- Simplify complex sentence structures while preserving literary style
- Replace rare or archaic vocabulary with common modern equivalents
- Keep idioms where their meaning is clear from context
- Preserve the author's tone: if the original is humorous — keep the humor; if dramatic — keep the drama`,

  B1: `B1 (intermediate):
- Use only common vocabulary (top 5000 most frequent English words)
- Maximum 20 words per sentence — break longer sentences into shorter ones
- Replace idioms by rewriting them plainly in simple language
- Keep descriptive passages but simplify the language`,

  A2: `A2 (elementary):
- Use only high-frequency vocabulary (top 2000 most frequent English words)
- Maximum 15 words per sentence
- No idioms — replace with literal, simple descriptions
- Keep only essential plot elements; reduce lengthy descriptions`,

  A1: `A1 (beginner):
- Use only the most basic vocabulary (top 1000 most frequent English words)
- Maximum 10 words per sentence
- Use present tense wherever possible
- Use Subject-Verb-Object structure only
- After writing each sentence, ask: "Can a complete beginner understand this?" — if not, rewrite it`,
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

      if (pathname === '/api/config'          && request.method === 'GET')  return getConfig(env);
      if (pathname === '/api/provider'        && request.method === 'POST') return setProvider(request, env);
      if (pathname === '/api/models'          && request.method === 'POST') return setModels(request, env);
      if (pathname === '/api/structure'       && request.method === 'POST') return detectStructure(request, env);
      if (pathname === '/api/detect-level'    && request.method === 'POST') return detectLevel(request, env);
      if (pathname === '/api/adapt'           && request.method === 'POST') return adapt(request, env);
      if (pathname === '/api/translate'       && request.method === 'POST') return translate(request, env);
      if (pathname === '/api/describe'        && request.method === 'POST') return describe(request, env);
      if (pathname === '/api/generate-cover'         && request.method === 'POST') return generateCover(request, env);
      if (pathname === '/api/generate-chapter-image' && request.method === 'POST') return generateChapterImage(request, env);

      if (pathname === '/api/batch-submit'   && request.method === 'POST') return batchSubmit(request, env);
      if (pathname === '/api/batch-jobs'     && request.method === 'GET')  return batchJobs(request, env);
      if (pathname === '/api/batch-status'   && request.method === 'GET')  return batchStatus(request, env);
      if (pathname === '/api/batch-download' && request.method === 'POST') return batchDownload(request, env);

      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500);
    }
  },
};

// ─── Config ─────────────────────────────────────────────────────────────────

async function getConfig(env) {
  const provider      = await env.KV.get('active_provider')   || 'openai';
  const adaptModel    = await env.KV.get('adapt_model')        || 'gpt-4o';
  const translateModel = await env.KV.get('translate_model')   || 'gpt-4o-mini';
  return json({
    provider,
    adaptModel,
    translateModel,
    keys: {
      openai: !!env.OPENAI_API_KEY,
      google: !!env.GOOGLE_API_KEY,
      claude: !!env.ANTHROPIC_API_KEY,
    },
  });
}

async function setModels(request, env) {
  const { adaptModel, translateModel } = await request.json();
  if (adaptModel    && !ADAPT_MODELS.includes(adaptModel))     return json({ error: 'Invalid adapt model' }, 400);
  if (translateModel && !TRANSLATE_MODELS.includes(translateModel)) return json({ error: 'Invalid translate model' }, 400);
  if (adaptModel)     await env.KV.put('adapt_model',     adaptModel);
  if (translateModel) await env.KV.put('translate_model', translateModel);
  return json({ ok: true, adaptModel, translateModel });
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

// ─── Structure detection ─────────────────────────────────────────────────────

async function detectStructure(request, env) {
  const { sample, candidates } = await request.json();
  // sample: first ~6000 chars of cleaned text
  // candidates: standalone short lines from the full text (potential story titles)

  const result = await openai(env.OPENAI_API_KEY, {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You analyze the structure of literary texts. Return ONLY valid JSON, no other text.

Determine the structure type:
- "single": one story or book (may have named chapters, but one unified narrative)
- "collection": multiple independent stories/essays, each with its own title
- "chapters": one book divided into named chapters

If "collection": list ONLY the story titles that are actual story/essay titles, IN ORDER.
Use the exact title text as it appears in the candidates list.

Return JSON:
{"type":"collection","stories":["Title 1","Title 2",...]}
or
{"type":"single"}
or
{"type":"chapters"}`,
      },
      {
        role: 'user',
        content: `Text beginning (first 6000 chars):\n${sample}\n\n---\nStandalone short lines found throughout the text (potential titles):\n${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
      },
    ],
    max_tokens: 600,
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  try {
    const data = JSON.parse(result.choices[0].message.content);
    return json({
      type:    data.type || 'single',
      stories: data.stories || [],
    });
  } catch {
    return json({ type: 'single', stories: [] });
  }
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
  const model = await env.KV.get('adapt_model') || 'gpt-4o';

  const result = await openai(env.OPENAI_API_KEY, {
    model,
    messages: [
      {
        role: 'system',
        content: `You are an expert English language teacher adapting literary texts for learners.
Adapt the following ${fromLevel}-level English text to ${toLevel} level.

Target level requirements:
${LEVEL_PROMPTS[toLevel]}

Content rules:
- Preserve ALL story events, characters, and plot — nothing removed, nothing added
- NEVER change character names — keep them exactly as in the original (e.g. "Stuffy Pete" stays "Stuffy Pete")
- NEVER translate or localize proper nouns — character names, place names, institution names stay in English
- Preserve the author's tone completely — if the original is humorous, keep the humor; if dramatic, keep the drama
- Preserve stylistic devices: irony, metaphors, imagery — simplify language but not the style

Formatting rules (strict):
- Each sentence on its own line
- Each speaker's dialogue starts on a new line
- One blank line between paragraphs
- Keep [[CHAPTER: ...]] markers on their own line — ALWAYS with a title inside: [[CHAPTER: Chapter 1]], [[CHAPTER: Chapter 2]], etc. NEVER write [[CHAPTER:]] with an empty title — if the source has no title, generate one like "Chapter N"

Output ONLY the adapted text, no comments or explanations.`,
      },
      { role: 'user', content: text },
    ],
    temperature: 0.3,
  });

  // Guard: never let an empty [[CHAPTER:]] through in adapted output
  let chN = 0;
  const adaptedText = result.choices[0].message.content.trim()
    .replace(/\[\[CHAPTER:\s*\]\]/g, () => `[[CHAPTER: Chapter ${++chN}]]`);

  return json({ text: adaptedText });
}

// ─── Translate ───────────────────────────────────────────────────────────────

async function translate(request, env) {
  const { text, targetLang, level } = await request.json();
  const provider = await env.KV.get('active_provider') || 'openai';

  if (provider === 'openai')  return translateOpenAI(text, targetLang, level, env);
  // if (provider === 'google') return translateGoogle(text, targetLang, level, env);
  // if (provider === 'claude') return translateClaude(text, targetLang, level, env);

  return json({ error: `Provider "${provider}" not yet implemented` }, 400);
}

const TRANSLATE_LEVEL_INSTRUCTIONS = {
  original: (lang) => `This is the original literary text. Translate it as a full literary translation:
- The result must feel like it was written in ${lang}, not translated from English
- Preserve the author's voice, rhythm, sentence variety, and stylistic devices
- Preserve metaphors, irony, humor — find the target-language equivalent, not a literal version`,

  b2: (lang) => `This is a B2-level (upper intermediate) text. Translate naturally:
- Preserve literary style while using clear, accessible ${lang}
- Keep the author's tone`,

  b1: (lang) => `This is a B1-level (intermediate) simplified text:
- Use common, everyday vocabulary in ${lang}
- Match the simplicity of the English source — no complex expressions`,

  a2: (lang) => `This is an A2-level (elementary) text:
- Use simple, high-frequency vocabulary in ${lang}
- Keep sentences short and clear`,

  a1: (lang) => `This is an A1-level (beginner) text:
- Use only the most basic vocabulary in ${lang}
- Very short sentences, simple Subject-Verb-Object structure`,
};

async function translateOpenAI(text, targetLang, level, env) {
  const langName = LANG_NAMES[targetLang] || targetLang;
  const levelInstructions = (TRANSLATE_LEVEL_INSTRUCTIONS[level] || TRANSLATE_LEVEL_INSTRUCTIONS.original)(langName);
  const model = await env.KV.get('translate_model') || 'gpt-4o-mini';

  // Tag every non-empty line with [NNN] so GPT is forced to translate
  // line-by-line — a text instruction alone ("keep each sentence on its own
  // line") is not reliable enough; numbered tags make the structure explicit.
  const inputLines = text.split('\n');
  let tagIdx = 0;
  const taggedLines = inputLines.map(line =>
    line.trim() === '' ? '' : `[${String(++tagIdx).padStart(3, '0')}] ${line}`
  );
  const taggedText = taggedLines.join('\n');

  const result = await openai(env.OPENAI_API_KEY, {
    model,
    messages: [
      {
        role: 'system',
        content: `You are a professional literary translator. Translate the English text to ${langName}.

${levelInstructions}

Name rules (strict):
- NEVER translate character names — transliterate them to ${langName} phonetically if needed (e.g. "Stuffy Pete" → phonetic equivalent, NOT a translation of the meaning)
- Place names: keep English or use established local equivalents
- A name must be identical in every level of the same book

CRITICAL formatting rules:
- Every non-empty input line starts with a tag like [001], [002], etc.
- Translate each tagged line into EXACTLY ONE output line, keeping its tag at the start
- Keep ALL tags in order — one tag per output line, no merging, no splitting
- Keep blank lines (lines without a tag) exactly where they appear
- Keep [[CHAPTER: ...]] markers — translate only the chapter name inside them. NEVER output [[CHAPTER:]] with an empty title

Output ONLY the translated tagged lines and blank lines. No notes, no explanations.`,
      },
      { role: 'user', content: taggedText },
    ],
    temperature: 0.2,
  });

  // Strip [NNN] tags from every line and return clean translated text
  let chapterN = 0;
  const translatedLines = result.choices[0].message.content
    .trim()
    .split('\n')
    .map(line => {
      const clean = line.replace(/^\[\d{3}\]\s?/, '');
      // Guard: never let an empty [[CHAPTER:]] through
      return clean.replace(/\[\[CHAPTER:\s*\]\]/g, () => `[[CHAPTER: Chapter ${++chapterN}]]`);
    });

  return json({ text: translatedLines.join('\n') });
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
        content: `Write a 2–3 sentence description (max 60 words) in ${langName} for the book "${title}" by ${author}.
Rules:
- Do NOT reveal the ending or any plot twists
- Match the tone of the original: if the story is humorous — write a fun, engaging description; if dramatic — match that mood
- Make the reader want to read the book
Output ONLY the description text, no labels or notes.`,
      },
      { role: 'user', content: `Book excerpt:\n${excerpt.slice(0, 3000)}` },
    ],
    max_tokens: 150,
    temperature: 0.5,
  });

  return json({ description: result.choices[0].message.content.trim() });
}

// ─── Generate Cover ──────────────────────────────────────────────────────────

async function generateCover(request, env) {
  const { title, author, description } = await request.json();

  // Step 1: GPT-4o-mini writes a genre-aware visual prompt for the cover
  const promptResult = await openai(env.OPENAI_API_KEY, {
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `Write a detailed visual prompt for an AI image generator to create a book cover illustration.

Book title: "${title}"
Author: ${author || 'Unknown'}
${description ? `Description: ${description}` : ''}

Rules:
- Detect the genre/mood from the title and description (children, fairy tale, adventure, detective, mystery, drama, romance, classic literature, sci-fi, thriller, etc.)
- Children / fairy tale → bright warm colors, soft lighting, playful characters, sunshine, flowers, magical atmosphere
- Detective / mystery / thriller → dark moody atmosphere, shadows, muted blues and grays, fog, suspenseful
- Adventure → vivid dynamic colors, dramatic sky, action, sweeping landscape
- Romance → warm soft tones, golden light, elegant composition, emotional atmosphere
- Drama / classic literature → painterly, rich earthy tones, period-appropriate setting
- Sci-fi / fantasy → otherworldly colors, dramatic lighting, imaginative world-building
- Describe a SCENE that captures the book's essence — not just abstract shapes
- Portrait composition (2:3 ratio), full-bleed illustration, suitable for a book cover
- Absolutely NO text, letters, numbers, words, typography, or signs in the image
- Professional quality, painterly or illustrative style
- Output ONLY the visual prompt. No explanation. Max 90 words.`,
    }],
    max_tokens: 150,
  });

  const visualPrompt = promptResult.choices[0].message.content.trim()
    + ' No text, no letters, no words anywhere in the image. Portrait book cover format.';

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: visualPrompt,
      n: 1,
      size: '1024x1536',
      output_format: 'jpeg',
      quality: 'medium',
    }),
  });

  const data = await response.json();
  if (!response.ok) return json({ error: data.error?.message || 'Image generation failed' }, 500);
  return json({ imageBase64: data.data[0].b64_json });
}

// ─── Generate Chapter Image ──────────────────────────────────────────────────

async function generateChapterImage(request, env) {
  const { chapterText, imageStyle, title } = await request.json();

  const styleDesc = {
    watercolor: 'soft watercolor illustration, pastel colors, artistic brushwork, impressionistic',
    minimal:    'minimalist illustration, clean geometric shapes, limited color palette, flat design',
    comic:      'comic book style, bold ink outlines, vivid saturated colors, dynamic composition',
  }[imageStyle] || 'atmospheric artistic illustration';

  // Step 1: GPT-4o-mini writes a focused visual scene prompt
  const promptResult = await openai(env.OPENAI_API_KEY, {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You write concise image generation prompts for book chapter illustrations.
Based on the chapter excerpt, write a single visual scene description (50–70 words).
Focus on: setting, atmosphere, mood, lighting, key objects and environment.
Do NOT mention faces, characters' appearances, text, or words.
Style to convey: ${styleDesc}.
Output ONLY the image prompt, no labels or explanations.`,
      },
      {
        role: 'user',
        content: `Book: "${title}"\n\nChapter excerpt:\n${chapterText}`,
      },
    ],
    max_tokens: 120,
    temperature: 0.7,
  });

  const imagePrompt = promptResult.choices[0].message.content.trim()
    + `. ${styleDesc}. No text, no letters, no faces.`;

  // Step 2: GPT Image 1 generates the illustration
  const imgResponse = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: imagePrompt,
      n: 1,
      size: '1024x1024',
      output_format: 'jpeg',
      quality: 'medium',
    }),
  });

  const data = await imgResponse.json();
  if (!imgResponse.ok) return json({ error: data.error?.message || 'Image generation failed' }, 500);
  return json({ imageBase64: data.data[0].b64_json });
}

// ─── Batch API ───────────────────────────────────────────────────────────────

async function batchSubmit(request, env) {
  const { meta, chapterTexts, excerpt, jobId } = await request.json();
  // meta: { title, author, slug, detectedLevel, languages, imageStyle }
  // chapterTexts: { original: [...], b2: [...], b1: [...], a2: [...], a1: [...] }
  // excerpt: first 2 chapters joined (for describe)
  // jobId: generated by frontend (alphanumeric, no underscores)

  const translateModel = await env.KV.get('translate_model') || 'gpt-4o-mini';
  const ALL_LEVELS = ['original', 'b2', 'b1', 'a2', 'a1'];
  const languages  = meta.languages || [];
  const requests   = [];

  // Translation requests: level × lang × chapter
  for (const lvl of ALL_LEVELS) {
    for (const lang of languages) {
      const langName = LANG_NAMES[lang] || lang;
      const levelInstructions = (TRANSLATE_LEVEL_INSTRUCTIONS[lvl] || TRANSLATE_LEVEL_INSTRUCTIONS.original)(langName);
      const chapters = chapterTexts[lvl] || [];

      for (let i = 0; i < chapters.length; i++) {
        // Tag lines (same approach as real-time translate)
        const inputLines = chapters[i].split('\n');
        let tagIdx = 0;
        const taggedText = inputLines.map(line =>
          line.trim() === '' ? '' : `[${String(++tagIdx).padStart(3, '0')}] ${line}`
        ).join('\n');

        requests.push({
          custom_id: `${jobId}_t_${lvl}_${lang}_${i}`,
          method: 'POST',
          url: '/v1/chat/completions',
          body: {
            model: translateModel,
            messages: [
              {
                role: 'system',
                content: `You are a professional literary translator. Translate the English text to ${langName}.\n\n${levelInstructions}\n\nName rules (strict):\n- NEVER translate character names — transliterate them to ${langName} phonetically if needed\n- Place names: keep English or use established local equivalents\n- A name must be identical in every level of the same book\n\nCRITICAL formatting rules:\n- Every non-empty input line starts with a tag like [001], [002], etc.\n- Translate each tagged line into EXACTLY ONE output line, keeping its tag at the start\n- Keep ALL tags in order — one tag per output line, no merging, no splitting\n- Keep blank lines (lines without a tag) exactly where they appear\n- Keep [[CHAPTER: ...]] markers — translate only the chapter name inside them. NEVER output [[CHAPTER:]] with an empty title\nOutput ONLY the translated tagged lines and blank lines. No notes, no explanations.`,
              },
              { role: 'user', content: taggedText },
            ],
            temperature: 0.2,
          },
        });
      }
    }
  }

  // Description requests: EN + each target language
  for (const lang of ['en', ...languages]) {
    const langName = LANG_NAMES[lang] || 'English';
    requests.push({
      custom_id: `${jobId}_d_${lang}`,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `Write a compelling 2-3 sentence book description (blurb) for a language learning app.\nBook: "${meta.title}" by ${meta.author || 'Unknown'}\nExcerpt:\n${excerpt}\nLanguage: ${langName}.\nOutput only the description, nothing else.`,
        }],
        max_tokens: 200,
        temperature: 0.7,
      },
    });
  }

  // Build JSONL
  const jsonl = requests.map(r => JSON.stringify(r)).join('\n');

  // Upload file to OpenAI
  const formData = new FormData();
  formData.append('file', new Blob([jsonl], { type: 'text/plain' }), 'batch.jsonl');
  formData.append('purpose', 'batch');

  const fileRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: formData,
  });
  if (!fileRes.ok) {
    const e = await fileRes.text();
    return json({ error: `File upload failed: ${e}` }, 500);
  }
  const fileData = await fileRes.json();

  // Create batch
  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input_file_id: fileData.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
    }),
  });
  if (!batchRes.ok) {
    const e = await batchRes.text();
    return json({ error: `Batch creation failed: ${e}` }, 500);
  }
  const batchData = await batchRes.json();

  // Store job in KV (store chapterTexts for assembly on download)
  const jobData = {
    id: jobId,
    openai_batch_id: batchData.id,
    meta,
    chapterTexts,
    excerpt,
    status: 'pending',
    created_at: Date.now(),
    request_count: requests.length,
  };
  await env.KV.put(`batch:${jobId}`, JSON.stringify(jobData));

  // Update job index
  const indexRaw = await env.KV.get('batch:index');
  const index = indexRaw ? JSON.parse(indexRaw) : [];
  index.unshift(jobId);
  await env.KV.put('batch:index', JSON.stringify(index.slice(0, 100)));

  return json({ jobId, batchId: batchData.id, requestCount: requests.length });
}

async function batchJobs(request, env) {
  const indexRaw = await env.KV.get('batch:index');
  if (!indexRaw) return json({ jobs: [] });

  const index = JSON.parse(indexRaw);
  const jobs = await Promise.all(index.map(async (id) => {
    const raw = await env.KV.get(`batch:${id}`);
    if (!raw) return null;
    const job = JSON.parse(raw);
    return {
      id:            job.id,
      title:         job.meta?.title || '(unknown)',
      author:        job.meta?.author || '',
      languages:     job.meta?.languages || [],
      status:        job.status,
      created_at:    job.created_at,
      completed_at:  job.completed_at || null,
      request_count: job.request_count,
    };
  }));
  return json({ jobs: jobs.filter(Boolean) });
}

async function batchStatus(request, env) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('id');
  if (!jobId) return json({ error: 'Missing id' }, 400);

  const raw = await env.KV.get(`batch:${jobId}`);
  if (!raw) return json({ error: 'Job not found' }, 404);
  const job = JSON.parse(raw);

  const batchRes = await fetch(`https://api.openai.com/v1/batches/${job.openai_batch_id}`, {
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
  });
  if (!batchRes.ok) return json({ error: 'Failed to check batch status' }, 500);
  const batchData = await batchRes.json();

  // Update KV if status changed
  if (batchData.status !== job.status) {
    job.status = batchData.status;
    if (batchData.status === 'completed') job.completed_at = Date.now();
    await env.KV.put(`batch:${jobId}`, JSON.stringify(job));
  }

  return json({
    id:             jobId,
    status:         batchData.status,
    request_counts: batchData.request_counts,
    created_at:     job.created_at,
    completed_at:   job.completed_at || null,
    output_file_id: batchData.output_file_id || null,
  });
}

async function batchDownload(request, env) {
  const { jobId } = await request.json();

  const raw = await env.KV.get(`batch:${jobId}`);
  if (!raw) return json({ error: 'Job not found' }, 404);
  const job = JSON.parse(raw);

  // Get batch info
  const batchRes = await fetch(`https://api.openai.com/v1/batches/${job.openai_batch_id}`, {
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
  });
  const batchData = await batchRes.json();
  if (batchData.status !== 'completed') {
    return json({ error: `Batch not completed (status: ${batchData.status})` }, 400);
  }

  // Download output file
  const fileRes = await fetch(`https://api.openai.com/v1/files/${batchData.output_file_id}/content`, {
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
  });
  const outputText = await fileRes.text();

  // Parse JSONL output
  const translationsMap = {};  // [level][lang][idx] = text
  const descriptionsMap = {};  // [lang] = text

  for (const line of outputText.trim().split('\n').filter(Boolean)) {
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const customId = item.custom_id || '';
    const content  = item.response?.body?.choices?.[0]?.message?.content || '';

    // Parse custom_id: {jobId}_{type}_{...}
    const underscoreIdx = customId.indexOf('_');
    if (underscoreIdx < 0) continue;
    const suffix = customId.slice(underscoreIdx + 1); // e.g. "t_b2_uk_3" or "d_uk"
    const parts  = suffix.split('_');
    const type   = parts[0];

    if (type === 't' && parts.length >= 4) {
      const level = parts[1];
      const lang  = parts[2];
      const idx   = parseInt(parts[3]);
      if (!translationsMap[level]) translationsMap[level] = {};
      if (!translationsMap[level][lang]) translationsMap[level][lang] = [];
      // Strip tags (same as real-time translate)
      const cleaned = content.trim().split('\n').map(l => l.replace(/^\[\d{3}\]\s?/, '')).join('\n');
      translationsMap[level][lang][idx] = cleaned;
    } else if (type === 'd' && parts.length >= 2) {
      descriptionsMap[parts[1]] = content.trim();
    }
  }

  // Assemble results object (same structure as runSingleStory returns)
  const { meta, chapterTexts } = job;
  const ALL_LEVELS = ['original', 'b2', 'b1', 'a2', 'a1'];
  const levels = {};

  for (const lvl of ALL_LEVELS) {
    const chapters = chapterTexts[lvl] || [];
    levels[lvl] = { en: chapters.join('\n\n\n') };
    for (const lang of meta.languages || []) {
      const translated = translationsMap[lvl]?.[lang];
      if (translated?.length) {
        levels[lvl][lang] = translated.join('\n\n\n');
      }
    }
  }

  const assembledResults = {
    meta: { ...meta, chaptersCount: (chapterTexts.original || []).length },
    levels,
    descriptions:  descriptionsMap,
    chapterImages: [],
  };

  // Mark job as downloaded in KV
  job.status = 'downloaded';
  await env.KV.put(`batch:${jobId}`, JSON.stringify(job));

  return json({ results: assembledResults });
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
