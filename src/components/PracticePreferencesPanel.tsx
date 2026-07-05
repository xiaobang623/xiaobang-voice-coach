import { SPEED_OPTIONS, VOICE_OPTIONS } from "../config/session";
import type { UserPreferences } from "../types";
import { Card } from "./ui/Card";
import { VoiceAvatar } from "./ui/VoiceAvatar";

export interface PracticePreferencesPanelProps {
  preferences: UserPreferences;
  onVoiceChange: (voiceType: string) => void;
  onSpeedChange: (speedRatio: number) => void;
  onShowSubtitleChange: (showSubtitle: boolean) => void;
  disabled?: boolean;
}

export function PracticePreferencesPanel({
  preferences,
  onVoiceChange,
  onSpeedChange,
  onShowSubtitleChange,
  disabled = false,
}: PracticePreferencesPanelProps) {
  return (
    <Card variant="elevated" className="space-y-6 p-5">
      <div>
        <p className="text-sm font-medium text-text">默认音色</p>
        <p className="mt-0.5 text-xs text-text-muted">每次开始练习时使用</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {VOICE_OPTIONS.map((voice) => {
            const active = preferences.voiceType === voice.id;
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
                <span className="font-medium">{voice.label}</span>
              </button>
            );
          })}
        </div>
      </div>

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
