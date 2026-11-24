// Always-on-top pill shown on the PC whenever a phone is sending mouse/keyboard input.
const style = document.createElement('style');
style.textContent = `
  html, body { margin: 0; background: transparent; font-family: 'Segoe UI', system-ui, sans-serif; overflow: hidden; }
  #pill { margin: 6px; height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 16px; border-radius: 999px;
    background: rgba(14, 14, 21, .92); border: 1px solid #7C4DFF; color: #F4F2FF; font-size: 13px; font-weight: 600;
    box-shadow: 0 6px 24px rgba(124, 77, 255, .45); }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #FF5470; animation: pulse 1s infinite alternate; }
  @keyframes pulse { from { opacity: .4; transform: scale(.85); } to { opacity: 1; transform: scale(1.1); } }
`;
document.head.appendChild(style);
const q = new URLSearchParams(location.search);
const device = (q.get('device') ?? '').slice(0, 40);
const he = q.get('lang') === 'he';
if (he) document.documentElement.dir = 'rtl';
const label = document.getElementById('label')!;
label.textContent = `${he ? 'שליטה מרחוק פעילה' : 'Remote input active'}${device ? ` · ${device}` : ''}`;
