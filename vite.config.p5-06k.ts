import { defineConfig } from 'vite';
import base from './vite.config';

export default defineConfig({
  ...base,
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '^/api(?:/|[?]|$)': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        rewrite: (requestPath) => {
          const rest = requestPath.slice('/api'.length);
          return rest.startsWith('/') ? rest : `/${rest}`;
        },
      },
    },
  },
});
