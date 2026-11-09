Unicode true
RequestExecutionLevel user
!include "MUI2.nsh"
!include "FileFunc.nsh"
!define MUI_ICON "${APP_ICON}"

Name "通用鉴伪系统 完整版 ${VERSION}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\通用鉴伪系统\离线安装资源\${VERSION}"
ShowInstDetails show
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "通用鉴伪系统 完整版"
!define MUI_WELCOMEPAGE_TEXT "本安装器会准备全部模型资源，然后启动应用安装向导。缺少的数据文件会从本项目 GitHub Release 自动获取。$\r$\n$\r$\n如已下载所有 .bin 数据分卷，请将它们与安装器放在同一文件夹，即可离线安装。无需手动解压或单独配置 Python、模型权重与解释服务。"
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择保存离线安装资源的空目录。应用与运行数据可另外选择位置。建议目标磁盘有至少 50 GB 可用空间。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "准备完整安装资源"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=prepare-full.ps1 "${HELPER}"
  File /oname=distribution.json "${MANIFEST}"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/EXTRACTONLY" $R1
  ${If} ${Errors}
    StrCpy $R1 ""
  ${Else}
    StrCpy $R1 "-ExtractOnly"
  ${EndIf}
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\prepare-full.ps1" -SourceDirectory "$EXEDIR" -Destination "$INSTDIR" -ManifestPath "$PLUGINSDIR\distribution.json" $R1'
  Pop $R0
  ${If} $R0 != "0"
    SetErrorLevel 1
    MessageBox MB_OK|MB_ICONSTOP "安装准备未完成，请查看详细信息。联网下载中断时，可重新运行安装器并选择同一目录继续；离线安装请将全部数据分卷与安装器放在同一文件夹。" /SD IDOK
    Abort
  ${EndIf}
SectionEnd
