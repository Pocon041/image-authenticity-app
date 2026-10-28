import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerDesktopIPC } from './ipc'
import { RoutedAnalysisService } from './services/rita'
import { AnalysisSession } from './services/analysis-session'

let mainWindow: BrowserWindow | null = null
const session = new AnalysisSession(new RoutedAnalysisService())
const smokeMode = process.argv.includes('--smoke-test')

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: 'SRDP · 图像真实性分析',
    width: 1400,
    height: 920,
    minWidth: 1060,
    minHeight: 740,
    show: false,
    backgroundColor: '#10141b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !smokeMode
    }
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
  mainWindow.once('ready-to-show', () => {
    if (!smokeMode) mainWindow?.show()
  })
  mainWindow.on('closed', () => {
    session.dispose()
    mainWindow = null
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('cn.srdp.desktop')
  registerDesktopIPC(() => mainWindow, session)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
