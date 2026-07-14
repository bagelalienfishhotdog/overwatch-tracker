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
    const [t, o, p] = await Promise.all([
      supabase.from('players').select('*', { count: 'exact', head: true }).eq('server_id', sid),
      supabase.from('players').select('*', { count: 'exact', head: true }).eq('server_id', sid).eq('online', true),
      supabase.from('positions').select('*', { count: 'exact', head: true }).eq('server_id', sid)
    ]);
    return res.json({ totalPlayers: t.count || 0, online: o.count || 0, totalPositions: p.count || 0 });
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
