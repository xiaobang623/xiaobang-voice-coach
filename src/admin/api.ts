import type {
  AdminSessionRow,
  AdminUser,
  AdminUserRow,
  CostProviderRow,
  DashboardSummary,
  FunnelSummaryData,
  ModelInstancesData,
  Pagination,
  ResolvedVoiceConfigPreview,
  SessionCostProviderRow,
  TokenModelRow,
  TokenUserRow,
  VoiceBackend,
  VoiceBackendConfigRow,
  VoiceModelConfigPayload,
} from "./types";

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface ApiListSuccess<T> {
  success: true;
  data: T[];
  pagination: Pagination;
}

interface ApiError {
  success: false;
  error: string;
}

async function readJsonResponse<T>(response: Response): Promise<T | ApiError | null> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as T | ApiError;
  } catch {
    throw new Error(`API 返回了非 JSON 内容（${response.status}）`);
  }
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = await readJsonResponse<T>(response);
  if (body === null) {
    throw new Error(
      `API 无响应（${response.status}）。本地开发请先运行 npm run dev:api，再运行 npm run dev。`,
    );
  }

  if (!response.ok || (body as ApiError).success === false) {
    const message = (body as ApiError).error ?? `Request failed (${response.status})`;
    throw new Error(message);
  }

  return body as T;
}

export async function fetchAdminMe(): Promise<AdminUser> {
  const result = await adminFetch<ApiSuccess<AdminUser>>("/api/admin/me");
  return result.data;
}

export async function loginAdmin(username: string, password: string) {
  return adminFetch<{
    success: true;
    token: string;
    role: string;
    username: string;
  }>("/api/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function logoutAdmin() {
  return adminFetch<{ success: true }>("/api/admin/auth/logout", { method: "POST" });
}

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const result = await adminFetch<ApiSuccess<DashboardSummary>>("/api/admin/dashboard-summary");
  return result.data;
}

export async function fetchFunnelSummary(params: {
  dateFrom: string;
  dateTo: string;
}): Promise<FunnelSummaryData> {
  const query = new URLSearchParams({
    date_from: params.dateFrom,
    date_to: params.dateTo,
  });
  const result = await adminFetch<ApiSuccess<FunnelSummaryData>>(
    `/api/admin/funnel-summary?${query}`,
  );
  return result.data;
}

export async function fetchAdminUsers(params: {
  page: number;
  search: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
}): Promise<{ rows: AdminUserRow[]; pagination: Pagination }> {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: "20",
    search: params.search,
    sort_by: params.sortBy,
    sort_order: params.sortOrder,
  });
  const result = await adminFetch<ApiListSuccess<AdminUserRow>>(`/api/admin/users?${query}`);
  return { rows: result.data, pagination: result.pagination };
}

export async function fetchAdminSessions(params: {
  page: number;
  userId: string;
  dateFrom: string;
  dateTo: string;
}): Promise<{ rows: AdminSessionRow[]; pagination: Pagination }> {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: "20",
    date_from: params.dateFrom,
    date_to: params.dateTo,
  });
  if (params.userId) {
    query.set("user_id", params.userId);
  }
  const result = await adminFetch<ApiListSuccess<AdminSessionRow>>(`/api/admin/sessions?${query}`);
  return { rows: result.data, pagination: result.pagination };
}

export async function fetchTokenSummary(params: {
  dateFrom: string;
  dateTo: string;
}): Promise<{
  total_cost: number;
  total_tokens: number;
  by_provider: CostProviderRow[];
  by_model: TokenModelRow[];
  by_user: TokenUserRow[];
}> {
  const query = new URLSearchParams({
    date_from: params.dateFrom,
    date_to: params.dateTo,
  });
  const result = await adminFetch<
    ApiSuccess<{
      total_cost: number;
      total_tokens: number;
      by_provider: CostProviderRow[];
      by_model: TokenModelRow[];
      by_user: TokenUserRow[];
    }>
  >(`/api/admin/token-summary?${query}`);
  return result.data;
}

export function formatSessionCostBreakdown(
  rows: SessionCostProviderRow[] | undefined,
  totalCost: number,
) {
  if (!rows?.length) {
    return formatCurrency(totalCost);
  }
  return rows
    .filter((row) => row.cost > 0)
    .map((row) => `${row.short_label} ${formatCurrency(row.cost)}`)
    .join(" · ");
}

export function formatVoiceBackendLabel(backend: AdminSessionRow["voice_backend"]) {
  if (backend === "doubao") {
    return "豆包";
  }
  if (backend === "selfhosted") {
    return "自建 / 硅谷云";
  }
  return "—";
}

