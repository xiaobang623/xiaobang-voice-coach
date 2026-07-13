import { SPEED_OPTIONS } from "../config/session";
import type { UserPreferences, VoiceOption } from "../types";
import { Card } from "./ui/Card";
import { VoiceAvatar } from "./ui/VoiceAvatar";

export interface PracticePreferencesPanelProps {
  preferences: UserPreferences;
  voiceOptions: VoiceOption[];
  showVoicePicker: boolean;
  globalDefaultVoiceId?: string;
  onVoiceChange: (voiceType: string) => void;
  onSpeedChange: (speedRatio: number) => void;
  onShowSubtitleChange: (showSubtitle: boolean) => void;
  disabled?: boolean;
}

export function PracticePreferencesPanel({
  preferences,
  voiceOptions,
  showVoicePicker,
  globalDefaultVoiceId,
  onVoiceChange,
  onSpeedChange,
  onShowSubtitleChange,
  disabled = false,
}: PracticePreferencesPanelProps) {
  return (
    <Card variant="elevated" className="space-y-6 p-5">
      {showVoicePicker ? (
        <div>
          <p className="text-sm font-medium text-text">默认音色</p>
          <p className="mt-0.5 text-xs text-text-muted">每次开始练习时使用</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onVoiceChange("")}
            className={`mt-3 flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
              preferences.voiceType.trim() === ""
                ? "border-accent bg-surface-raised text-text shadow-card"
                : "border-border-subtle bg-surface/60 text-text-secondary hover:border-accent-muted"
            }`}
          >
            <span>
              <span className="block font-medium">跟随全局默认</span>
              <span className="mt-0.5 block text-xs text-text-muted">后台模型配置改了，新会话自动跟随</span>
            </span>
            <span className="text-xs text-text-muted">推荐</span>
          </button>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {voiceOptions.map((voice) => {
              const active = preferences.voiceType === voice.id;
              const isGlobalDefault = globalDefaultVoiceId === voice.id;
              return (
                <button
                  key={voice.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onVoiceChange(voice.id)}
                  className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    active
                      ? "border-accent bg-surface-raised text-text shadow-card"
                      : "border-border-subtle bg-surface/60 text-text-secondary hover:border-accent-muted"
                  }`}
                >
                  <VoiceAvatar voiceId={voice.id} label={voice.label} size="sm" />
                  <span className="min-w-0">
                    <span className="block font-medium">{voice.label}</span>
                    {isGlobalDefault ? (
                      <span className="mt-0.5 block text-xs text-text-muted">全局默认</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <p className="text-sm font-medium text-text">默认语速</p>
        <div className="mt-3 inline-flex rounded-full bg-bg-warm p-1">
          {SPEED_OPTIONS.map((speed) => {
            const active = preferences.speedRatio === speed.ratio;
            return (
              <button
                key={speed.id}
                type="button"
                disabled={disabled}
                onClick={() => onSpeedChange(speed.ratio)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "bg-surface-raised text-text shadow-card"
                    : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {speed.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-text">默认显示字幕</p>
          <p className="mt-0.5 text-xs text-text-muted">关闭后默认纯听力，可点气泡看单句</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={preferences.showSubtitle}
          disabled={disabled}
          onClick={() => onShowSubtitleChange(!preferences.showSubtitle)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
            preferences.showSubtitle ? "bg-accent" : "bg-accent-muted"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-surface-raised shadow transition ${
              preferences.showSubtitle ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    </Card>
  );
}
