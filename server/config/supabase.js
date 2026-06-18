const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const rootEnvLocal = path.resolve(__dirname, '../../.env.local');
if (fs.existsSync(rootEnvLocal)) {
  dotenv.config({ path: rootEnvLocal, override: false });
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required Supabase env var: ${name}`);
  }
  return value;
}

function createSupabaseServerClient(options = {}) {
  const key = options.useServiceRole ? supabaseServiceRoleKey || supabaseAnonKey : supabaseAnonKey;

  return createClient(
    requireEnv('SUPABASE_URL', supabaseUrl),
    requireEnv(options.useServiceRole ? 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY' : 'SUPABASE_ANON_KEY', key),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      ...options.clientOptions,
    }
  );
}

module.exports = {
  createSupabaseServerClient,
};
