const supabase = require('../../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const { data: profile, error: pe } = await supabase.from('user_profiles').select('*').eq('username', username).single();
    if (pe || !profile) return res.status(401).json({ error: 'Invalid credentials' });
    const { data, error } = await supabase.auth.signInWithPassword({ email: `${username}@dynomap.local`, password });
    if (error) return res.status(401).json({ error: error.message || 'Invalid credentials' });
    const { data: permissions } = await supabase.from('user_permissions').select('*').eq('user_id', profile.id);
    return res.json({ token: data.session.access_token, user: { id: profile.id, username: profile.username, role: profile.role, permissions: permissions || [] } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
