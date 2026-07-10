import { useCallback, useEffect, useState } from "react";
import {
  FALLBACK_VOICE_PROFILE,
  resolveVoiceProfileFromApiPayload,
  type VoiceProfile,
} from "../config/voices";

interface VoiceProfileApiResponse {
  backend?: string;
  voiceProfile?: unknown;
  config?: {
    backend?: string;
    selfhosted?: {
      ttsProvider?: string;
      siliconflowTtsVoice?: string;
    };
  };
}

export interface UseVoiceProfileResult {
  voiceProfile: VoiceProfile;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useVoiceProfile(): UseVoiceProfileResult {
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile>(FALLBACK_VOICE_PROFILE);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/voice-backend-config", {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        return;
      }
      const text = await response.text();
      if (!text.trim()) {
        return;
      }
      const payload = JSON.parse(text) as VoiceProfileApiResponse;
      setVoiceProfile(resolveVoiceProfileFromApiPayload(payload));
    } catch {
      // Keep the last known profile (or fallback) on transient failures.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refresh]);

  return { voiceProfile, isLoading, refresh };
}
