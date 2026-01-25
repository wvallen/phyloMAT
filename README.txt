phyloMAT v1

Files:
- index.html
- styles.css
- engine.js
- atlas.xml

Run:
Serve this folder with a local web server.
Example:
python3 -m http.server 8000

Open:
http://localhost:8000

Use:
- Drag to pan
- Wheel to zoom
- Click to select
- Shift-click to pin
- Export PNG produces a snapshot of the canvas
- Export state.xml captures camera and pinned nodes
- Generate LLM prompt exports prompt.txt including a local atlas excerpt

Extend:
Paste new patches into atlas.xml under <patches>.
Coordinates are editorial and can be adjusted by hand.