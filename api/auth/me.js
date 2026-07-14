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
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const user = await va(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    // For access code tokens, return the embedded data
    if (user.role && user.hidden_features !== undefined) {
      return res.json({ user });
    }

    // For Supabase auth tokens, fetch profile and permissions
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (profile) {
      const { data: permissions } = await supabase
        .from('user_permissions')
        .select('*')
        .eq('user_id', profile.id);

      return res.json({
        user: {
          id: profile.id,
          username: profile.username,
          role: profile.role,
          permissions: permissions || [],
          hidden_features: profile.hidden_features || []
        }
      });
    }

    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
