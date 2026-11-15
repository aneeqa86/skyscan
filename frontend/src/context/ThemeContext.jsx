import { createContext, useContext, useEffect } from 'react'

const ThemeContext = createContext(null)

/** SKYSCAN ships one dark theme; the provider keeps the boilerplate's API. */
export function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])
  return <ThemeContext.Provider value={{ theme: 'dark' }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}
