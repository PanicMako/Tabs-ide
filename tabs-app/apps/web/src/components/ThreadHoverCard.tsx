import { threadHoverCardRows, type ThreadHoverCardInput } from "./threadHoverCard.logic";

/** The full title and the few facts you want before opening a thread, shown on hover. */
export function ThreadHoverCard({ title, ...input }: { title: string } & ThreadHoverCardInput) {
  const rows = threadHoverCardRows(input);
  return (
    <div className="flex max-w-72 min-w-0 flex-col gap-2 py-1 text-left">
      <div className="text-xs leading-snug font-medium break-words whitespace-normal">{title}</div>
      {rows.length > 0 && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="m-0 truncate">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
