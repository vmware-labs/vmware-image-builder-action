import * as artifact from "@actions/artifact"
import * as core from "@actions/core"
import * as path from "path"
import ConfigurationFactory, { Config } from "./config"
import { ExecutionGraph, ExecutionGraphReport, Pipeline, RawReport, Task, TaskStatus } from "./client/vib/api"
import CSP from "./client/csp"
import VIB from "./client/vib"
import ansi from "ansi-colors"
import fs from "fs"

export interface ActionResult {
  baseDir: string,
  artifacts: string[],
  executionGraphReport: ExecutionGraphReport
}

export default class Action {

  private ENV_VAR_TEMPLATE_PREFIX = "VIB_ENV_"

  config: Config

  csp: CSP
  
  vib: VIB

  root: string

  constructor(root: string) {
    this.config = new ConfigurationFactory(root).getConfiguration()
    this.root = root
    this.csp = new CSP(this.config.clientTimeout, this.config.clientRetryCount, this.config.clientRetryIntervals)
    this.vib = new VIB(this.config.clientTimeout, this.config.clientRetryCount, this.config.clientRetryIntervals, 
      this.config.clientUserAgentVersion, this.csp)
    this.csp.checkTokenExpiration()
  }

  async main(): Promise<void> {
    core.startGroup("Initializing GitHub Action...")
    const pipeline = await this.readPipeline()
    core.endGroup()

    core.startGroup("Executing pipeline...")
    const executionGraph = await this.runPipeline(pipeline)
    core.endGroup()

    core.startGroup("Processing resulting execution graph...")
    const actionResult = await this.processExecutionGraph(executionGraph)
    core.endGroup()

    core.startGroup("Uploading artifacts...")
    this.uploadArtifacts(actionResult.baseDir, actionResult.artifacts, executionGraph.execution_graph_id)
    core.endGroup()

    this.summarize(executionGraph, actionResult)
  }

