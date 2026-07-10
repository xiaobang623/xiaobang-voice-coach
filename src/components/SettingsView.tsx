import { PracticePreferencesPanel } from "./PracticePreferencesPanel";
import { Card } from "./ui/Card";
import { useVoiceProfile } from "../hooks/useVoiceProfile";
import { pickVoiceType, showsVoicePicker } from "../config/voices";
import { useAuth } from "../hooks/useAuth";
import { useUserPreferences } from "../hooks/useUserPreferences";

export interface SettingsViewProps {
  onOpenAccount: () => void;
}

function SettingsRow({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left">
      <Card
        variant="elevated"
        className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-surface"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{label}</p>
          {hint ? <p className="mt-0.5 truncate text-xs text-text-muted">{hint}</p> : null}
        </div>
        <span className="shrink-0 text-accent-muted" aria-hidden="true">
          ›
        </span>
      </Card>
    </button>
  );
}

export function SettingsView({ onOpenAccount }: SettingsViewProps) {
  const { isAnonymous, nickname, email } = useAuth();
  const { preferences, isReady, setVoiceType, setSpeedRatio, setShowSubtitle } = useUserPreferences();
  const { voiceProfile } = useVoiceProfile();
  const resolvedVoiceType = pickVoiceType(preferences.voiceType, voiceProfile);

  const displayName = nickname?.trim();

  const accountHint = isAnonymous
    ? "未登录 · 点击登录或注册"
    : displayName
      ? `${displayName} · ${email ?? ""}`
      : (email ?? "已登录");

  return (
    <section className="space-y-6">
      <SettingsRow label="账号" hint={accountHint} onClick={onOpenAccount} />

      <div>
        <p className="mb-3 text-sm font-medium text-text-secondary">练习默认</p>
        {isReady ? (
          <PracticePreferencesPanel
            preferences={{ ...preferences, voiceType: resolvedVoiceType }}
            voiceOptions={voiceProfile.voices}
            showVoicePicker={showsVoicePicker(voiceProfile)}
            onVoiceChange={setVoiceType}
            onSpeedChange={setSpeedRatio}
            onShowSubtitleChange={setShowSubtitle}
          />
        ) : (
          <p className="text-sm text-text-muted">加载中…</p>
        )}
        {!isAnonymous ? (
          <p className="mt-3 text-xs leading-relaxed text-text-muted">
            已保存到账号，每次登录后会自动应用这些默认选项。
          </p>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-text-muted">
            当前仅保存在本设备。登录账号后可跨设备同步。
          </p>
        )}
      </div>
    </section>
  );
}
