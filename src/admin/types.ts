export interface AdminUser {
  username: string;
  role: "admin" | "viewer";
}

export interface DashboardSummary {
  total_users: number;
  total_guests: number;
  total_sessions: number;
  total_cost: number;
  new_users_today: number;
  sessions_today: number;
  cost_today: number;
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

export interface AdminSessionRow {
  id: string;
  user_id: string;
  user_nickname: string;
  topic: string | null;
  duration_seconds: number | null;
  created_at: string;
  transcript_preview: string;
  total_cost: number;
}

export interface TokenModelRow {
  model_name: string;
  api_provider: string;
  call_count: number;
  total_tokens: number;
  total_duration_seconds?: number;
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
