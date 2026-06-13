import type { EncountersApi, MeterApi, OverlaySettings } from '../preload/index'

declare global {
  interface Window {
    meterApi: MeterApi
    encountersApi: EncountersApi
    overlayApi: {
      getSettings: () => Promise<OverlaySettings>
      getClickThrough: () => Promise<boolean>
      getLocked: () => Promise<boolean>
      toggleClickThrough: () => Promise<OverlaySettings>
      setClickThrough: (enabled: boolean) => Promise<OverlaySettings>
      toggleLocked: () => Promise<OverlaySettings>
      setLocked: (locked: boolean) => Promise<OverlaySettings>
      setOpacity: (opacity: number) => Promise<OverlaySettings>
      closeWindow: () => Promise<{ ok: boolean }>
      resizeToHeight: (height: number) => Promise<{ ok: boolean }>
      setPointerPassthrough: (passThrough: boolean) => void
      onSettingsChanged: (callback: (settings: OverlaySettings) => void) => () => void
    }
    writerApi: {
      lastError: () => Promise<string | null>
    }
  }
}

export {}
