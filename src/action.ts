import * as artifact from "@actions/artifact"
import * as core from "@actions/core"
import * as path from "path"
import ConfigurationFactory, { Config } from "./config"
import { ExecutionGraph, ExecutionGraphReport, Pipeline, RawReport, SemanticValidationHint, SemanticValidationLevel, Task, 
  TaskStatus } from "./client/vib/api"
import { BASE_PATH } from "./client/vib/base"
import CSP from "./client/csp"
import VIB from "./client/vib"
import ansi from "ansi-colors"
import fs from "fs"
import moment from "moment"
import { pipeline as streamPipeline } from "node:stream/promises"

export interface ActionResult {
  baseDir: string,
  artifacts: string[],
  executionGraph: ExecutionGraph
  executionGraphReport: ExecutionGraphReport | undefined
}

class Action {

  private ENV_VAR_TEMPLATE_PREFIX = "VIB_ENV_"

  config: Config

  csp: CSP
  
  vib: VIB

  root: string

  constructor(root: string) {
    this.config = new ConfigurationFactory(root).getConfiguration()
    this.root = root
    this.csp = new CSP(this.config.clientTimeoutMillis, this.config.clientRetryCount, this.config.clientRetryIntervals)
    this.vib = new VIB(this.config.clientTimeoutMillis, this.config.clientRetryCount, this.config.clientRetryIntervals, 
      this.config.clientUserAgentVersion, this.csp)
  }

  async main(): Promise<ActionResult> {
    core.startGroup("Initializing GitHub Action...")
    const pipeline = await this.initialize()
    core.endGroup()

    core.startGroup("Running pipeline...")
    const executionGraph = await this.runPipeline(pipeline)
    core.endGroup()

    core.startGroup("Processing resulting execution graph...")
    const actionResult = await this.processExecutionGraph(executionGraph)
    core.endGroup()

    core.startGroup("Uploading artifacts...")
    this.uploadArtifacts(actionResult.baseDir, actionResult.artifacts, executionGraph.execution_graph_id)
    core.endGroup()

    this.summarize(executionGraph, actionResult)

    return actionResult
  }

  async initialize(): Promise<Pipeline> {
    await this.checkCSPTokenExpiration()
    return await this.readPipeline()
  }

  async checkCSPTokenExpiration(): Promise<void> {
    core.debug(`Checking CSP token expiration, token expiration days warning set to ${this.config.tokenExpirationDaysWarning}`)
    const tokenExpiration = await this.csp.checkTokenExpiration()
    const now = moment()
    const expiresAt = moment.unix(tokenExpiration)
    const expiresInDays = expiresAt.diff(now, "days")
    if (expiresInDays < this.config.tokenExpirationDaysWarning) {
      core.warning(`CSP API token will expire in ${expiresInDays} days.`)
    } else {
      core.debug(`Checked expiration token, expires ${expiresAt.from(now)}.`)
    }
  }

