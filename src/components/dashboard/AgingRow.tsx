export const AgingRow = ({ label, count, tone }: { label: string; count: number; tone: string }) => (
  <li className="flex items-center justify-between gap-2">
    <span className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full ${tone}`} />
      {label}
    </span>
    <span className="font-semibold">{count}</span>
  </li>
);
