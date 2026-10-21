import { useEffect, useRef } from "react";

export function AmbientCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let last = 0;
    let time = 0;
    let dark = document.documentElement.classList.contains("dark");
    let colors = ["rgba(242,181,68,", "rgba(123,196,164,"];
    let observer: MutationObserver | null = null;

    const readTheme = () => {
      dark = document.documentElement.classList.contains("dark");
      colors = dark
        ? ["rgba(242,181,68,", "rgba(123,196,164,"]
        : ["rgba(178,58,31,", "rgba(15,118,110,"];
    };

    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (now: number) => {
      if (!last) last = now;
      if (now - last < 32) {
        frame = requestAnimationFrame(draw);
        return;
      }
      last = now;
      time += reduced ? 0 : 0.0035;

      context.clearRect(0, 0, width, height);

      const lines = width < 720 ? 9 : 16;
      const span = width + 240;

      for (let index = 0; index < lines; index += 1) {
        const color = colors[index % colors.length];
        const progress = index / Math.max(1, lines - 1);
        const baseY = height * (0.08 + progress * 0.86);
        const amplitude = 18 + ((index * 13) % 48);
        const frequency = 0.0016 + (index % 5) * 0.00042;
        const speed = 0.55 + (index % 4) * 0.22;

        context.beginPath();
        for (let x = -120; x <= span; x += 18) {
          const wave =
            Math.sin(x * frequency + time * speed + index * 0.9) * amplitude +
            Math.sin(x * frequency * 2.7 - time * speed * 0.6 + index) *
              (amplitude * 0.32);
          const drift = Math.sin(time * 0.22 + index * 0.5) * 22;
          const y = baseY + wave + drift;
          if (x === -120) context.moveTo(x, y);
          else context.lineTo(x, y);
        }

        const alpha = 0.045 + (1 - Math.abs(progress - 0.55) * 1.4) * 0.055;
        context.strokeStyle = `${color}${Math.max(0.02, alpha)})`;
        context.lineWidth = index % 5 === 0 ? 1.15 : 0.7;
        context.stroke();
      }

      if (!reduced) frame = requestAnimationFrame(draw);
    };

    const start = () => {
      cancelAnimationFrame(frame);
      last = 0;
      frame = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(frame);
      else start();
    };

    readTheme();
    resize();
    start();

    observer = new MutationObserver(() => {
      readTheme();
      if (reduced) {
        context.clearRect(0, 0, width, height);
        draw(performance.now());
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="absolute -left-40 top-[-18rem] size-[42rem] rounded-full bg-[radial-gradient(circle,var(--glow-a),transparent_68%)] blur-3xl animate-float" />
      <div
        className="absolute -right-52 top-1/3 size-[38rem] rounded-full bg-[radial-gradient(circle,var(--glow-b),transparent_68%)] blur-3xl animate-float"
        style={{ animationDelay: "-7s", animationDuration: "24s" }}
      />
      <div
        className="absolute bottom-[-20rem] left-1/3 size-[34rem] rounded-full bg-[radial-gradient(circle,var(--glow-a),transparent_70%)] blur-3xl animate-float"
        style={{ animationDelay: "-13s", animationDuration: "30s" }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 opacity-70" />
      <div className="absolute inset-0 bg-grid opacity-30 [mask-image:radial-gradient(ellipse_at_50%_20%,black,transparent_78%)]" />
    </div>
  );
}
