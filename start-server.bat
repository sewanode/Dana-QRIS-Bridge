@echo off
title DANA-QRIS-BRIDGE SERVER (Port 2020 Pair & Port 8080 HTTP)
cd /d "%~dp0server"
echo ==================================================================
echo  Starting DANA-QRIS-BRIDGE Server...
echo  Dashboard : http://localhost:8080 (Default Password: 123456)
echo  Pair Port : 2020
echo ==================================================================
node src/index.js
pause
