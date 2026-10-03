import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { execSync } from 'child_process'
import { resolve } from 'path'

const SOLUTION_DIR = resolve(__dirname, '..', 'solution')

/**
 * Vite plugin that adds server-side API routes for Docker control.
 * These routes let the dashboard UI stop/start Redis via docker compose.
 */
function dockerControlPlugin() {
  return {
    name: 'docker-control',
    configureServer(server) {
      // POST /harness/redis-stop  — stops the Redis container
      server.middlewares.use('/harness/redis-stop', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        try {
          execSync('docker compose stop redis', { cwd: SOLUTION_DIR, stdio: 'pipe' })
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, action: 'stopped' }))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })

      // POST /harness/redis-start — starts the Redis container
      server.middlewares.use('/harness/redis-start', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        try {
          execSync('docker compose start redis', { cwd: SOLUTION_DIR, stdio: 'pipe' })
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, action: 'started' }))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), dockerControlPlugin()],
  server: {
    port: 5173,
    // Proxy API requests to the rate limiter service (nginx LB)
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      },
      '/health': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
})
