import type { ReactNode } from "react";

function inline(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return (
        <strong key={`${key}-${i}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return (
        <code
          key={`${key}-${i}`}
          className="rounded bg-muted px-1 py-px font-mono text-[12px] text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      );
    return part.replace(/\*([^*]+)\*/g, "$1");
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let ordered = false;
  const flush = () => {
    if (!list.length) return;
    const items = list.map((item, i) => (
      <li key={i} className="pl-1">
        {inline(item, `li${blocks.length}-${i}`)}
      </li>
    ));
    blocks.push(
      ordered ? (
        <ol key={blocks.length} className="m-0 grid list-decimal gap-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className="m-0 grid list-disc gap-1 pl-5">
          {items}
        </ul>
      ),
    );
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      if (list.length && ordered !== Boolean(numbered)) flush();
      ordered = Boolean(numbered);
      list.push((bullet ?? numbered)![1]);
      continue;
    }
    flush();
    if (line)
      blocks.push(
        <p key={blocks.length} className="m-0">
          {inline(line.replace(/^#+\s*/, ""), `p${blocks.length}`)}
        </p>,
      );
  }
  flush();
  return <div className="grid gap-2 text-[13px] leading-relaxed text-foreground/90">{blocks}</div>;
}
