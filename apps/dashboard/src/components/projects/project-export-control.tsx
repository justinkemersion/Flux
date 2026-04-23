"use client";

import { useMemo, useState } from "react";

type Props = {
  hash: string;
};

/**
 * Project export controls for SQL dump streaming.
 */
export function ProjectExportControl({ hash }: Props) {
  const [schemaOnly, setSchemaOnly] = useState(false);
  const [dataOnly, setDataOnly] = useState(false);
  const [clean, setClean] = useState(false);

  const downloadHref = useMemo(() => {
    const params = new URLSearchParams();
    if (schemaOnly) params.set("schemaOnly", "1");
    if (dataOnly) params.set("dataOnly", "1");
    if (clean) params.set("clean", "1");
    const q = params.toString();
    const base = `/api/cli/v1/projects/${encodeURIComponent(hash)}/dump`;
    return q.length > 0 ? `${base}?${q}` : base;
  }, [clean, dataOnly, hash, schemaOnly]);

  function onSchemaToggle(): void {
    setSchemaOnly((prev) => {
      const next = !prev;
      if (next) setDataOnly(false);
      return next;
    });
  }

  function onDataToggle(): void {
    setDataOnly((prev) => {
      const next = !prev;
      if (next) setSchemaOnly(false);
      return next;
    });
  }

  function downloadDump(): void {
    window.location.assign(downloadHref);
  }

  return (
    <section
      className="border border-zinc-800 bg-zinc-950 p-3 font-mono"
      aria-label="Project export control"
    >
      <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        EXPORT_CONTROL
      </div>
      <div className="grid grid-cols-1 border border-zinc-800 text-[11px] text-zinc-300 sm:grid-cols-[1fr_auto]">
        <label className="contents cursor-pointer">
          <span className="border-b border-zinc-800 bg-black px-3 py-2 sm:border-r">
            [ ] Schema Only
          </span>
          <span className="border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-right">
            <input
              type="checkbox"
              checked={schemaOnly}
              onChange={onSchemaToggle}
              className="h-3.5 w-3.5 rounded-none border-zinc-600 bg-black text-zinc-300 focus:ring-0 focus:ring-offset-0"
            />
          </span>
        </label>
        <label className="contents cursor-pointer">
          <span className="border-b border-zinc-800 bg-black px-3 py-2 sm:border-r">
            [ ] Data Only
          </span>
          <span className="border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-right">
            <input
              type="checkbox"
              checked={dataOnly}
              onChange={onDataToggle}
              className="h-3.5 w-3.5 rounded-none border-zinc-600 bg-black text-zinc-300 focus:ring-0 focus:ring-offset-0"
            />
          </span>
        </label>
        <label className="contents cursor-pointer">
          <span className="bg-black px-3 py-2 sm:border-r">
            [ ] Include DROP commands
          </span>
          <span className="bg-zinc-950 px-3 py-2 text-right">
            <input
              type="checkbox"
              checked={clean}
              onChange={(e) => setClean(e.target.checked)}
              className="h-3.5 w-3.5 rounded-none border-zinc-600 bg-black text-zinc-300 focus:ring-0 focus:ring-offset-0"
            />
          </span>
        </label>
      </div>
      <div className="mt-3">
        <button
          type="button"
          onClick={downloadDump}
          className="border border-zinc-700 bg-black px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
        >
          [ DOWNLOAD_SQL_DUMP ]
        </button>
      </div>
    </section>
  );
}
