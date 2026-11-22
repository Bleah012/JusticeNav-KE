import { Fragment, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import "./HomeTypewriter.css";

export function HomeTypewriter({
  text,
  startAfter,
  interval,
  whenVisible = false,
}: {
  text: string;
  startAfter: number;
  interval: number;
  whenVisible?: boolean;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [started, setStarted] = useState(
    () => !whenVisible || typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (!whenVisible || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setStarted(true);
        observer.disconnect();
      }
    }, { threshold: 0.1 });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, [whenVisible]);

  let position = 0;
  const words = text.split(" ");

  return (
    <span
      ref={element}
      className="home-typewriter"
      data-started={started}
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
