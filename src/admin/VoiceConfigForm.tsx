import type {
  AsrProvider,
  ModelInstancesData,
  TtsProvider,
  VoiceBackend,
  VoiceModelConfigPayload,
} from "./types";

export interface VoiceConfigFormState {
  backend: VoiceBackend;
  doubaoDialogModel: string;
  asrProvider: AsrProvider;
  ttsProvider: TtsProvider;
  siliconflowTtsVoice: string;
  whisperModel: string;
  deepseekModel: string;
  cosyvoiceModelKey: string;
}

export const DEFAULT_FORM_STATE: VoiceConfigFormState = {
  backend: "doubao",
  doubaoDialogModel: "1.2.1.1",
  asrProvider: "siliconflow-sensevoice",
  ttsProvider: "local-cosyvoice",
  siliconflowTtsVoice: "diana",
  whisperModel: "base",
  deepseekModel: "deepseek-chat",
  cosyvoiceModelKey: "cosyvoice2-0.5b",
};

const ASR_OPTIONS: Array<{ value: AsrProvider; label: string; hint: string }> = [
  { value: "local-whisper", label: "本地 Whisper", hint: "自托管实例" },
  {
    value: "siliconflow-sensevoice",
    label: "SenseVoiceSmall",
    hint: "SiliconFlow · 免费 · 英文陪练推荐（低延迟）",
  },
  {
    value: "siliconflow-telespeech",
    label: "TeleSpeechASR",
    hint: "SiliconFlow · 免费 · 方言场景备选",
  },
];

const TTS_OPTIONS: Array<{ value: TtsProvider; label: string; hint: string }> = [
  { value: "local-cosyvoice", label: "本地 CosyVoice", hint: "自托管实例" },
  {
    value: "siliconflow-cosyvoice",
    label: "CosyVoice2-0.5B",
    hint: "SiliconFlow · ¥0.05/千字符",
  },
  {
    value: "siliconflow-moss-ttsd",
    label: "MOSS-TTSD-v0.5",
    hint: "SiliconFlow · ¥0.05/千字符",
  },
];

const SILICONFLOW_VOICES = ["alex", "benjamin", "charles", "david", "anna", "bella", "claire", "diana"];

export function formStateFromPayload(
  backend: VoiceBackend,
  config: VoiceModelConfigPayload,
): VoiceConfigFormState {
  return {
    backend,
    doubaoDialogModel: config.doubao?.dialogModel ?? DEFAULT_FORM_STATE.doubaoDialogModel,
    asrProvider: config.selfhosted?.asrProvider ?? DEFAULT_FORM_STATE.asrProvider,
    ttsProvider: config.selfhosted?.ttsProvider ?? DEFAULT_FORM_STATE.ttsProvider,
    siliconflowTtsVoice:
      config.selfhosted?.siliconflowTtsVoice ?? DEFAULT_FORM_STATE.siliconflowTtsVoice,
    whisperModel: config.selfhosted?.whisperModel ?? DEFAULT_FORM_STATE.whisperModel,
    deepseekModel: config.selfhosted?.deepseekModel ?? DEFAULT_FORM_STATE.deepseekModel,
    cosyvoiceModelKey:
      config.selfhosted?.cosyvoiceModelKey ?? DEFAULT_FORM_STATE.cosyvoiceModelKey,
  };
}

export function formStateToPayload(state: VoiceConfigFormState): VoiceModelConfigPayload {
  return {
    doubao: { dialogModel: state.doubaoDialogModel.trim() || DEFAULT_FORM_STATE.doubaoDialogModel },
    selfhosted: {
      asrProvider: state.asrProvider,
      ttsProvider: state.ttsProvider,
      siliconflowTtsVoice: state.siliconflowTtsVoice,
      whisperModel: state.whisperModel,
      deepseekModel: state.deepseekModel,
      cosyvoiceModelKey: state.cosyvoiceModelKey,
    },
  };
}

interface VoiceConfigFormProps {
  state: VoiceConfigFormState;
  instances: ModelInstancesData | null;
  disabled?: boolean;
  onChange: (next: VoiceConfigFormState) => void;
}

function HealthDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-red-400"}`}
      title={ok ? "健康" : "不可用"}
    />
  );
}

function providerOk(
  instances: ModelInstancesData | null,
  kind: "asr" | "tts",
  provider: string,
): boolean {
  if (provider === "local-whisper" || provider === "local-cosyvoice") {
    return true;
  }
  if (!instances?.siliconflow?.apiKeyConfigured) {
    return false;
  }
  if (kind === "asr") {
    return instances.siliconflow.asr[provider]?.ok ?? false;
  }
  return instances.siliconflow.tts[provider]?.ok ?? false;
}

