-- ============================================
-- OVERWATCH - Credentials Setup (Fixed)
-- Run this in Supabase SQL Editor after schema.sql
-- ============================================

-- 1. Get the existing admin user ID
DO $$
DECLARE
  admin_uuid UUID;
BEGIN
  -- Find existing admin user
  SELECT id INTO admin_uuid FROM auth.users WHERE email = 'admin@dynomap.local';

  IF admin_uuid IS NULL THEN
    RAISE NOTICE 'No admin user found. Create one in Supabase Dashboard > Authentication > Users';
    RAISE NOTICE 'Email: admin@dynomap.local | Password: (your choice)';
    RETURN;
  END IF;

  -- 2. Create admin profile (if not exists)
  INSERT INTO user_profiles (id, username, role, created_at)
  VALUES (admin_uuid, 'admin', 'admin', NOW())
  ON CONFLICT (id) DO UPDATE SET role = 'admin';

  -- 3. Create admin permissions (full access)
  INSERT INTO user_permissions (user_id, feature, can_read, can_write)
  VALUES
    (admin_uuid, 'heatmap', TRUE, TRUE),
    (admin_uuid, 'perimeters', TRUE, TRUE),
    (admin_uuid, 'export', TRUE, TRUE),
    (admin_uuid, 'settings', TRUE, TRUE)
  ON CONFLICT (user_id, feature) DO UPDATE SET can_read = TRUE, can_write = TRUE;

  RAISE NOTICE 'Admin profile created for user: %', admin_uuid;
END $$;

-- 4. Create Default Viewer Access Code
INSERT INTO access_codes (code, role, permissions, max_uses, use_count, expires_at, hidden_features, created_at)
VALUES (
  'VIEWER-2026-DEFAULT',
  'viewer',
  '[{"feature": "heatmap", "can_read": true, "can_write": false}, {"feature": "export", "can_read": true, "can_write": false}]'::jsonb,
  100,
  0,
  NOW() + INTERVAL '1 year',
  '["perimeters", "settings"]'::jsonb,
  NOW()
)
ON CONFLICT (code) DO NOTHING;

-- 5. Create Second Viewer Access Code (backup)
INSERT INTO access_codes (code, role, permissions, max_uses, use_count, expires_at, hidden_features, created_at)
VALUES (
  'VIEWER-BACKUP-2026',
  'viewer',
  '[{"feature": "heatmap", "can_read": true, "can_write": false}, {"feature": "export", "can_read": true, "can_write": false}]'::jsonb,
  50,
  0,
  NOW() + INTERVAL '1 year',
  '["perimeters", "settings"]'::jsonb,
  NOW()
)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- SUMMARY
-- ============================================
-- Admin Login (use your existing password):
--   Username: admin
--   Role: admin (full access)
--
-- Viewer Access Codes:
--   Code: VIEWER-2026-DEFAULT (100 uses)
--   Code: VIEWER-BACKUP-2026 (50 uses)
--   Role: viewer (read-only, no perimeters/settings)
-- ============================================
