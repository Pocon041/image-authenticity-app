!macro customInstall
  ${If} ${FileExists} "$EXEDIR\runtime-bundle\manifest.json"
    FileOpen $R0 "$INSTDIR\resources\bootstrap-source.txt" w
    FileWriteUTF16LE $R0 "$EXEDIR\runtime-bundle"
    FileClose $R0
  ${EndIf}
!macroend
