import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Clean up any stale dev service workers on mobile phones so they always load the latest online UI
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then(async (regs) => {
      let cleanedDevSw = false;
      for (const reg of regs) {
        const scriptUrl = reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '';
        if (scriptUrl.includes('dev-sw.js')) {
          await reg.unregister();
          cleanedDevSw = true;
        } else {
          reg.update().catch(() => {});
        }
      }
      if (cleanedDevSw && 'caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        if (!sessionStorage.getItem('dt_sw_cleaned')) {
          sessionStorage.setItem('dt_sw_cleaned', '1');
          window.location.reload();
        }
      }
    })
    .catch(() => {});
}

createRoot(document.getElementById('root')!).render(<App />);
