import { useEffect } from "react";

// Iconfont 图标组件
// 使用方式: <Icon name="icon-name" size={20} color="#fff" />

const ICONFONT_URL = "//at.alicdn.com/t/c/font_5169341_c9xp5l9of05.js";

let scriptLoaded = false;

function loadIconfontScript() {
  if (scriptLoaded || document.getElementById("iconfont-script")) {
    return;
  }
  const script = document.createElement("script");
  script.id = "iconfont-script";
  script.src = ICONFONT_URL;
  script.async = true;
  document.body.appendChild(script);
  scriptLoaded = true;
}

export function Icon({
  name,
  size = 16,
  color,
  className,
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  useEffect(() => {
    loadIconfontScript();
  }, []);

  return (
    <svg
      className={`icon ${className || ""}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fill: color || "currentColor",
        stroke: color || "currentColor",
        ...style,
      }}
    >
      <use xlinkHref={`#${name}`} />
    </svg>
  );
}

// 预定义的图标名称
export const IconNames = {
  ARROW: "icon-arrow",        // 返回/箭头
  MESSAGE: "icon-message",    // 消息
  INTERNET: "icon-internet",  // 网络/连接
  SEND: "icon-send",          // 发送
  UPLOAD: "icon-upload",      // 上传
  MAXIMIZE: "icon-maximize",  // 最大化/展开
  CLOSE: "icon-close",        // 关闭
} as const;
