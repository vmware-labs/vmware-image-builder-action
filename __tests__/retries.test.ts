// eslint-disable-next-line filenames/match-regex
import * as clients from '../src/client/clients';
import * as core from '@actions/core';
import MockAdapter from 'axios-mock-adapter';
import { randomUUID } from 'crypto';
import { AxiosInstance } from 'axios';

const STARTING_ENV = process.env;

describe('Given a custom client', () => {
  let client: AxiosInstance;
  let serverStub: MockAdapter;

  beforeAll(async () => {
    // mock all output so that there is less noise when running tests
    jest
      .spyOn(core, 'info')
      .mockImplementation((msg) => console.log('::info:: ' + msg));
    jest
      .spyOn(core, 'warning')
      .mockImplementation((msg) => console.log('::warning:: ' + msg));
    jest
      .spyOn(core, 'debug')
      .mockImplementation((msg) => console.log('::debug:: ' + msg));
    jest.spyOn(core, 'setFailed');
  });

  beforeEach(async () => {
    jest.resetModules();
    process.env = { ...STARTING_ENV };

    client = clients.newClient(
      { timeout: 120000 },
      { retries: 3, backoffIntervals: [500, 1000, 2000] }
    );
    serverStub = new MockAdapter(client);
  });

  it('When it does a regular request then it succeeds', async () => {
    const route = `/${randomUUID()}`;
    const body = 'ok';
    serverStub.onGet(route).replyOnce(200, body);

    const response = await client.get(route);

    expect(response.status).toEqual(200);
    expect(response.data).toEqual(body);
  });

  it('When it times out then it retries and fails', async () => {
    const route = `/${randomUUID()}`;

    serverStub.onGet(route).timeout();

    await expect(client.get(route)).rejects.toThrow(
      new Error('Could not execute operation. Retried 3 times.')
    );
    expect(core.info).toHaveBeenCalledTimes(3);
  });

  it('When it has a network error then it retries and fails', async () => {
    const route = `/${randomUUID()}`;

    serverStub.onGet(route).networkError();

    await expect(client.get(route)).rejects.toThrow(
      new Error('Could not execute operation. Retried 3 times.')
    );
    expect(core.info).toHaveBeenCalledTimes(3);
  });

  it('When it times out then it retries and recovers', async () => {
    const route = `/${randomUUID()}`;

    serverStub.onGet(route).timeoutOnce();

    // Not sure if this can be done better with axios-mock-adapter. Request will timeout once and then
    // returns a 404 as we cannot mock a proper response ( adapter only supports one mock response per endpoint )
    await expect(client.get(route)).rejects.toThrow(
      new Error('Request failed with status code 404')
    );
    expect(core.info).toHaveBeenCalledTimes(1);
  });

  it('When it has a network error then it retries and recovers', async () => {
    const route = `/${randomUUID()}`;

    serverStub.onGet(route).networkErrorOnce();

    // Not sure if this can be done better with axios-mock-adapter. Request will error once and then
    // returns a 404 as we cannot mock a proper response ( adapter only supports one mock response per endpoint )
    await expect(client.get(route)).rejects.toThrow(
      new Error('Request failed with status code 404')
    );
    expect(core.info).toHaveBeenCalledTimes(1);
  });

  it('When it gets unsuccessful responses then it retries for retriable codes', async () => {
    const route = `/${randomUUID()}`;

    serverStub.onGet(route).reply(503, { error: 'some-error-back' });

    await expect(client.get(route)).rejects.toThrow(
      new Error('Could not execute operation. Retried 3 times.')
    );
  });

  it("When it gets unsuccessful responses then it doesn't retry unhandled codes", async () => {
    const route = `/${randomUUID()}`;
    const statusCode = 400;

    serverStub.onGet(route).reply(statusCode, { error: 'some-error-back' });

    await expect(client.get(route)).rejects.toThrow(
      new Error(`Request failed with status code ${statusCode}`)
    );
  });

  it('When it receives a Retry-After header then it retries accordingly', async () => {
    const route = `/${randomUUID()}`;
    const retryPeriod = 1;

    serverStub
      .onGet(route)
      .reply(503, { error: 'some-error-back' }, { 'Retry-After': retryPeriod });

    await expect(client.get(route)).rejects.toThrow(
      new Error('Could not execute operation. Retried 3 times.')
    );
    expect(core.debug).toHaveBeenCalledWith(
      `Following server advice. Will retry after ${retryPeriod} seconds`
    );
  });

  it('When it receives a bad Retry-After header then it is resilient', async () => {
    const route = `/${randomUUID()}`;
    const retryPeriod = 'foo';

    serverStub
      .onGet(route)
      .reply(503, { error: 'some-error-back' }, { 'Retry-After': retryPeriod });

    await expect(client.get(route)).rejects.toThrow(
      new Error('Could not execute operation. Retried 3 times.')
    );
    expect(core.debug).toHaveBeenCalledWith(
      `Could not parse Retry-After header value ${retryPeriod}`
    );
  });

  it('When it requests a bad URI then it times out', async () => {
    const badUriClient = clients.newClient(
      {
        baseURL: `http://foo-${randomUUID().toString()}.vmware.com`, // non-existing, it will fail.
        timeout: 100,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
      {
        retries: 3,
        backoffIntervals: [100, 200, 500],
        retriableErrorCodes: ['ECONNABORTED', 'ENOTFOUND', 'ECONNREFUSED'],
      }
    );

    await expect(badUriClient.get('/bar')).rejects.toThrow(
      new Error('Could not execute operation. Retried 3 times.')
    );
    expect(core.info).toHaveBeenCalledTimes(3);
  });
});
