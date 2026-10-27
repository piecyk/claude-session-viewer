import { timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Connect, Plugin } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

// VIEWER_USER and VIEWER_PASSWORD can live in .env (git-ignored). Variables
// already set in the shell win.
const envFile = resolve(import.meta.dirname, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

// Basic auth for remote access, for example through a tunnel. Off unless
// VIEWER_PASSWORD is set. VIEWER_USER is optional; without it, any user name works.
function basicAuth(user: string | undefined, password: string | undefined): Plugin {
  const expected = Buffer.from(user ? `${user}:${password}` : (password ?? ''))
  const check: Connect.NextHandleFunction = (req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ')
    const decoded = scheme === 'Basic' ? Buffer.from(encoded ?? '', 'base64').toString() : ''
    const given = Buffer.from(user ? decoded : decoded.slice(decoded.indexOf(':') + 1))
    if (decoded.includes(':') && given.length === expected.length && timingSafeEqual(given, expected)) {
      return next()
    }
    res.statusCode = 401
    res.setHeader('WWW-Authenticate', 'Basic realm="Claude sessions", charset="UTF-8"')
    res.end('Unauthorized')
  }
  return {
    name: 'basic-auth',
    enforce: 'pre',
    configureServer: (server) => void (password && server.middlewares.use(check)),
    configurePreviewServer: (server) => void (password && server.middlewares.use(check)),
  }
}

export default defineConfig({
  plugins: [
    basicAuth(process.env.VIEWER_USER, process.env.VIEWER_PASSWORD),
    tanstackStart(),
    viteReact(),
  ],
})
