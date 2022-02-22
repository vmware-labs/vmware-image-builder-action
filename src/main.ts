import * as artifact from "@actions/artifact"
import * as clients from "./clients"
import * as constants from "./constants"
import * as core from "@actions/core"
import * as path from "path"
import axios from "axios"
import fs from "fs"
import util from "util"

const root =
  process.env.JEST_WORKER_ID !== undefined
    ? path.join(__dirname, "../__tests__/") // tests base context
    : process.env.GITHUB_WORKSPACE !== undefined
    ? path.join(process.env.GITHUB_WORKSPACE, ".") // Running on GH but not tests
    : path.join(__dirname, "..") // default, but should never trigger

export const cspClient = clients.newClient({
  baseURL: `${
    process.env.CSP_API_URL
      ? process.env.CSP_API_URL
      : constants.DEFAULT_CSP_API_URL
  }`,
  timeout: 10000,
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
})

export const vibClient = clients.newClient({
  baseURL: `${
    process.env.VIB_PUBLIC_URL
      ? process.env.VIB_PUBLIC_URL
      : constants.DEFAULT_VIB_PUBLIC_URL
  }`,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
    "User-Agent": "vib-action/0.1-dev",
  },
})

interface Config {
  pipeline: string
  baseFolder: string
  shaArchive: string
  targetPlatform: string | undefined
}

interface TargetPlatform {
  id: string
  kind: string
  version: string
}

type TargetPlatformsMap = {
  [key: string]: TargetPlatform
}

interface CspToken {
  access_token: string
  timestamp: number
}

interface CspInput {
  timeout: number
}

let cachedCspToken: CspToken | null = null
let targetPlatforms: TargetPlatformsMap = {}

const recordedStatuses = {}
let eventConfig

async function run(): Promise<void> {
  //TODO: Refactor so we don't need to do this check
  if (process.env.JEST_WORKER_ID !== undefined) return // skip running logic when importing class for npm test

  loadTargetPlatforms() // load target platforms in the background
  await loadEventConfig()
  await runAction()
}

