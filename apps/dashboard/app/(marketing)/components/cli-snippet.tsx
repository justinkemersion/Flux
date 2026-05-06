const lines = [
  "$ curl -sL https://flux.vsl-base.com/install | bash",
  "$ flux create my-app",
] as const;

export function CliSnippet() {
  return (
    <section aria-labelledby="cli-heading">
      <h2 id="cli-heading" className="sr-only">
        Get started from the terminal
      </h2>
      <p className="text-base text-zinc-400">Get started from your terminal.</p>
      <pre
        className="mx-auto mt-5 max-w-lg rounded-md border border-zinc-800/80 bg-zinc-900/50 px-4 py-3 text-left text-sm leading-relaxed text-zinc-300"
        style={{ fontFamily: "var(--font-landing-mono), ui-monospace, monospace" }}
      >
        <code>
          {lines.map((line) => (
            <span key={line} className="block whitespace-pre-wrap">
              {line}
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}
