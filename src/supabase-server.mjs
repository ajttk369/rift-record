let clientPromise;

export function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseStatus() {
  return {
    hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
    hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasSupabaseConfig: hasSupabaseConfig()
  };
}

export async function getSupabaseClient() {
  if (!hasSupabaseConfig()) {
    const error = new Error(
      "Supabase 환경변수가 설정되지 않아 배포 환경에서 데이터를 수집해 저장할 수 없습니다. Vercel Environment Variables에 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 추가해 주세요."
    );
    error.code = "SUPABASE_CONFIG_MISSING";
    throw error;
  }

  if (!clientPromise) {
    clientPromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      })
    );
  }

  return clientPromise;
}
