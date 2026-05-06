import { GetStartedButton } from "./get-started-button";

export function FinalCTA() {
  return (
    <section aria-labelledby="cta-lead" className="flex flex-col items-center text-center">
      <p
        id="cta-lead"
        className="max-w-md text-lg font-medium leading-snug text-zinc-100 sm:text-xl"
      >
        Start building on PostgreSQL
      </p>
      <div className="mt-10">
        <GetStartedButton />
      </div>
    </section>
  );
}
