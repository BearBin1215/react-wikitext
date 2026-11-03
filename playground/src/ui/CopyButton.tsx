import { useEffect, useState } from "react";
import { copyText } from "@pg/harness/clipboard";

interface CopyButtonProps {
  text: string;
  label?: string;
}

type CopyState = "idle" | "copied" | "failed";

export function CopyButton({ text, label = "复制" }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") {
      return;
    }
    const timer = setTimeout(() => setState("idle"), 1_500);
    return () => clearTimeout(timer);
  }, [state]);

  const handleClick = () => {
    void copyText(text).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  };

  return (
    <button type="button" className="pg-button" onClick={handleClick}>
      {state === "copied" ? "已复制" : state === "failed" ? "复制失败" : label}
    </button>
  );
}
