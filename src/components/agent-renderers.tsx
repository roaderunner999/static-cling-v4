"use client";

import type { AgentResult } from "@/db/schema";
import { Markdown } from "@/components/markdown";

/**
 * The render-target views — one per agent output shape (number / list / table /
 * trend / text / image). Each reads the loosely-typed `result.data` defensively
 * (it came from a model), so a slightly-off shape degrades gracefully instead of
 * throwing. The dispatcher picks the view from `result.target`.
 */

export function AgentResultView({ result }: { result: AgentResult | null }) {
  if (!result) {
    return <Muted>Not run yet — hit Run to fetch the first result.</Muted>;
  }
  if (result.error) {
    return (
      <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
        {result.error}
      </div>
    );
  }

  const data = (result.data ?? {}) as Record<string, unknown>;
  let body: React.ReactNode;
  switch (result.target) {
    case "number":
      body = <NumberView d={data} />;
      break;
    case "list":
      body = <ListView d={data} />;
      break;
    case "table":
      body = <TableView d={data} />;
      break;
    case "line":
      body = <TrendView d={data} />;
      break;
    case "image":
      body = <ImageView d={data} />;
      break;
    default:
      body = <TextView d={data} />;
  }

  return (
    <div>
      {body}
      {result.caption && (
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">{result.caption}</p>
      )}
    </div>
  );
}

function NumberView({ d }: { d: Record<string, unknown> }) {
  const value = d.value as string | number | undefined;
  const delta = typeof d.delta === "number" ? d.delta : undefined;
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
          {value ?? "—"}
        </span>
        {typeof d.unit === "string" && (
          <span className="text-lg font-medium text-zinc-400">{d.unit}</span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {typeof d.label === "string" && (
          <span className="text-xs text-zinc-500">{d.label}</span>
        )}
        {delta !== undefined && (
          <span
            className={`font-mono text-xs ${
              delta > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : delta < 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-zinc-400"
            }`}
          >
            {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta)}
          </span>
        )}
      </div>
    </div>
  );
}

function ListView({ d }: { d: Record<string, unknown> }) {
  const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
  if (!items.length) return <Muted>Empty.</Muted>;
  return (
    <ul className="space-y-1.5">
      {items.slice(0, 12).map((it, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className="select-none font-mono text-xs text-violet-400">{i + 1}</span>
          <span className="min-w-0">
            <span className="text-zinc-700 dark:text-zinc-200">{String(it.text ?? "")}</span>
            {typeof it.sub === "string" && it.sub && (
              <span className="block truncate text-xs text-zinc-400">{it.sub}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TableView({ d }: { d: Record<string, unknown> }) {
  const columns = Array.isArray(d.columns) ? (d.columns as unknown[]).map(String) : [];
  const rows = Array.isArray(d.rows) ? (d.rows as unknown[][]) : [];
  if (!rows.length) return <Muted>Empty.</Muted>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        {columns.length > 0 && (
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              {columns.map((c, i) => (
                <th key={i} className="py-1 pr-3 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.slice(0, 15).map((r, i) => (
            <tr key={i} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
              {(Array.isArray(r) ? r : [r]).map((cell, j) => (
                <td key={j} className="py-1 pr-3 text-zinc-700 dark:text-zinc-300">
                  {String(cell ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrendView({ d }: { d: Record<string, unknown> }) {
  const points = Array.isArray(d.points) ? (d.points as Record<string, unknown>[]) : [];
  const ys = points.map((p) => Number(p.y)).filter((n) => !Number.isNaN(n));
  if (ys.length < 2) return <Muted>Not enough points to chart.</Muted>;

  const w = 280;
  const h = 64;
  const pad = 4;
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (ys.length - 1);
  const coords = ys.map((y, i) => {
    const px = pad + i * stepX;
    const py = pad + (h - pad * 2) * (1 - (y - min) / span);
    return [px, py] as const;
  });
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${coords[coords.length - 1][0].toFixed(1)},${h - pad} L${coords[0][0].toFixed(1)},${h - pad} Z`;
  const last = ys[ys.length - 1];
  const first = ys[0];
  const up = last >= first;

  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{last}</span>
        {typeof d.unit === "string" && <span className="text-sm text-zinc-400">{d.unit}</span>}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full" preserveAspectRatio="none">
        <path d={area} className={up ? "fill-emerald-500/10" : "fill-red-500/10"} />
        <path
          d={path}
          fill="none"
          className={up ? "stroke-emerald-500" : "stroke-red-500"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-zinc-400">
        <span>{String(points[0]?.x ?? "")}</span>
        <span>{String(points[points.length - 1]?.x ?? "")}</span>
      </div>
    </div>
  );
}

function ImageView({ d }: { d: Record<string, unknown> }) {
  const url = typeof d.url === "string" ? d.url : "";
  if (!/^https?:\/\//.test(url)) return <Muted>No image returned.</Muted>;
  return (
    // Agent images are arbitrary remote URLs Claude finds — next/image needs
    // configured domains, so a plain <img> is correct here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={typeof d.alt === "string" ? d.alt : "agent image"}
      className="max-h-56 w-full rounded-md object-cover"
    />
  );
}

function TextView({ d }: { d: Record<string, unknown> }) {
  const text = typeof d.text === "string" ? d.text : "";
  if (!text) return <Muted>No result.</Muted>;
  return <Markdown>{text}</Markdown>;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-400">{children}</p>;
}
