import { useEffect, useState } from "react";
import {
  deleteVoiceConfigOverride,
  fetchModelInstances,
  fetchResolvedVoiceConfig,
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

interface VoiceConfigModalProps {
  user: AdminUser;
  scopeType: "user" | "session";
  userId?: string;
  guestId?: string;
  sessionId?: string;
  title: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function VoiceConfigModal({
  user,
  scopeType,
  userId,
  guestId,
  sessionId,
  title,
  onClose,
  onSaved,
}: VoiceConfigModalProps) {
  const [form, setForm] = useState<VoiceConfigFormState>(DEFAULT_FORM_STATE);
  const [effectivePreview, setEffectivePreview] = useState<string>("");
  const [overrideRow, setOverrideRow] = useState<VoiceBackendConfigRow | null>(null);
  const [instances, setInstances] = useState<Awaited<ReturnType<typeof fetchModelInstances>> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = user.role === "admin";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const [resolved, rows, modelInstances] = await Promise.all([
          fetchResolvedVoiceConfig({ userId, guestId, sessionId }),
          fetchVoiceConfigRows(scopeType),
          fetchModelInstances(),
        ]);

        if (cancelled) {
          return;
        }

        setInstances(modelInstances);

        const existing = rows.find((row) => {
          if (scopeType === "session") {
            return row.session_id === sessionId;
          }
          if (userId) {
            return row.user_id === userId;
          }
          return row.guest_id === guestId;
        });

        setOverrideRow(existing ?? null);

        if (existing) {
          setForm(formStateFromPayload(existing.backend, existing.config));
        } else {
          setForm(
            formStateFromPayload(resolved.effective.backend, resolved.effective.config),
          );
        }

        const eff = resolved.effective;
        const sh = eff.config.selfhosted;
        setEffectivePreview(
          eff.backend === "doubao"
            ? `${eff.backend} · 豆包 ${eff.config.doubao?.dialogModel ?? "—"}`
            : `${eff.backend} · ASR ${sh?.asrProvider ?? "—"} · TTS ${sh?.ttsProvider ?? "—"} · DeepSeek ${sh?.deepseekModel ?? "—"}`,
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scopeType, userId, guestId, sessionId]);

  const handleSave = () => {
    if (!canEdit) {
      return;
    }

    setSaving(true);
    setError(null);

    void (async () => {
      try {
        await saveVoiceConfig({
          scopeType,
          backend: form.backend,
          config: formStateToPayload(form),
          userId,
          guestId,
          sessionId,
        });
        onSaved?.();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存失败");
      } finally {
        setSaving(false);
      }
    })();
  };

  const handleClear = () => {
    if (!canEdit || !overrideRow) {
      return;
    }

    setSaving(true);
    setError(null);

    void (async () => {
      try {
        await deleteVoiceConfigOverride({
          scopeType,
          userId,
          guestId,
          sessionId,
        });
        onSaved?.();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "清除失败");
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border-subtle bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-medium">{title}</h3>
            <p className="mt-1 text-xs text-text-muted">当前生效：{effectivePreview || "—"}</p>
            {overrideRow ? (
              <p className="mt-1 text-xs text-text-muted">
                覆盖于 {formatDateTime(overrideRow.updated_at)}
                {overrideRow.updated_by ? ` · ${overrideRow.updated_by}` : ""}
              </p>
            ) : (
              <p className="mt-1 text-xs text-text-muted">暂无专属覆盖，继承上级配置</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-2 py-1 text-sm text-text-muted hover:text-text"
          >
            关闭
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-text-muted">加载中…</p>
        ) : (
          <VoiceConfigForm
            state={form}
            instances={instances}
            disabled={!canEdit || saving}
            onChange={setForm}
          />
        )}

        {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {overrideRow && canEdit ? (
            <button
              type="button"
              disabled={saving}
              onClick={handleClear}
              className="rounded-full border border-border px-4 py-2 text-sm text-text-secondary hover:bg-bg-warm disabled:opacity-40"
            >
              清除覆盖
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              disabled={loading || saving}
              onClick={handleSave}
              className="rounded-full bg-accent px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              {saving ? "保存中…" : "保存覆盖"}
            </button>
          ) : (
            <p className="text-xs text-text-muted self-center">viewer 角色只读</p>
          )}
        </div>
      </div>
    </div>
  );
}
