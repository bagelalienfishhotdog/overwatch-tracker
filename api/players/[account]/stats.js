const supabase = require('../../../lib/supabase');

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
    const { account } = req.query;
    const sid = new URL(req.url, 'http://localhost').searchParams.get('server_id') || 'default';
    const start = Number(new URL(req.url, 'http://localhost').searchParams.get('start')) || 0;
    const end = Number(new URL(req.url, 'http://localhost').searchParams.get('end')) || Date.now();
    const [pr, sr, plr, lr] = await Promise.all([
      supabase.from('positions').select('x,y,z,timestamp').eq('server_id', sid).eq('account', account).gte('timestamp', start).lte('timestamp', end).order('timestamp'),
      supabase.from('sessions').select('start_time,end_time').eq('server_id', sid).eq('account', account).lte('start_time', end).or(`end_time.is.null,end_time.gte.${start}`),
      supabase.from('players').select('*').eq('server_id', sid).eq('account', account).maybeSingle(),
      supabase.from('positions').select('x,z,world,timestamp').eq('server_id', sid).eq('account', account).order('timestamp', { ascending: false }).limit(1).maybeSingle()
    ]);
    const pos = pr.data || [], sess = sr.data || [], pl = plr.data, lp = lr.data;
    let d2 = 0, d3 = 0;
    for (let i = 1; i < pos.length; i++) { const a = pos[i-1], b = pos[i]; d2 += Math.sqrt((b.x-a.x)**2+(b.z-a.z)**2); d3 += Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2+(b.z-a.z)**2); }
    let t = 0; const now = Date.now();
    for (const s of sess) { const ss = Math.max(s.start_time, start), se = Math.min(s.end_time ?? now, end); if (se > ss) t += se - ss; }
    return res.json({ account, display_name: pl?.display_name || account, online: !!pl?.online, last_seen: pl?.last_seen, last_x: lp?.x ?? null, last_z: lp?.z ?? null, positions_recorded: pos.length, distance_blocks_2d: Math.round(d2), time_online_ms: t, visits: sess.length });
  } catch (err) { return res.status(500).json({ error: err.message }); }
};
