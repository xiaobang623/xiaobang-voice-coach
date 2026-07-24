export interface AdminUser {
  username: string;
  role: "admin" | "viewer";
}

export interface DashboardSummary {
  total_users: number;
  total_guests: number;
  total_sessions: number;
  total_cost: number;
  cost_by_provider?: CostProviderRow[];
  new_users_today: number;
  sessions_today: number;
  cost_today: number;
  cost_today_by_provider?: CostProviderRow[];
  /** C3 成本护栏：今日单人成本超阈值的 actor 列表，按成本降序。 */
  cost_alerts?: CostAlertRow[];
  /** 告警阈值（¥/人/天），后端 DAILY_COST_ALERT_CNY 可配。 */
  cost_alert_threshold?: number;
}

export interface CostAlertRow {
  actor_type: "user" | "guest";
  actor_id: string;
  cost: number;
}

export interface CostProviderRow {
  api_provider: string;
  label: string;
  short_label: string;
  usage_kind: "duration" | "tokens" | "characters";
  rate_hint: string;
  call_count: number;
  total_tokens: number;
  total_duration_seconds: number;
  total_characters: number;
  total_cost: number;
}

export interface AdminUserRow {
  id: string;
  nickname: string;
  is_guest?: boolean;
  created_at: string;
  session_count: number;
  total_cost: number;
  last_session: string | null;
}

export interface SessionCostProviderRow {
  api_provider: string;
  short_label: string;
  cost: number;
}

export interface AdminSessionRow {
  id: string;
  user_id: string | null;
  guest_id?: string | null;
  user_nickname: string;
  topic: string | null;
  duration_seconds: number | null;
  created_at: string;
  transcript_preview: string;
  total_cost: number;
  cost_by_provider?: SessionCostProviderRow[];
  voice_backend?: "doubao" | "selfhosted" | null;
  is_guest?: boolean;
  is_archived?: boolean;
}

export interface TokenModelRow {
  model_name: string;
  model_label?: string;
  api_provider: string;
  provider_label?: string;
  usage_kind?: CostProviderRow["usage_kind"];
  rate_hint?: string;
  call_count: number;
  total_tokens: number;
  total_duration_seconds?: number;
  total_characters?: number;
  total_cost: number;
}

export interface TokenUserRow {
  user_id: string;
  user_nickname: string;
  call_count: number;
  total_tokens: number;
  total_duration_seconds?: number;
  total_cost: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export type VoiceBackend = "doubao" | "selfhosted";

export type AsrProvider =
  | "platform-native-asr"
  | "local-whisper"
  | "siliconflow-sensevoice"
  | "siliconflow-telespeech";

export type PlatformNativeAsrLocale = "en-US" | "zh-CN";

export type TtsProvider =
  | "local-cosyvoice"
  | "siliconflow-cosyvoice"
  | "siliconflow-moss-ttsd";

export interface VoiceModelConfigPayload {
  doubao?: {
    dialogModel?: string;
  };
  selfhosted?: {
    asrProvider?: AsrProvider;
    platformNativeAsrLocale?: PlatformNativeAsrLocale;
    ttsProvider?: TtsProvider;
    siliconflowTtsVoice?: string;
    whisperModel?: string;
    deepseekModel?: string;
    cosyvoiceModelKey?: string;
  };
}

export interface VoiceBackendConfigRow {
  id: string;
  scope_type: "global" | "user" | "session";
  user_id: string | null;
  guest_id: string | null;
  session_id: string | null;
  backend: VoiceBackend;
  config: VoiceModelConfigPayload;
  updated_at: string;
  updated_by: string | null;
}

export interface ResolvedVoiceConfigPreview {
  backend: VoiceBackend;
  config: VoiceModelConfigPayload & { backend: VoiceBackend };
  modelOverrides: {
    doubaoDialogModel?: string;
    asrProvider?: AsrProvider;
    platformNativeAsrLocale?: PlatformNativeAsrLocale;
    ttsProvider?: TtsProvider;
    siliconflowTtsVoice?: string;
    whisperModel?: string;
    deepseekModel?: string;
    cosyvoiceModelKey?: string;
  };
  cachedAt: number;
}

export interface ModelInstanceHealth {
  key: string;
  url: string;
  ok: boolean;
  detail: string;
}

export interface ModelInstancesData {
  keys: {
    whisper: string[];
    cosyvoice: string[];
  };
  whisper: ModelInstanceHealth[];
  cosyvoice: ModelInstanceHealth[];
  siliconflow?: {
    apiKeyConfigured: boolean;
    asr: Record<string, { model: string; ok: boolean; detail: string }>;
    tts: Record<string, { model: string; ok: boolean; detail: string }>;
  };
}

export interface FunnelStepRow {
  event_name: string;
  label: string;
  /** Distinct users/guests that fired the event in range. */
  actor_count: number;
  event_count: number;
  /** Actor conversion vs the previous funnel step (0-1), null for step 1. */
  conversion_from_prev: number | null;
}

export interface FunnelSummaryData {
  steps: FunnelStepRow[];
  extra_events: FunnelStepRow[];
}