//TODO: After generating objects with OpenAPI we should be able to have a Promise<ExecutionGraph>
//TODO: Enable linter
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runAction(): Promise<any> {
  core.debug("Running github action.")
  const config = await loadConfig()
  const startTime = Date.now()

  try {
    const executionGraphId = await createPipeline(config)
    core.info(`Created pipeline with id ${executionGraphId}.`)

    // Now wait until pipeline ends or times out
    let executionGraph = await getExecutionGraph(executionGraphId)
    while (
      !Object.values(constants.EndStates).includes(executionGraph["status"])
    ) {
      core.info(
        `Fetched execution graph with id ${executionGraphId}. Status: ${executionGraph["status"]}`
      )
      if (
        Date.now() - startTime >
        constants.DEFAULT_EXECUTION_GRAPH_GLOBAL_TIMEOUT
      ) {
        //TODO: Allow user to override the global timeout via action input params
        core.info(
          `Execution graph ${executionGraphId} timed out. Ending Github Action.`
        )
        break
      }
      await sleep(constants.DEFAULT_EXECUTION_GRAPH_CHECK_INTERVAL)
      executionGraph = await getExecutionGraph(executionGraphId)
    }

    core.info("Downloading all outputs from execution graph.")
    const files = await loadAllData(executionGraph)
    const result = await getExecutionGraphResult(executionGraphId)
    if (result !== null) {
      // Add result
      files.push(
        path.join(
          getFolder(executionGraph["execution_graph_id"]),
          "result.json"
        )
      )
    }
    if (process.env.ACTIONS_RUNTIME_TOKEN) {
      core.debug("Uploading logs as artifacts to GitHub")
      core.debug(`Will upload the following files: ${util.inspect(files)}`)
      core.debug(`Root directory: ${getFolder(executionGraphId)}`)
      const artifactClient = artifact.create()
      const artifactName = getArtifactName(config)

      const options = {
        continueOnError: true,
      }
      const executionGraphFolder = getFolder(executionGraphId)
      const uploadResult = await artifactClient.uploadArtifact(
        artifactName,
        files,
        executionGraphFolder,
        options
      )
      core.debug(
        `Got response from GitHub artifacts API: ${util.inspect(uploadResult)}`
      )
      core.info(`Uploaded artifact: ${uploadResult.artifactName}`)
      if (uploadResult.failedItems.length > 0) {
        core.warning(
          `The following files could not be uploaded: ${util.inspect(
            uploadResult.failedItems
          )}`
        )
      }
    } else {
      core.warning(
        "ACTIONS_RUNTIME_TOKEN env variable not found. Skipping upload artifacts."
      )
    }

    core.info("Processing execution graph result.")
    if (result && !result["passed"]) {
      core.setFailed(
        "Some pipeline tests have failed. Please check the execution graph report for details."
      )
    }

    if (
      !Object.values(constants.EndStates).includes(executionGraph["status"])
    ) {
      core.setFailed(`Execution graph ${executionGraphId} has timed out.`)
    } else {
      if (executionGraph["status"] === constants.EndStates.FAILED) {
        core.setFailed(`Execution graph ${executionGraphId} has failed.`)
      } else {
        core.info(
          `Execution graph ${executionGraphId} has completed successfully.`
        )
      }
    }

    core.info("Generating action outputs.")
    //TODO: Improve existing tests to verify that outputs are set
    core.setOutput("execution-graph", executionGraph)
    core.setOutput("result", result)

    return executionGraph
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

export function getArtifactName(config: Config): string {
  if (config.targetPlatform) {
    // try to find the platform
    const targetPlatform = targetPlatforms[config.targetPlatform]
    if (targetPlatform) {
      return `assets-${process.env.GITHUB_JOB}-${targetPlatform.kind}`
    }
  }
  return `assets-${process.env.GITHUB_JOB}`
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
      const next = executionGraph["tasks"].find(
        it => it["task_id"] === task["next_tasks"][0]
      )
      taskName = `${taskName} ( ${next["action_id"]} )`
    } else if (taskName === "undeployment") {
      // find the associated task
      const prev = executionGraph["tasks"].find(
        it => it["task_id"] === task["previous_tasks"][0]
      )
      taskName = `${taskName} ( ${prev["action_id"]} )`
    }

    if (
      typeof recordedStatus === "undefined" ||
      taskStatus !== recordedStatus
    ) {
      core.info(`Task ${taskName} is now in status ${taskStatus}`)
      switch (taskStatus) {
        case "FAILED":
          core.error(`Task ${taskName} has failed. Error: ${taskError}`)
          break
        case "SKIPPED":
          core.info(`Task ${taskName} has been skipped`)
          break
        case "SUCCEEDED":
          //TODO: Use coloring to print this in green
          core.info(`Task ${taskName} has finished successfully`)
          break
      }
    }

    recordedStatuses[taskId] = taskStatus
  }
}

export async function getExecutionGraph(
  executionGraphId: string
): Promise<Object> {
  core.debug(`Getting execution graph with id ${executionGraphId}`)
  if (typeof process.env.VIB_PUBLIC_URL === "undefined") {
    core.setFailed("VIB_PUBLIC_URL environment variable not found.")
    return ""
  }

  const apiToken = await getToken({ timeout: constants.CSP_TIMEOUT })
  try {
    const response = await vibClient.get(
      `/v1/execution-graphs/${executionGraphId}`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    )
    //TODO: Handle response codes
    const executionGraph = response.data
    displayExecutionGraph(executionGraph)
    return executionGraph
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      if (err.response.status === 404) {
        const errorMessage = err.response.data
          ? err.response.data.detail
          : `Could not find execution graph with id ${executionGraphId}`
        core.debug(errorMessage)
        throw new Error(errorMessage)
      }
      throw err
    }
    throw err
  }
}

export async function getExecutionGraphResult(
  executionGraphId: string
): Promise<Object | null> {
  core.info(
    `Downloading execution graph results from ${getDownloadVibPublicUrl()}/v1/execution-graphs/${executionGraphId}/report`
  )
  if (typeof process.env.VIB_PUBLIC_URL === "undefined") {
    core.setFailed("VIB_PUBLIC_URL environment variable not found.")
  }

  const apiToken = await getToken({ timeout: constants.CSP_TIMEOUT })
  try {
    const response = await vibClient.get(
      `/v1/execution-graphs/${executionGraphId}/report`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    )
    //TODO: Handle response codes
    const result = response.data

    const resultFile = path.join(getFolder(executionGraphId), "result.json")
    fs.writeFileSync(resultFile, JSON.stringify(result))
    return result
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      if (err.response.status === 404) {
        core.warning(
          `Coult not find execution graph report for ${executionGraphId}`
        )
        return null
      }
      // Don't throw error if we cannot fetch a report
      core.warning(
        `Error fetching execution graph for ${executionGraphId}. Error code: ${err.response.status}. Message: ${err.response.statusText}`
      )
      return null
    }
    core.warning(
      `Could not fetch execution graph report for ${executionGraphId}. Error: ${err}}`
    )
    return null
  }
}

