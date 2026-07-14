const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Access code required' });
    const { data: ac, error: ce } = await supabase.from('access_codes').select('*').eq('code', code.toUpperCase().trim()).single();
    if (ce || !ac) return res.status(401).json({ error: 'Invalid access code' });
    if (new Date(ac.expires_at) < new Date()) return res.status(401).json({ error: 'Access code expired' });
    if (ac.use_count >= ac.max_uses) return res.status(401).json({ error: 'Access code already used' });
    await supabase.from('access_codes').update({ use_count: ac.use_count + 1 }).eq('id', ac.id);
    const uid = crypto.randomUUID();
    const token = Buffer.from(JSON.stringify({ sub: uid, role: ac.role, permissions: ac.permissions || [], hidden_features: ac.hidden_features || [], iat: Math.floor(Date.now() / 1000), exp: Math.floor(new Date(ac.expires_at).getTime() / 1000) })).toString('base64');
    return res.json({ token, user: { id: uid, username: `guest-${uid.slice(0, 8)}`, role: ac.role, permissions: ac.permissions || [], hidden_features: ac.hidden_features || [] } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
