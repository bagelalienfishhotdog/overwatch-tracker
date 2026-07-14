const supabase = require('../lib/supabase');

async function va(h) {
  const ah = h.headers.authorization;
  if (!ah || !ah.startsWith('Bearer ')) return null;
  try { const d = JSON.parse(Buffer.from(ah.split(' ')[1], 'base64').toString()); if (d.sub && d.role && d.exp >= Math.floor(Date.now() / 1000)) return d; } catch {}
  try { const { data: { user } } = await supabase.auth.getUser(ah.split(' ')[1]); if (user) return user; } catch {}
  return null;
}

async function requireAdmin(h) {
  const user = await va(h);
  if (!user) return null;

  if (user.role === 'admin') return user;

  if (user.id) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile && profile.role === 'admin') return user;
  }

  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Parse path from URL directly since [..slug] may not populate correctly
  const url = new URL(req.url, 'http://localhost');
  const fullPath = url.pathname;
  // Strip /api prefix if present, normalize to ensure leading slash, strip trailing slash
  let path = fullPath.replace(/^\/api/, '') || '/';
  if (!path.startsWith('/')) path = '/' + path;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const sid = url.searchParams.get('server_id') || 'default';

  // Parse body if it's a string (Vercel edge cases)
  if (req.body && typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch {}
  }

  try {
    // Debug endpoint
    if (path === '/debug') {
      const url = process.env.SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const srk = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'MISSING';
      return res.json({
        supabaseUrl: url ? url.substring(0, 30) + '...' : 'MISSING',
        supabaseKey: key ? key.substring(0, 30) + '...' : 'MISSING',
        serviceRoleKey: srk,
      });
    }

    // Auth routes (public)
    console.log('[api] path:', path, 'method:', req.method);
    if (path === '/auth/login' && req.method === 'POST') {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
      const { data: profile, error: pe } = await supabase.from('user_profiles').select('*').eq('username', username).single();
      if (pe || !profile) return res.status(401).json({ error: 'Invalid credentials' });
      const { data, error } = await supabase.auth.signInWithPassword({ email: `${username}@dynomap.local`, password });
      if (error) return res.status(401).json({ error: error.message || 'Invalid credentials' });
      const { data: permissions } = await supabase.from('user_permissions').select('*').eq('user_id', profile.id);
      return res.json({ token: data.session.access_token, user: { id: profile.id, username: profile.username, role: profile.role, permissions: permissions || [] } });
    }

    if (path === '/auth/access' && req.method === 'POST') {
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
    }

    if (path === '/auth/me') {
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
    }

    // Protected routes
    const user = await va(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    // Players
    if (path === '/players/live') {
      const { data: p } = await supabase.from('players').select('account, display_name, online, last_seen').eq('server_id', sid).eq('online', true).order('display_name');
      const rows = await Promise.all((p || []).map(async pl => { const { data: pos } = await supabase.from('positions').select('world, x, y, z').eq('server_id', sid).eq('account', pl.account).order('timestamp', { ascending: false }).limit(1).maybeSingle(); return { ...pl, ...(pos || { world: null, x: null, y: null, z: null }) }; }));
      return res.json(rows);
    }

    if (path === '/players/search') {
      const q = req.query.q || '';
      const { data } = await supabase.from('players').select('account, display_name, online, first_seen, last_seen').eq('server_id', sid).or(`account.ilike.%${q}%,display_name.ilike.%${q}%`).order('online', { ascending: false }).limit(50);
      return res.json(data || []);
    }

    if (path === '/players') {
      const { data } = await supabase.from('players').select('account, display_name, online, first_seen, last_seen').eq('server_id', sid).order('online', { ascending: false }).limit(200);
      return res.json(data || []);
    }

    // Player sub-routes
    const parts = path.split('/').filter(Boolean);
    if (parts[0] === 'players' && parts.length >= 3 && parts[2] === 'stats') {
      const account = parts[1];
      const start = Number(req.query.start) || 0;
      const end = Number(req.query.end) || Date.now();
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
    }

    if (parts[0] === 'players' && parts.length >= 3 && parts[2] === 'history') {
      const account = parts[1];
      const start = Number(req.query.start) || 0;
      const end = Number(req.query.end) || Date.now();
      const { data } = await supabase.from('positions').select('x,y,z,world,health,armor,timestamp').eq('server_id', sid).eq('account', account).gte('timestamp', start).lte('timestamp', end).order('timestamp');
      return res.json(data || []);
    }

    // Stats
    if (path === '/stats/overview') {
      const [t, o, p] = await Promise.all([
        supabase.from('players').select('*', { count: 'exact', head: true }).eq('server_id', sid),
        supabase.from('players').select('*', { count: 'exact', head: true }).eq('server_id', sid).eq('online', true),
        supabase.from('positions').select('*', { count: 'exact', head: true }).eq('server_id', sid)
      ]);
      return res.json({ totalPlayers: t.count || 0, online: o.count || 0, totalPositions: p.count || 0 });
    }

    // Heatmap
    if (path === '/heatmap') {
      const start = Number(req.query.start) || 0;
      const end = Number(req.query.end) || Date.now();
      let q = supabase.from('positions').select('x,z').eq('server_id', sid).gte('timestamp', start).lte('timestamp', end);
      if (req.query.account) q = q.eq('account', req.query.account);
      const { data } = await q.limit(100000);
      return res.json(data || []);
    }

    // Intel events
    if (path.startsWith('/intel/events')) {
      const limit = parseInt(req.query.limit) || 50;
      let q = supabase.from('intel_events').select('*').eq('server_id', sid).order('detected_at', { ascending: false }).limit(limit);
      if (parts.length >= 3) q = q.eq('account', parts[2]);
      if (req.query.type) q = q.eq('event_type', req.query.type);
      const { data } = await q;
      return res.json(data || []);
    }

    // Perimeters
    if (path === '/perimeters') {
      if (req.method === 'GET') {
        const { data } = await supabase.from('perimeters').select('*').eq('server_id', sid);
        return res.json(data || []);
      }
      if (req.method === 'POST') {
        const admin = await requireAdmin(req);
        if (!admin) return res.status(403).json({ error: 'Admin access required' });

        const { name, center_x, center_z, radius, color } = req.body;
        if (!name || center_x == null || center_z == null) return res.status(400).json({ error: 'name, center_x, center_z required' });
        const { data, error } = await supabase.from('perimeters').insert({ server_id: sid, name, center_x, center_z, radius: radius || 500, color: color || '#ff4444', shape_type: 'circle' }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json(data);
      }
    }

    if (path.match(/^\/perimeters\/\d+$/)) {
      const id = path.split('/')[2];
      if (req.method === 'DELETE') {
        const admin = await requireAdmin(req);
        if (!admin) return res.status(403).json({ error: 'Admin access required' });

        await supabase.from('perimeters').delete().eq('id', id);
        return res.json({ ok: true });
      }
    }

    // Servers
    if (path === '/servers') {
      if (req.method === 'GET') {
        const { data } = await supabase.from('servers').select('*');
        return res.json(data || []);
      }
      if (req.method === 'POST') {
        const admin = await requireAdmin(req);
        if (!admin) return res.status(403).json({ error: 'Admin access required' });

        const { name, url, map_type } = req.body;
        if (!url) return res.status(400).json({ error: 'url required' });
        const id = crypto.randomUUID();
        const { data, error } = await supabase.from('servers').insert({ id, name: name || 'Server', url, map_type }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(201).json(data);
      }
    }

    // Settings
    if (path === '/settings') {
      if (req.method === 'GET') {
        return res.json({ pollIntervalMs: 3000, offlineAfterMissedPolls: 3 });
      }
      if (req.method === 'PUT') {
        const admin = await requireAdmin(req);
        if (!admin) return res.status(403).json({ error: 'Admin access required' });

        return res.json({ ok: true });
      }
    }

    // Map config
    if (path === '/mapconfig') {
      return res.json({ mapType: 'unknown', config: null });
    }

    // Markers
    if (path === '/markers') {
      return res.json({ sets: {} });
    }

    // Analytics
    if (path === '/analytics') {
      return res.json({ towns: [], explorers: [] });
    }

    // Intel activity profile
    if (path.match(/^\/intel\/activity-profile\//)) {
      return res.json({ hourly: new Array(24).fill(0), estimatedSessions: 0 });
    }

    // Intel session patterns
    if (path.match(/^\/intel\/session-patterns\//)) {
      return res.json({ sessions: [], avgDurationFormatted: '0m' });
    }

    // Intel offline windows
    if (path.match(/^\/intel\/offline-windows\//)) {
      return res.json({ windows: [], bestHour: { label: '00:00', offlineChance: 0 }, bestDay: { day: 'Sun', offlineChance: 0 } });
    }

    // Intel associations
    if (path.match(/^\/intel\/associations\//)) {
      return res.json({ associates: [] });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('[api]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
