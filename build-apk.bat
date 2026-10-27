@echo off
setlocal
set "TOOLS_DIR=%LOCALAPPDATA%\AndroidBuildTools"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"

for /d %%i in ("%TOOLS_DIR%\jdk-17*") do set "JAVA_HOME=%%i"
set "PATH=%JAVA_HOME%\bin;%TOOLS_DIR%\gradle-8.7\bin;%ANDROID_HOME%\platform-tools;%PATH%"

cd /d "%~dp0android-app"
echo Building Dana-QRIS-Bridge APK...
call gradle assembleDebug
if exist "app\build\outputs\apk\debug\app-debug.apk" (
    copy /Y "app\build\outputs\apk\debug\app-debug.apk" "%~dp0Dana-QRIS-Bridge.apk"
    echo ==================================================================
    echo  APK BERHASIL DIBUAT: %~dp0Dana-QRIS-Bridge.apk
    echo ==================================================================
)
pause
