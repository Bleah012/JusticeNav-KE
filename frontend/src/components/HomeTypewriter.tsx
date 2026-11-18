import { Fragment } from "react";
import type { CSSProperties } from "react";
import "./HomeTypewriter.css";

export function HomeTypewriter({
  text,
  startAfter,
  interval,
}: {
  text: string;
  startAfter: number;
  interval: number;
}) {
  let position = 0;
  const words = text.split(" ");

  return (
    <span
      className="home-typewriter"
      style={{ "--letter-interval": `${interval}ms` } as CSSProperties}
    >
      <span className="home-typewriter__accessible">{text}</span>
      <span aria-hidden="true">
        {words.map((word, wordIndex) => (
          <Fragment key={wordIndex}>
            <span className="home-typewriter__word">
              {Array.from(word).map((letter, letterIndex) => {
                const delay = startAfter + position * interval;
                position += 1;
                return (
                  <span
                    key={letterIndex}
                    className="home-typewriter__letter"
                    style={{ "--letter-delay": `${delay}ms` } as CSSProperties}
                  >
                    {letter}
                  </span>
                );
              })}
            </span>
            {wordIndex < words.length - 1 && " "}
          </Fragment>
        ))}
      </span>
    </span>
  );
}
