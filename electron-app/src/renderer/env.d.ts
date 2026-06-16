import type { EncountersApi, MeterApi, OverlaySettings, ProjectionInfo } from '../preload/index'

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
      toggleCompact: () => Promise<OverlaySettings>
      setCompact: (compact: boolean) => Promise<OverlaySettings>
      setOpacity: (opacity: number) => Promise<OverlaySettings>
      closeWindow: () => Promise<{ ok: boolean }>
      projectEncounter: (id: number) => Promise<{ ok: boolean; projection?: ProjectionInfo }>
      clearProjection: () => Promise<{ ok: boolean }>
      getProjection: () => Promise<ProjectionInfo | null>
      resizeToHeight: (height: number) => Promise<{ ok: boolean }>
      setPointerPassthrough: (passThrough: boolean) => void
      setInteractiveRects: (
        rects: Array<{ x: number; y: number; width: number; height: number }>
      ) => void
      onSettingsChanged: (callback: (settings: OverlaySettings) => void) => () => void
    }
    writerApi: {
      lastError: () => Promise<string | null>
    }
  }
}

export {}
