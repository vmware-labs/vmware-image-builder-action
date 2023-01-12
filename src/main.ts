import * as artifact from "@actions/artifact"
import * as core from "@actions/core"
import * as path from "path"
import ConfigurationFactory, { Config } from "./config"
import VIB, { States, TargetPlatform } from "./client/vib"
import CSP from "./client/csp"
import ansi from "ansi-colors"
import fs from "fs"
import util from "util"

const ENV_VAR_TEMPLATE_PREFIX = "VIB_ENV_"

const root =
  process.env.JEST_WORKER_ID !== undefined
    ? path.join(__dirname, "../__tests__/") // tests base context
    : process.env.GITHUB_WORKSPACE !== undefined
      ? path.join(process.env.GITHUB_WORKSPACE, ".") // Running on GH but not tests
      : path.join(__dirname, "..") // default, but should never trigger

export const configFactory = new ConfigurationFactory(root)

export const cspClient = new CSP()

export const vibClient = new VIB()

type TargetPlatformsMap = {
  [key: string]: TargetPlatform
}

let targetPlatforms: TargetPlatformsMap = {}

const recordedStatuses = {}

async function run(): Promise<void> {
  //TODO: Refactor so we don't need to do this check
  if (process.env.JEST_WORKER_ID !== undefined) return // skip running logic when importing class for npm test

  loadTargetPlatforms() // load target platforms in the background
  await runAction()
}

