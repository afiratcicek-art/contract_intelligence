import { useTheme } from "../context/ThemeContext";

export function useDarkMode(): boolean {
  return useTheme().dark;
}
