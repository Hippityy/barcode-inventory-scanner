import { defineConfig } from 'vite';
import path from 'path';
import { execSync } from 'child_process';

let gitHash = '';
try {
  gitHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
} catch {
  // not a git repo (e.g. CI deploy) — use build timestamp as fallback
  gitHash = `unknown-${Date.now()}`;
}

const shortHash = gitHash.slice(0, 7);

export default defineConfig({
  base: '/barcode-inventory-scanner/',
  define: {
    __GIT_HASH__: JSON.stringify(gitHash),
    __GIT_SHORT_HASH__: JSON.stringify(shortHash),
    __GIT_COMMIT_URL__: JSON.stringify(
      `https://github.com/Hippityy/barcode-inventory-scanner/commit/${gitHash}`
    ),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
