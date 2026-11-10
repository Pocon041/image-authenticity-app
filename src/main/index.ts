import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerDesktopIPC } from './ipc'
import { RoutedAnalysisService } from './services/rita'
import { AnalysisSession } from './services/analysis-session'
import { releaseConfiguredLocalModel } from './services/explanation'
import { initializeRuntimeEnvironment } from './runtime-environment'
import { stopManagedOllama } from './managed-ollama'
import { cancelRuntimeSetup } from './runtime-bootstrap'

let mainWindow: BrowserWindow | null = null
const session = new AnalysisSession(new RoutedAnalysisService(), releaseConfiguredLocalModel)
const smokeMode = process.argv.includes('--smoke-test')
const appModelId = app.isPackaged ? 'cn.srdp.desktop' : 'cn.srdp.desktop.source'

function createWindow(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'build/icon.ico')
  mainWindow = new BrowserWindow({
    title: '通用鉴伪系统',
    icon: iconPath,
    width: 1400,
    height: 920,
    minWidth: 1060,
    minHeight: 740,
    show: false,
    backgroundColor: '#f3f3f0',
    autoHideMenuBar: true,
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: { color: '#e6ece8', symbolColor: '#29322c', height: 42 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: !smokeMode
    }
  })
  if (process.platform === 'win32') {
    const relaunchCommand = app.isPackaged
      ? `"${process.execPath}"`
      : `"${process.env.ComSpec ?? 'cmd.exe'}" /d /c ""${join(app.getAppPath(), 'start.cmd')}""`
    mainWindow.setAppDetails({
      appId: appModelId,
      appIconPath: iconPath,
      appIconIndex: 0,
      relaunchCommand,
      relaunchDisplayName: '通用鉴伪系统'
    })
  }
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

const primaryInstance = smokeMode || app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
})

if (primaryInstance)
  app.whenReady().then(async () => {
    app.setAppUserModelId(appModelId)
    await initializeRuntimeEnvironment()
    registerDesktopIPC(() => mainWindow, session)
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
app.on('window-all-closed', () => {
  cancelRuntimeSetup()
  stopManagedOllama()
  if (process.platform !== 'darwin') app.quit()
})
