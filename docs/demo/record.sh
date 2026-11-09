#!/bin/sh
# Records the demo take: the real ethglobal.com/showcase with the unpacked extension loaded,
# driven by agent-browser at 1920x1080. Nothing is mocked; the data is live.
# Usage: sh docs/demo/record.sh <output.mp4>
set -eu
OUT=${1:?usage: record.sh <output.mp4>}
EXT=$(cd "$(dirname "$0")/../.." && pwd)
export AGENT_BROWSER_SESSION=ethglobalists-demo
ab() { agent-browser "$@" >/dev/null; }
smooth() { ab eval "window.scrollBy({ top: $1, behavior: 'smooth' })"; }

agent-browser close >/dev/null 2>&1 || true
ab --extension "$EXT" set viewport 1920 1080
ab open "https://ethglobal.com/showcase"
ab wait 2500
# Start from the showcase as ETHGlobal ships it.
ab eval "document.querySelector('#ethgl-bar [data-mode=off]').click()"
ab open "https://ethglobal.com/showcase"
ab wait 4000

ab record start "$OUT" --cursor
ab wait 2500                                  # the showcase, untouched
smooth 1000; ab wait 2600                      # a page of projects, most without a prize
smooth 1000; ab wait 2200
smooth -2000; ab wait 1600
ab click "#ethgl-bar [data-mode=any]"; ab wait 3800   # Winners: the feed replaces the page
smooth 560; ab wait 4800                       # prizes and sponsor logos on each card
smooth -560; ab wait 1000
ab click ".max-w-2xl button"; ab wait 1400     # ETHGlobal's own filters
ab click "div:has(> div > div > input#react-select-2-input)"; ab wait 1300
ab click "#react-select-2-option-1"; ab wait 3800    # ETHGlobal Tokyo 2026
smooth 640; ab wait 3200
smooth 1100; ab wait 3400                      # scrolling near the end loads the rest
smooth -1740; ab wait 3200                     # 29 winners out of 254 projects
ab click "#ethgl-bar [data-mode=finalist]"; ab wait 3200
smooth 640; ab wait 4200
ab record stop
agent-browser close >/dev/null 2>&1 || true
echo "$OUT"
