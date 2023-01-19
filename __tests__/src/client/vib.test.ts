// eslint-disable-next-line filenames/match-regex
import { newClient } from "../../../src/client/clients"
import VIB from "../../../src/client/vib"
import { ExecutionGraphsApi, PipelinesApi, TargetPlatformsApi } from "../../../src/client/vib/api"

jest.mock('../../../src/client/vib/api')
jest.mock('../../../src/client/clients', () => {
  return {
    __esModule: true,
    newClient: jest.fn(() => 'mock client')
  }
})

describe('Given a VIB client', () => {

  it('When it is initialized then it configures the underlying clients properly', () => {
    const timeout = 1000
    const retryCount = 2
    const retryIntervals = [50, 100]
    const userAgent = 'jest'

    new VIB(timeout, retryCount, retryIntervals, userAgent, undefined)

    expect(newClient).toHaveBeenCalledWith(
      {
        timeout: timeout,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": `vib-action/${userAgent}`,
        },
      },
      {
        retries: retryCount,
        backoffIntervals: retryIntervals,
      })
    expect(ExecutionGraphsApi).toHaveBeenCalledWith(undefined, undefined, 'mock client')
    expect(PipelinesApi).toHaveBeenCalledWith(undefined, undefined, 'mock client')
    expect(TargetPlatformsApi).toHaveBeenCalledWith(undefined, undefined, 'mock client')
  })
})