import { useEffect } from "react";
import { AppShell } from "./components/layout/AppShell";
import { useAppStore } from "./store/useAppStore";

export default function App() {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  return <AppShell />;
}
