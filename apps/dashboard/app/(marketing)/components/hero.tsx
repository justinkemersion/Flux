import { GetStartedButton } from "./get-started-button";

export function Hero() {
  return (
    <section aria-labelledby="flux-hero-heading" className="flex flex-col items-center text-center">
      <h1
        id="flux-hero-heading"
        className="max-w-xl text-4xl font-medium leading-tight tracking-tight text-white sm:text-5xl"
        style={{ fontFamily: "var(--font-landing-serif), Georgia, serif" }}
      >
        PostgreSQL, ready to use.
      </h1>
      <p className="mt-8 max-w-md text-base leading-relaxed text-zinc-400">
        A clean API over your database.
        <br />
        No setup.
      </p>
      <div className="mt-10">
        <GetStartedButton />
      </div>
    </section>
  );
}
