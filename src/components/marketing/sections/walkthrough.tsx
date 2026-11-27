import { Section, SectionHeader } from "@/components/marketing/section";
import { WALKTHROUGH } from "@/content/landing";

/**
 * The narrated product walkthrough, on the same tinted stage as the other
 * product visuals. It never autoplays and loads nothing until played.
 */
export function Walkthrough() {
  return (
    <Section id={WALKTHROUGH.id} labelledBy="walkthrough-heading">
      <SectionHeader
        id="walkthrough-heading"
        label={WALKTHROUGH.label}
        title={WALKTHROUGH.title}
        accent={WALKTHROUGH.accent}
        description={WALKTHROUGH.description}
      />

      <div className="mx-auto mt-[clamp(2.5rem,5vw,3.5rem)] w-full max-w-[64rem]">
        <div className="border-primary/15 bg-primary-subtle reveal rounded-[28px] border p-2 sm:p-4 lg:p-5">
          <div className="border-border bg-surface overflow-hidden rounded-2xl border shadow-lg">
            <video
              className="block aspect-video w-full bg-black"
              controls
              playsInline
              preload="none"
              poster={WALKTHROUGH.poster}
              aria-label={WALKTHROUGH.videoLabel}
            >
              <source src={WALKTHROUGH.video} type="video/mp4" />
              {WALKTHROUGH.fallback}{" "}
              <a href={WALKTHROUGH.video} className="text-primary underline">
                {WALKTHROUGH.download}
              </a>
            </video>
          </div>
        </div>
      </div>
    </Section>
  );
}
