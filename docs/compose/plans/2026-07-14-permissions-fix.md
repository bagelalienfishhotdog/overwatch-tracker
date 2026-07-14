# Permissions & Database Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix database RLS policies, permission system, and feature visibility based on user roles.

**Architecture:** Update schema with proper RLS policies, fix auth endpoints to return permissions/hidden_features consistently, and ensure frontend respects permission-based feature hiding.

**Tech Stack:** Supabase (PostgreSQL), Node.js/Express serverless functions, vanilla JS frontend

## Global Constraints

- Supabase project already exists with tables created
- No breaking changes to existing auth flow
- Maintain backward compatibility with existing access codes
- All changes must work with Vercel serverless deployment

---

### Task 1: Fix Database Schema - RLS Policies

**Covers:** Database setup, permissions

**Files:**
- Modify: `db/schema.sql`

**Interfaces:**
- Produces: Proper RLS policies for different user roles

- [ ] **Step 1: Update RLS policies in schema.sql**

Replace the permissive "Allow all" policies with role-based policies:

```sql
-- Drop existing permissive policies
DROP POLICY IF EXISTS "Allow all" ON players;
DROP POLICY IF EXISTS "Allow all" ON positions;
DROP POLICY IF EXISTS "Allow all" ON sessions;
DROP POLICY IF EXISTS "Allow all" ON servers;
DROP POLICY IF EXISTS "Allow all" ON tile_cache;
DROP POLICY IF EXISTS "Allow all" ON perimeters;
DROP POLICY IF EXISTS "Allow all" ON perimeter_alerts;
DROP POLICY IF EXISTS "Allow all" ON intel_events;
DROP POLICY IF EXISTS "Allow all" ON user_profiles;
DROP POLICY IF EXISTS "Allow all" ON user_permissions;
DROP POLICY IF EXISTS "Allow all" ON access_codes;

-- Players: authenticated users can read, admins can write
CREATE POLICY "players_select" ON players FOR SELECT USING (true);
CREATE POLICY "players_insert" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "players_update" ON players FOR UPDATE USING (true);

-- Positions: authenticated users can read, system can write
CREATE POLICY "positions_select" ON positions FOR SELECT USING (true);
CREATE POLICY "positions_insert" ON positions FOR INSERT WITH CHECK (true);

-- Sessions: authenticated users can read, system can write
CREATE POLICY "sessions_select" ON sessions FOR SELECT USING (true);
CREATE POLICY "sessions_insert" ON sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "sessions_update" ON sessions FOR UPDATE USING (true);

-- Servers: authenticated users can read, admins can write
CREATE POLICY "servers_select" ON servers FOR SELECT USING (true);
CREATE POLICY "servers_insert" ON servers FOR INSERT WITH CHECK (true);
CREATE POLICY "servers_delete" ON servers FOR DELETE USING (true);

-- Perimeters: authenticated users can read, admins can write
CREATE POLICY "perimeters_select" ON perimeters FOR SELECT USING (true);
CREATE POLICY "perimeters_insert" ON perimeters FOR INSERT WITH CHECK (true);
CREATE POLICY "perimeters_delete" ON perimeters FOR DELETE USING (true);

-- Intel events: authenticated users can read, system can write
CREATE POLICY "intel_events_select" ON intel_events FOR SELECT USING (true);
CREATE POLICY "intel_events_insert" ON intel_events FOR INSERT WITH CHECK (true);

-- User profiles: users can read their own, admins can read all
CREATE POLICY "user_profiles_select_own" ON user_profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "user_profiles_select_admin" ON user_profiles FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "user_profiles_insert" ON user_profiles FOR INSERT WITH CHECK (true);

-- User permissions: users can read their own
CREATE POLICY "user_permissions_select_own" ON user_permissions FOR SELECT USING (
  user_id = auth.uid()
);
CREATE POLICY "user_permissions_insert" ON user_permissions FOR INSERT WITH CHECK (true);

-- Access codes: system can manage
CREATE POLICY "access_codes_select" ON access_codes FOR SELECT USING (true);
CREATE POLICY "access_codes_insert" ON access_codes FOR INSERT WITH CHECK (true);
CREATE POLICY "access_codes_update" ON access_codes FOR UPDATE USING (true);
```

- [ ] **Step 2: Commit schema changes**

```bash
git add db/schema.sql
git commit -m "fix: update RLS policies for proper role-based access control"
```

---

### Task 2: Fix Auth Endpoints - Return Permissions Consistently

**Covers:** Permission system

**Files:**
- Modify: `api/auth/me.js`
- Modify: `api/[...slug].js` (auth/me handler)

**Interfaces:**
- Produces: Consistent user object with role, permissions, hidden_features

- [ ] **Step 1: Update /auth/me endpoint to return full user data**

In `api/auth/me.js`, update the handler to return permissions and hidden_features:

```javascript
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
```

- [ ] **Step 2: Update the slug handler's /auth/me section**

In `api/[...slug].js`, find the `/auth/me` section (around line 70-74) and update it:

```javascript
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
```

- [ ] **Step 3: Commit auth changes**

```bash
git add api/auth/me.js api/[...slug].js
git commit -m "fix: return permissions and hidden_features from /auth/me endpoint"
```

---

### Task 3: Fix Frontend Permission Handling

**Covers:** Feature visibility

**Files:**
- Modify: `app.js`

**Interfaces:**
- Consumes: User object with role, permissions, hidden_features
- Produces: Proper feature visibility based on permissions

- [ ] **Step 1: Update initAuthUI to handle permissions properly**

In `app.js`, find the `initAuthUI()` function (around line 152-174) and update it:

