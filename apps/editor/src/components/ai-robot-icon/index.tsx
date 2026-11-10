type Props = {
  size?: number;
  className?: string;
};

/** 圆头天线机器人，比 IconPark 的 Robot 在小尺寸工具栏上更干净 */
export function AiRobotIcon({ size = 16, className }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <path d="M24 6v8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="6" r="3" fill="currentColor" />
      <rect x="8" y="14" width="32" height="26" rx="10" stroke="currentColor" strokeWidth="3" />
      <circle cx="18.5" cy="27" r="2.6" fill="currentColor" />
      <circle cx="29.5" cy="27" r="2.6" fill="currentColor" />
      <path d="M19 35h10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
