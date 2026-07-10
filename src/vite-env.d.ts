/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VOICE_PROXY_URL?: string;
  readonly VITE_SELFHOSTED_VOICE_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Set to "false" to hide typing test on production. */
  readonly VITE_ENABLE_TYPING_TEST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
