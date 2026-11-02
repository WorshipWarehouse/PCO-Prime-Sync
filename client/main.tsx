import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');
const root: HTMLElement = container;

/**
 * A blank page with the right title is the worst failure mode: nothing to read,
 * nothing to report. If the dashboard cannot boot, say why in the page itself.
 */
function showFailure(detail: string): void {
  const box = document.createElement('div');
  box.style.cssText =
    'font:14px/1.5 system-ui,sans-serif;margin:48px auto;max-width:640px;padding:24px;border:1px solid #b42318;border-radius:8px;color:#111';
  const heading = document.createElement('h1');
  heading.textContent = 'PCO Prime Sync could not start';
  heading.style.cssText = 'font-size:18px;margin:0 0 8px';
  const hint = document.createElement('p');
  hint.style.cssText = 'margin:0 0 12px';
  hint.textContent =
    'This usually means the dashboard build is stale: run `npm run build` (or restart `npm run dev`) and reload. The browser console has the full stack.';
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;font-size:12px;color:#b42318;margin:0';
  pre.textContent = detail;
  box.append(heading, hint, pre);
  root.replaceChildren(box);
}

window.addEventListener('error', (event) => {
  if (root.childElementCount === 0) showFailure(event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { message?: string } | undefined;
  if (root.childElementCount === 0) showFailure(String(reason?.message ?? event.reason));
});

try {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (error) {
  showFailure(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
}
