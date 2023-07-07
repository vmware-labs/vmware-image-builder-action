import * as core from "@actions/core"
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios"
import { ConstraintsViolation, ExecutionGraph, ExecutionGraphsApi, Pipeline, PipelinesApi, RawReport,
  SemanticValidationHint,
  TargetPlatform, TargetPlatformsApi } from "./vib/api"
import CSP from "./csp"
import { Readable } from "stream"
import { AxiosHeaders, isAxiosError } from "axios"
import moment from "moment"
import { newClient } from "./clients"
import util from "util"

export enum VerificationModes {
  PARALLEL = "PARALLEL",
  SERIAL = "SERIAL",
}

const DEFAULT_VERIFICATION_MODE = VerificationModes.PARALLEL

class VIB {
  executionGraphsClient: ExecutionGraphsApi
  pipelinesClient: PipelinesApi
  targetPlatformsClient: TargetPlatformsApi

  constructor(clientTimeout: number, clientRetryCount: number, clientRetryIntervals: number[], clientUserAgent: string, 
    csp?: CSP) {
    const client: AxiosInstance = newClient(
      {
        timeout: clientTimeout,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `vib-action/${clientUserAgent}`,
        },
      },
      {
        retries: clientRetryCount,
        backoffIntervals: clientRetryIntervals,
      }
    )

