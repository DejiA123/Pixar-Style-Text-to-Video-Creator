#!/bin/sh
# Face portrait sheet: sh dev/faces.sh out.png
CAST='[{"name":"A","kind":"human","age":"teen","gender":"f","seed":5,"hair":{"style":"wavy","color":8014378},"skin":15516842},{"name":"B","kind":"human","age":"child","gender":"m","seed":8,"hair":{"style":"curly","color":2759191},"skin":7095345},{"name":"C","kind":"human","age":"teen","gender":"m","seed":11,"accessories":["glasses"],"hair":{"style":"swept","color":4861727},"skin":15516842}]'
GRID='[{"yaw":0.12,"emotion":"happy","dist":0.62,"focus":0,"solo":1},{"yaw":0.12,"emotion":"happy","dist":0.6,"focus":1,"solo":1},{"yaw":0.12,"emotion":"happy","dist":0.62,"focus":2,"solo":1}]'
node dev/shot.mjs "$(python3 dev/q.py "$CAST" "$GRID" 'q=medium&ap=0&bloom=0.15&w=1500&h=640&cols=3&look=1')" "$1" 1500 640
