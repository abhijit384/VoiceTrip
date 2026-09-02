/**
 * Supabase Client Configuration (Frontend)
 *
 * Uses Vite-compatible environment variables:
 * - VITE_SUPABASE_URL
 * - VITE_SUPABASE_PUBLISHABLE_KEY
 *
 * SECURITY NOTE:
 * The Publishable Key is safe for client-side usage in the browser.
 * The Secret Key (SUPABASE_SECRET_KEY) MUST NEVER be referenced or exposed here.
 */

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
  isConfigured: boolean;
}

export const supabaseConfig: SupabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL || '',
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
  isConfigured: Boolean(
    import.meta.env.VITE_SUPABASE_URL &&
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY &&
    !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY.includes('your_')
  ),
};
