import { useCallback, useEffect, useState } from "react";
import {
  fetchModelInstances,
  fetchVoiceConfigRows,
  formatDateTime,
  saveVoiceConfig,
} from "./api";
import type { AdminUser, VoiceBackendConfigRow } from "./types";
import {
  DEFAULT_FORM_STATE,
  formStateFromPayload,
  formStateToPayload,
  VoiceConfigForm,
  type VoiceConfigFormState,
} from "./VoiceConfigForm";

interface VoiceConfigSectionProps {
  user: AdminUser;
}

export function VoiceConfigSection({ user }: VoiceConfigSectionProps) {
  const [form, setForm] = useState<VoiceConfigFormState>(DEFAULT_FORM_STATE);
  const [globalRow, setGlobalRow] = useState<VoiceBackendConfigRow | null>(null);
  const [instances, setInstances] = useState<Awaited<ReturnType<typeof fetchModelInstances>> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const canEdit = user.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchVoiceConfigRows("global");
      const row = rows.find((item) => item.scope_type === "global") ?? null;
      setGlobalRow(row);
      if (row) {
        setForm(formStateFromPayload(row.backend, row.config));
      }

      try {
        setInstances(await fetchModelInstances());
      } catch (instanceErr) {
        console.warn("[admin] model instances unavailable:", instanceErr);
        setInstances(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = () => {
    if (!canEdit) {
      return;
    }

    setSaving(true);
    setError(null);
    setSavedMessage(null);

    void (async () => {
      try {
        const saved = await saveVoiceConfig({
          scopeType: "global",
          backend: form.backend,
          config: formStateToPayload(form),
        });
        setGlobalRow(saved);
        setSavedMessage("全局配置已保存，新会话将按此生效。");
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存失败");
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">语音模型配置</h2>
          <p className="text-xs text-text-muted">
            全局默认后端与模型参数；可在用户/会话列表中为个别对象设置覆盖。
          </p>
        </div>
        {globalRow ? (
          <p className="text-xs text-text-muted">
            上次更新 {formatDateTime(globalRow.updated_at)}
            {globalRow.updated_by ? ` · ${globalRow.updated_by}` : ""}
          </p>
        ) : null}
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-text-muted">加载中…</p>
      ) : (
        <VoiceConfigForm
          state={form}
          instances={instances}
          disabled={!canEdit || saving}
          onChange={setForm}
        />
      )}

      {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}
      {savedMessage ? <p className="mt-3 text-sm text-emerald-600">{savedMessage}</p> : null}

      <div className="mt-5 flex justify-end">
        {canEdit ? (
          <button
            type="button"
            disabled={loading || saving}
            onClick={handleSave}
            className="rounded-full bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            {saving ? "保存中…" : "保存全局配置"}
          </button>
        ) : (
          <p className="text-xs text-text-muted">viewer 角色只读</p>
        )}
      </div>
    </section>
  );
}