//TODO: After generating objects with OpenAPI we should be able to have a Promise<ExecutionGraph>
//TODO: Enable linter
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runAction(): Promise<any> {
  core.debug("Running github action.")

  core.startGroup("Initializing GitHub Action...")
  const config = await configFactory.getConfiguration()
  core.endGroup()

  const startTime = Date.now()

  cspClient.checkTokenExpiration()

  try {
    core.startGroup("Executing pipeline...")
    const pipeline = await readPipeline(config)

    await validatePipeline(pipeline)

    const executionGraphId = await createExecutionGraph(pipeline, config)

    // Now wait until pipeline ends or times out
    let executionGraph = await getExecutionGraph(executionGraphId)
    displayExecutionGraph(executionGraph)
    while (!Object.values(States).includes(executionGraph["status"])) {
      core.info(`  » Pipeline is still in progress, will check again in ${config.executionGraphCheckInterval / 1000}s.`)

      executionGraph = await getExecutionGraph(executionGraphId)
      displayExecutionGraph(executionGraph)

      await sleep(config.executionGraphCheckInterval)

      if (Date.now() - startTime > config.pipelineDuration) {
        core.setFailed(`Pipeline ${executionGraphId} timed out. Ending GitHub Action.`)
        return executionGraph
      }
    }

    core.debug("Downloading all outputs from execution graph.")
    const files = await loadRawLogsAndRawReports(executionGraph)

    const report = await getExecutionGraphReport(executionGraphId)
    if (report !== null) {
      const reportFile = path.join(getFolder(executionGraphId), "report.json")
      core.debug(`Will store report at ${reportFile}`)
      fs.writeFileSync(reportFile, JSON.stringify(report))
      files.push(reportFile)
    }

    core.debug("Processing execution graph report...")
    let failedMessage
    if (report && !report["passed"]) {
      failedMessage = "Some pipeline actions have failed. Please check the pipeline report for details."
      core.info(ansi.red(failedMessage))
    }

    if (!Object.values(States).includes(executionGraph["status"])) {
      failedMessage = `Pipeline ${executionGraphId} has timed out.`
      core.info(failedMessage)
    } else {
      if (executionGraph["status"] !== States.SUCCEEDED) {
        displayErrorExecutionGraph(executionGraph)
        failedMessage = `Pipeline ${executionGraphId} has ${executionGraph["status"].toLowerCase()}.`
        core.info(failedMessage)
      } else {
        core.info(`Pipeline finished successfully.`)
      }
    }
    core.endGroup()

    core.startGroup("Uploading artifacts...")
    const uploadArtifacts = core.getInput("upload-artifacts")
    if (process.env.ACTIONS_RUNTIME_TOKEN && uploadArtifacts === "true" && files.length > 0) {
      core.debug("Uploading logs as artifacts to GitHub")
      core.debug(`Will upload the following files: ${util.inspect(files)}`)
      core.debug(`Root directory: ${getFolder(executionGraphId)}`)
      const artifactClient = artifact.create()
      const artifactName = getArtifactName(config, executionGraphId)

      const options = {
        continueOnError: true,
      }
      const executionGraphFolder = getFolder(executionGraphId)
      const uploadResult = await artifactClient.uploadArtifact(artifactName, files, executionGraphFolder, options)
      core.debug(`Got response from GitHub artifacts API: ${util.inspect(uploadResult)}`)
      core.info(`Uploaded artifact: ${uploadResult.artifactName}`)
      if (uploadResult.failedItems.length > 0) {
        core.warning(`The following files could not be uploaded: ${util.inspect(uploadResult.failedItems)}`)
      }
    } else if (uploadArtifacts === "false") {
      core.info("Artifacts will not be published.")
    } else {
      core.warning("ACTIONS_RUNTIME_TOKEN env variable not found. Skipping upload artifacts.")
    }
    core.endGroup()

    core.debug("Generating action outputs...")
    //TODO: Improve existing tests to verify that outputs are set
    core.setOutput("execution-graph", executionGraph)
    core.setOutput("result", report)

    if (report !== null) {
      prettifyExecutionGraphResult(report)
    }

    if (executionGraph["status"] !== States.SUCCEEDED) {
      displayErrorExecutionGraph(executionGraph)
    }

    if (failedMessage) {
      core.setFailed(failedMessage)
    }

    return executionGraph
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

/**
 * Loads target platforms into the global target platforms map. Target platform names
 * will be used later to store assets.
 */
export async function loadTargetPlatforms(): Promise<TargetPlatformsMap | undefined> {
  core.debug("Loading target platforms.")

  const apiToken = await cspClient.getToken()

  try {
    const response = await vibClient.getTargetPlatforms(apiToken)
    core.debug(`Received target platforms: ${response}`)

    for (const targetPlatform of response) {
      targetPlatforms[targetPlatform["id"]] = {
        id: targetPlatform["id"],
        kind: targetPlatform["kind"],
        version: targetPlatform["version"],
      }
    }

    return targetPlatforms
  } catch (err) {
    if (err instanceof Error) {
      core.warning(err.message)
    } else {
      throw err
    }
  }
}

export async function validatePipeline(pipeline: string): Promise<void> {
  const apiToken = await cspClient.getToken()

  const errors = await vibClient.validatePipeline(pipeline, apiToken)

  if (errors && errors.length > 0) {
    const errorMessage = errors.toString()
    core.info(ansi.bold(ansi.red(errorMessage)))
    throw new Error(errorMessage)
  } else {
    core.info(ansi.bold(ansi.green("The pipeline has been validated successfully.")))
  }
}

export async function createExecutionGraph(pipeline: string, config: Config): Promise<string> {
  const apiToken = await cspClient.getToken()

  const executionGraphId = await vibClient.createPipeline(
    pipeline,
    config.pipelineDuration,
    config.verificationMode,
    apiToken
  )
  core.info(
    `Started execution graph ${executionGraphId}, check more details: ${vibClient.url}/v1/execution-graphs/${executionGraphId}`
  )

  return executionGraphId
}

export function getArtifactName(config: Config, executionGraphID: string): string {
  let artifactName = `assets-${process.env.GITHUB_JOB}`
  if (config.targetPlatform) {
    // try to find the platform
    const targetPlatform = targetPlatforms[config.targetPlatform]
    if (targetPlatform) {
      artifactName += `-${targetPlatform.kind}`
    }
  }
  if (process.env.GITHUB_RUN_ATTEMPT) {
    const runAttempt = Number.parseInt(process.env.GITHUB_RUN_ATTEMPT)
    if (runAttempt > 1) {
      artifactName += `_${runAttempt}`
    }
  }
  if (executionGraphID) {
    artifactName += `-${executionGraphID.slice(0, 8)}`
  }
  return artifactName
}

export function displayExecutionGraph(executionGraph: Object): void {
  for (const task of executionGraph["tasks"]) {
    const taskId = task["task_id"]
    let taskName = task["action_id"]
    const taskError = task["error"]
    const taskStatus = task["status"]
    const recordedStatus = recordedStatuses[taskId]

    if (taskName === "deployment") {
      // find the associated task
      const next = executionGraph["tasks"].find(it => it["task_id"] === task["next_tasks"][0])
      taskName = `${taskName} ( ${next["action_id"]} )`
    } else if (taskName === "undeployment") {
      // find the associated task
      const prev = executionGraph["tasks"].find(it => it["task_id"] === task["previous_tasks"][0])
      taskName = `${taskName} ( ${prev["action_id"]} )`
    }

    if (typeof recordedStatus === "undefined" || taskStatus !== recordedStatus) {
      switch (taskStatus) {
        case "FAILED":
          core.error(`Task ${taskName} has failed. Error: ${taskError}`)
          break
      }
    }

    recordedStatuses[taskId] = taskStatus
  }
}

export async function getExecutionGraph(executionGraphId: string): Promise<Object> {
  core.debug(`Getting execution graph with id ${executionGraphId}`)

  const apiToken = await cspClient.getToken()

  return await vibClient.getExecutionGraph(executionGraphId, apiToken)
}

export function prettifyExecutionGraphResult(executionGraphResult: Object): void {
  core.info(ansi.bold(`Pipeline result: ${executionGraphResult["passed"] ? ansi.green("passed") : ansi.red("failed")}`))
  let actionsPassed = 0
  let actionsFailed = 0
  let actionsSkipped = 0
  for (const task of executionGraphResult["actions"]) {
    if (task["passed"] === true) {
      actionsPassed++
    } else if (task["passed"] === false) {
      actionsFailed++
    } else {
      actionsSkipped++
    }
  }
  for (const task of executionGraphResult["actions"]) {
    if (task["tests"]) {
      core.info(
        `${ansi.bold(task["action_id"])} ${ansi.bold("action:")} ${
          task["passed"] === true ? ansi.green("passed") : ansi.red("failed")
        } » ${"Tests:"} ${ansi.bold(ansi.green(task["tests"]["passed"]))} ${ansi.bold(
          ansi.green("passed")
        )}, ${ansi.bold(ansi.yellow(task["tests"]["skipped"]))} ${ansi.bold(ansi.yellow("skipped"))}, ${ansi.bold(
          ansi.red(task["tests"]["failed"])
        )} ${ansi.bold(ansi.red("failed"))}`
      )
    } else if (task["vulnerabilities"]) {
      core.info(
        `${ansi.bold(task["action_id"])} ${ansi.bold("action:")} ${
          task["passed"] === true ? ansi.green("passed") : ansi.red("failed")
        } » ${"Vulnerabilities:"} ${task["vulnerabilities"]["minimal"]} minimal, ${
          task["vulnerabilities"]["low"]
        } low, ${task["vulnerabilities"]["medium"]} medium, ${task["vulnerabilities"]["high"]} high, ${ansi.bold(
          ansi.red(task["vulnerabilities"]["critical"])
        )} ${ansi.bold(ansi.red("critical"))}, ${task["vulnerabilities"]["unknown"]} unknown`
      )
    }
    if (task["passed"] === "true") {
      core.info(ansi.bold(`${task["action_id"]}: ${ansi.green("passed")}`))
    } else if (task["passed"] === "false") {
      core.info(ansi.bold(`${task["action_id"]}: ${ansi.red("failed")}`))
    }
  }
  core.info(
    ansi.bold(
      `Actions: ${ansi.green(actionsPassed.toString())} ${ansi.green("passed")}, ${ansi.yellow(
        actionsSkipped.toString()
      )} ${ansi.yellow("skipped")}, ${ansi.red(actionsFailed.toString())} ${ansi.red("failed")}, ${
        actionsPassed + actionsFailed + actionsSkipped
      } ${"total"}
      `
    )
  )
}

export function displayErrorExecutionGraph(executionGraph: Object): void {
  const status = executionGraph["status"]
  core.info(
    ansi.bold(
      ansi.red(
        `Execution graph ${
          executionGraph["execution_graph_id"]
        } did not succeed. The following actions have a ${status.toLowerCase()} status:`
      )
    )
  )
  for (const task of executionGraph["tasks"]) {
    if (task["status"] === status) {
      core.info(ansi.bold(ansi.red(`${task["action_id"]}( ${task["task_id"]} ). Error:  ${task["error"]}`)))
    }
  }
}

export async function readPipeline(config: Config): Promise<string> {
  const folderName = path.join(root, config.baseFolder)
  const filename = path.join(folderName, config.pipeline)
  core.debug(`Reading pipeline file from ${filename}`)
  let pipeline = fs.readFileSync(filename).toString()

  if (config.shaArchive) {
    pipeline = pipeline.replace(/{SHA_ARCHIVE}/g, config.shaArchive)
  } else {
    if (pipeline.includes("{SHA_ARCHIVE}")) {
      core.warning(
        `Pipeline ${config.pipeline} expects SHA_ARCHIVE variable but either GITHUB_REPOSITORY or GITHUB_SHA cannot be found on environment.`
      )
    }
  }

  // Keeping this code block that deals with TARGET_PLATFORM for backwards compatibility for the time being
  if (config.targetPlatform) {
    pipeline = pipeline.replace(/{TARGET_PLATFORM}/g, config.targetPlatform)
  }

  // Replaces the above. Generic template var substitution based in environment variables
  pipeline = substituteEnvVariables(config, pipeline)
  core.debug(`Sending pipeline: ${util.inspect(pipeline)}`)

  return pipeline
}

export function substituteEnvVariables(config: Config, pipeline: string): string {
  // More generic templating approach. We try replacing any environment var starting with VIB_ENV_
  for (const property in process.env) {
    if (property && property.startsWith(ENV_VAR_TEMPLATE_PREFIX)) {
      const propertyValue = process.env[property]
      if (propertyValue) {
        pipeline = replaceVariable(config, pipeline, property, propertyValue)
      }
    }
  }

  // Warn about all unsubstituted variables
  // Ignore variables within double brackets as those will be substituted by VIB
  const unsubstituted = [...pipeline.matchAll(/((?<!\{)\{)[^{}|"]*(\}(?!\}))/g)]
  for (const [key] of unsubstituted) {
    core.setFailed(
      `Pipeline ${config.pipeline} expects ${key} but the matching VIB_ENV_ template variable was not found in environment.`
    )
  }
  return pipeline
}

function replaceVariable(config: Config, pipeline: string, variable: string, value: string): string {
  const shortVariable = variable.substring(ENV_VAR_TEMPLATE_PREFIX.length)
  if (!pipeline.includes(`{${variable}}`) && !pipeline.includes(`{${shortVariable}}`)) {
    core.warning(`Environment variable ${variable} is set but is not used within pipeline ${config.pipeline}`)
  } else {
    core.info(`Substituting variable ${variable} in ${config.pipeline}`)
    pipeline = pipeline.replace(new RegExp(`{${variable}}`, "g"), value)
    // we also support not using the VIB_ENV_ prefix for expressivity and coping with hypothetic future product naming changes
    pipeline = pipeline.replace(new RegExp(`{${shortVariable}}`, "g"), value)
  }
  return pipeline
}

export async function loadRawLogsAndRawReports(executionGraph: Object): Promise<string[]> {
  let files: string[] = []

  const onlyUploadOnFailure = core.getInput("only-upload-on-failure")
  if (onlyUploadOnFailure === "false") {
    core.debug("Will fetch and upload all artifacts independently of task state.")
  }

  // TODO: assertions
  for (const task of executionGraph["tasks"]) {
    if (task["status"] === "SKIPPED") {
      continue
    }

    if (task["passed"] === true && onlyUploadOnFailure === "true") {
      continue
    }

    const logFile = await getRawLogs(executionGraph["execution_graph_id"], task["action_id"], task["task_id"])
    if (logFile) {
      core.debug(`Downloaded file ${logFile}`)
      files.push(logFile)
    }

    const reports = await getRawReports(executionGraph["execution_graph_id"], task["action_id"], task["task_id"])
    files = [...files, ...reports]
  }

  return files
}

export function getLogsFolder(executionGraphId: string): string {
  //TODO validate inputs
  const logsFolder = path.join(getFolder(executionGraphId), "/logs")
  if (!fs.existsSync(logsFolder)) {
    core.debug(`Creating logs folder ${logsFolder}`)
    fs.mkdirSync(logsFolder, { recursive: true })
  }

  return logsFolder
}

function getReportsFolder(executionGraphId: string): string {
  //TODO validate inputs
  const reportsFolder = path.join(getFolder(executionGraphId), "/reports")
  if (!fs.existsSync(reportsFolder)) {
    core.debug(`Creating logs reports ${reportsFolder}`)
    fs.mkdirSync(reportsFolder, { recursive: true })
  }

  return reportsFolder
}

function getFolder(executionGraphId: string): string {
  const folder = path.join(root, "outputs", executionGraphId)
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true })
  }
  return folder
}

export async function getRawReports(executionGraphId: string, taskName: string, taskId: string): Promise<string[]> {
  core.debug(`Downloading raw reports for task ${taskName}`)

  const reports: string[] = []
  const apiToken = await cspClient.getToken()

  try {
    const rawReports = await vibClient.getRawReports(executionGraphId, taskId, apiToken)

    if (rawReports.length > 0) {
      for (const rawReport of rawReports) {
        const reportFile = path.join(getReportsFolder(executionGraphId), `${taskId}_${rawReport["filename"]}`)

        core.debug(`Downloading raw report ${rawReport["id"]}`)

        const report = await vibClient.getRawReport(executionGraphId, taskId, rawReport["id"], apiToken)
        report.pipe(fs.createWriteStream(reportFile))

        reports.push(reportFile)
      }
    }
  } catch (err) {
    if (!(err instanceof Error)) throw err
    core.warning(err.message)
  }

  return reports
}

export async function getRawLogs(executionGraphId: string, taskName: string, taskId: string): Promise<string | null> {
  core.debug(`Downloading logs for task ${taskName}`)

  const logFile = path.join(getLogsFolder(executionGraphId), `${taskName}-${taskId}.log`)
  const apiToken = await cspClient.getToken()

  core.debug(`Will store logs at ${logFile}`)
  try {
    const logs = await vibClient.getRawLogs(executionGraphId, taskId, apiToken)
    fs.writeFileSync(logFile, logs)
    return logFile
  } catch (err) {
    if (!(err instanceof Error)) throw err
    core.warning(err.message)
    return null
  }
}

export async function getExecutionGraphReport(executionGraphId: string): Promise<Object | null> {
  core.debug(`Downloading execution graph report ${executionGraphId}`)

  const apiToken = await cspClient.getToken()

  try {
    return await vibClient.getExecutionGraphReport(executionGraphId, apiToken)
  } catch (err) {
    if (!(err instanceof Error)) throw err
    core.warning(err.message)
    return null
  }
}

/*eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/promise-function-async*/
//TODO: Enable linter
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
/*eslint-enable */

export async function reset(): Promise<void> {
  cspClient.setCachedToken(null)
  targetPlatforms = {}
}

run()