  async readPipeline(): Promise<Pipeline> {
    core.debug(`Reading pipeline from ${this.root}, using base folder ${this.config.baseFolder} and file ${this.config.pipeline}`)
    let rawPipeline = fs.readFileSync(path.join(this.root, this.config.baseFolder, this.config.pipeline)).toString()

    if (this.config.shaArchive) {
      rawPipeline = rawPipeline.replace(/{SHA_ARCHIVE}/g, this.config.shaArchive)
    } else if (rawPipeline.includes("{SHA_ARCHIVE}")) {
      throw new Error(`Pipeline ${this.config.pipeline} expects SHA_ARCHIVE variable but either GITHUB_REPOSITORY or GITHUB_SHA cannot be found on environment.`)
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

    if (this.config.runtimeParametersFile) {
      rawPipeline = this.readParemetersFile(rawPipeline, path.join(this.root, this.config.baseFolder, this.config.runtimeParametersFile))
    }

    return JSON.parse(rawPipeline)
  }

  private replaceVariable(pipeline: string, key: string, value: string): string {
    core.debug(`Replacing variable ${key} with value ${value}`)
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

  private readParemetersFile(pipeline: string, runtimeParametersFilePath: string): string {
    let runtimeParameters = Buffer.from(fs.readFileSync(runtimeParametersFilePath).toString().trim()).toString("base64")

    switch (runtimeParameters.length % 4) {
      case 2:
        runtimeParameters += "=="
        break
      case 3:
        runtimeParameters += "="
        break
      default:
        break
    }
  
    const pipelineBeforeRuntimeParams = JSON.parse(pipeline)
    pipelineBeforeRuntimeParams.phases.verify.context.runtime_parameters = runtimeParameters
    pipeline = JSON.stringify(pipelineBeforeRuntimeParams, null, 2)

    core.debug(`Runtime parameters file added to pipeline ${pipeline}`)
    
    return pipeline
  }

  async runPipeline(pipeline: Pipeline): Promise<ExecutionGraph> {
    const startTime = Date.now()

    const validationHints = await this.vib.validatePipeline(pipeline)
    this.displayPipelineValidationHints(validationHints)

    core.info(ansi.bold(ansi.green("The pipeline has been validated successfully.")))

    const executionGraphId = await this.vib.createPipeline(pipeline, this.config.pipelineDurationMillis, this.config.verificationMode)
    core.info(`Running execution graph: ${BASE_PATH}/execution-graphs/${executionGraphId}`)

    const executionGraph = await new Promise<ExecutionGraph>((resolve, reject) => {

      const failedTasks: Task[] = []

      const interval = setInterval(async () => {

        try {
          const eg = await this.vib.getExecutionGraph(executionGraphId)
          const status = eg.status

          failedTasks.push(...this.displayFailedTasks(eg, eg.tasks.filter(t => !failedTasks.find(f => f.task_id === t.task_id))))

          if (status === TaskStatus.Failed || status === TaskStatus.Skipped || status === TaskStatus.Succeeded) {
            resolve(eg)
            clearInterval(interval)
          } else if (Date.now() - startTime > this.config.pipelineDurationMillis) {
            throw new Error(`Pipeline ${executionGraphId} timed out. Ending pipeline execution.`)
          } else {
            core.info(`Execution graph in progress, will check in ${this.config.executionGraphCheckInterval / 1000}s.`)
          }
        } catch(err) {
          clearInterval(interval)
          reject(err)
        }
      }, this.config.executionGraphCheckInterval)
    })

    core.setOutput("execution-graph", executionGraph)

    return executionGraph
  }

  private displayPipelineValidationHints(hints: SemanticValidationHint[]): void {
    const header = 'Got pipeline validation hint: '
    for (const hint of hints) {
      const message = header + hint.message
      switch (hint.level) {
        case SemanticValidationLevel.Error:
          core.error(message)
          break
        case SemanticValidationLevel.Warning:
          core.warning(message)
          break
        case SemanticValidationLevel.Info:
        default:
          core.info(message)
          break
      }
    }
  }

  private displayFailedTasks(executionGraph: ExecutionGraph, tasks: Task[]): Task[] {
    const failed: Task[] = []
    for (const task of tasks.filter(t => t.status === TaskStatus.Failed)) {
      let name = task.action_id

      if (name === "deployment") {
        name = name.concat(` (${executionGraph.tasks.find(t => t.task_id === task.next_tasks[0])?.action_id})`)
      } else if (name === "undeployment") {
        name = name.concat(` (${executionGraph.tasks.find(t => t.task_id === task.previous_tasks[0])?.action_id})`)
      }

      core.error(`Task ${name} with ID ${task.task_id} has failed. Error: ${task.error}`)
      failed.push(task)
    }
    return failed
  }

  async processExecutionGraph(executionGraph: ExecutionGraph): Promise<ActionResult> {
    const executionGraphId = executionGraph.execution_graph_id
    const artifacts: string[] = []

    const baseDir = this.mkdir(path.join(this.root, "outputs", executionGraphId))
    const logsDir = this.mkdir(path.join(baseDir, "/logs"))
    const reportsDir = this.mkdir(path.join(baseDir, "/reports"))

    for (const task of executionGraph.tasks) {
      const taskId = task.task_id

      // API restriction
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let taskReport: { [key: string]: any } = {}

      if (task.status === TaskStatus.Succeeded) {
        try {
          taskReport = await this.vib.getTaskReport(executionGraphId, taskId)
        } catch (error) {
          core.warning(`Error downloading report for task ${taskId}, error: ${error}`)
        }
      }
      
      const taskReportFailed = !taskReport?.report?.passed
      const alwaysDoUpload = !this.config.onlyUploadOnFailure

      if (taskReportFailed || alwaysDoUpload) {
        if (task.status === TaskStatus.Succeeded) {
          try {
            const rawReports = await this.vib.getRawReports(executionGraphId, taskId)
            const reportFiles = await Promise.all(rawReports
              .map(async r => await this.downloadRawReport(executionGraph, task, r, reportsDir)))
            core.debug(`Downloaded report ${reportFiles.length} files for task ${taskId}`)
            artifacts.push(...reportFiles)
          } catch (error) {
            core.warning(`Error downloading report files for task ${taskId}, error: ${error}`)
          }
        }

        if (task.status === TaskStatus.Succeeded || task.status === TaskStatus.Failed) {
          try {
            const logs = await this.vib.getRawLogs(executionGraphId, taskId)
            const logsFile = this.writeFileSync(path.join(logsDir, `${task.action_id}-${taskId}.log`), logs)
            core.debug(`Downloaded logs file for task ${taskId}`)
            artifacts.push(logsFile)
          } catch (error) {
            core.warning(`Error downloading task logs file for task ${taskId}, error: ${error}`)
          }
        }
      }
    }

    let executionGraphReport: ExecutionGraphReport | undefined = undefined

    if (executionGraph.status === TaskStatus.Succeeded) {
      try {
        executionGraphReport = await this.vib.getExecutionGraphReport(executionGraphId)
        core.setOutput("result", executionGraphReport)

        if (!executionGraphReport.passed) {
          core.setFailed(`Execution graph succeeded, however some tasks didn't pass the verification.`)
        }

        const executionGraphReportFile = this.writeFileSync(path.join(baseDir, "report.json"), JSON.stringify(executionGraphReport))
        artifacts.push(executionGraphReportFile)
      } catch (error) {
        core.warning(`Error downloading report for execution graph ${executionGraphId}, error: ${error}`)
      }
    } else {
      core.setFailed(`Execution graph ${executionGraphId} has ${executionGraph.status.toLowerCase()}.`)
    }
    
    return { baseDir, artifacts, executionGraph, executionGraphReport }
  }

  private mkdir(dir: string): string {
    core.debug(`Creating directory ${dir} if does not exist`)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    return dir
  }

  private writeFileSync(file: string, data: string): string {
    core.debug(`Writing file ${file}`)
    fs.writeFileSync(file, data)
    return file
  }

  private async downloadRawReport(executionGraph: ExecutionGraph, task: Task, rawReport: RawReport, reportsDir: string): Promise<string> {
    core.debug(`Downloading raw report from execution graph ${executionGraph.execution_graph_id}, task ${task.task_id}, raw report ${rawReport.id} into ${reportsDir}`)
    let finalFilename = `${task.task_id}_${rawReport.filename}`
    if (finalFilename.length > 255) {
      finalFilename = finalFilename.slice(0, 255)
    }
    const reportFile = path.join(reportsDir, finalFilename)
    const report = await this.vib.getRawReport(executionGraph.execution_graph_id, task.task_id, rawReport.id)
    await streamPipeline(report, fs.createWriteStream(reportFile))
    return reportFile
  }

  async uploadArtifacts(baseDir: string, artifacts: string[], executionGraphId: string): Promise<void> {
    if (process.env.ACTIONS_RUNTIME_TOKEN && this.config.uploadArtifacts && artifacts.length > 0) {
      const artifactClient = artifact.create()
      const artifactName = await this.getArtifactName(executionGraphId)
      
      const uploadResult = await artifactClient.uploadArtifact(artifactName, artifacts, baseDir, { continueOnError: true })
      
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
    core.debug('Generating artifact name')
    let artifactName = `assets-${process.env.GITHUB_JOB}`

    if (this.config.targetPlatform) {
      try {
        const targetPlatform = await this.vib.getTargetPlatform(this.config.targetPlatform)
        if (targetPlatform) {
          artifactName += `-${targetPlatform.kind}`
        }
      } catch (error) {
        core.warning(`Unexpected error getting target platform ${this.config.targetPlatform}, error: ${error}`)
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
    // TODO: add cleanup function to remove local artifacts
  }

  prettifyExecutionGraphResult(executionGraph: ExecutionGraph, report?: ExecutionGraphReport): void {
    if (!report) {
      return core.warning('Skipping execution graph summary, either the report could not be dowloaded or final state was not SUCCEEDED')
    }

    core.info(ansi.bold(`Pipeline result: ${report.passed ? ansi.green("passed") : ansi.red("failed")}`))
    core.summary.addHeading(`Pipeline result: ${report.passed ? "passed" : "failed"}`)

    let tasksPassed = 0
    let tasksFailed = 0

    let testsTable = "<table><thead><tr><td colspan=5>Tests</td></tr>"
    + "<tr><td>Action</td><td>Passed 🟢</td><td>Skipped ⚪</td><td>Failed 🔴</td><td>Result</></tr></thead><tbody>"
    let vulnerabilitiesTable = "<table><thead><tr><td colspan=8>Vulnerabilities</td></tr>"
    + "<tr><td>Action</td><td>Minimal</td><td>Low</td><td>Medium</td><td>High</td><td>❗️Critical</td><td>Unknown</td>"
    + "<td>Result</td></tr></thead><tbody>"

    for (const task of report.actions) {
      task.passed ? tasksPassed++ : tasksFailed++

      if (task.tests) {
        core.info(`${ansi.bold(`${task.action_id} action:`)} ${task.passed === true ? ansi.green("passed") : ansi.red("failed")} » `
          + `${"Tests:"} ${ansi.bold(ansi.green(`${task.tests.passed} passed`))}, `
          + `${ansi.bold(ansi.yellow(`${task.tests.skipped} skipped`))}, `
          + `${ansi.bold(ansi.red(`${task.tests.failed} failed`))}`)
        testsTable += this.testTableRow(task.action_id, task.tests.passed, task.tests.skipped, task.tests.failed, task.passed)
      } else if (task.vulnerabilities) {
        core.info(`${ansi.bold(`${task.action_id} action:`)} ${task.passed === true ? ansi.green("passed") : ansi.red("failed")} » `
          + `${"Vulnerabilities:"} ${task.vulnerabilities.minimal} minimal, `
          + `${task.vulnerabilities.low} low, `
          + `${task.vulnerabilities.medium} medium, `
          + `${task.vulnerabilities.high} high, `
          + `${ansi.bold(ansi.red(`${task.vulnerabilities.critical} critical`))}, `
          + `${task["vulnerabilities"]["unknown"]} unknown`)
        vulnerabilitiesTable += this.vulnerabilitiesTableRow(task.action_id, task.vulnerabilities.minimal, task.vulnerabilities.low, 
          task.vulnerabilities.medium, task.vulnerabilities.high, task.vulnerabilities.critical, task.vulnerabilities.unknown, task.passed)
      }
    }

    const tasksSkipped = executionGraph.tasks.filter(t => t.status === TaskStatus.Skipped).length

    core.info(ansi.bold(`Actions: `
      + `${ansi.green(`${tasksPassed} passed`)}, `
      + `${ansi.yellow(`${tasksSkipped} skipped`)}, `
      + `${ansi.red(`${tasksFailed} failed`)}, `
      + `${tasksPassed + tasksFailed + tasksSkipped} total`)
    )
    const testsTableRows = testsTable.split("<tr>").length -1
    if (testsTableRows > 2) {
      core.summary.addRaw(testsTable)
    }

    const vulnerabilitiesTableRows = vulnerabilitiesTable.split("<tr>").length -1
    if (vulnerabilitiesTableRows > 2) {
      core.summary.addRaw(vulnerabilitiesTable)
    }

    if (process.env.GITHUB_STEP_SUMMARY) core.summary.write()
  }

  private testTableRow(action: string, passed: number, skipped: number, failed: number, actionPassed: boolean | undefined): string {
    return `<tr><td>${action}</td><td>${passed}</td><td>${skipped}</td><td>${failed}</td><td>${actionPassed ? "✅ " : "❌"}</td></tr>`
  }

  private vulnerabilitiesTableRow(action: string, min: number, low: number, mid: number, high: number, critic: number, unk: number, 
    passed: boolean | undefined): string {
    return `<tr><td>${action}</td><td>${min}</td><td>${low}</td><td>${mid}</td><td>${high}</td><td>${critic}</td><td>${unk}</td><td>${passed ? "✅" : "❌"}</td></tr>`
  }
}

export default Action
