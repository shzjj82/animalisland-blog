type Props = {
  type: "pdf" | "word";
  size?: number;
};

const COLORS = { pdf: "#E5252A", word: "#185ABD" } as const;

export function FileTypeIcon({ type, size = 16 }: Props) {
  const color = COLORS[type];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path d="M6 2h8.5L20 7.5V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" fill="#fff" stroke={color} strokeWidth="1.5" />
      <path d="M14.5 2v4.5a1 1 0 0 0 1 1H20" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="2" y="11" width={type === "pdf" ? 15 : 11} height="8" rx="1.5" fill={color} />
      {type === "pdf" ? (
        <text x="9.5" y="17.2" textAnchor="middle" fontSize="6" fontWeight="800" fill="#fff" fontFamily="ui-sans-serif,system-ui,sans-serif">
          PDF
        </text>
      ) : (
        <path d="m4 13 1.2 4.5L6.5 14l1.3 3.5L9 13" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