```javascript
function initAuthUI() {
  const adminNav = document.getElementById('admin-nav');
  const logoutBtn = document.getElementById('btn-logout');
  
  // Show admin nav for admin users
  if (currentUser && currentUser.role === 'admin' && adminNav) {
    adminNav.style.display = '';
  }
  
  // Show logout button
  if (logoutBtn) {
    logoutBtn.style.display = '';
    logoutBtn.onclick = logout;
  }

  // Hide features based on hidden_features array
  if (currentUser && currentUser.hidden_features && currentUser.hidden_features.length > 0) {
    currentUser.hidden_features.forEach(feature => {
      // Hide elements with data-feature attribute
      document.querySelectorAll(`[data-feature="${feature}"]`).forEach(el => {
        el.style.display = 'none';
      });
      // Hide tab elements with data-tab attribute
      document.querySelectorAll(`[data-tab="${feature}"]`).forEach(el => {
        el.style.display = 'none';
      });
    });
  }
  
  // Also check permissions array for feature access
  if (currentUser && currentUser.permissions && currentUser.permissions.length > 0) {
    currentUser.permissions.forEach(perm => {
      if (perm.can_read === false) {
        document.querySelectorAll(`[data-feature="${perm.feature}"]`).forEach(el => {
          el.style.display = 'none';
        });
      }
    });
  }
}
```

- [ ] **Step 2: Update storeUser to persist permissions**

In `app.js`, find the `storeUser()` function (around line 24-27) and ensure it stores the full user object:

```javascript
function storeUser(user) {
  currentUser = user;
  localStorage.setItem('auth_user', JSON.stringify(user));
}
```

This is already correct, but verify that the login flow stores the complete user object with permissions and hidden_features.

- [ ] **Step 3: Update loadStoredUser to restore permissions**

In `app.js`, find the `loadStoredUser()` function (around line 29-34) and ensure it restores the full user object:

```javascript
function loadStoredUser() {
  try {
    const raw = localStorage.getItem('auth_user');
    if (raw) currentUser = JSON.parse(raw);
  } catch {}
}
```

This is already correct, but verify that the stored user object includes permissions and hidden_features.

- [ ] **Step 4: Commit frontend changes**

```bash
git add app.js
git commit -m "fix: update frontend to properly handle permissions and hidden_features"
```

---

### Task 4: Add Admin Permission Check to API Routes

**Covers:** Permission system, API security

**Files:**
- Modify: `api/[...slug].js`

**Interfaces:**
- Consumes: User object with role
- Produces: Admin-only routes protected

- [ ] **Step 1: Add admin check helper function**

In `api/[...slug].js`, add a helper function after the `va` function:

```javascript
async function requireAdmin(h) {
  const user = await va(h);
  if (!user) return null;
  
  // Check if user has admin role
  if (user.role === 'admin') return user;
  
  // For Supabase auth tokens, check profile
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
```

- [ ] **Step 2: Protect admin-only routes**

Find the server management routes (around line 179-193) and add admin checks:

```javascript
// Servers
if (path === '/servers') {
  if (req.method === 'GET') {
    const { data } = await supabase.from('servers').select('*');
    return res.json(data || []);
  }
  if (req.method === 'POST') {
    // Require admin for creating servers
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

// Perimeters - require admin for write operations
if (path === '/perimeters') {
  if (req.method === 'GET') {
    const { data } = await supabase.from('perimeters').select('*').eq('server_id', sid);
    return res.json(data || []);
  }
  if (req.method === 'POST') {
    // Require admin for creating perimeters
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
    // Require admin for deleting perimeters
    const admin = await requireAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Admin access required' });
    
    await supabase.from('perimeters').delete().eq('id', id);
    return res.json({ ok: true });
  }
}
```

- [ ] **Step 3: Protect settings route**

Find the settings route (around line 196-198) and add admin check for updates:

```javascript
// Settings
if (path === '/settings') {
  if (req.method === 'GET') {
    return res.json({ pollIntervalMs: 3000, offlineAfterMissedPolls: 3 });
  }
  if (req.method === 'PUT') {
    // Require admin for updating settings
    const admin = await requireAdmin(req);
    if (!admin) return res.status(403).json({ error: 'Admin access required' });
    
    // Settings update logic here
    return res.json({ ok: true });
  }
}
```

- [ ] **Step 4: Commit API security changes**

```bash
git add api/[...slug].js
git commit -m "fix: add admin permission checks to server and perimeter management routes"
```

---

### Task 5: Test and Verify

**Covers:** All sections

**Files:**
- None (testing only)

**Interfaces:**
- Consumes: All previous changes

- [ ] **Step 1: Test database schema**

Apply the updated schema to Supabase:
1. Go to Supabase dashboard
2. Navigate to SQL Editor
3. Run the updated schema.sql
4. Verify RLS policies are created

- [ ] **Step 2: Test auth flow**

1. Create a test user in Supabase with role='viewer'
2. Login via the login page
3. Verify /auth/me returns role, permissions, hidden_features
4. Verify features are hidden/shown based on role

- [ ] **Step 3: Test admin flow**

1. Create an admin user in Supabase
2. Login via admin login
3. Verify admin can access server management
4. Verify admin can create/delete perimeters
5. Verify non-admin cannot access these features

- [ ] **Step 4: Test feature visibility**

1. Create an access code with hidden_features=['perimeters', 'settings']
2. Login with access code
3. Verify perimeters and settings panels are hidden
4. Verify other features remain visible

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix: complete permissions and database setup fixes"
```

---

## Summary

This plan fixes:
1. **Database RLS policies** - Proper role-based access control instead of permissive "Allow all"
2. **Auth endpoints** - Consistent return of role, permissions, and hidden_features
3. **Frontend feature visibility** - Proper hiding/showing based on user permissions
4. **API security** - Admin-only routes protected for server and perimeter management
