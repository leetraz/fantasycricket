#!/bin/bash

# Simple script to launch the Cricinfo Tab Launcher with a match URL
# Usage: ./launch.sh "https://www.espncricinfo.com/..."

URL=$1
PORT=3000

# Start server in background if not running
if ! lsof -i:$PORT > /dev/null; then
    echo "Starting Cricinfo Fantasy Server..."
    nohup node index.js > server.log 2>&1 &
    sleep 2
fi

if [ -z "$URL" ]; then
    xdg-open "http://localhost:$PORT/launcher.html"
else
    xdg-open "http://localhost:$PORT/launcher.html?url=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$URL'''))")"
fi

echo "Launcher opened in your browser."
