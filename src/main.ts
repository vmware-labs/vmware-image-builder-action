import * as artifact from "@actions/artifact"
import * as clients from "./clients"
import * as constants from "./constants"
import * as core from "@actions/core"
import * as path from "path"
import ansi from "ansi-colors"
import axios from "axios"
import fs from "fs"
import util from "util"

const root =
  process.env.JEST_WORKER_ID !== undefined
    ? path.join(__dirname, "../__tests__/") // tests base context
    : process.env.GITHUB_WORKSPACE !== undefined
    ? path.join(process.env.GITHUB_WORKSPACE, ".") // Running on GH but not tests
    : path.join(__dirname, "..") // default, but should never trigger

const userAgentVersion = process.env.GITHUB_ACTION_REF
  ? process.env.GITHUB_ACTION_REF
  : "unknown"

export const cspClient = clients.newClient(
  {
    baseURL: `${
      process.env.CSP_API_URL
        ? process.env.CSP_API_URL
        : constants.DEFAULT_CSP_API_URL
    }`,
    timeout: 30000,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  },
  {
    retries: getNumberInput("retry-count"),
    backoffIntervals: getNumberArray(
      "backoff-intervals",
      constants.HTTP_RETRY_INTERVALS
    ),
  }
)

export const vibClient = clients.newClient(
  {
    baseURL: `${
      process.env.VIB_PUBLIC_URL
        ? process.env.VIB_PUBLIC_URL
        : constants.DEFAULT_VIB_PUBLIC_URL
    }`,
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `vib-action/${userAgentVersion}`,
    },
  },
  {
    retries: getNumberInput("retry-count"),
    backoffIntervals: getNumberArray(
      "backoff-intervals",
      constants.HTTP_RETRY_INTERVALS
    ),
  }
)

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
  const config = await loadConfig()
  const startTime = Date.now()

  try {
    const executionGraphId = await createPipeline(config)
    core.info(
      `Starting the execution of the pipeline with id ${executionGraphId}, check the pipeline details: ${getDownloadVibPublicUrl()}/v1/execution-graphs/${executionGraphId}`
    )

    // Now wait until pipeline ends or times out
    let executionGraph = await getExecutionGraph(executionGraphId)
    while (
      !Object.values(constants.EndStates).includes(executionGraph["status"])
    ) {
      core.info(`  » Pipeline is still in progress, will check again in 15s.`)
      if (
        Date.now() - startTime >
        constants.DEFAULT_EXECUTION_GRAPH_GLOBAL_TIMEOUT
      ) {
        //TODO: Allow user to override the global timeout via action input params
        core.info(
          `Pipeline ${executionGraphId} timed out. Ending Github Action.`
        )
        break
      }
      await sleep(constants.DEFAULT_EXECUTION_GRAPH_CHECK_INTERVAL)
      executionGraph = await getExecutionGraph(executionGraphId)
    }

    core.debug("Downloading all outputs from pipeline.")
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

    core.debug("Processing pipeline report...")
    let failedMessage
    if (result && !result["passed"]) {
      failedMessage =
        "Some pipeline actions have failed. Please check the pipeline report for details."
      core.info(ansi.red(failedMessage))
    }

    if (
      !Object.values(constants.EndStates).includes(executionGraph["status"])
    ) {
      failedMessage = `Pipeline ${executionGraphId} has timed out.`
      core.info(failedMessage)
    } else {
      if (executionGraph["status"] !== constants.EndStates.SUCCEEDED) {
        displayErrorExecutionGraph(executionGraph)
        failedMessage = `Pipeline ${executionGraphId} has ${executionGraph[
          "status"
        ].toLowerCase()}.`
        core.info(failedMessage)
      } else {
        core.info(`Pipeline finished successfully.`)
      }
    }

    core.debug("Generating action outputs.")
    //TODO: Improve existing tests to verify that outputs are set
    core.setOutput("execution-graph", executionGraph)
    core.setOutput("result", result)

    if (executionGraph["status"] !== constants.EndStates.SUCCEEDED) {
      displayErrorExecutionGraph(executionGraph)
    }

    if (result !== null) {
      prettifyExecutionGraphResult(result)
    }

    const uploadArtifacts = core.getInput("upload-artifacts")
    if (
      process.env.ACTIONS_RUNTIME_TOKEN &&
      uploadArtifacts === "true" &&
      files.length > 0
    ) {
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
    } else if (uploadArtifacts === "false") {
      core.info("Artifacts will not be published.")
    } else {
      core.warning(
        "ACTIONS_RUNTIME_TOKEN env variable not found. Skipping upload artifacts."
      )
    }

    if (failedMessage) {
      core.setFailed(failedMessage)
    }

    return executionGraph
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

export function getArtifactName(config: Config): string {
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
      switch (taskStatus) {
        case "FAILED":
          core.error(`Task ${taskName} has failed. Error: ${taskError}`)
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
  core.debug(
    `Downloading pipeline report from ${getDownloadVibPublicUrl()}/v1/execution-graphs/${executionGraphId}/report`
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
        core.warning(`Could not find pipeline report for ${executionGraphId}`)
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

export function prettifyExecutionGraphResult(
  executionGraphResult: Object
): void {
  core.info(
    ansi.bold(
      `Pipeline result: ${
        executionGraphResult["passed"]
          ? ansi.green("passed")
          : ansi.red("failed")
      }`
    )
  )
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
        `${ansi.bold(task["action_id"])} ${ansi.bold(" action: ")} ${ansi.bold(
          task["action_id"]["status"]
        )} » ${ansi.bold("Tests: ")} ${ansi.bold(
          ansi.green(task["tests"]["passed"])
        )} ${ansi.bold(ansi.green(" passed"))}, ${ansi.bold(
          ansi.yellow(task["tests"]["skipped"])
        )} ${ansi.bold(ansi.yellow(" skipped"))}, ${ansi.bold(
          ansi.red(task["tests"]["failed"])
        )} ${ansi.bold(ansi.red(" failed"))}`
      )
    } else if (task["passed"] === true && task["vulnerabilities"]) {
      core.info(
        `${ansi.bold(task["action_id"])} ${ansi.bold(" action: ")} ${ansi.green(
          "passed"
        )} » ${ansi.bold("Vulnerabilities: ")} ${
          task["vulnerabilities"]["minimal"]
        } minimal, ${task["vulnerabilities"]["low"]} low, ${
          task["vulnerabilities"]["medium"]
        } medium, ${task["vulnerabilities"]["high"]} high, ${ansi.bold(
          ansi.red(task["vulnerabilities"]["critical"])
        )} ${ansi.bold(ansi.red(" critical"))}, ${
          task["vulnerabilities"]["unknown"]
        } unknown`
      )
    } else if (task["passed"] === false && task["vulnerabilities"]) {
      core.info(
        `${ansi.bold(task["action_id"])} ${ansi.bold(" action: ")} ${ansi.red(
          ansi.bold("failed")
        )} » ${ansi.bold("Vulnerabilities: ")} ${
          task["vulnerabilities"]["minimal"]
        } minimal, ${task["vulnerabilities"]["low"]} low, ${
          task["vulnerabilities"]["medium"]
        } medium, ${task["vulnerabilities"]["high"]} high, ${ansi.bold(
          ansi.red(task["vulnerabilities"]["critical"])
        )} ${ansi.bold(ansi.red(" critical"))}, ${
          task["vulnerabilities"]["unknown"]
        } unknown`
      )
    }
  }
  core.info(
    ansi.bold(
      `Actions: ${ansi.green(actionsPassed.toString())} ${ansi.green(
        " passed"
      )}, ${ansi.yellow(actionsSkipped.toString())} ${ansi.yellow(
        " skipped"
      )}, ${ansi.red(actionsFailed.toString())} ${ansi.red(" failed")}, ${
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
      core.info(
        ansi.bold(
          ansi.red(
            `${task["action_id"]}( ${task["task_id"]} ). Error:  ${task["error"]}`
          )
        )
      )
    }
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
    await validatePipeline(pipeline)
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

export async function validatePipeline(pipeline: string): Promise<boolean> {
  if (typeof process.env.VIB_PUBLIC_URL === "undefined") {
    core.setFailed("VIB_PUBLIC_URL environment variable not found.")
  }

  const apiToken = await getToken({ timeout: constants.CSP_TIMEOUT })
  try {
    core.debug(`Validating pipeline: ${util.inspect(pipeline)}`)
    const response = await vibClient.post("/v1/pipelines/validate", pipeline, {
      headers: { Authorization: `Bearer ${apiToken}` },
    })
    core.debug(
      `Got validate pipeline response data : ${JSON.stringify(
        response.data
      )}, headers: ${util.inspect(response.headers)}`
    )

    if (response.status === 200) {
      core.info(
        ansi.bold(ansi.green("The pipeline has been validated successfully."))
      )
      return true
    }
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      if (error.response.status === 400) {
        const errorMessage = error.response.data
          ? error.response.data.detail
          : "The pipeline given is not correct."
        core.info(ansi.bold(ansi.red(errorMessage)))
        core.setFailed(errorMessage)
      } else {
        core.setFailed(
          `Could not reach out to VIB. Please try again. Error: ${error.response.status}`
        )
      }
    } else {
      core.debug(`Unexpected error ${JSON.stringify(error)}`)
    }
  }
  return false
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
    core.setFailed(
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
    core.debug(`Got response from CSP API token ${util.inspect(response.data)}`)
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
    core.debug("CSP API token obtained successfully.")
    return response.data.access_token
  } catch (error) {
    core.debug(`Could not obtain CSP API token ${util.inspect(error)}`)
    throw error
  }
}

export async function loadAllData(executionGraph: Object): Promise<string[]> {
  let files: string[] = []

  const onlyUploadOnFailure = core.getInput("only-upload-on-failure")
  if (onlyUploadOnFailure === "false") {
    core.debug(
      "Will fetch and upload all artifacts independently of task state."
    )
  }

  //TODO assertions
  for (const task of executionGraph["tasks"]) {
    if (task["status"] === "SKIPPED") {
      continue
    }

    if (task["passed"] === true && onlyUploadOnFailure === "true") {
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
export async function loadEventConfig(): Promise<Object | undefined> {
  if (typeof process.env.GITHUB_EVENT_PATH === "undefined") {
    core.warning(
      "Could not find GITHUB_EVENT_PATH environment variable. Will not have any action event context."
    )
    return
  }
  core.info(`Loading event configuration from ${process.env.GITHUB_EVENT_PATH}`)
  try {
    const eventConfig = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH).toString()
    )
    core.debug(`Loaded config: ${util.inspect(eventConfig)}`)
    return eventConfig
  } catch (err) {
    core.warning(
      `Could not read content from ${process.env.GITHUB_EVENT_PATH}. Error: ${err}`
    )
    return
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
  core.debug(
    `Downloading raw reports for task ${taskName} from ${getDownloadVibPublicUrl()}/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/result/raw-reports`
  )

  const reports: string[] = []

  const apiToken = await getToken({ timeout: constants.CSP_TIMEOUT })

  try {
    const response = await vibClient.get(
      `/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/result/raw-reports`,
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
          `Downloading raw report from ${getDownloadVibPublicUrl()}/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/result/raw-reports/${
            raw_report.id
          } into ${reportFile}`
        )
        const fileResponse = await vibClient.get(
          `/v1/execution-graphs/${executionGraphId}/tasks/${taskId}/result/raw-reports/${raw_report.id}`,
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
  core.debug(
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
  const eventConfig = await loadEventConfig()
  if (eventConfig) {
    if (eventConfig["pull_request"]) {
      // This event triggers only for fork pull requests. We load the sha differently here.
      shaArchive = `${eventConfig["pull_request"]["head"]["repo"]["url"]}/tarball/${eventConfig["pull_request"]["head"]["ref"]}`
    } else {
      let ref = process.env.GITHUB_SHA
      if (ref === undefined) {
        ref = process.env.GITHUB_REF_NAME
        if (ref === undefined) {
          if (eventConfig["repository"]) {
            ref = eventConfig["repository"]["master_branch"]
          } else {
            core.setFailed(
              `Could not guess the source code ref value. Neither a valid GitHub event or the GITHUB_REF_NAME env variable are available `
            )
          }
        }
      }

      const url =
        eventConfig["repository"] !== undefined
          ? eventConfig["repository"]["url"]
          : `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
      shaArchive = `${url}/tarball/${ref}`
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
  core.info(`Resources will be resolved from ${shaArchive}`)

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
    targetPlatform: process.env.VIB_ENV_TARGET_PLATFORM
      ? process.env.VIB_ENV_TARGET_PLATFORM
      : process.env.TARGET_PLATFORM,
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

function getNumberInput(name: string): number {
  return parseInt(core.getInput(name))
}

export function getNumberArray(
  name: string,
  defaultValues: number[]
): number[] {
  const value = core.getInput(name)
  if (typeof value === "undefined" || value === "") {
    return defaultValues
  }

  try {
    const arrNums = JSON.parse(value)

    if (typeof arrNums === "object") {
      return arrNums.map(it => Number(it))
    } else {
      return [Number.parseInt(arrNums)]
    }
  } catch (err) {
    core.debug(`Could not process backoffIntervals value. ${err}`)
    core.warning(`Invalid value for backoffIntervals. Using defaults.`)
  }
  return defaultValues
}

run()
