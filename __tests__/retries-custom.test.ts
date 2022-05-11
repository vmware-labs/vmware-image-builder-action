// eslint-disable-next-line filenames/match-regex
import * as constants from "../src/constants"
import * as core from "@actions/core"
import MockAdapter from "axios-mock-adapter"
process.env["INPUT_RETRY-COUNT"] = "5"
process.env["INPUT_BACKOFF-INTERVALS"] = "[100,200]"
import { cspClient, getExecutionGraph, reset, vibClient } from "../src/main"

const fixedExecutionGraphId = "d632043b-f74c-4901-8e00-0dbed62f1031"
const STARTING_ENV = process.env

describe("On GitHub Action ", () => {
  let cspStub: MockAdapter
  let vibStub: MockAdapter
  beforeAll(async () => {
    // mock all output so that there is less noise when running tests
    //jest.spyOn(console, 'log').mockImplementation(() => {})
    //jest.spyOn(core, 'debug').mockImplementation(() => {})
    jest.spyOn(core, "info").mockImplementation(() => {})
    jest.spyOn(core, "warning").mockImplementation(() => {})
    jest.spyOn(core, "setFailed")
  })

  beforeEach(async () => {
    jest.resetModules()
    cspStub = new MockAdapter(cspClient)
    vibStub = new MockAdapter(vibClient)
    process.env = { ...STARTING_ENV }
    process.env["VIB_PUBLIC_URL"] = constants.DEFAULT_VIB_PUBLIC_URL
    process.env["CSP_API_URL"] = constants.DEFAULT_CSP_API_URL
  })

  afterEach(async () => {
    jest.clearAllMocks()
    cspStub.reset()
    reset() // removes cached tokens
  })

  afterAll(async () => {})

  it("VIB client times out, retries and then fails with custom retry count", async () => {
    // time it out!
    cspStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        '{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "h72827dd","refresh_token": "aT4epjdh"}'
      )
    vibStub.onGet(`/v1/execution-graphs/${fixedExecutionGraphId}`).timeout()

    await expect(getExecutionGraph(fixedExecutionGraphId)).rejects.toThrow(
      new Error("Could not execute operation. Retried 5 times.")
    )
    expect(core.info).toHaveBeenCalledTimes(5)
  })

  it("VIB client times out, retries and then fails with custom backoff intervals", async () => {
    // Use a shorter backoff intervals array to make sure that it works
    // 200 should be reused for the last 3 attempts
    cspStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        '{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "h72827dd","refresh_token": "aT4epjdh"}'
      )
    vibStub.onGet(`/v1/execution-graphs/${fixedExecutionGraphId}`).timeout()

    await expect(getExecutionGraph(fixedExecutionGraphId)).rejects.toThrow(
      new Error("Could not execute operation. Retried 5 times.")
    )
    expect(core.info).toHaveBeenCalledTimes(5)
  })
})
