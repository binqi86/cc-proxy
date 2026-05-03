import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import TrayPopup from './components/TrayPopup';
import ErrorBoundary from './components/ErrorBoundary';
import { getStoredTheme, applyTheme } from './lib/theme';
import './index.css';

applyTheme(getStoredTheme());

const root = document.getElementById('root') as HTMLElement;
const isPopup = window.location.search.includes('window=popup');

if (isPopup) {
  // Transparent window - only the card content will be visible
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.body.style.overflow = 'hidden';
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <TrayPopup />
      </ErrorBoundary>
    </React.StrictMode>,
  );
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
