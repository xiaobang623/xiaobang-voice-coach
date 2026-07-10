import { useCallback, useEffect, useRef, useState } from "react";

import xiaobangBase from "../../assets/xiaobang/xiaobang-base.png";
import xiaobangIdle from "../../assets/xiaobang/xiaobang-idle.png";
import xiaobangThinking from "../../assets/xiaobang/xiaobang-thinking.png";
import xiaobangTalking from "../../assets/xiaobang/xiaobang-talking.png";
import xiaobangHappy from "../../assets/xiaobang/xiaobang-happy.png";

export type MascotExpression = "idle" | "thinking" | "talking" | "happy";

export interface MascotProps {
  expression?: MascotExpression;
  size?: number;
  bob?: boolean;
  /** Enables cursor-following gaze + a happy tap reaction. */
  interactive?: boolean;
  /** Renders the full sitting-pose body (+ paws + tail) instead of just the
   *  head. Only worth turning on at hero sizes (~56px+) — at nav/avatar sizes
   *  (32-40px) the extra silhouette reads as clutter, not detail. */
  fullBody?: boolean;
  className?: string;
}

const IMAGE_BY_EXPRESSION: Record<MascotExpression, string> = {
  idle: xiaobangIdle,
  thinking: xiaobangThinking,
  talking: xiaobangTalking,
  happy: xiaobangHappy,
};

function resolveMascotImage(expression: MascotExpression, fullBody: boolean): string {
  if (fullBody) {
    return xiaobangBase;
  }
  return IMAGE_BY_EXPRESSION[expression];
}

/** Static-image mascot wrapper that preserves the old Mascot API so existing
 *  callers do not need to change. */
export function Mascot({
  expression = "idle",
  size = 80,
  bob = true,
  interactive = false,
  fullBody = false,
  className = "",
}: MascotProps) {
  const [popped, setPopped] = useState(false);
  const popTimeout = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(popTimeout.current), []);

  const handleTap = useCallback(() => {
    if (!interactive) {
      return;
    }
    setPopped(true);
    window.clearTimeout(popTimeout.current);
    popTimeout.current = window.setTimeout(() => setPopped(false), 650);
  }, [interactive]);

  const src = resolveMascotImage(expression, fullBody);

  return (
    <div
      className={`${bob ? "animate-mascot-bob" : ""} ${interactive ? "cursor-pointer" : ""} ${
        popped ? "animate-mascot-pop" : ""
      } ${className}`.trim()}
      style={{ width: size, height: size, display: "inline-block" }}
      onClick={handleTap}
      role="img"
      aria-label="小榜"
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="block h-full w-full select-none object-contain"
        aria-hidden="true"
      />
    </div>
  );
}
