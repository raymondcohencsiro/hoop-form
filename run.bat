@echo off
title Python HTTP Server

:: Open the browser after a short delay so the server has time to start
start "" http://localhost:8010

:: Start the Python HTTP server on port 8000
python -m http.server 8010

pause