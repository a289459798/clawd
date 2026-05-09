import type { CSSProperties } from "react";

export const IconNames = {
  ARROW: "icon-arrow",
  MESSAGE: "icon-message",
  INTERNET: "icon-internet",
  SEND: "icon-send",
  UPLOAD: "icon-upload",
  MAXIMIZE: "icon-maximize",
  CLOSE: "icon-close",
} as const;

type IconName = typeof IconNames[keyof typeof IconNames];

type IconProps = {
  name: IconName | string;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
};

function iconPaths(name: string) {
  switch (name) {
    case IconNames.ARROW:
      /* Chevron down (24×24); rotate parent for collapsed → side */
      return <path d="M6 9l6 6 6-6" />;
    case IconNames.MESSAGE:
      return <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7A2.5 2.5 0 0 1 17.5 15H9l-5 4v-4.5A2.5 2.5 0 0 1 4 12.5z" />;
    case IconNames.INTERNET:
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3.6 9h16.8M3.6 15h16.8M12 3c2.2 2.4 3.3 5.4 3.3 9S14.2 18.6 12 21M12 3C9.8 5.4 8.7 8.4 8.7 12S9.8 18.6 12 21" />
        </>
      );
    case IconNames.SEND:
      return <path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" />;
    case IconNames.UPLOAD:
      return (
        <>
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M5 20h14" />
        </>
      );
    case IconNames.MAXIMIZE:
      return (
        <>
          <path d="M8 3H3v5" />
          <path d="M16 3h5v5" />
          <path d="M8 21H3v-5" />
          <path d="M16 21h5v-5" />
        </>
      );
    case IconNames.CLOSE:
      return (
        <>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </>
      );
    default:
      return <circle cx="12" cy="12" r="7" />;
  }
}

export function Icon({ name, size = 16, color, className, style }: IconProps) {
  return (
    <svg
      className={`icon ${className || ""}`}
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color || "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        color: color || "currentColor",
        ...style,
      }}
    >
      {iconPaths(name)}
    </svg>
  );
}
