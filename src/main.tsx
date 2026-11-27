import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import './index.css';
import {initProductionServiceWorkerAndUpdates} from './services/appUpdateChecker';

initProductionServiceWorkerAndUpdates((serverBuildId) => {
  window.dispatchEvent(
    new CustomEvent('lgplast-app-update-available', { detail: serverBuildId })
  );
});

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
