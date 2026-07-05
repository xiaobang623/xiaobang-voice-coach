import { useState, type FormEvent } from "react";
import { EMAIL_ALREADY_REGISTERED, useAuth } from "../hooks/useAuth";

type Mode = "signup" | "login";

/**
 * Header account entry. Registered users see nickname + sign out. Guests see a
 * guest label with login / register actions and a clear no-memory disclaimer.
 */
export function AccountModal() {
  const {
    isConfigured,
    isAnonymous,
    email,
    nickname,
    registerAccount,
    signInWithPassword,
    signOut,
  } = useAuth();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("signup");
  const [nicknameValue, setNicknameValue] = useState("");
  const [emailValue, setEmailValue] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);

  if (!isConfigured) {
    return null;
  }

  const resetForm = () => {
    setNicknameValue("");
    setEmailValue("");
    setPassword("");
    setError(null);
    setEmailTaken(false);
  };

  const openModal = (nextMode: Mode) => {
    setMode(nextMode);
    resetForm();
    setOpen(true);
  };

  const closeModal = () => {
    setOpen(false);
    resetForm();
  };

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setError(null);
    setEmailTaken(false);
    setPassword("");
    if (nextMode === "login") {
      setNicknameValue("");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setEmailTaken(false);
    try {
      if (mode === "signup") {
        await registerAccount(emailValue, password, nicknameValue);
      } else {
        await signInWithPassword(emailValue, password);
      }
      closeModal();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : String(submitError);
      if (message === EMAIL_ALREADY_REGISTERED) {
        // Keep the email, guide the user to the login tab.
        setError("这个邮箱已经注册过了，直接登录吧～");
        setEmailTaken(true);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const displayName = nickname?.trim() || null;
  const canSubmit =
    mode === "signup"
      ? Boolean(emailValue.trim() && password && nicknameValue.trim())
      : Boolean(emailValue.trim() && password);

  // Registered account: nickname + sign out.
  if (!isAnonymous && email) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#A89B8C]">
        {displayName ? (
          <span className="max-w-[8rem] truncate font-medium text-[#7C6B5D]" title={email}>
            {displayName}
          </span>
        ) : (
          <span className="max-w-[10rem] truncate" title={email}>
            {email}
          </span>
        )}
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-[#A89B8C] transition-colors hover:text-[#7C6B5D]"
        >
          退出
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 text-sm">
        <span
          className="text-xs text-[#C4B5A5]"
          title="未登录时，练习记录和成长记忆不会保存到账号"
        >
          游客
        </span>
        <button
          type="button"
          onClick={() => openModal("login")}
          className="text-[#A89B8C] transition-colors hover:text-[#7C6B5D]"
        >
          登录
        </button>
        <span className="text-[#E8DFD4]" aria-hidden="true">
          |
        </span>
        <button
          type="button"
          onClick={() => openModal("signup")}
          className="text-[#A89B8C] transition-colors hover:text-[#7C6B5D]"
        >
          注册
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#3D3D3D]/30 px-6 backdrop-blur-[2px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-modal-title"
            className="w-full max-w-sm rounded-3xl bg-[#FFF9F3] p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 id="account-modal-title" className="sr-only">
                {mode === "signup" ? "注册账号" : "登录账号"}
              </h2>
              <button
                type="button"
                onClick={closeModal}
                className="ml-auto text-[#A89B8C] transition-colors hover:text-[#7C6B5D]"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div
              role="tablist"
              aria-label="账号操作"
              className="flex rounded-full bg-[#F3EBE2] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                onClick={() => switchMode("signup")}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  mode === "signup"
                    ? "bg-white text-[#3D3D3D] shadow-sm"
                    : "text-[#A89B8C] hover:text-[#7C6B5D]"
                }`}
              >
                注册
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                onClick={() => switchMode("login")}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  mode === "login"
                    ? "bg-white text-[#3D3D3D] shadow-sm"
                    : "text-[#A89B8C] hover:text-[#7C6B5D]"
                }`}
              >
                登录
              </button>
            </div>

            <p className="mt-4 text-sm text-[#A89B8C]">
              {mode === "signup" ? (
                <>注册后，小榜会记住你的昵称、练习记录和成长记忆，换设备也能找回。</>
              ) : (
                <>用已有账号登录，取回你的昵称、历史和成长记忆。</>
              )}
            </p>

            <form className="mt-5 space-y-3" onSubmit={(event) => void handleSubmit(event)}>
              {mode === "signup" ? (
                <input
                  type="text"
                  value={nicknameValue}
                  onChange={(event) => setNicknameValue(event.target.value)}
                  placeholder="昵称（例如：小明）"
                  autoComplete="nickname"
                  autoFocus
                  maxLength={32}
                  className="w-full rounded-2xl border border-[#E8DFD4] bg-white px-4 py-3 text-sm text-[#3D3D3D] outline-none transition-colors focus:border-[#7C6B5D]"
                />
              ) : null}
              <input
                type="email"
                value={emailValue}
                onChange={(event) => setEmailValue(event.target.value)}
                placeholder="邮箱"
                autoComplete="email"
                autoFocus={mode === "login"}
                className="w-full rounded-2xl border border-[#E8DFD4] bg-white px-4 py-3 text-sm text-[#3D3D3D] outline-none transition-colors focus:border-[#7C6B5D]"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === "signup" ? "设置密码（至少 6 位）" : "输入密码"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="w-full rounded-2xl border border-[#E8DFD4] bg-white px-4 py-3 text-sm text-[#3D3D3D] outline-none transition-colors focus:border-[#7C6B5D]"
              />

              {error ? (
                <div className="space-y-1.5">
                  <p className="text-sm text-[#B85C5C]">{error}</p>
                  {emailTaken ? (
                    <button
                      type="button"
                      onClick={() => switchMode("login")}
                      className="text-sm font-medium text-[#7C6B5D] underline underline-offset-2 transition-colors hover:text-[#5C4E42]"
                    >
                      用这个邮箱去登录 →
                    </button>
                  ) : null}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={busy || !canSubmit}
                className="w-full rounded-full bg-[#7C6B5D] px-6 py-3 text-sm font-medium text-[#FAF8F3] shadow-md transition-transform hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "处理中…" : mode === "signup" ? "注册" : "登录"}
              </button>
            </form>

            <button
              type="button"
              onClick={closeModal}
              className="mt-4 w-full text-center text-sm text-[#A89B8C] transition-colors hover:text-[#7C6B5D]"
            >
              先随便聊聊（不保存账号记忆）
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