export async function createPipeline(config: Config): Promise<string> {
  core.debug(`Config: ${config}`)
  if (typeof process.env.VIB_PUBLIC_URL === "undefined") {
    core.setFailed("VIB_PUBLIC_URL environment variable not found.")
  }

  const apiToken = await getToken({ timeout: constants.CSP_TIMEOUT })

  try {
    const pipeline = await readPipeline(config)
    core.debug(`Sending pipeline: ${util.inspect(pipeline)}`)
    //TODO: Define and replace different placeholders: e.g. for values, content folders (goss, jmeter), etc.

    const response = await vibClient.post("/v1/pipelines", pipeline, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    core.debug(
      `Got create pipeline response data : ${JSON.stringify(
        response.data
      )}, headers: ${util.inspect(response.headers)}`
    )
    //TODO: Handle response codes
    const locationHeader = response.headers["location"]?.toString()
    if (typeof locationHeader === "undefined") {
      throw new Error("Location header not found")
    }
    core.debug(`Location Header: ${locationHeader}`)

    const executionGraphId = locationHeader.substring(
      locationHeader.lastIndexOf("/") + 1
    )
    return executionGraphId
  } catch (error) {
    core.debug(`Error: ${JSON.stringify(error)}`)
    throw error
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
      core.setFailed(
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

export function substituteEnvVariables(
  config: Config,
  pipeline: string
): string {
  // More generic templating approach. We try replacing any environment var starting with VIB_ENV_
  for (const property in process.env) {
    if (property && property.startsWith(constants.ENV_VAR_TEMPLATE_PREFIX)) {
      const propertyValue = process.env[property]
      if (propertyValue) {
        pipeline = replaceVariable(config, pipeline, property, propertyValue)
      }
    }
  }

  // Warn about all unsubstituted variables
  const unsubstituted = [...pipeline.matchAll(/\{([^} ]+)\}/g)]
  for (const [key] of unsubstituted) {
    core.warning(
      `Pipeline ${config.pipeline} expects ${key} but the matching VIB_ENV_ template variable was not found in environmnt.`
    )
  }
  return pipeline
}

function replaceVariable(
  config: Config,
  pipeline: string,
  variable: string,
  value: string
): string {
  const shortVariable = variable.substring(
    constants.ENV_VAR_TEMPLATE_PREFIX.length
  )
  if (
    !pipeline.includes(`{${variable}}`) &&
    !pipeline.includes(`{${shortVariable}}`)
  ) {
    core.warning(
      `Environment variable ${variable} is set but is not used within pipeline ${config.pipeline}`
    )
  } else {
    core.info(`Substituting variable ${variable} in ${config.pipeline}`)
    pipeline = pipeline.replace(new RegExp(`{${variable}}`, "g"), value)
    // we also support not using the VIB_ENV_ prefix for expressivity and coping with hypothetic future product naming changes
    pipeline = pipeline.replace(new RegExp(`{${shortVariable}}`, "g"), value)
  }
  return pipeline
}

export async function getToken(input: CspInput): Promise<string> {
  if (typeof process.env.CSP_API_TOKEN === "undefined") {
    core.setFailed("CSP_API_TOKEN secret not found.")
    return ""
  }

  if (typeof process.env.CSP_API_URL === "undefined") {
    core.setFailed("CSP_API_URL environment variable not found.")
    return ""
  }

  if (cachedCspToken != null && cachedCspToken.timestamp > Date.now()) {
    return cachedCspToken.access_token
  }

  try {
    const response = await cspClient.post(
      "/csp/gateway/am/api/auth/api-tokens/authorize",
      `grant_type=refresh_token&api_token=${process.env.CSP_API_TOKEN}`
    )
    //TODO: Handle response codes
    if (
      typeof response.data === "undefined" ||
      typeof response.data.access_token === "undefined"
    ) {
      throw new Error("Could not fetch access token.")
    }

    cachedCspToken = {
      access_token: response.data.access_token,
      timestamp: Date.now() + input.timeout,
    }

    return response.data.access_token
  } catch (error) {
    throw error
  }
}

export async function loadAllData(executionGraph: Object): Promise<string[]> {
  let files: string[] = []

  //TODO assertions
  for (const task of executionGraph["tasks"]) {
    if (task["status"] === "SKIPPED") {
      continue
    }

    const logFile = await getRawLogs(
      executionGraph["execution_graph_id"],
      task["action_id"],
      task["task_id"]
    )
    if (logFile) {
      core.debug(`Downloaded file ${logFile}`)
      files.push(logFile)
    }

    const reports = await getRawReports(
      executionGraph["execution_graph_id"],
      task["action_id"],
      task["task_id"]
    )
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

/**
 * Loads target platforms into the global target platforms map. Target platform names
 * will be used later to store assets.
 */
export async function loadTargetPlatforms(): Promise<Object> {
  core.debug("Loading target platforms.")
  if (typeof process.env.VIB_PUBLIC_URL === "undefined") {
    throw new Error("VIB_PUBLIC_URL environment variable not found.")
  }

  const apiToken = await getToken({ timeout: constants.CSP_TIMEOUT })
  try {
    const response = await vibClient.get("/v1/target-platforms", {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    //TODO: Handle response codes
    for (const targetPlatform of response.data) {
      targetPlatforms[targetPlatform.id] = {
        id: targetPlatform.id,
        kind: targetPlatform.kind,
        version: targetPlatform.version,
      }
    }
    core.debug(`Received target platforms: ${util.inspect(targetPlatforms)}`)
    return targetPlatforms
  } catch (err) {
    // Don't fail action if we cannot fetch target platforms. Log error instead
    core.error(`Could not fetch target platforms. Has the endpoint changed? `)
    if (axios.isAxiosError(err) && err.response) {
      core.error(
        `Error code: ${err.response.status}. Message: ${err.response.statusText}`
      )
    } else {
      core.error(`Error: ${err}`)
    }
    return {}
  }
}

/**
 * Loads the event github event configuration from the environment variable if existing
 */
export async function loadEventConfig(): Promise<Object> {
  if (typeof process.env.GITHUB_EVENT_PATH === "undefined") {
    core.warning(
      "Could not find GITHUB_EVENT_PATH environment variable. Will not have any action event context."
    )
    return {}
  }
  core.info(`Loading event configuration from ${process.env.GITHUB_EVENT_PATH}`)
  try {
    eventConfig = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH).toString()
    )
    core.debug(`Loaded config: ${util.inspect(eventConfig)}`)
    return eventConfig
  } catch (err) {
    core.warning(
      `Could not read content from ${process.env.GITHUB_EVENT_PATH}. Error: ${err}`
    )
    return {}
  }
}

function getFolder(executionGraphId: string): string {
  const folder = path.join(root, "outputs", executionGraphId)
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true })
  }
  return folder
}

function getDownloadVibPublicUrl(): string | undefined {
  return typeof process.env.VIB_REPLACE_PUBLIC_URL !== "undefined"
    ? process.env.VIB_REPLACE_PUBLIC_URL
    : process.env.VIB_PUBLIC_URL
}

export async function getRawReports(
  executionGraphId: string,
  taskName: string,
  taskId: string
): Promise<string[]> {
  if (typeof process.env.VIB_PUBLIC_URL === "undefined") {
    core.setFailed("VIB_PUBLIC_URL environment variable not found.")
  }
  core.info(
    `Downloading raw reports for task ${taskName} from ${getDownloadVibPublicUrl()}/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/raw-reports`
  )

  const reports: string[] = []

  const apiToken = await getToken({ timeout: constants.CSP_TIMEOUT })

  try {
    const response = await vibClient.get(
      `/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/raw-reports`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    )
    //TODO: Handle response codes
    const result = response.data
    if (result && result.length > 0) {
      for (const raw_report of result) {
        const reportFilename = `${taskId}_${raw_report.filename}`
        const reportFile = path.join(
          getReportsFolder(executionGraphId),
          `${reportFilename}`
        )
        // Still need to download the raw content
        const writer = fs.createWriteStream(reportFile)
        core.debug(
          `Downloading raw report from ${getDownloadVibPublicUrl()}/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/raw-reports/${
            raw_report.id
          } into ${reportFile}`
        )
        const fileResponse = await vibClient.get(
          `/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/raw-reports/${raw_report.id}`,
          {
            headers: { Authorization: `Bearer ${apiToken}` },
            responseType: "stream",
          }
        )
        fileResponse.data.pipe(writer)
        reports.push(reportFile)
      }
    }
    return reports
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      // Don't throw error if we cannot fetch a report
      core.warning(
        `Received error while fetching reports for task ${taskId}. Error code: ${err.response.status}. Message: ${err.response.statusText}`
      )
      return []
    } else {
      throw err
    }
  }
}

export async function getRawLogs(
  executionGraphId: string,
  taskName: string,
  taskId: string
): Promise<string | null> {
  if (typeof process.env.VIB_PUBLIC_URL === "undefined") {
    core.setFailed("VIB_PUBLIC_URL environment variable not found.")
  }
  core.info(
    `Downloading logs for task ${taskName} from ${getDownloadVibPublicUrl()}/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/logs/raw`
  )

  const logFile = path.join(
    getLogsFolder(executionGraphId),
    `${taskName}-${taskId}.log`
  )
  const apiToken = await getToken({ timeout: constants.CSP_TIMEOUT })

  core.debug(`Will store logs at ${logFile}`)
  try {
    const response = await vibClient.get(
      `/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/logs/raw`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    )
    //TODO: Handle response codes
    fs.writeFileSync(logFile, response.data)
    return logFile
  } catch (err) {
    if (axios.isAxiosError(err) && err.response) {
      // Don't throw error if we cannot fetch a log
      core.warning(
        `Received error while fetching logs for task ${taskId}. Error code: ${err.response.status}. Message: ${err.response.statusText}`
      )
      return null
    } else {
      throw err
    }
  }
}

export async function loadConfig(): Promise<Config> {
  //TODO: Replace SHA_ARCHIVE with something more meaningful like PR_HEAD_TARBALL or some other syntax. Perhaps something
  //      we could do would be to allow to use as variables to the actions any of the data from the GitHub event from the
  //      GITHUB_EVENT_PATH file.
  //      For the time being I'm using pull_request.head.repo.url plus the ref as the artifact name and reusing shaArchive
  //      but we need to redo this in the very short term
  let shaArchive
  if (eventConfig) {
    if (eventConfig["pull_request"]) {
      shaArchive = `${eventConfig["pull_request"]["head"]["repo"]["url"]}/tarball/${eventConfig["pull_request"]["head"]["ref"]}`
    } else {
      // not a pull request. Try pulling tarball from master
      shaArchive = `${eventConfig["repository"]["url"]}/tarball/${eventConfig["repository"]["master_branch"]}`
    }
  } else {
    // fall back to the old logic if needed
    // Warn on rqeuirements for HELM_CHART variable replacement
    if (typeof process.env.GITHUB_SHA === "undefined") {
      core.warning(
        "Could not find a valid GitHub SHA on environment. Is the GitHub action running as part of PR or Push flows?"
      )
    } else if (typeof process.env.GITHUB_REPOSITORY === "undefined") {
      core.warning(
        "Could not find a valid GitHub Repository on environment. Is the GitHub action running as part of PR or Push flows?"
      )
    } else {
      shaArchive = `https://github.com/${process.env.GITHUB_REPOSITORY}/archive/${process.env.GITHUB_SHA}.zip`
    }
  }
  core.info(`SHA_ARCHIVE will resolve to ${shaArchive}`)

  let pipeline = core.getInput("pipeline")
  let baseFolder = core.getInput("config")

  if (pipeline === "") {
    pipeline = constants.DEFAULT_PIPELINE
  }

  if (baseFolder === "") {
    baseFolder = constants.DEFAULT_BASE_FOLDER
  }

  const folderName = path.join(root, baseFolder)

  if (!fs.existsSync(folderName)) {
    core.setFailed(`Could not find base folder at ${folderName}`)
  }

  const filename = path.join(folderName, pipeline)
  if (!fs.existsSync(filename)) {
    core.setFailed(`Could not find pipeline at ${baseFolder}/${pipeline}`)
  }
  return {
    pipeline,
    baseFolder,
    shaArchive,
    targetPlatform: process.env.TARGET_PLATFORM,
  }
}

/*eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/promise-function-async*/
//TODO: Enable linter
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
/*eslint-enable */

export async function reset(): Promise<void> {
  cachedCspToken = null
  targetPlatforms = {}
}

run()
