import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem("payflow_theme");
    return stored === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("payflow_theme", theme);
  }, [theme]);

  return {
    theme,
    toggle: () =>
      setTheme((current) => (current === "dark" ? "light" : "dark")),
  };
}