    if (csp) {
      client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
        if (!config.headers) {
          config.headers = new AxiosHeaders()
        }

        config.headers.set("Authorization",  `Bearer ${await csp.getToken()}`)
        return config
      })
    }


    this.executionGraphsClient = new ExecutionGraphsApi(undefined, undefined, client)
    this.pipelinesClient = new PipelinesApi(undefined, undefined, client)
    this.targetPlatformsClient = new TargetPlatformsApi(undefined, undefined, client)
  }

  async createPipeline(
    pipeline: Pipeline,
    pipelineDurationMillis: number,
    verificationMode?: VerificationModes
  ): Promise<string> {
    try {
      core.debug(`Sending pipeline [pipeline=${util.inspect(pipeline)}]`)

      const response: AxiosResponse = await this.pipelinesClient.startPipeline(pipeline, undefined, {
        headers: {
          "X-Verification-Mode": `${verificationMode || DEFAULT_VERIFICATION_MODE}`,
          "X-Expires-After": moment()
            .add(pipelineDurationMillis / 1000.0, "s")
            .format("ddd, DD MMM YYYY HH:mm:ss z"),
        },
      })  
      
      core.debug(`Got response.data : ${JSON.stringify(response.data)}, headers: ${util.inspect(response.headers)}`)

      //TODO: Handle response codes
      const locationHeader: string = response.headers["location"]?.toString()
      if (!locationHeader) {
        throw new Error("Location header not found")
      }

      return locationHeader.substring(locationHeader.lastIndexOf("/") + 1)
    } catch (error) {
      core.debug(JSON.stringify(error))
      throw new Error(`Unexpected error creating pipeline.`)
    }
  }

  async getExecutionGraph(executionGraphId: string): Promise<ExecutionGraph> {
    try {
      core.debug(`Getting execution graph [id=${executionGraphId}]`)

      const response = await this.executionGraphsClient.getExecutionGraph(executionGraphId)

      core.debug(`Got response.data : ${JSON.stringify(response.data)}, headers: ${util.inspect(response.headers)}`)

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err.toJSON()))
        if (err.response.status === 404) {
          throw new Error(
            err.response.data ? err.response.data.detail : `Could not find execution graph with id ${executionGraphId}`
          )
        }
        throw err
      }
      throw err
    }
  }

  async getRawLogs(executionGraphId: string, taskId: string): Promise<string> {
    try {
      core.debug(`Downloading raw logs [executionGraphId=${executionGraphId}, taskId=${taskId}]`)

      const response = await this.executionGraphsClient.getRawTaskLogs(executionGraphId, taskId)

      core.debug(`Got response.data : ${JSON.stringify(response.data)}, headers: ${util.inspect(response.headers)}`)

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err.toJSON()))
        throw new Error(
          `Error fetching logs for task ${taskId}. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  async getRawReport(executionGraphId: string, taskId: string, reportId: string): Promise<Readable> {
    try {
      core.debug(`Downloading raw report [executionGraphId=${executionGraphId}, taskId=${taskId}, reportId=${reportId}]`)

      const response = await this.executionGraphsClient.getTaskResultRawReportById(executionGraphId, taskId, reportId, {
        responseType: "stream",
      })

      //TODO: Handle response codes
      return response.data as unknown as Readable // Hack bc the autogenerated client says it's a string
    } catch (err) {
      if (isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err.toJSON()))
        throw new Error(
          `Error fetching raw report ${reportId} for task ${taskId}. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  async getRawReports(executionGraphId: string, taskId: string): Promise<RawReport[]> {
    try {
      core.debug(`Getting raw reports [executionGraphId=${executionGraphId}, taskId=${taskId}]`)

      const response = await this.executionGraphsClient.getTaskResultRawReports(executionGraphId, taskId)

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err.toJSON()))
        throw new Error(
          `Error fetching raw reports for task ${taskId}. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  async getExecutionGraphBundle(executionGraphId: string): Promise<Readable> {
    try {
      core.debug(`Getting bundle [executionGraphId=${executionGraphId}`)

      const response = await this.executionGraphsClient.getExecutionGraphBundle(executionGraphId, {
        responseType: "stream",
      })

      //TODO: Handle response codes
      return response.data as unknown as Readable // Hack bc the autogenerated client says it's a string
    } catch (err) {
      if (isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err.toJSON()))
        throw new Error(
          `Error fetching bundle for execution graph ${executionGraphId}. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getTaskReport(executionGraphId: string, taskId: string): Promise<{[key: string]: any}> {
    try {
      core.debug(`Downloading task report [executionGraphId=${executionGraphId}, taskId=${taskId}]`)

      const response = await this.executionGraphsClient.getTaskResultReport(executionGraphId, taskId)

      core.debug(`Got response.data : ${JSON.stringify(response.data)}, headers: ${util.inspect(response.headers)}`)

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err.toJSON()))
        throw new Error(
          `Error fetching task ${taskId} report. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  async getTargetPlatform(targetPlatformId: string): Promise<TargetPlatform> {
    try {
      core.debug(`Getting target platform ${targetPlatformId}`)

      const response = await this.targetPlatformsClient.getTargetPlatform(targetPlatformId)

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err.toJSON()))
        throw new Error(
          `Error fetching target platform. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  async getTargetPlatforms(): Promise<TargetPlatform[]> {
    try {
      core.debug(`Getting target platforms`)

      const response = await this.targetPlatformsClient.getTargetPlatforms(undefined, undefined, undefined, undefined, 
        undefined)

      //TODO: Handle response codes
      return response.data
    } catch (err) {
      if (isAxiosError(err) && err.response) {
        core.debug(JSON.stringify(err.toJSON()))
        throw new Error(
          `Error fetching target platforms. Code: ${err.response.status}. Message: ${err.response.statusText}`
        )
      } else {
        throw err
      }
    }
  }

  async validatePipeline(pipeline: Pipeline): Promise<SemanticValidationHint[]> {
    try {
      core.debug(`Validating pipeline [pipeline=${util.inspect(pipeline)}]`)

      const response = await this.pipelinesClient.validatePipeline(pipeline)

      core.debug(`Got response.data : ${JSON.stringify(response.data)}, headers: ${util.inspect(response.headers)}`)

      //TODO: Handle response codes
      return response.data
    } catch (error) {
      if (isAxiosError(error) && error.response) {
        if (error.response.status === 400) {
          throw new Error(error.response?.data?.violations.map((v: ConstraintsViolation) => `Field: ${v.field}. Error: ${v.message}`).toString())
        }

        throw new Error(
          `Could not reach out to VIB. Please try again. Code: ${error.response.status}. Message: ${error.response.statusText}`
        )
      } else {
        throw error
      }
    }
  }
}

export default VIB