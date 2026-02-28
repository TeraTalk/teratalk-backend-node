import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ROLE_KEY

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

if (!roleKey) {
  throw new Error('Missing service role key (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ROLE_KEY)')
}

const supabase = createClient(
  supabaseUrl,
  roleKey
)

const { data, error } = await supabase.auth.admin.updateUserById(
  "USER_ID_HERE",
  { password: "NewStrongPassword123!" }
)

if (error) {
  throw error
}

console.log(`Password reset successful for user: ${data.user?.id ?? 'unknown'}`)
