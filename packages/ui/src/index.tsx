import type { ThemeProviderProps } from "next-themes"
import { NuqsAdapter } from "nuqs/adapters/next/app"
import { throttle } from "nuqs/server"
import { Toaster } from "./components/ui/sonner"
import { TooltipProvider } from "./components/ui/tooltip"
import { DEFAULT_TOAST_DURATION_MS } from "./config/toast"
import { ThemeProvider } from "./providers/theme"

type UiProviderProperties = ThemeProviderProps

export const UiProvider = ({
  children,
  ...properties
}: UiProviderProperties) => (
  <NuqsAdapter
    defaultOptions={{
      shallow: false,
      scroll: true,
      limitUrlUpdates: throttle(250),
    }}
  >
    <ThemeProvider {...properties}>
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster closeButton duration={DEFAULT_TOAST_DURATION_MS} richColors />
    </ThemeProvider>
  </NuqsAdapter>
)
