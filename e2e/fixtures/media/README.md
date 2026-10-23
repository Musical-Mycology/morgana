# Media fixtures

Tiny committed test media (each under 100 KB), generated with ffmpeg from the repo root.
`testsrc2` already varies from frame to frame, and `drawtext` burns the frame number into the
H.264 and VP9 clips so tests can tell frames apart.

```bash
ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=2" -vf "drawtext=text='%{frame_num}':x=10:y=10:fontsize=40:fontcolor=white:box=1:boxcolor=black" -c:v libx264 -pix_fmt yuv420p -g 30 -an e2e/fixtures/media/clip-h264.mp4
ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=2" -vf "drawtext=text='%{frame_num}':x=10:y=10:fontsize=40:fontcolor=white:box=1:boxcolor=black" -c:v libvpx-vp9 -b:v 200k -g 30 -an e2e/fixtures/media/clip-vp9.webm
ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=30:duration=1" -c:v libx265 -tag:v hvc1 -an e2e/fixtures/media/clip-hevc.mp4
ffmpeg -y -f lavfi -i "testsrc2=size=320x180:rate=1:duration=1" -frames:v 1 e2e/fixtures/media/still.png
```

| File | Purpose |
|---|---|
| `clip-h264.mp4` | 2 s H.264 clip: accepted (`avc1`) |
| `clip-vp9.webm` | 2 s VP9 clip: accepted (`V_VP9`) |
| `clip-hevc.mp4` | 1 s HEVC clip: rejected with the ffmpeg-conversion hint (`hvc1`) |
| `still.png` | single-frame PNG: accepted image |
