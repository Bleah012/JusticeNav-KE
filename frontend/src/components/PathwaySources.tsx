import type { SourceReview } from "../pathways/pathwayApi";
export function PathwaySources({ review }: { review: SourceReview }) {
  return (
    <section className="catalog-source-note" aria-label="Official sources">
      <p>
        Source checked:{" "}
        <time dateTime={review.checkedOn}>{review.checkedOn}</time>. This is the
        project's review date; confirm current requirements with the publisher.
      </p>
      <ul>
        {review.sources.map((source) => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.name}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
