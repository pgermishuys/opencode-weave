import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const LOG_FILE = path.join(os.tmpdir(), "weave-opencode.log")

export function log(message: string, data?: unknown): void {
  try {
    const timestamp = new Date().toISOString()
    const entry = `[${timestamp}] ${message}${data !== undefined ? " " + JSON.stringify(data) : ""}\n`
    fs.appendFileSync(LOG_FILE, entry)
  } catch {
  }
}

export function getLogFilePath(): string {
  return LOG_FILE
}
