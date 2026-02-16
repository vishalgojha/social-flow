import React, { createContext, useContext } from "react";

export interface AppTheme {
  accent: "cyan" | "blue";
  success: "green";
  warning: "yellow";
  error: "red";
  text: "white";
  muted: "gray";
}

const DEFAULT_THEME: AppTheme = {
  accent: "cyan",
  success: "green",
  warning: "yellow",
  error: "red",
  text: "white",
  muted: "gray"
};

const ThemeContext = createContext<AppTheme>(DEFAULT_THEME);

export function ThemeProvider(props: { theme?: Partial<AppTheme>; children: React.ReactNode }): JSX.Element {
  const value: AppTheme = { ...DEFAULT_THEME, ...(props.theme || {}) };
  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

export function useTheme(): AppTheme {
  return useContext(ThemeContext);
}

