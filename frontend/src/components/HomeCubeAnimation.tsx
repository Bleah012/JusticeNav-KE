import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import "./HomeCubeAnimation.css";

// Decorative Uiverse animation adapted to the homepage palette.
export function HomeCubeAnimation() {
  const element = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
    });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={element} className="home-cubes" data-paused={paused || !visible}>
      <div className="home-cubes__stage" aria-hidden="true">
        {/* From Uiverse.io by Admin12121 */}
        <div className="home-cubes__loader">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className={`box box${index}`}>
              <div />
            </div>
          ))}
          <div className="ground">
            <div />
          </div>
        </div>
      </div>
      <button
        className="home-cubes__control"
        type="button"
        aria-pressed={paused}
        aria-label={paused ? "Play animation" : "Pause animation"}
        onClick={() => setPaused((current) => !current)}
      >
        {paused ? (
          <Play size={14} aria-hidden="true" />
        ) : (
          <Pause size={14} aria-hidden="true" />
        )}
        <span>{paused ? "Play animation" : "Pause animation"}</span>
      </button>
    </div>
  );
}
