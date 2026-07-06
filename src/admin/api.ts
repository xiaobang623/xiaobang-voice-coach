import type {
  AdminSessionRow,
  AdminUser,
  AdminUserRow,
  DashboardSummary,
  Pagination,
  TokenModelRow,
  TokenUserRow,
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

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = (await response.json()) as T | ApiError;
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
      by_model: TokenModelRow[];
      by_user: TokenUserRow[];
    }>
  >(`/api/admin/token-summary?${query}`);
  return result.data;
}

export function formatCurrency(value: number) {
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

export function formatUsageMetric(row: {
  api_provider: string;
  total_tokens: number;
  total_duration_seconds?: number;
}) {
  if (row.api_provider === "doubao") {
    return formatDurationSeconds(row.total_duration_seconds ?? row.total_tokens);
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
