// Netlify Function (v2) : relais IA, accessible sur POST /api/ai
// Les clés restent côté serveur. Priorité : Groq (GROQ_API_KEY) puis Gemini (GEMINI_API_KEY).
const E = k => (typeof Netlify !== 'undefined' ? Netlify.env.get(k) : process.env[k]);
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const parse = t => { try { return JSON.parse(String(t).replace(/```json|```/g, '').trim()); } catch { return null; } };

export default async (req) => {
  if (req.method !== 'POST') return J({ error: 'method' }, 405);
  const groq = E('GROQ_API_KEY'), gem = E('GEMINI_API_KEY');
  if (!groq && !gem) return J({ error: 'missing_key' }, 500);
  const allowed = E('ALLOWED_ORIGIN'), o = req.headers.get('origin');
  if (allowed && o && o !== allowed) return J({ error: 'forbidden' }, 403);
  let body; try { body = await req.json(); } catch { return J({ error: 'bad_json' }, 400); }
  const prompt = String(body.prompt || '').slice(0, 4000);
  if (!prompt) return J({ error: 'empty' }, 400);

  let r, text;
  if (groq) {
    const key = groq.trim();
    const call = (model, fmt) => fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], ...(fmt ? { response_format: { type: 'json_object' } } : {}), temperature: 0.7 })
    });
    const tryModel = async (model) => {
      for (const fmt of [true, false]) {
        const x = await call(model, fmt);
        if (x.ok) return { ok: true, text: (await x.json()).choices?.[0]?.message?.content };
        const d = (await x.text()).slice(0, 300);
        console.error('GROQ_ERROR', model, fmt ? 'json' : 'plain', x.status, d);
        if (x.status !== 400) return { ok: false, status: x.status };
      }
      return { ok: false, status: 400 };
    };
    let models = [E('GROQ_MODEL'), 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'].filter((m, i, a) => m && a.indexOf(m) === i);
    let res = { ok: false, status: 0 }, tried = new Set();
    for (let round = 0; round < 2 && !res.ok; round++) {
      for (const m of models) {
        if (tried.has(m)) continue;
        tried.add(m);
        res = await tryModel(m);
        if (res.ok) break;
        if (res.status === 401 || res.status === 403) return J({ error: 'bad_key', status: res.status }, 502);
        if (res.status === 429) return J({ error: 'rate_limited' }, 429);
      }
      if (res.ok || round) break;
      // Aucun modèle connu ne marche : on demande à Groq la liste des modèles disponibles.
      const ml = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key } });
      if (!ml.ok) { console.error('GROQ_MODELS_ERROR', ml.status); break; }
      const ids = ((await ml.json()).data || []).map(m => m.id);
      console.error('GROQ_AVAILABLE_MODELS', ids.join(', ').slice(0, 800));
      const bad = /whisper|tts|guard|embed|orpheus|vision|safeguard|compound/i;
      const pref = [/llama-3\.3/, /llama-4/, /llama-3\.1/, /qwen/, /kimi/, /gpt-oss-20b/, /gpt-oss-120b/, /gemma/];
      models = ids.filter(i => !bad.test(i)).sort((x, y) => {
        const f = i => { const k = pref.findIndex(r => r.test(i)); return k < 0 ? 99 : k; };
        return f(x) - f(y);
      }).slice(0, 4);
    }
    if (!res.ok) return J({ error: 'upstream', status: res.status }, 502);
    text = res.text;
  } else {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${E('GEMINI_MODEL') || 'gemini-2.5-flash'}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': gem },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.7 } })
    });
    if (!r.ok) { console.error('GEMINI_ERROR', r.status, (await r.text()).slice(0, 300)); return J({ error: 'upstream', status: r.status }, r.status === 429 ? 429 : 502); }
    text = (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text;
  }
  const data = parse(text);
  if (!data) console.error('BAD_OUTPUT', String(text).slice(0, 200));
  return data ? J({ data }) : J({ error: 'bad_output' }, 502);
};

export const config = { path: '/api/ai' };
