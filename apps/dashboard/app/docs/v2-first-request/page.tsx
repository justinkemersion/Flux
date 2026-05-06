import { redirect } from "next/navigation";

function pick(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

export default async function V2FirstRequestRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const sp = new URLSearchParams();
  const slug = pick(p.slug);
  const hash = pick(p.hash);
  if (slug) sp.set("slug", slug);
  if (hash) sp.set("hash", hash);
  const qs = sp.toString();
  redirect(
    qs.length > 0
      ? `/docs/getting-started/first-request?${qs}`
      : "/docs/getting-started/first-request",
  );
}
