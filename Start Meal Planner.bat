@echo off
cd /d "%~dp0"
echo Starting Meal Planner...
start "" http://localhost:3000
node server.js
pause
