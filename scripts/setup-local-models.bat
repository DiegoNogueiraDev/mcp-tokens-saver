@echo off
REM MCP Token Saver - Local Model Setup Script for Windows
REM Downloads and sets up Phi-3-mini and Gemma-2 models for local inference

setlocal enabledelayedexpansion

set MODELS_DIR=%USERPROFILE%\.mcp-tokens-saver\models
set PHI3_URL=https://huggingface.co/bartowski/Phi-3-mini-4k-instruct-v0.3-GGUF/resolve/main/phi-3-mini-4k-instruct.Q4_K_M.gguf
set GEMMA2_URL=https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it.Q4_K_M.gguf

set PHI3_FILENAME=phi-3-mini-4k-instruct.Q4_K_M.gguf
set GEMMA2_FILENAME=gemma-2-2b-it.Q4_K_M.gguf

echo === MCP Token Saver - Local Model Setup ===

REM Check if llama-server.exe is available
where llama-server >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: llama-server.exe not found in PATH
    echo Please install llama.cpp first:
    echo   - Download from: https://github.com/ggerganov/llama.cpp/releases
    echo   - Extract and add to PATH
    pause
    exit /b 1
)

REM Check if curl or powershell is available
where curl >nul 2>nul
set HAS_CURL=%errorlevel%
powershell -Command "Get-Command Invoke-WebRequest" >nul 2>nul
set HAS_POWERSHELL=%errorlevel%

if %HAS_CURL% neq 0 if %HAS_POWERSHELL% neq 0 (
    echo Error: curl or PowerShell is required
    pause
    exit /b 1
)

REM Create models directory
echo Creating models directory...
if not exist "%MODELS_DIR%" mkdir "%MODELS_DIR%"

REM Function to download model
:download_model
set url=%~1
set filename=%~2
set filepath=%MODELS_DIR%\%filename%

if exist "%filepath%" (
    echo ✓ %filename% already exists
    goto :eof
)

echo Downloading %filename%...

if %HAS_CURL% equ 0 (
    curl -L -o "%filepath%" "%url%"
) else (
    powershell -Command "Invoke-WebRequest -Uri '%url%' -OutFile '%filepath%'"
)

if exist "%filepath%" (
    echo ✓ %filename% downloaded successfully
    
    REM Verify file size
    for %%F in ("%filepath%") do set size=%%~zF
    if !size! lss 1000000 (
        echo Error: Downloaded file seems too small (!size! bytes)
        del "%filepath%"
        exit /b 1
    )
) else (
    echo Error: Failed to download %filename%
    exit /b 1
)
goto :eof

REM Download models
echo Downloading models...
call :download_model "%PHI3_URL%" "%PHI3_FILENAME%"
call :download_model "%GEMMA2_URL%" "%GEMMA2_FILENAME%"

REM Check available RAM
echo Checking system resources...
for /f "tokens=2 delims=:" %%a in ('systeminfo ^| findstr "Total Physical Memory"') do (
    set RAM_STR=%%a
    set RAM_STR=!RAM_STR: =!
    set RAM_STR=!RAM_STR:,=!
    set /a TOTAL_RAM=!RAM_STR:~0,-2!/1024
)

echo System RAM: %TOTAL_RAM%MB

REM Recommend models based on RAM
echo Model recommendations:
if %TOTAL_RAM% geq 6000 (
    echo ✓ Phi-3-mini-4k-instruct (5.8GB RAM) - RECOMMENDED
    echo ✓ Gemma-2-2B-IT (4GB RAM) - ALSO SUPPORTED
) else if %TOTAL_RAM% geq 4000 (
    echo ! Phi-3-mini-4k-instruct may be tight on RAM
    echo ✓ Gemma-2-2B-IT (4GB RAM) - RECOMMENDED
) else (
    echo ✗ Insufficient RAM for local models (need at least 4GB)
    pause
    exit /b 1
)

REM Create launch scripts
echo Creating launch scripts...

echo @echo off > "%MODELS_DIR%\start-phi3.bat"
echo echo Starting Phi-3-mini model server... >> "%MODELS_DIR%\start-phi3.bat"
echo llama-server.exe -m "%MODELS_DIR%\%PHI3_FILENAME%" -c 4096 -ngl 99 --port 8080 >> "%MODELS_DIR%\start-phi3.bat"

echo @echo off > "%MODELS_DIR%\start-gemma2.bat"
echo echo Starting Gemma-2-2B model server... >> "%MODELS_DIR%\start-gemma2.bat"
echo llama-server.exe -m "%MODELS_DIR%\%GEMMA2_FILENAME%" -c 4096 -ngl 99 --port 8081 >> "%MODELS_DIR%\start-gemma2.bat"

echo ✓ Created launch scripts

REM Test model files
echo Verifying model files...
for %%F in ("%MODELS_DIR%\%PHI3_FILENAME%" "%MODELS_DIR%\%GEMMA2_FILENAME%") do (
    if exist "%%F" (
        for %%A in ("%%F") do (
            set size=%%~zA
            set size_mb=!size:~0,-6!
            echo ✓ %%~nxF: !size_mb!MB
        )
    )
)

REM Create PowerShell scripts for better Windows integration
echo Creating PowerShell scripts...

echo # PowerShell script to start Phi-3-mini > "%MODELS_DIR%\start-phi3.ps1"
echo Write-Host "Starting Phi-3-mini model server..." >> "%MODELS_DIR%\start-phi3.ps1"
echo Start-Process "llama-server.exe" -ArgumentList "-m `"$env:USERPROFILE\.mcp-tokens-saver\models\%PHI3_FILENAME%`" -c 4096 -ngl 99 --port 8080" -NoNewWindow >> "%MODELS_DIR%\start-phi3.ps1"

echo # PowerShell script to start Gemma-2-2B >> "%MODELS_DIR%\start-gemma2.ps1"
echo Write-Host "Starting Gemma-2-2B model server..." >> "%MODELS_DIR%\start-gemma2.ps1"
echo Start-Process "llama-server.exe" -ArgumentList "-m `"$env:USERPROFILE\.mcp-tokens-saver\models\%GEMMA2_FILENAME%`" -c 4096 -ngl 99 --port 8081" -NoNewWindow >> "%MODELS_DIR%\start-gemma2.ps1"

echo.
echo === Setup Complete ===
echo Models directory: %MODELS_DIR%
echo Available models:
echo   - Phi-3-mini-4k-instruct: %MODELS_DIR%\%PHI3_FILENAME%
echo   - Gemma-2-2B-IT: %MODELS_DIR%\%GEMMA2_FILENAME%
echo.
echo To start models:
echo   %MODELS_DIR%\start-phi3.bat
echo   %MODELS_DIR%\start-gemma2.bat
echo   or run the PowerShell scripts
echo.
echo API endpoints:
echo   Phi-3-mini: http://localhost:8080/v1
echo   Gemma-2-2B: http://localhost:8081/v1
echo.
pause