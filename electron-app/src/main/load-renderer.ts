import { BrowserWindow } from 'electron'
import { join } from 'node:path'

export function loadRendererWindow(
  win: BrowserWindow,
  productionHtml: string,
  devUrlPath = '/'
): void {
  const devBase = process.env.ELECTRON_RENDERER_URL
  if (devBase) {
    const url = new URL(devUrlPath, devBase.endsWith('/') ? devBase : `${devBase}/`)
    void win.loadURL(url.toString())
    return
  }
  void win.loadFile(join(__dirname, productionHtml))
}
