import path from 'path'
import fs from "fs"
import { Readable } from 'stream'

export function runtimeParameters() {
  return fs.readFileSync(path.join(__dirname, '..', 'resources', '.vib', 'runtime-parameters-file.yaml'))
  .toString()
  .trim()
}

export function bundle(): Readable {
  return fs.createReadStream(path.join(__dirname, '..', 'resources', 'bundle.zip' ))
}

export function executionGraphNotPassed(): Readable {
  return fs.createReadStream(path.join(__dirname, '..', 'resources', 'bundle-not-passed.zip' ))
}

export function executionGraphFailed(): Readable {
  return fs.createReadStream(path.join(__dirname, '..', 'resources', 'bundle-failed.zip' ))
}
