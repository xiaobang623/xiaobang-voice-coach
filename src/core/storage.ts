import type { ReportJSON } from "../types";

export interface SessionRecord {
  id: string;
  transcript: string;
  createdAt: string;
}

export async function saveSessionTranscript(_record: SessionRecord): Promise<void> {
  // TODO: persist transcript to Supabase.
  throw new Error("Not implemented");
}

export async function saveSessionReport(_report: ReportJSON): Promise<void> {
  // TODO: persist report to Supabase.
  throw new Error("Not implemented");
}

export async function listSessionReports(): Promise<ReportJSON[]> {
  // TODO: fetch report history from Supabase.
  throw new Error("Not implemented");
}
