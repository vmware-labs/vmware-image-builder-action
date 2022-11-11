// eslint-disable-next-line filenames/match-regex
import * as clients from "../src/clients"
import * as constants from "../src/constants"
import * as core from "@actions/core"
import MockAdapter from "axios-mock-adapter"
import { cspClient, getExecutionGraph, getToken, reset, vibClient } from "../src/main"
import { randomUUID } from "crypto"

const tkgPlatformId = "7ddab896-2e4e-4d58-a501-f79897eba3a0"
const fixedExecutionGraphId = "d632043b-f74c-4901-8e00-0dbed62f1031"
const STARTING_ENV = process.env

describe("On GitHub Action ", () => {
  let cspStub: MockAdapter
  let vibStub: MockAdapter
  beforeAll(async () => {
    // mock all output so that there is less noise when running tests
    //jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(core, "info").mockImplementation(msg => {
      console.log("::info:: " + msg)
    })
    jest.spyOn(core, "warning").mockImplementation(msg => {
      console.log("::warning:: " + msg)
    })
    jest.spyOn(core, "debug").mockImplementation(msg => {
      console.log("::debug:: " + msg)
    })
    jest.spyOn(core, "setFailed")

    // Mock a token so it is not a requirement when running tests
    process.env["CSP_API_TOKEN"] = "foo"
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

  it("VIB client does a regular request then succeeds", async () => {
    // no retries exercising on this one yet. Just making sure all is good and there won't be noise.

    cspStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        '{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "h72827dd","refresh_token": "aT4epjdh"}'
      )
    vibStub
      .onGet(`/v1/execution-graphs/${fixedExecutionGraphId}`)
      .replyOnce(200, '{"execution-graph-id": "abcd", "tasks":[]}')

    const executionGraph = await getExecutionGraph(fixedExecutionGraphId)
    expect(executionGraph).toBeDefined()
  })

  it("VIB client times out, retries and then fails", async () => {
    // time it out!

    cspStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        '{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "h72827dd","refresh_token": "aT4epjdh"}'
      )
    vibStub.onGet(`/v1/execution-graphs/${fixedExecutionGraphId}`).timeout()

    await expect(getExecutionGraph(fixedExecutionGraphId)).rejects.toThrow(
      new Error("Could not execute operation. Retried 3 times.")
    )
    expect(core.info).toHaveBeenCalledTimes(3)
  })

  it("VIB client has a network error, retries and then fails", async () => {
    // network error!

    cspStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        '{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "h72827dd","refresh_token": "aT4epjdh"}'
      )
    vibStub.onGet(`/v1/execution-graphs/${fixedExecutionGraphId}`).networkError()

    await expect(getExecutionGraph(fixedExecutionGraphId)).rejects.toThrow(
      new Error("Could not execute operation. Retried 3 times.")
    )
    expect(core.info).toHaveBeenCalledTimes(3)
  })

  it("VIB client times out, retries and then recovers", async () => {
    // time it out!

    cspStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        '{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "h72827dd","refresh_token": "aT4epjdh"}'
      )
    vibStub.onGet(`/v1/execution-graphs/${fixedExecutionGraphId}`).timeoutOnce()

    // Not sure if this can be done better with axios-mock-adapter. Request will timeout once and then
    // returns a 404 as we cannot mock a proper response ( adapter only supports one mock response per endpoint )
    await expect(getExecutionGraph(fixedExecutionGraphId)).rejects.toThrow(
      new Error("Could not find execution graph with id d632043b-f74c-4901-8e00-0dbed62f1031")
    )
    expect(core.info).toHaveBeenCalledTimes(1)
  })

  it("VIB client has a network error, retries and then recovers", async () => {
    // network error!

    cspStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        '{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "h72827dd","refresh_token": "aT4epjdh"}'
      )
    vibStub.onGet(`/v1/execution-graphs/${fixedExecutionGraphId}`).networkErrorOnce()

    // Not sure if this can be done better with axios-mock-adapter. Request will error once and then
    // returns a 404 as we cannot mock a proper response ( adapter only supports one mock response per endpoint )
    await expect(getExecutionGraph(fixedExecutionGraphId)).rejects.toThrow(
      new Error("Could not find execution graph with id d632043b-f74c-4901-8e00-0dbed62f1031")
    )
    expect(core.info).toHaveBeenCalledTimes(1)
  })

  it("VIB client retries for retriable codes", async () => {
    // time it out!

    cspStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        '{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "h72827dd","refresh_token": "aT4epjdh"}'
      )
    vibStub.onGet(`/v1/execution-graphs/${fixedExecutionGraphId}`).reply(503, { error: "some-error-back" })

    await expect(getExecutionGraph(fixedExecutionGraphId)).rejects.toThrow(
      new Error("Could not execute operation. Retried 3 times.")
    )
  })

  it("VIB client does not retry for non retriable", async () => {
    // time it out!

    cspStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        '{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "h72827dd","refresh_token": "aT4epjdh"}'
      )
    vibStub.onGet(`/v1/execution-graphs/${fixedExecutionGraphId}`).reply(400, { error: "some-error-back" })

    await expect(getExecutionGraph(fixedExecutionGraphId)).rejects.toThrow(
      new Error("Request failed with status code 400")
    )
  })

  it("VIB client retries ruling Retry-After header", async () => {
    // time it out!

    cspStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        '{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "h72827dd","refresh_token": "aT4epjdh"}'
      )
    vibStub
      .onGet(`/v1/execution-graphs/${fixedExecutionGraphId}`)
      .reply(503, { error: "some-error-back" }, { "Retry-After": 1 })

    await expect(getExecutionGraph(fixedExecutionGraphId)).rejects.toThrow(
      new Error("Could not execute operation. Retried 3 times.")
    )
    expect(core.debug).toHaveBeenCalledWith("Following server advice. Will retry after 1 seconds")
  })

  it("VIB client retries ruling Retry-After header and is resilient to bad header data", async () => {
    // time it out!

    cspStub
      .onPost("/csp/gateway/am/api/auth/api-tokens/authorize")
      .replyOnce(
        200,
        '{"id_token": "aToken","token_type": "bearer","expires_in": 1799,"scope": "*","access_token": "h72827dd","refresh_token": "aT4epjdh"}'
      )
    vibStub
      .onGet(`/v1/execution-graphs/${fixedExecutionGraphId}`)
      .reply(503, { error: "some-error-back" }, { "Retry-After": "foo" })

    await expect(getExecutionGraph(fixedExecutionGraphId)).rejects.toThrow(
      new Error("Could not execute operation. Retried 3 times.")
    )
    expect(core.debug).toHaveBeenCalledWith("Could not parse Retry-After header value foo")
  })

  it("Bad URI times out", async () => {
    const badUriClient = clients.newClient(
      {
        baseURL: `http://foo-${randomUUID().toString()}.vmware.com`, // non-existing, it will fail.
        timeout: 100,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
      {
        retries: 3,
        backoffIntervals: [100, 200, 500],
        retriableErrorCodes: ["ECONNABORTED", "ENOTFOUND", "ECONNREFUSED"],
      }
    )

    try {
      await badUriClient.get("/bar")
    } catch (err) {
      console.log("We got an error")
    }

    expect(core.info).toHaveBeenCalledTimes(3)
  })
})
