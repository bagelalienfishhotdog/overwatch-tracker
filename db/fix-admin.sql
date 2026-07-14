-- ============================================
-- FIX ADMIN LOGIN
-- Run this if admin can't login
-- ============================================

-- First, check if admin user exists in auth.users
SELECT id, email, created_at FROM auth.users WHERE email = 'admin@dynomap.local';

-- Create admin profile if it doesn't exist
DO $$
DECLARE
  admin_uuid UUID;
BEGIN
  SELECT id INTO admin_uuid FROM auth.users WHERE email = 'admin@dynomap.local';

  IF admin_uuid IS NULL THEN
    RAISE NOTICE 'ERROR: No admin user found in auth.users!';
    RAISE NOTICE 'Create one in Supabase Dashboard > Authentication > Users';
    RAISE NOTICE 'Email: admin@dynomap.local';
    RAISE NOTICE 'Password: (your choice)';
    RETURN;
  END IF;

  -- Create or update admin profile
  INSERT INTO user_profiles (id, username, role, created_at)
  VALUES (admin_uuid, 'admin', 'admin', NOW())
  ON CONFLICT (id) DO UPDATE SET role = 'admin', username = 'admin';

  -- Create admin permissions
  INSERT INTO user_permissions (user_id, feature, can_read, can_write)
  VALUES
    (admin_uuid, 'heatmap', TRUE, TRUE),
    (admin_uuid, 'perimeters', TRUE, TRUE),
    (admin_uuid, 'export', TRUE, TRUE),
    (admin_uuid, 'settings', TRUE, TRUE)
  ON CONFLICT (user_id, feature) DO UPDATE SET can_read = TRUE, can_write = TRUE;

  RAISE NOTICE 'SUCCESS: Admin profile created for user: %', admin_uuid;
  RAISE NOTICE 'You can now login with: admin / (your password)';
END $$;

-- Verify admin profile exists
SELECT up.id, up.username, up.role, au.email
FROM user_profiles up
JOIN auth.users au ON up.id = au.id
WHERE up.role = 'admin';
