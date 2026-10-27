import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
const root = dirname(dirname(fileURLToPath(import.meta.url))), backend = join(root, 'backend')
const python = join(backend, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
if (!existsSync(python)) { console.error('Falta preparar el backend. Ejecuta npm run setup.'); process.exit(1) }
const env = { ...process.env, PYTHONPATH: '', PYTHONDONTWRITEBYTECODE: '1', NEXT_TELEMETRY_DISABLED: '1' }
const api = spawn(python, ['run.py'], { cwd: backend, stdio: 'inherit', env })
const web = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), process.argv.includes('--production') ? 'start' : 'dev', '--hostname', '0.0.0.0', '--port', process.env.PORT || '3000'], { cwd: root, stdio: 'inherit', env })
let stopping = false
const stop = (code = 0) => { if (stopping) return; stopping = true; process.exitCode = code; api.kill('SIGTERM'); web.kill('SIGTERM') }
for (const child of [api, web]) {
  child.on('error', error => { console.error(error.message); stop(1) })
  child.on('exit', code => { if (!stopping) stop(code || 0) })
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
