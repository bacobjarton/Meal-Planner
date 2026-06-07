@echo off
cd /d "%~dp0"
echo Starting Meal Planner...

:: Start the Node server in a separate window
start "Meal Planner Server" cmd /c "node server.js"

:: Give the server a moment to start
timeout /t 2 /nobreak >nul

:: Start the public tunnel so your phone can reach it
echo Starting tunnel for mobile access...
start "Meal Planner Tunnel" cmd /c "npx localtunnel --port 3000 --subdomain mealplanner-jacob"

:: Open the browser locally
timeout /t 3 /nobreak >nul
start "" http://localhost:3000

echo.
echo Server:  http://localhost:3000
echo Mobile:  https://mealplanner-jacob.loca.lt
echo.
echo Close the two terminal windows to stop.
pause