  async readPipeline(): Promise<Pipeline> {
    let rawPipeline = fs.readFileSync(path.join(this.root, this.config.baseFolder, this.config.pipeline)).toString()

    if (this.config.shaArchive) {
      rawPipeline = rawPipeline.replace(/{SHA_ARCHIVE}/g, this.config.shaArchive)
    } else if (rawPipeline.includes("{SHA_ARCHIVE}")) {
      core.warning(`Pipeline ${this.config.pipeline} expects SHA_ARCHIVE variable but either GITHUB_REPOSITORY or GITHUB_SHA cannot be found on environment.`)
    }

    if (this.config.targetPlatform) {
      rawPipeline = rawPipeline.replace(/{TARGET_PLATFORM}/g, this.config.targetPlatform)
    }

    for (const key of Object.keys(process.env).filter(k => k.startsWith(this.ENV_VAR_TEMPLATE_PREFIX))) {
      const value = process.env[key]
      rawPipeline = this.replaceVariable(rawPipeline, key, value === undefined ? '' : value)
    }

    const unsubstituted = [...rawPipeline.matchAll(/((?<!\{)\{)[^{}|"]*(\}(?!\}))/g)]
    for (const [key] of unsubstituted) {
      core.warning(`Pipeline ${this.config.pipeline} expects ${key} but the matching VIB_ENV_ template variable was not found in environment.`)
    }

    return JSON.parse(rawPipeline)
  }

  private replaceVariable(pipeline: string, key: string, value: string): string {
    const shortVariable = key.substring(this.ENV_VAR_TEMPLATE_PREFIX.length)

    if (!pipeline.includes(`{${key}}`) && !pipeline.includes(`{${shortVariable}}`)) {
      core.warning(`Environment variable ${key} is set but is not used within the pipeline`)
    } else {
      core.info(`Substituting variable ${key} found in the pipeline`)
      // Both VIB_ENB_ prefixed and non-prefixed are supported for now inside the pipeline
      pipeline = pipeline.replace(new RegExp(`{${key}}`, "g"), value)
      pipeline = pipeline.replace(new RegExp(`{${shortVariable}}`, "g"), value)
    }

    return pipeline
  }

  async runPipeline(pipeline: Pipeline): Promise<ExecutionGraph> {
    const startTime = Date.now()

    await this.vib.validatePipeline(pipeline)

    const executionGraphId = await this.vib.createPipeline(pipeline, this.config.pipelineDuration, this.config.verificationMode)

    const executionGraph = await new Promise<ExecutionGraph>(resolve => {
      const interval = setInterval(async () => {

        const eg = await this.vib.getExecutionGraph(executionGraphId)
        const status = eg.status

        if (status === TaskStatus.Failed || status === TaskStatus.Skipped || TaskStatus.Succeeded) {
          resolve(eg)
          clearInterval(interval)
        } else if (Date.now() - startTime > this.config.pipelineDuration) {
          clearInterval(interval)
          throw new Error(`Pipeline ${executionGraphId} timed out. Ending GitHub Action.`)
        } else {
          core.info(`Execution graph in progress, will check in ${this.config.executionGraphCheckInterval / 1000}s.`)
        }
      }, this.config.executionGraphCheckInterval)
    })

    core.setOutput("execution-graph", executionGraph)

    return executionGraph
  }

  async processExecutionGraph(executionGraph: ExecutionGraph): Promise<ActionResult> {
    const executionGraphId = executionGraph.execution_graph_id
    const artifacts: string[] = []

    const baseDir = this.mkdir(path.join(this.root, "outputs", executionGraphId))
    const logsDir = this.mkdir(path.join(baseDir, "/logs"))
    const reportsDir = this.mkdir(path.join(baseDir, "/reports"))

    const tasksToProcess = executionGraph.tasks
      .filter(t => t.status === TaskStatus.Succeeded && this.config.onlyUploadOnFailure || t.status === TaskStatus.Failed)

    for (const task of tasksToProcess) {
      const taskId = task.task_id

      try {
        const logs = await this.vib.getRawLogs(executionGraphId, taskId)
        const logsFile = this.writeFileSync(path.join(logsDir, `${task.action_id}-${taskId}.log`), logs)
        core.debug(`Downloaded logs file for task ${taskId}`)
        artifacts.push(logsFile)
      } catch (error) {
        core.warning(`Error downloading task logs file for task ${taskId}, error: ${error}`)
      }

      try {
        const rawReports = await this.vib.getRawReports(executionGraphId, taskId)
        const reportFiles = await Promise.all(rawReports.map(async r => await this.downloadRawReport(executionGraph, task, r, reportsDir)))
        core.debug(`Downloaded report ${reportFiles.length} files for task ${taskId}`)
        artifacts.push(...reportFiles)
      } catch (error) {
        core.warning(`Error downloading report files for task ${taskId}, error: ${error}`)
      }
    }

    const executionGraphReport = await this.vib.getExecutionGraphReport(executionGraphId)
    core.setOutput("result", executionGraphReport)
    const executionGraphReportFile = this.writeFileSync(path.join(baseDir, "report.json"), JSON.stringify(executionGraphReport))
    artifacts.push(executionGraphReportFile)
    
    return { baseDir, artifacts, executionGraphReport }
  }

  private mkdir(dir: string): string {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  private writeFileSync(file: string, data: string): string {
    fs.writeFileSync(file, data)
    return file
  }

  private async downloadRawReport(executionGraph: ExecutionGraph, task: Task, rawReport: RawReport, reportsDir: string): Promise<string> {
    const reportFile = path.join(reportsDir, `${task.task_id}_${rawReport.filename}`)
    const report = await this.vib.getRawReport(executionGraph.execution_graph_id, task.task_id, rawReport.id)
    report.pipe(fs.createWriteStream(reportFile))
    return reportFile
  }

  async uploadArtifacts(baseDir: string, artifacts: string[], executionGraphId: string): Promise<void> {
    if (process.env.ACTIONS_RUNTIME_TOKEN && this.config.uploadArtifacts && artifacts.length > 0) {
      const artifactClient = artifact.create()
      const artifactName = await this.getArtifactName(executionGraphId)
      
      const uploadResult = await artifactClient.uploadArtifact(artifactName, artifacts, baseDir, { continueOnError: true })
      
      core.info(`Uploaded artifact: ${uploadResult.artifactName}`)
      if (uploadResult.failedItems.length > 0) {
        core.warning(`The following files could not be uploaded: ${uploadResult.failedItems}`)
      }
    } else if (!this.config.uploadArtifacts) {
      core.info("Artifacts will not be published.")
    } else if (artifacts.length > 0) {
      core.warning("ACTIONS_RUNTIME_TOKEN env variable not found. Skipping upload artifacts.")
    }
  }

  private async getArtifactName(executionGraphID: string): Promise<string> {
    let artifactName = `assets-${process.env.GITHUB_JOB}`

    if (this.config.targetPlatform) {
      const targetPlatform = await this.vib.getTargetPlatform(this.config.targetPlatform)
      if (targetPlatform) {
        artifactName += `-${targetPlatform.kind}`
      }
    }

    if (process.env.GITHUB_RUN_ATTEMPT) {
      const runAttempt = parseInt(process.env.GITHUB_RUN_ATTEMPT)
      if (runAttempt > 1) {
        artifactName += `_${runAttempt}`
      }
    }

    if (executionGraphID) {
      artifactName += `-${executionGraphID.slice(0, 8)}`
    }

    return artifactName
  }

  summarize(executionGraph: ExecutionGraph, actionResult: ActionResult): void {
    this.prettifyExecutionGraphResult(executionGraph, actionResult.executionGraphReport)
  }

  private prettifyExecutionGraphResult(executionGraph: ExecutionGraph, executionGraphResult: ExecutionGraphReport): void {
    core.info(ansi.bold(`Pipeline result: ${executionGraphResult.passed ? ansi.green("passed") : ansi.red("failed")}`))

    let actionsPassed = 0
    let actionsFailed = 0

    for (const task of executionGraphResult.actions) {
      if (task.passed) {
        actionsPassed++
        core.info(ansi.bold(`${task["action_id"]}: ${ansi.green("passed")}`))
      } else {
        actionsFailed++
        core.info(ansi.bold(`${task["action_id"]}: ${ansi.red("failed")}`))
      }
    }

    for (const task of executionGraphResult.actions) {
      if (task.tests) {
        core.info(`${ansi.bold(`${task.action_id} action:`)} ${task.passed === true ? ansi.green("passed") : ansi.red("failed")} » 
          ${"Tests:"} ${ansi.bold(ansi.green(`${task.tests.passed} passed`))}, 
          ${ansi.bold(ansi.yellow(`${task.tests.skipped} skipped`))}, 
          ${ansi.bold(ansi.red(`${task.tests.failed} failed`))}`)
      } else if (task.vulnerabilities) {
        core.info(`${ansi.bold(`${task.action_id} action:`)} ${task.passed === true ? ansi.green("passed") : ansi.red("failed")} » 
          ${"Vulnerabilities:"} ${task.vulnerabilities.minimal} minimal, 
          ${task.vulnerabilities.low} low, 
          ${task.vulnerabilities.medium} medium, 
          ${task.vulnerabilities.high} high, 
          ${ansi.bold(ansi.red(`${task.vulnerabilities.critical} critical`))}, 
          ${task["vulnerabilities"]["unknown"]} unknown`
        )
      }
    }

    const actionsSkipped = executionGraph.tasks.filter(t => t.status === TaskStatus.Skipped).length

    core.info(ansi.bold(`Actions: 
      ${ansi.green(`${actionsPassed} passed`)}, 
      ${ansi.yellow(`${actionsSkipped} skipped`)}, 
      ${ansi.red(`${actionsFailed} failed`)}, 
      ${actionsPassed + actionsFailed + actionsSkipped} total`)
    )
  }
}