export function formatCurrency(value: number) {
  const digits = Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 6 : 2;
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatTokens(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

export function formatDurationSeconds(seconds: number) {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest > 0 ? `${minutes}分${rest}秒` : `${minutes}分`;
  }
  return `${seconds}秒`;
}

export function formatCharacters(value: number) {
  if (value >= 10_000) {
    return `${(value / 10_000).toFixed(1)} 万字`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)} 千字`;
  }
  return `${value} 字`;
}

export function getProviderBadgeClass(apiProvider: string) {
  if (apiProvider === "doubao") {
    return "bg-amber-50 text-amber-800 border-amber-200";
  }
  if (apiProvider === "siliconflow") {
    return "bg-sky-50 text-sky-800 border-sky-200";
  }
  if (apiProvider === "deepseek") {
    return "bg-violet-50 text-violet-800 border-violet-200";
  }
  return "bg-bg-warm text-text-secondary border-border-subtle";
}

export function formatProviderLabel(apiProvider: string, fallback?: string) {
  if (apiProvider === "doubao") {
    return "豆包";
  }
  if (apiProvider === "siliconflow") {
    return "硅谷云";
  }
  if (apiProvider === "deepseek") {
    return "DeepSeek";
  }
  return fallback ?? apiProvider;
}

export function formatCostProviderBreakdown(rows: CostProviderRow[] | undefined) {
  if (!rows?.length) {
    return "暂无分项";
  }
  return rows
    .filter((row) => row.total_cost > 0 || row.call_count > 0)
    .map((row) => `${row.short_label} ${formatCurrency(row.total_cost)}`)
    .join(" · ");
}

export function formatUsageMetric(row: {
  api_provider: string;
  usage_kind?: CostProviderRow["usage_kind"];
  total_tokens: number;
  total_duration_seconds?: number;
  total_characters?: number;
}) {
  const usageKind =
    row.usage_kind ??
    (row.api_provider === "doubao"
      ? "duration"
      : row.api_provider === "siliconflow"
        ? "characters"
        : "tokens");

  if (usageKind === "duration") {
    return formatDurationSeconds(row.total_duration_seconds ?? row.total_tokens);
  }
  if (usageKind === "characters") {
    return formatCharacters(row.total_characters ?? row.total_tokens);
  }
  return formatTokens(row.total_tokens);
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function defaultDateFrom(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function fetchVoiceConfigRows(scopeType?: string): Promise<VoiceBackendConfigRow[]> {
  const query = scopeType ? `?scope_type=${encodeURIComponent(scopeType)}` : "";
  const result = await adminFetch<ApiSuccess<VoiceBackendConfigRow[]>>(`/api/admin/voice-config${query}`);
  return result.data;
}

export async function fetchResolvedVoiceConfig(params: {
  userId?: string;
  guestId?: string;
  sessionId?: string;
}): Promise<{ effective: ResolvedVoiceConfigPreview; instanceKeys: ModelInstancesData["keys"] }> {
  const query = new URLSearchParams({ resolve: "true" });
  if (params.userId) {
    query.set("userId", params.userId);
  }
  if (params.guestId) {
    query.set("guestId", params.guestId);
  }
  if (params.sessionId) {
    query.set("sessionId", params.sessionId);
  }
  const result = await adminFetch<
    ApiSuccess<{ effective: ResolvedVoiceConfigPreview; instanceKeys: ModelInstancesData["keys"] }>
  >(`/api/admin/voice-config?${query}`);
  return result.data;
}

export async function saveVoiceConfig(input: {
  scopeType: "global" | "user" | "session";
  backend: VoiceBackend;
  config: VoiceModelConfigPayload;
  userId?: string;
  guestId?: string;
  sessionId?: string;
}): Promise<VoiceBackendConfigRow> {
  const result = await adminFetch<ApiSuccess<VoiceBackendConfigRow>>("/api/admin/voice-config", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return result.data;
}

export async function deleteVoiceConfigOverride(input: {
  scopeType: "user" | "session";
  userId?: string;
  guestId?: string;
  sessionId?: string;
}) {
  return adminFetch<{ success: true }>("/api/admin/voice-config", {
    method: "DELETE",
    body: JSON.stringify(input),
  });
}

export async function fetchModelInstances(): Promise<ModelInstancesData> {
  const result = await adminFetch<ApiSuccess<ModelInstancesData>>("/api/admin/model-instances");
  return result.data;
}
