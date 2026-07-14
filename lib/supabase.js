const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) console.warn('[db] SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
const supabase = createClient(supabaseUrl || '', supabaseKey || '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = serviceRoleKey ? createClient(supabaseUrl || '', serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
module.exports = supabase;
module.exports.admin = supabaseAdmin;
