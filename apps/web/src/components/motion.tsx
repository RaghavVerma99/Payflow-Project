import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/utils";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return reduced;
}

export function useAnimatedNumber(target: number, duration = 900): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  const previous = useRef(0);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      previous.current = target;
      return;
    }

    const from = previous.current;
    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + (target - from) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        previous.current = target;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, reduced]);

  return value;
}

export function useSpringNumber(
  target: number,
  stiffness = 120,
  damping = 18,
): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  const velocity = useRef(0);
  const previous = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    if (reduced) {
      setValue(target);
      previous.current = target;
      velocity.current = 0;
      return;
    }

    const from = previous.current;
    const start = performance.now();
    let resolved = false;

    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      // Critically damped spring approximation
      const progress = Math.min(1, elapsed * 2.2);
      const spring =
        1 -
        Math.exp(-damping * elapsed) *
          (Math.cos(stiffness * elapsed) +
            (damping / stiffness) * Math.sin(stiffness * elapsed));
      const next = from + (target - from) * spring;
      setValue(next);
      previous.current = next;

      if (progress < 1 && !reduced) {
        frame.current = requestAnimationFrame(tick);
      } else if (!resolved) {
        resolved = true;
        setValue(target);
        previous.current = target;
      }
    };

    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, stiffness, damping, reduced]);

  return value;
}

export function Stagger({
  children,
  delay = 60,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {items.map((child, index) => (
        <div
          key={index}
          className="reveal"
          style={{ transitionDelay: `${index * delay}ms` }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn("reveal", visible && "is-visible", className)}
    >
      {children}
    </div>
  );
}

export function LiveClock({ className }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const time = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  return (
    <span
      className={cn(
        "tabular font-mono text-[10px] tracking-[0.12em]",
        className,
      )}
    >
      {time} IST
    </span>
  );
}
