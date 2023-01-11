// eslint-disable-next-line filenames/match-regex
import * as clients from "../src/client/clients"
import * as core from "@actions/core"
import MockAdapter from "axios-mock-adapter"
import { randomUUID } from "crypto"
import VIB from "../src/client/vib"

const EXECUTION_GRAPH_ID = "d632043b-f74c-4901-8e00-0dbed62f1031"
const STARTING_ENV = process.env

describe("On GitHub Action ", () => {
  let vibClient: VIB
  let vibStub: MockAdapter

  beforeAll(async () => {
    // mock all output so that there is less noise when running tests
    jest.spyOn(core, "info").mockImplementation(msg => console.log("::info:: " + msg))
    jest.spyOn(core, "warning").mockImplementation(msg => console.log("::warning:: " + msg))
    jest.spyOn(core, "debug").mockImplementation(msg => console.log("::debug:: " + msg))
    jest.spyOn(core, "setFailed")
  })

  beforeEach(async () => {
    jest.resetModules()
    process.env = { ...STARTING_ENV }

    vibClient = new VIB()
    vibStub = new MockAdapter(vibClient.client)
  })

  it("VIB client does a regular request then succeeds", async () => {
    vibStub
      .onGet(`/v1/execution-graphs/${EXECUTION_GRAPH_ID}`)
      .replyOnce(200, '{"execution-graph-id": "abcd", "tasks":[]}')

    const executionGraph = await vibClient.getExecutionGraph(EXECUTION_GRAPH_ID)
    expect(executionGraph).toBeDefined()
  })

  it("VIB client times out, retries and then fails", async () => {
    vibStub.onGet(`/v1/execution-graphs/${EXECUTION_GRAPH_ID}`).timeout()

    await expect(vibClient.getExecutionGraph(EXECUTION_GRAPH_ID)).rejects.toThrow(
      new Error("Could not execute operation. Retried 3 times.")
    )
    expect(core.info).toHaveBeenCalledTimes(3)
  })

  it("VIB client times out, retries and then fails with custom retry count", async () => {
    process.env["INPUT_RETRY-COUNT"] = "5"
    process.env["INPUT_BACKOFF-INTERVALS"] = "[100, 200]"
    vibClient = new VIB()
    vibStub = new MockAdapter(vibClient.client)

    vibStub.onGet(`/v1/execution-graphs/${EXECUTION_GRAPH_ID}`).timeout()

    await expect(vibClient.getExecutionGraph(EXECUTION_GRAPH_ID)).rejects.toThrow(
      new Error("Could not execute operation. Retried 5 times.")
    )
    expect(core.info).toHaveBeenCalledTimes(5)
  })

  it("VIB client has a network error, retries and then fails", async () => {
    vibStub.onGet(`/v1/execution-graphs/${EXECUTION_GRAPH_ID}`).networkError()

    await expect(vibClient.getExecutionGraph(EXECUTION_GRAPH_ID)).rejects.toThrow(
      new Error("Could not execute operation. Retried 3 times.")
    )
    expect(core.info).toHaveBeenCalledTimes(3)
  })

  it("VIB client times out, retries and then recovers", async () => {
    vibStub.onGet(`/v1/execution-graphs/${EXECUTION_GRAPH_ID}`).timeoutOnce()

    // Not sure if this can be done better with axios-mock-adapter. Request will timeout once and then
    // returns a 404 as we cannot mock a proper response ( adapter only supports one mock response per endpoint )
    await expect(vibClient.getExecutionGraph(EXECUTION_GRAPH_ID)).rejects.toThrow(
      new Error(`Could not find execution graph with id ${EXECUTION_GRAPH_ID}`)
    )
    expect(core.info).toHaveBeenCalledTimes(1)
  })

  it("VIB client has a network error, retries and then recovers", async () => {
    vibStub.onGet(`/v1/execution-graphs/${EXECUTION_GRAPH_ID}`).networkErrorOnce()

    // Not sure if this can be done better with axios-mock-adapter. Request will error once and then
    // returns a 404 as we cannot mock a proper response ( adapter only supports one mock response per endpoint )
    await expect(vibClient.getExecutionGraph(EXECUTION_GRAPH_ID)).rejects.toThrow(
      new Error(`Could not find execution graph with id ${EXECUTION_GRAPH_ID}`)
    )
    expect(core.info).toHaveBeenCalledTimes(1)
  })

  it("VIB client retries for retriable codes", async () => {
    vibStub.onGet(`/v1/execution-graphs/${EXECUTION_GRAPH_ID}`).reply(503, { error: "some-error-back" })

    await expect(vibClient.getExecutionGraph(EXECUTION_GRAPH_ID)).rejects.toThrow(
      new Error("Could not execute operation. Retried 3 times.")
    )
  })

  it("VIB client does not retry for non retriable", async () => {
    vibStub.onGet(`/v1/execution-graphs/${EXECUTION_GRAPH_ID}`).reply(400, { error: "some-error-back" })

    await expect(vibClient.getExecutionGraph(EXECUTION_GRAPH_ID)).rejects.toThrow(
      new Error("Request failed with status code 400")
    )
  })

  it("VIB client retries ruling Retry-After header", async () => {
    vibStub
      .onGet(`/v1/execution-graphs/${EXECUTION_GRAPH_ID}`)
      .reply(503, { error: "some-error-back" }, { "Retry-After": 1 })

    await expect(vibClient.getExecutionGraph(EXECUTION_GRAPH_ID)).rejects.toThrow(
      new Error("Could not execute operation. Retried 3 times.")
    )
    expect(core.debug).toHaveBeenCalledWith("Following server advice. Will retry after 1 seconds")
  })

  it("VIB client retries ruling Retry-After header and is resilient to bad header data", async () => {
    vibStub
      .onGet(`/v1/execution-graphs/${EXECUTION_GRAPH_ID}`)
      .reply(503, { error: "some-error-back" }, { "Retry-After": "foo" })

    await expect(vibClient.getExecutionGraph(EXECUTION_GRAPH_ID)).rejects.toThrow(
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
