Dolby.io OptiView MultiOpus Audio Viewer (Debug + Visualizer)

Lightweight audio-only viewer for Dolby.io / Millicast streams with MultiOpus (5.1 / 7.1) support.
Includes per-track audio playback, real-time visualizers, and deep WebRTC debug logging.

Features
🎧 MultiOpus audio playback (5.1 / 7.1)
📊 Real-time audio visualizer per track
🔍 WebRTC debug logging (tracks, SDP, stats)
📡 Direct Millicast Viewer connection (no custom signaling needed)
🧪 Designed for validation using chrome://webrtc-internals
Prerequisites
Account & Stream Setup
A valid Dolby.io (Millicast) Account ID
A valid Stream Name

Combined format:

streamAccountId/streamName
Browser Requirements
Chromium-based browser (Chrome recommended)
Version 89+
WebRTC enabled (default)
Required Permissions
Audio playback (no mic required)
Autoplay must be allowed (user interaction required)
Usage
1. Open the Viewer
viewer.html?streamId=YOUR_ACCOUNT/YOUR_STREAM

Example:

viewer.html?streamId=LZsuF8/metadata
2. Click Start
Connects to Dolby.io via the Millicast SDK
Subscribes to the stream
Automatically renders audio tracks
3. What You Will See
Audio Outputs Panel
One <audio> player per incoming track
Each includes:
Track ID
Ready state
Mute status
Visualizer
Real-time frequency bars
Driven by WebAudio AnalyserNode
Independent per track
4. Debug Panel

Includes:

Track events
Connection state changes
SDP snippet (first ~1800 chars)
Receiver stats (codec, channels, payload, etc.)
Verification (Critical for MultiOpus)

Open:

chrome://webrtc-internals

Look for:

Expected (SUCCESS)
codec: audio/multiopus
channels: 6 (or 8)
If you see:
codec: opus
stereo=1

➡️ Browser is downmixing → MultiOpus not active

Architecture
Millicast Stream
      ↓
millicast.View()
      ↓
WebRTC Track Event
      ↓
MediaStream → <audio>
      ↓
WebAudio → AnalyserNode → Canvas Visualizer
Known Limitations
Browser Playback
Chrome may:
Decode MultiOpus
But still downmix to stereo
Visualizer reflects signal energy, not channel separation
Channel Routing
This viewer does NOT:
Split channels
Route to speakers

➡️ Next step is WebAudio channel splitting (can be added)

Troubleshooting
❌ No audio
Click Start (required for autoplay)
Check console for track events
Verify stream is live
❌ No MultiOpus detected
Confirm publisher SDP munging

Verify:

a=rtpmap:111 multiopus/48000/6
❌ Visualizer not moving
Check:
Audio is playing
No browser audio restrictions
Some browsers throttle AudioContext until interaction
❌ JS not loading (404)

Ensure:

viewer.html
viewer.js

Are in the same directory

Notes
This viewer is intentionally minimal + debug-focused
Designed to validate:
MultiOpus ingestion
Channel count
Codec negotiation
Next Enhancements (Optional)
🔊 Channel splitter (true surround output)
🎛 Per-channel meters (DAW-style)
🎚 Output routing (L/R/C/LFE mapping)
🧠 Spatial audio rendering

If you want next step:

👉 I can turn this into a full surround monitoring console (DAW-style) with:

6–8 vertical meters
per-channel routing
real speaker mapping (not just visualization)

That’s where it gets really powerful.
