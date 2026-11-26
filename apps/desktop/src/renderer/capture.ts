// Hidden capture page: keeps a live video stream of one display and encodes
// the most recent frame to JPEG when the main process asks for it.
const video = document.createElement('video');
video.muted = true;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { alpha: false })!;
let stream: MediaStream | null = null;

declare global {
  interface Window {
    __fristyStart(sourceId: string, maxWidth: number, maxHeight: number): Promise<boolean>;
    __fristyGrab(maxWidth: number, quality: number): Promise<{ w: number; h: number; data: string } | null>;
  }
}

window.__fristyStart = async (sourceId, maxWidth, maxHeight) => {
  stream?.getTracks().forEach((t) => t.stop());
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // Electron's desktop capture constraints
        mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId, maxWidth, maxHeight, maxFrameRate: 30 }
      } as unknown as MediaTrackConstraints
    });
    video.srcObject = stream;
    await video.play();
    // wait for the first decoded frame
    for (let i = 0; i < 50 && video.videoWidth === 0; i++) await new Promise((r) => setTimeout(r, 50));
    return video.videoWidth > 0;
  } catch {
    return false;
  }
};

window.__fristyGrab = async (maxWidth, quality) => {
  if (!stream || video.videoWidth === 0) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, w, h);
  const url = canvas.toDataURL('image/jpeg', quality);
  return { w, h, data: url.slice(url.indexOf(',') + 1) };
};
export {};
