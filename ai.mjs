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
    const models = [E('GROQ_MODEL'), 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'].filter((m, i, a) => m && a.indexOf(m) === i);
    for (const model of models) {
      r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + groq.trim() },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' }, temperature: 0.7 })
      });
      if (r.ok) { text = (await r.json()).choices?.[0]?.message?.content; break; }
      const detail = (await r.text()).slice(0, 300);
      console.error('GROQ_ERROR', model, r.status, detail);
      if (r.status === 401 || r.status === 403) return J({ error: 'bad_key', status: r.status }, 502);
      if (r.status === 429) return J({ error: 'rate_limited' }, 429);
    }
    if (!r.ok) return J({ error: 'upstream', status: r.status }, 502);
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