export function VoiceConfigForm({ state, instances, disabled, onChange }: VoiceConfigFormProps) {
  const whisperKeys =
    instances?.keys.whisper.length ? instances.keys.whisper : [DEFAULT_FORM_STATE.whisperModel];
  const cosyvoiceKeys =
    instances?.keys.cosyvoice.length
      ? instances.keys.cosyvoice
      : [DEFAULT_FORM_STATE.cosyvoiceModelKey];

  const whisperHealth = new Map(instances?.whisper.map((item) => [item.key, item.ok]) ?? []);
  const cosyvoiceHealth = new Map(instances?.cosyvoice.map((item) => [item.key, item.ok]) ?? []);

  const usesSiliconFlow =
    state.asrProvider.startsWith("siliconflow-") || state.ttsProvider.startsWith("siliconflow-");

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-text-secondary">语音后端</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="backend"
              checked={state.backend === "doubao"}
              disabled={disabled}
              onChange={() => onChange({ ...state, backend: "doubao" })}
            />
            豆包实时语音
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="backend"
              checked={state.backend === "selfhosted"}
              disabled={disabled}
              onChange={() => onChange({ ...state, backend: "selfhosted" })}
            />
            自建链路（ASR + DeepSeek + TTS）
          </label>
        </div>
        <p className="text-xs text-text-muted">切换仅对新开始的语音会话生效。</p>
      </fieldset>

      {state.backend === "doubao" ? (
        <label className="block space-y-1 text-sm">
          <span className="text-text-secondary">豆包对话模型版本</span>
          <input
            value={state.doubaoDialogModel}
            disabled={disabled}
            onChange={(event) => onChange({ ...state, doubaoDialogModel: event.target.value })}
            placeholder="1.2.1.1"
            className="w-full rounded-xl border border-border bg-bg px-3 py-2 outline-none focus:border-accent"
          />
          <span className="text-xs text-text-muted">常见值：1.2.1.1（O2.0 对话模型）</span>
        </label>
      ) : (
        <div className="space-y-3 rounded-xl border border-border-subtle bg-bg/50 p-4">
          {usesSiliconFlow && !instances?.siliconflow?.apiKeyConfigured ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
              已选择 SiliconFlow 提供方，但服务端未配置 SILICONFLOW_API_KEY。
            </p>
          ) : null}

          <label className="block space-y-1 text-sm">
            <span className="flex items-center gap-2 text-text-secondary">
              ASR（语音转文字）
              <HealthDot ok={providerOk(instances, "asr", state.asrProvider)} />
            </span>
            <select
              value={state.asrProvider}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...state, asrProvider: event.target.value as AsrProvider })
              }
              className="w-full rounded-xl border border-border bg-bg px-3 py-2"
            >
              {ASR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.hint}
                </option>
              ))}
            </select>
          </label>

          {state.asrProvider === "local-whisper" ? (
            <label className="block space-y-1 text-sm">
              <span className="flex items-center gap-2 text-text-secondary">
                Whisper 实例
                <HealthDot ok={whisperHealth.get(state.whisperModel) ?? false} />
              </span>
              <select
                value={state.whisperModel}
                disabled={disabled}
                onChange={(event) => onChange({ ...state, whisperModel: event.target.value })}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2"
              >
                {whisperKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block space-y-1 text-sm">
            <span className="text-text-secondary">DeepSeek 模型</span>
            <select
              value={state.deepseekModel}
              disabled={disabled}
              onChange={(event) => onChange({ ...state, deepseekModel: event.target.value })}
              className="w-full rounded-xl border border-border bg-bg px-3 py-2"
            >
              <option value="deepseek-chat">deepseek-chat</option>
              <option value="deepseek-reasoner">deepseek-reasoner</option>
            </select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="flex items-center gap-2 text-text-secondary">
              TTS（文字转语音）
              <HealthDot ok={providerOk(instances, "tts", state.ttsProvider)} />
            </span>
            <select
              value={state.ttsProvider}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...state, ttsProvider: event.target.value as TtsProvider })
              }
              className="w-full rounded-xl border border-border bg-bg px-3 py-2"
            >
              {TTS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} — {option.hint}
                </option>
              ))}
            </select>
          </label>

          {state.ttsProvider === "local-cosyvoice" ? (
            <label className="block space-y-1 text-sm">
              <span className="flex items-center gap-2 text-text-secondary">
                CosyVoice 实例
                <HealthDot ok={cosyvoiceHealth.get(state.cosyvoiceModelKey) ?? false} />
              </span>
              <select
                value={state.cosyvoiceModelKey}
                disabled={disabled}
                onChange={(event) => onChange({ ...state, cosyvoiceModelKey: event.target.value })}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2"
              >
                {cosyvoiceKeys.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block space-y-1 text-sm">
              <span className="text-text-secondary">SiliconFlow 音色</span>
              <select
                value={state.siliconflowTtsVoice}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...state, siliconflowTtsVoice: event.target.value })
                }
                className="w-full rounded-xl border border-border bg-bg px-3 py-2"
              >
                {SILICONFLOW_VOICES.map((voice) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
              <span className="text-xs text-text-muted">
                英文教练推荐 diana / benjamin；CosyVoice2 与 MOSS-TTSD 共用预置音色名。
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
