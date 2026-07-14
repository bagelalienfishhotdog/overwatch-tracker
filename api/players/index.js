const supabase = require('../../lib/supabase');

async function va(h) {
  const ah = h.headers.authorization;
  if (!ah || !ah.startsWith('Bearer ')) return null;
  try { const d = JSON.parse(Buffer.from(ah.split(' ')[1], 'base64').toString()); if (d.sub && d.role && d.exp >= Math.floor(Date.now() / 1000)) return d; } catch {}
  try { const { data: { user } } = await supabase.auth.getUser(ah.split(' ')[1]); if (user) return user; } catch {}
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = await va(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const sid = new URL(req.url, 'http://localhost').searchParams.get('server_id') || 'default';
    const q = new URL(req.url, 'http://localhost').searchParams.get('q');
    if (q) {
      const { data } = await supabase.from('players').select('account, display_name, online, first_seen, last_seen').eq('server_id', sid).or(`account.ilike.%${q}%,display_name.ilike.%${q}%`).order('online', { ascending: false }).limit(50);
      return res.json(data || []);
    }
    const { data } = await supabase.from('players').select('account, display_name, online, first_seen, last_seen').eq('server_id', sid).order('online', { ascending: false }).limit(200);
    return res.json(data || []);
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
